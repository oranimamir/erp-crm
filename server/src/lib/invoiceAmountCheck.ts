/**
 * Customer Invoices → Check amounts: re-reads every UPLOADED customer invoice
 * (generated ones are computed, never read) with `readCustomerInvoice` and
 * keeps what it found in `invoice_amount_checks`, so invoices recorded at
 * their subtotal — the total sat in a picture beside the table — can be put
 * right one by one. Readings are cached per file, so a second run is free.
 */
import fs from 'fs';
import db from '../database.js';
import { resolveUpload } from './zipFiles.js';
import { getEurRate } from './fx.js';
import { notifyAdmin } from './notify.js';
import { AiBudgetError } from './aiBudget.js';
import { isCreditError } from './supplierInvoiceReader.js';
import { readCustomerInvoice, cachedCustomerInvoiceReading, fileSha256, type CustomerInvoiceReading } from './customerInvoiceReader.js';

export function ensureAmountCheckTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_amount_checks (
      invoice_id INTEGER PRIMARY KEY,
      file_hash TEXT,
      reading TEXT,
      read_total REAL,
      read_currency TEXT,
      status TEXT NOT NULL,
      decision TEXT,
      decided_amount REAL,
      message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** Approximate cost of one page reading (USD), for the estimate shown before a run. */
export const READ_COST_USD = 0.015;

// Every uploaded customer invoice (generated ones are calculated, never read)
const CANDIDATES = `
  SELECT i.id, i.invoice_number, i.amount, i.currency, i.fx_rate, i.eur_amount, i.invoice_date, i.status,
    i.file_path, i.file_name, c.name AS customer_name,
    COALESCE(i.operation_id, (SELECT id FROM operations WHERE operation_number = i.our_ref LIMIT 1)) AS op_id
  FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
  WHERE i.type = 'customer' AND i.status != 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM invoice_documents d WHERE d.invoice_id = i.id)
`;

const compact = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (v: unknown) => String(v || '').replace(/\D/g, '');

/** The same invoice number, allowing for spacing and a shortened prefix (CINL20260103 = CI20260103). */
export function sameInvoiceNo(a: unknown, b: unknown): boolean {
  const x = compact(a), y = compact(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const dx = digits(x), dy = digits(y);
  return dx.length >= 6 && dx === dy;
}

/**
 * The invoice's PDF: its own file, else the operation document that is this
 * invoice (an invoice category or "invoice" / "CI" in the name, the invoice
 * number's digits in the name) — older invoices were often filed only there.
 */
function invoiceFileFor(inv: any): { abs: string; source: string; name: string } | null {
  if (inv.file_path) {
    const abs = resolveUpload('invoices', inv.file_path);
    if (abs) return { abs, source: 'invoice', name: inv.file_name || inv.file_path };
  }
  if (!inv.op_id) return null;
  const docs = db.prepare(`
    SELECT od.file_path, od.file_name, LOWER(COALESCE(dc.name, '')) AS category
    FROM operation_documents od LEFT JOIN document_categories dc ON dc.id = od.category_id
    WHERE od.operation_id = ? ORDER BY od.created_at DESC, od.id DESC
  `).all(inv.op_id) as any[];
  const num = digits(inv.invoice_number);
  const isPdfOrImage = (n: string) => /\.(pdf|png|jpe?g|webp)$/i.test(n || '');
  const looksInvoice = (d: any) => /invoice/.test(d.category) && !/sample|supplier|proforma|pro forma/.test(d.category)
    || /(^|[^a-z])(ci|inv|invoice)[^a-z]?\d|invoice/i.test(d.file_name || '');
  const named = docs.filter(d => isPdfOrImage(d.file_name) && num.length >= 6 && digits(d.file_name).includes(num) && looksInvoice(d));
  const pick = named[0] || (() => {
    const inCategory = docs.filter(d => isPdfOrImage(d.file_name) && /invoice/.test(d.category) && !/sample|supplier|proforma|pro forma/.test(d.category));
    return inCategory.length === 1 ? inCategory[0] : null;
  })();
  if (!pick) return null;
  const abs = resolveUpload('operation-docs', pick.file_path);
  return abs ? { abs, source: 'operation document', name: pick.file_name } : null;
}

const sameAmount = (a: unknown, b: unknown) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 0.01;
const cur = (c: unknown) => String(c || 'USD').toUpperCase();

/** 'match' | 'differs' | 'unreadable' for a reading against the recorded invoice. */
function verdict(inv: any, r: CustomerInvoiceReading | null): { status: string; message: string | null } {
  if (!r || r.total == null) return { status: 'unreadable', message: 'No total could be read from the file' };
  if (r.invoice_number && !sameInvoiceNo(r.invoice_number, inv.invoice_number)) {
    return { status: 'unreadable', message: `The file found is invoice ${r.invoice_number}, not ${inv.invoice_number}` };
  }
  const currencyDiffers = !!r.currency && cur(r.currency) !== cur(inv.currency);
  if (sameAmount(r.total, inv.amount) && !currencyDiffers) return { status: 'match', message: null };
  const notes: string[] = [];
  if (r.parts_gap) notes.push(`the parts printed on the invoice are ${Math.abs(r.parts_gap).toFixed(2)} ${r.parts_gap > 0 ? 'under' : 'over'} its total — check the PDF`);
  if (currencyDiffers) notes.push(`currency read as ${cur(r.currency)}, recorded as ${cur(inv.currency)}`);
  return { status: 'differs', message: notes.join('; ') || null };
}

/**
 * The case this check was made for, corrected without asking: the recorded
 * amount is the subtotal printed on that same invoice, the invoice prints a
 * larger total, and its parts (subtotal + freight + insurance + VAT…) add up
 * to it — the reading of the text layer took the line amount for the total.
 */
function clearCut(inv: any, r: CustomerInvoiceReading | null): boolean {
  if (!r || r.printed_total == null || r.subtotal == null) return false;
  if (!sameInvoiceNo(r.invoice_number, inv.invoice_number)) return false;
  if (r.currency && cur(r.currency) !== cur(inv.currency)) return false;
  return sameAmount(inv.amount, r.subtotal) && r.printed_total > r.subtotal + 0.01 && r.parts_gap === 0;
}

function store(inv: any, hash: string | null, r: CustomerInvoiceReading | null, status: string, message: string | null): void {
  // A decision holds while the file and the recorded amount it was made on are unchanged
  const prev = db.prepare('SELECT file_hash, decision, decided_amount FROM invoice_amount_checks WHERE invoice_id = ?').get(inv.id) as any;
  const keep = prev?.decision && prev.file_hash === hash && sameAmount(prev.decided_amount, inv.amount);
  db.prepare(`INSERT OR REPLACE INTO invoice_amount_checks
    (invoice_id, file_hash, reading, read_total, read_currency, status, decision, decided_amount, message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(inv.id, hash, r ? JSON.stringify(r) : null, r?.total ?? null, r?.currency ?? null, status,
      keep ? prev.decision : null, keep ? prev.decided_amount : null, message);
}

// ── The run (one at a time, in the background) ──────────────────────────────
interface RunState {
  running: boolean; total: number; done: number; read: number; stopped: string | null; finished_at: string | null;
  /** Corrected without asking during this run (the clear-cut cases) */
  corrected: Array<{ invoice_number: string; from: number; to: number; currency: string }>;
}
const run: RunState = { running: false, total: 0, done: 0, read: 0, stopped: null, finished_at: null, corrected: [] };

export function amountCheckOverview() {
  const candidates = db.prepare(CANDIDATES).all() as any[];
  const byId = new Map(candidates.map(c => [c.id, c]));
  const rows = (db.prepare('SELECT * FROM invoice_amount_checks').all() as any[]).filter(r => byId.has(r.invoice_id));
  const checked = new Set(rows.map(r => r.invoice_id));
  const item = (r: any) => {
    const inv = byId.get(r.invoice_id);
    let reading: CustomerInvoiceReading | null = null;
    try { reading = r.reading ? JSON.parse(r.reading) : null; } catch { /* unreadable row */ }
    return {
      invoice_id: inv.id, invoice_number: inv.invoice_number, customer_name: inv.customer_name, invoice_date: inv.invoice_date,
      status: inv.status, recorded_amount: inv.amount, recorded_currency: cur(inv.currency),
      ...(() => {
        const f = invoiceFileFor(inv);
        if (!f) return { file_subfolder: null, file_path: null, file_name: null };
        const sub = f.source === 'invoice' ? 'invoices' : 'operation-docs';
        return { file_subfolder: sub, file_path: f.abs.split(/[\\/]/).pop(), file_name: f.name };
      })(),
      read_total: r.read_total, read_currency: r.read_currency ? cur(r.read_currency) : null,
      subtotal: reading?.subtotal ?? null, freight: reading?.freight ?? null, insurance: reading?.insurance ?? null,
      vat: reading?.vat ?? null, other_charges: reading?.other_charges ?? null,
      message: r.message, decision: r.decision, check_status: r.status,
    };
  };
  // Still open: the reading differs from what is recorded NOW and nobody decided
  const open = rows.filter(r => r.status === 'differs' && !r.decision
    && !(sameAmount(r.read_total, byId.get(r.invoice_id).amount) && (!r.read_currency || cur(r.read_currency) === cur(byId.get(r.invoice_id).currency))));
  return {
    run: { ...run },
    candidates: candidates.length,
    not_checked: candidates.filter(c => !checked.has(c.id)).length,
    matching: rows.filter(r => r.status === 'match').length,
    unreadable: rows.filter(r => r.status === 'unreadable' || r.status === 'error').map(item),
    decided: rows.filter(r => r.decision).length,
    auto_corrected: rows.filter(r => r.decision === 'auto').map(r => ({ ...item(r), corrected_to: r.decided_amount })),
    estimated_usd: Math.round(candidates.filter(c => !checked.has(c.id)).length * READ_COST_USD * 100) / 100,
    differing: open.map(item).sort((a, b) => String(b.invoice_date || '').localeCompare(String(a.invoice_date || ''))),
  };
}

/** Starts the run unless one is going; returns at once. */
export function startAmountCheck(opts: { onlyUnchecked?: boolean } = {}): { started: boolean } {
  if (run.running) return { started: false };
  let candidates = db.prepare(CANDIDATES).all() as any[];
  if (opts.onlyUnchecked) {
    const checked = new Set((db.prepare('SELECT invoice_id FROM invoice_amount_checks').all() as any[]).map(r => r.invoice_id));
    candidates = candidates.filter(c => !checked.has(c.id));
  }
  if (!candidates.length) return { started: false };
  Object.assign(run, { running: true, total: candidates.length, done: 0, read: 0, stopped: null, finished_at: null, corrected: [] });
  void (async () => {
    try {
      for (const inv of candidates) {
        try {
          const found = invoiceFileFor(inv);
          if (!found) { store(inv, null, null, 'unreadable', 'No PDF of this invoice — neither on the invoice nor in its operation\'s documents'); continue; }
          const file = fs.readFileSync(found.abs);
          const hash = fileSha256(file);
          const wasCached = !!cachedCustomerInvoiceReading(hash);
          const reading = await readCustomerInvoice(file);
          if (!wasCached && reading) run.read++;
          const v = verdict(inv, reading);
          store(inv, hash, reading, v.status, v.message ? v.message : found.source !== 'invoice' ? `Read from the operation document ${found.name}` : null);
          if (v.status === 'differs' && clearCut(inv, reading)) {
            const prev = db.prepare('SELECT decision FROM invoice_amount_checks WHERE invoice_id = ?').get(inv.id) as any;
            if (!prev?.decision) {
              const done = await applyAmountCheck(inv.id, undefined, 'auto');
              if (done) {
                run.corrected.push({ invoice_number: inv.invoice_number, from: done.from, to: done.to, currency: cur(done.invoice.currency) });
                console.log(`[amount-check] ${inv.invoice_number}: ${done.from} → ${done.to} ${cur(done.invoice.currency)} (subtotal had been recorded as the total)`);
              }
            }
          }
        } catch (err: any) {
          if (err instanceof AiBudgetError) { run.stopped = 'The monthly AI spending limit is reached — raise it in Settings → AI reading, then run the check again (what was read is kept)'; break; }
          if (err?.message === 'NO_API_KEY') { run.stopped = 'AI reading is not set up on the server (no API key)'; break; }
          if (err?.status === 401 || err?.status === 403) { run.stopped = 'The AI key on the server was refused — check ANTHROPIC_API_KEY in Railway, then run the check again'; break; }
          if (isCreditError(err)) { run.stopped = 'The AI account is out of credit — top it up, then run the check again (what was read is kept)'; break; }
          console.error('[amount-check] invoice', inv.id, err?.message || err);
          store(inv, null, null, 'error', String(err?.message || 'Reading failed').slice(0, 200));
        } finally {
          run.done++;
        }
      }
    } finally {
      run.running = false;
      run.finished_at = new Date().toISOString();
      db.saveToDisk();
    }
  })();
  return { started: true };
}

/** Records the correction: the invoice takes the amount (and currency) read from its file. */
export async function applyAmountCheck(invoiceId: number, amount?: number, decision: 'applied' | 'auto' = 'applied'): Promise<{ invoice: any; from: number; to: number } | null> {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
  const row = db.prepare('SELECT * FROM invoice_amount_checks WHERE invoice_id = ?').get(invoiceId) as any;
  if (!inv || !row) return null;
  const to = Number.isFinite(amount) && (amount as number) > 0 ? Math.round((amount as number) * 100) / 100 : Number(row.read_total);
  if (!(to > 0)) return null;
  const currency = row.read_currency ? cur(row.read_currency) : cur(inv.currency);
  let fxRate: number | null = inv.fx_rate ?? null;
  let eurAmount: number | null = inv.eur_amount ?? null;
  if (currency === 'EUR') { fxRate = inv.fx_rate != null ? 1 : null; eurAmount = inv.eur_amount != null ? to : null; }
  else {
    if (currency !== cur(inv.currency) || !fxRate) {
      try { fxRate = await getEurRate(currency, inv.invoice_date || 'latest'); } catch { fxRate = null; }
    }
    eurAmount = fxRate ? Math.round(to * fxRate * 100) / 100 : null;
  }
  db.prepare(`UPDATE invoices SET amount = ?, currency = ?, fx_rate = ?, eur_amount = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(to, currency, fxRate, eurAmount, invoiceId);
  db.prepare(`UPDATE invoice_amount_checks SET decision = ?, decided_amount = ? WHERE invoice_id = ?`).run(decision, to, invoiceId);
  if (decision === 'auto') {
    notifyAdmin({ action: 'updated', entity: 'Invoice', label: inv.invoice_number,
      detail: `Amount corrected ${inv.amount} → ${to} ${currency}: the subtotal had been recorded; the invoice's total includes freight / insurance / tax`,
      performedBy: 'Amount check', performedById: undefined });
  }
  db.saveToDisk();
  return { invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId), from: Number(inv.amount), to };
}

/** "The recorded amount is right" — not listed again until the amount or the file changes. */
export function keepAmountCheck(invoiceId: number): boolean {
  const inv = db.prepare('SELECT amount FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv) return false;
  const r = db.prepare(`UPDATE invoice_amount_checks SET decision = 'kept', decided_amount = ? WHERE invoice_id = ?`).run(inv.amount, invoiceId);
  return (r.changes ?? 0) > 0;
}

/**
 * At startup (a minute after, so it doesn't slow the boot): checks the uploaded
 * invoices never checked yet, correcting the clear-cut ones by itself. A file
 * read once is never paid for again.
 */
export function scheduleAmountCheck(): void {
  if (!process.env.ANTHROPIC_API_KEY) return;
  setTimeout(() => {
    try {
      ensureAmountCheckTable();
      const { started } = startAmountCheck({ onlyUnchecked: true });
      if (started) console.log(`[amount-check] checking ${run.total} uploaded customer invoice(s) not checked before`);
    } catch (err: any) {
      console.error('[amount-check] startup run failed:', err?.message || err);
    }
  }, 60_000);
}
