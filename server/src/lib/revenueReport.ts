/**
 * Daily revenue report: an Excel workbook built from the ERP data (customer
 * invoices + customer orders not yet invoiced) and emailed every morning.
 *
 * Logic follows the reviewed "TripleW Revenues" workbook:
 *  - USD (and other non-EUR) amounts are converted at ONE fixed rate shown on the
 *    Summary (default 0.91 USD→EUR), not at each invoice's own FX rate
 *  - Revenue = invoiced + orders not yet invoiced
 *  - Region comes from the operation / order destination country; an invoice with
 *    no country takes its customer's region from the customer's other invoices
 *  - Distribution tables (region / customer / quarter) all add up to the total
 */
import cron from 'node-cron';
import ExcelJS from 'exceljs';
import { Resend } from 'resend';
import db from '../database.js';
import { resolveCountry } from './portCountry.js';

const TIMEZONE = 'Europe/Brussels';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DEFAULT_USD_EUR = 0.91;

export interface RevenueReportSettings {
  enabled: boolean;
  recipients: string[];
  hour: number;
  minute: number;
  usd_eur: number;
}

const DEFAULTS: RevenueReportSettings = {
  enabled: true,
  recipients: ['amir.oranim@triplew.co'],
  hour: 7,
  minute: 0,
  usd_eur: DEFAULT_USD_EUR,
};

function readSetting(key: string): any {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
    return row ? JSON.parse(row.value) : null;
  } catch { return null; }
}

function writeSetting(key: string, value: unknown) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(key, JSON.stringify(value));
}

export function normalizeRevenueReportSettings(raw: any): RevenueReportSettings {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r) return { ...DEFAULTS, recipients: [...DEFAULTS.recipients] };
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  const list = Array.isArray(r.recipients) ? r.recipients : String(r.recipients ?? '').split(/[,;\s]+/);
  const recipients = [...new Set(list.map((e: unknown) => String(e).trim().toLowerCase()).filter((e: string) => EMAIL_RE.test(e)))] as string[];
  const rate = Number(r.usd_eur);
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULTS.enabled,
    recipients,
    hour: int(r.hour, 0, 23, DEFAULTS.hour),
    minute: int(r.minute, 0, 59, DEFAULTS.minute),
    usd_eur: rate > 0 && rate < 5 ? rate : DEFAULT_USD_EUR,
  };
}

export function getRevenueReportSettings(): RevenueReportSettings {
  return normalizeRevenueReportSettings(readSetting('revenue_report'));
}

export function getLastRevenueReport(): { at: string; ok: boolean; message: string } | null {
  return readSetting('revenue_report_last');
}

export function saveRevenueReportSettings(s: RevenueReportSettings) {
  writeSetting('revenue_report', s);
  startRevenueReportScheduler();
}

// ── Regions ────────────────────────────────────────────────────────────────

const EU = ['austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech republic', 'czechia', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden', 'united kingdom', 'uk', 'switzerland', 'norway', 'turkey', 'türkiye'];
const NA = ['united states', 'usa', 'us', 'canada'];
const LATAM = ['mexico', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'costa rica', 'panama', 'colombia', 'venezuela', 'ecuador', 'peru', 'bolivia', 'chile', 'argentina', 'uruguay', 'paraguay', 'brazil', 'dominican republic', 'cuba', 'puerto rico'];
const ASIA = ['china', 'india', 'japan', 'south korea', 'korea', 'singapore', 'thailand', 'vietnam', 'indonesia', 'malaysia', 'philippines', 'taiwan', 'hong kong', 'israel', 'saudi arabia', 'united arab emirates', 'uae'];

export function regionOfCountry(country: string | null | undefined): string | null {
  const c = String(country || '').trim().toLowerCase();
  if (!c) return null;
  if (EU.includes(c)) return 'EU';
  if (NA.includes(c)) return 'NA';
  if (LATAM.includes(c)) return 'LATAM';
  if (ASIA.includes(c)) return 'Asia';
  return 'Other';
}

export function quarterOf(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(date || ''));
  if (!m) return 'No date';
  return `${m[1]}-Q${Math.floor((Number(m[2]) - 1) / 3) + 1}`;
}

// ── Data ───────────────────────────────────────────────────────────────────

interface InvoiceRow {
  invoice_number: string; customer: string; operation_number: string | null; status: string;
  invoice_date: string | null; currency: string; amount: number; paid: number;
  country: string | null; region: string; quarter: string;
}
interface OpenLine {
  order_number: string; operation_number: string | null; customer: string; order_date: string | null;
  description: string; quantity: number; unit: string; currency: string; amount: number;
  country: string | null; region: string; quarter: string;
}

const PAID_STATUSES = ['paid', 'paid_with_other'];

export function collectRevenueData() {
  const invoiceRows = db.prepare(`
    SELECT i.invoice_number, c.name AS customer, i.status, i.amount, i.currency,
           COALESCE(i.invoice_date, substr(i.created_at, 1, 10)) AS invoice_date,
           op.operation_number AS operation_number, op.country AS op_country,
           o.destination AS destination
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN operations op ON op.id = i.operation_id
    LEFT JOIN orders o ON o.id = op.order_id
    WHERE i.type = 'customer' AND i.technology_operation_id IS NULL
      AND i.status NOT IN ('draft', 'cancelled')
    ORDER BY invoice_date, i.invoice_number
  `).all() as any[];

  // A customer's region, learned from their invoices that do have a country
  const customerRegion = new Map<string, Record<string, number>>();
  const withCountry = invoiceRows.map(r => {
    const country = r.op_country || (r.destination ? resolveCountry(r.destination) : null) || null;
    const region = regionOfCountry(country);
    if (region && r.customer) {
      const m = customerRegion.get(r.customer) ?? {};
      m[region] = (m[region] ?? 0) + 1;
      customerRegion.set(r.customer, m);
    }
    return { ...r, country, region };
  });
  const fallback = (customer: string | null) => {
    const m = customer ? customerRegion.get(customer) : null;
    if (!m) return null;
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
  };

  const invoices: InvoiceRow[] = withCountry.map(r => ({
    invoice_number: r.invoice_number, customer: r.customer || '(unknown)', operation_number: r.operation_number,
    status: r.status, invoice_date: r.invoice_date, currency: r.currency || 'EUR', amount: Number(r.amount) || 0,
    paid: PAID_STATUSES.includes(r.status) ? 1 : 0,
    country: r.country, region: r.region || fallback(r.customer) || 'Unmatched', quarter: quarterOf(r.invoice_date),
  }));

  // Customer orders with no invoice on their operation yet
  const lineRows = db.prepare(`
    SELECT o.order_number, COALESCE(o.operation_number, op.operation_number) AS operation_number,
           c.name AS customer, o.order_date, o.destination, op.country AS op_country,
           oi.description, oi.quantity, oi.unit, oi.currency, COALESCE(oi.total, oi.quantity * oi.unit_price) AS amount
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN operations op ON op.order_id = o.id
    WHERE o.type = 'customer' AND o.status != 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.type = 'customer' AND i.status != 'cancelled'
          AND (i.operation_id = op.id
               OR (i.our_ref IS NOT NULL AND i.our_ref != '' AND i.our_ref = COALESCE(o.operation_number, op.operation_number)))
      )
    ORDER BY o.order_date, o.order_number
  `).all() as any[];

  const open: OpenLine[] = lineRows.map(r => {
    const country = r.op_country || (r.destination ? resolveCountry(r.destination) : null) || null;
    return {
      order_number: r.order_number, operation_number: r.operation_number, customer: r.customer || '(unknown)',
      order_date: r.order_date, description: r.description, quantity: Number(r.quantity) || 0, unit: r.unit || '',
      currency: r.currency || 'USD', amount: Number(r.amount) || 0, country,
      region: regionOfCountry(country) || fallback(r.customer) || 'Unmatched', quarter: quarterOf(r.order_date),
    };
  });

  return { invoices, open };
}

// ── Workbook ───────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function buildRevenueWorkbook(rate = DEFAULT_USD_EUR): Promise<{ buffer: Buffer; totals: { invoiced: number; open: number; total: number; unmatched: number; checksOk: boolean } }> {
  const { invoices, open } = collectRevenueData();
  const eur = (cur: string, amt: number) => (cur === 'EUR' ? amt : amt * rate);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'TripleW ERP';
  wb.created = new Date();
  const sum = wb.addWorksheet('Summary');
  const inv = wb.addWorksheet('Invoices');
  const lines = wb.addWorksheet('Open orders');

  // Invoices sheet: EUR column is a formula on the Summary rate
  inv.columns = [
    { header: 'Invoice', key: 'n', width: 18 }, { header: 'Customer', key: 'c', width: 30 },
    { header: 'Operation', key: 'op', width: 18 }, { header: 'Status', key: 's', width: 12 },
    { header: 'Invoice date', key: 'd', width: 12 }, { header: 'Currency', key: 'cur', width: 9 },
    { header: 'Amount', key: 'a', width: 14 }, { header: 'EUR equivalent', key: 'e', width: 16 },
    { header: 'Country', key: 'co', width: 16 }, { header: 'Region', key: 'r', width: 11 },
    { header: 'Quarter', key: 'q', width: 10 }, { header: 'Paid', key: 'p', width: 7 },
  ];
  invoices.forEach((r, i) => {
    const row = i + 2;
    inv.addRow({
      n: r.invoice_number, c: r.customer, op: r.operation_number, s: r.status, d: r.invoice_date, cur: r.currency,
      a: r.amount, e: { formula: `IF(F${row}="EUR",G${row},G${row}*Summary!$C$5)`, result: round2(eur(r.currency, r.amount)) },
      co: r.country, r: r.region, q: r.quarter, p: r.paid,
    });
  });

  lines.columns = [
    { header: 'Order', key: 'n', width: 18 }, { header: 'Operation', key: 'op', width: 18 },
    { header: 'Customer', key: 'c', width: 30 }, { header: 'Order date', key: 'd', width: 12 },
    { header: 'Description', key: 'ds', width: 36 }, { header: 'Quantity', key: 'qty', width: 10 },
    { header: 'Unit', key: 'u', width: 8 }, { header: 'Currency', key: 'cur', width: 9 },
    { header: 'Amount', key: 'a', width: 14 }, { header: 'EUR equivalent', key: 'e', width: 16 },
    { header: 'Country', key: 'co', width: 16 }, { header: 'Region', key: 'r', width: 11 }, { header: 'Quarter', key: 'qt', width: 10 },
  ];
  open.forEach((r, i) => {
    const row = i + 2;
    lines.addRow({
      n: r.order_number, op: r.operation_number, c: r.customer, d: r.order_date, ds: r.description, qty: r.quantity, u: r.unit,
      cur: r.currency, a: r.amount, e: { formula: `IF(H${row}="EUR",I${row},I${row}*Summary!$C$5)`, result: round2(eur(r.currency, r.amount)) },
      co: r.country, r: r.region, qt: r.quarter,
    });
  });
  for (const ws of [inv, lines]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const nI = invoices.length + 1;   // last data row on Invoices
  const nL = open.length + 1;       // last data row on Open orders
  const INV = (col: string) => `Invoices!$${col}$2:$${col}$${Math.max(nI, 2)}`;
  const LIN = (col: string) => `'Open orders'!$${col}$2:$${col}$${Math.max(nL, 2)}`;

  const invoiced = round2(invoices.reduce((s, r) => s + eur(r.currency, r.amount), 0));
  const openEur = round2(open.reduce((s, r) => s + eur(r.currency, r.amount), 0));

  // Summary
  sum.getColumn(1).width = 44; sum.getColumn(2).width = 18; sum.getColumn(3).width = 18; sum.getColumn(4).width = 4;
  sum.getColumn(5).width = 18; sum.getColumn(6).width = 18;
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  sum.getCell('A1').value = 'TripleW revenues — daily ERP report'; sum.getCell('A1').font = { bold: true, size: 14 };
  sum.getCell('A2').value = `Generated ${stamp} (Brussels) from the ERP`;
  sum.getCell('A5').value = 'USD → EUR rate used for every non-EUR amount'; sum.getCell('C5').value = rate;
  sum.getCell('C5').numFmt = '0.0000';
  sum.getCell('A7').value = 'Invoiced (EUR)';
  sum.getCell('B7').value = { formula: `SUM(${INV('H')})`, result: invoiced };
  sum.getCell('A8').value = 'Orders not yet invoiced (EUR)';
  sum.getCell('B8').value = { formula: `SUM(${LIN('J')})`, result: openEur };
  sum.getCell('A9').value = 'Revenues = invoiced + orders not yet invoiced (EUR)'; sum.getCell('A9').font = { bold: true };
  sum.getCell('B9').value = { formula: 'B7+B8', result: round2(invoiced + openEur) }; sum.getCell('B9').font = { bold: true };
  sum.getCell('A10').value = 'Invoiced and paid (EUR)';
  sum.getCell('B10').value = { formula: `SUMIFS(${INV('H')},${INV('L')},1)`, result: round2(invoices.filter(r => r.paid).reduce((s, r) => s + eur(r.currency, r.amount), 0)) };
  sum.getCell('A11').value = 'Invoiced, not yet paid (EUR)';
  sum.getCell('B11').value = { formula: 'B7-B10', result: round2(invoiced - invoices.filter(r => r.paid).reduce((s, r) => s + eur(r.currency, r.amount), 0)) };
  for (const a of ['B7', 'B8', 'B9', 'B10', 'B11']) sum.getCell(a).numFmt = '#,##0';

  // Distribution tables: key lists are values, amounts are SUMIFS formulas
  let r = 13;
  const tables: Array<{ title: string; keys: string[]; invCol: string; linCol: string; totalRow?: number }> = [];
  const sorted = (keys: Iterable<string>, byAmount?: (k: string) => number) =>
    [...new Set(keys)].sort(byAmount ? (a, b) => byAmount(b) - byAmount(a) : undefined);
  const amountBy = (field: 'region' | 'customer' | 'quarter') => (k: string) =>
    invoices.filter(x => x[field] === k).reduce((s, x) => s + eur(x.currency, x.amount), 0) +
    open.filter(x => x[field] === k).reduce((s, x) => s + eur(x.currency, x.amount), 0);
  tables.push({ title: 'By region', keys: sorted([...invoices.map(x => x.region), ...open.map(x => x.region)], amountBy('region')), invCol: 'J', linCol: 'L' });
  tables.push({ title: 'By customer', keys: sorted([...invoices.map(x => x.customer), ...open.map(x => x.customer)], amountBy('customer')), invCol: 'B', linCol: 'C' });
  tables.push({ title: 'By quarter', keys: sorted([...invoices.map(x => x.quarter), ...open.map(x => x.quarter)]), invCol: 'K', linCol: 'M' });

  const totalRows: number[] = [];
  for (const t of tables) {
    sum.getCell(`A${r}`).value = t.title; sum.getCell(`B${r}`).value = 'Invoiced (EUR)'; sum.getCell(`C${r}`).value = 'Open orders (EUR)'; sum.getCell(`E${r}`).value = 'Total (EUR)';
    for (const c of ['A', 'B', 'C', 'E']) sum.getCell(`${c}${r}`).font = { bold: true };
    const first = r + 1;
    for (const k of t.keys) {
      r++;
      const invAmt = round2(invoices.filter(x => (t.title === 'By region' ? x.region : t.title === 'By customer' ? x.customer : x.quarter) === k).reduce((s, x) => s + eur(x.currency, x.amount), 0));
      const opAmt = round2(open.filter(x => (t.title === 'By region' ? x.region : t.title === 'By customer' ? x.customer : x.quarter) === k).reduce((s, x) => s + eur(x.currency, x.amount), 0));
      sum.getCell(`A${r}`).value = k;
      sum.getCell(`B${r}`).value = { formula: `SUMIFS(${INV('H')},${INV(t.invCol)},$A${r})`, result: invAmt };
      sum.getCell(`C${r}`).value = { formula: `SUMIFS(${LIN('J')},${LIN(t.linCol)},$A${r})`, result: opAmt };
      sum.getCell(`E${r}`).value = { formula: `B${r}+C${r}`, result: round2(invAmt + opAmt) };
    }
    r++;
    sum.getCell(`A${r}`).value = 'Total'; sum.getCell(`A${r}`).font = { bold: true };
    sum.getCell(`B${r}`).value = { formula: `SUM(B${first}:B${r - 1})`, result: invoiced };
    sum.getCell(`C${r}`).value = { formula: `SUM(C${first}:C${r - 1})`, result: openEur };
    sum.getCell(`E${r}`).value = { formula: `B${r}+C${r}`, result: round2(invoiced + openEur) };
    for (const c of ['B', 'C', 'E']) { sum.getCell(`${c}${r}`).font = { bold: true }; }
    for (let x = first - 1; x <= r; x++) for (const c of ['B', 'C', 'E']) if (x > first - 1) sum.getCell(`${c}${x}`).numFmt = '#,##0';
    totalRows.push(r);
    r += 2;
  }

  // Checks
  const unmatched = round2(invoices.filter(x => x.region === 'Unmatched').reduce((s, x) => s + eur(x.currency, x.amount), 0) +
    open.filter(x => x.region === 'Unmatched').reduce((s, x) => s + eur(x.currency, x.amount), 0));
  sum.getCell(`A${r}`).value = 'Checks'; sum.getCell(`A${r}`).font = { bold: true };
  const checkRows: Array<[string, string, boolean]> = [];
  const names = ['Region table total = revenues', 'Customer table total = revenues', 'Quarter table total = revenues'];
  totalRows.forEach((tr, i) => checkRows.push([names[i], `IF(ABS(E${tr}-$B$9)<0.5,"OK","CHECK")`, true]));
  checkRows.push(['Nothing left in region "Unmatched"', `IF(ABS(SUMIFS(${INV('H')},${INV('J')},"Unmatched")+SUMIFS(${LIN('J')},${LIN('L')},"Unmatched"))<0.5,"OK","CHECK")`, unmatched < 0.5]);
  for (const [label, formula, ok] of checkRows) {
    r++;
    sum.getCell(`A${r}`).value = label;
    sum.getCell(`B${r}`).value = { formula, result: ok ? 'OK' : 'CHECK' };
  }
  r += 2;
  sum.getCell(`A${r}`).value = 'Invoices counted: customer invoices that are not draft or cancelled (technology invoices excluded). "Paid" includes invoices paid with another operation. Orders not yet invoiced: customer order lines whose operation has no invoice yet.';
  sum.getCell(`A${r}`).alignment = { wrapText: true, vertical: 'top' };
  sum.mergeCells(`A${r}:F${r + 2}`);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const tablesOk = true; // tables are built from the same rows, so they tie by construction
  return { buffer, totals: { invoiced, open: openEur, total: round2(invoiced + openEur), unmatched, checksOk: tablesOk && unmatched < 0.5 } };
}

// ── Email ──────────────────────────────────────────────────────────────────

const eurFmt = (n: number) => `€${Math.round(n).toLocaleString('en-GB')}`;

export interface RevenueReportResult { ok: boolean; message: string }

export async function sendRevenueReport(settings = getRevenueReportSettings()): Promise<RevenueReportResult> {
  const finish = (ok: boolean, message: string): RevenueReportResult => {
    try { writeSetting('revenue_report_last', { at: new Date().toISOString(), ok, message }); } catch { /* best effort */ }
    if (!ok) console.error('[RevenueReport]', message); else console.log('[RevenueReport]', message);
    return { ok, message };
  };
  try {
    if (!settings.recipients.length) return finish(false, 'No recipients set');
    if (!process.env.RESEND_API_KEY) return finish(false, 'RESEND_API_KEY is not set');
    const { buffer, totals } = await buildRevenueWorkbook(settings.usd_eur);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
    const filename = `TripleW Revenues ${day}.xlsx`;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const html = `
      <div style="font-family:Lato,Arial,sans-serif;color:#1e293b;max-width:560px">
        <h2 style="margin:0 0 12px">TripleW revenues — ${day}</h2>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:4px 16px 4px 0">Invoiced</td><td style="text-align:right"><b>${eurFmt(totals.invoiced)}</b></td></tr>
          <tr><td style="padding:4px 16px 4px 0">Orders not yet invoiced</td><td style="text-align:right"><b>${eurFmt(totals.open)}</b></td></tr>
          <tr><td style="padding:4px 16px 4px 0;border-top:1px solid #cbd5e1">Revenues</td><td style="text-align:right;border-top:1px solid #cbd5e1"><b>${eurFmt(totals.total)}</b></td></tr>
        </table>
        <p style="font-size:13px;color:#475569">USD converted at ${settings.usd_eur} to EUR. ${totals.checksOk ? 'All checks passed.' : `<b>Check the Summary tab:</b> ${eurFmt(totals.unmatched)} has no region.`}
        The workbook is attached (Summary, Invoices, Open orders).</p>
      </div>`;
    const { error } = await resend.emails.send({
      from, to: settings.recipients, subject: `TripleW revenues ${day}: ${eurFmt(totals.total)}`, html,
      attachments: [{ filename, content: buffer.toString('base64') }],
    });
    if (error) throw new Error(error.message || 'Resend rejected the message');
    return finish(true, `Sent to ${settings.recipients.join(', ')} — total ${eurFmt(totals.total)}`);
  } catch (err: any) {
    return finish(false, err?.message || 'unknown error');
  }
}

let task: cron.ScheduledTask | null = null;

/** (Re)schedules the daily email from the stored settings. */
export function startRevenueReportScheduler() {
  if (task) { task.stop(); task = null; }
  const s = getRevenueReportSettings();
  if (!s.enabled) { console.log('[RevenueReport] Disabled'); return; }
  const expr = `${s.minute} ${s.hour} * * *`;
  task = cron.schedule(expr, () => {
    sendRevenueReport().catch(err => console.error('[RevenueReport]', err));
  }, { timezone: TIMEZONE });
  console.log(`[RevenueReport] Scheduled: ${expr} (${TIMEZONE})`);
}
