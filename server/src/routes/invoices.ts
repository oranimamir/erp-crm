import { Router, Request, Response } from 'express';
import db from '../database.js';
import { archiveStored, archiveFile, archiveBuffer, archivedBy, ownerOf, contextOf } from '../lib/archive.js';
import { uploadInvoice, uploadWireTransfer } from '../middleware/upload.js';
import { notifyAdmin } from '../lib/notify.js';
import { getEurRate } from '../lib/fx.js';
import { refreshEstimatedPaymentDate } from '../lib/paymentTerms.js';
import { resolveUpload, streamZip, safeName } from '../lib/zipFiles.js';
import { deleteInvoiceDocument } from './invoice-documents.js';
import { entityFromOperationNumber, isEntityCode } from '../lib/companyEntity.js';
import { resolveCountry } from '../lib/portCountry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { todayISO } from '../lib/today.js';
import { sendPaymentReceivedEmail } from '../lib/paymentEmail.js';
import { computeTotals, lotsOf, type DocumentData } from '../lib/document-pdf.js';
import { balancesFor, withBalances } from '../lib/invoiceBalance.js';
import { ensureAmountCheckTable, amountCheckOverview, startAmountCheck, applyAmountCheck, keepAmountCheck } from '../lib/invoiceAmountCheck.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const router = Router();

/**
 * Invoice tonnage in metric tons. Blank, whitespace or a non-number stores NULL
 * — "not recorded" and zero are different answers, and collapsing them is what
 * made the analytics tonnage totals understate reality.
 */
function parseTonnage(value: any): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  // Exports and pickers ask for everything at once, so the cap is set well above the data size
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const status = (req.query.status as string) || '';
  const type = (req.query.type as string) || '';
  const year  = (req.query.year  as string) || '';
  const month = (req.query.month as string) || '';
  const wire  = (req.query.wire  as string) || '';
  const customer = (req.query.customer as string) || '';
  const offset = (page - 1) * limit;

  const sortFieldMap: Record<string, string> = {
    date: 'COALESCE(i.invoice_date, i.created_at)',
    amount: 'i.amount',
    name: 'COALESCE(c.name, s.name)',
    wire_date: 'wt.last_wire_date',
  };
  const sortBy = (req.query.sort_by as string) || 'date';
  const sortDir = (req.query.sort_dir as string) === 'asc' ? 'ASC' : 'DESC';
  const orderBy = `${Object.hasOwn(sortFieldMap, sortBy) ? sortFieldMap[sortBy] : sortFieldMap.date} ${sortDir}`;

  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  // Support comma-separated multi-values for status, month
  if (status) {
    const statuses = status.split(',').filter(Boolean);
    if (statuses.length === 1) { conditions.push('i.status = ?'); params.push(statuses[0]); }
    else { conditions.push(`i.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
  }
  if (type)   { conditions.push('i.type = ?'); params.push(type); }
  if (year)   { conditions.push("strftime('%Y', COALESCE(i.invoice_date, i.created_at)) = ?"); params.push(year); }
  if (month) {
    const months = month.split(',').filter(Boolean).map((m: string) => m.padStart(2, '0'));
    if (months.length === 1) { conditions.push("strftime('%m', COALESCE(i.invoice_date, i.created_at)) = ?"); params.push(months[0]); }
    else { conditions.push(`strftime('%m', COALESCE(i.invoice_date, i.created_at)) IN (${months.map(() => '?').join(',')})`); params.push(...months); }
  }
  // Date range filter (from/to)
  const dateFrom = (req.query.date_from as string) || '';
  const dateTo   = (req.query.date_to   as string) || '';
  if (dateFrom) { conditions.push("COALESCE(i.invoice_date, date(i.created_at)) >= ?"); params.push(dateFrom); }
  if (dateTo)   { conditions.push("COALESCE(i.invoice_date, date(i.created_at)) <= ?"); params.push(dateTo); }
  if (wire === 'yes') { conditions.push('COALESCE(wt.wire_transfer_count, 0) > 0'); }
  if (wire === 'no')  { conditions.push('(wt.wire_transfer_count IS NULL OR wt.wire_transfer_count = 0)'); }
  if (customer) { conditions.push('c.name LIKE ?'); params.push(`%${customer}%`); }
  // Wire transfer date range filter
  const wireDateFrom = (req.query.wire_date_from as string) || '';
  const wireDateTo   = (req.query.wire_date_to   as string) || '';
  if (wireDateFrom) { conditions.push("wt.last_wire_date >= ?"); params.push(wireDateFrom); }
  if (wireDateTo)   { conditions.push("wt.last_wire_date <= ?"); params.push(wireDateTo); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const wtJoin = `LEFT JOIN (SELECT invoice_id, COUNT(*) as wire_transfer_count, MAX(transfer_date) as last_wire_date FROM wire_transfers GROUP BY invoice_id) wt ON wt.invoice_id = i.id`;
  const total = (db.prepare(`SELECT COUNT(*) as count FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN suppliers s ON i.supplier_id = s.id ${wtJoin} ${where}`).get(...params) as any).count;
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name, s.name as supplier_name,
      COALESCE(wt.wire_transfer_count, 0) as wire_transfer_count,
      wt.last_wire_date,
      (SELECT o.order_number FROM operations op JOIN orders o ON o.id = op.order_id
        WHERE op.id = COALESCE(i.operation_id, (SELECT id FROM operations WHERE operation_number = i.our_ref LIMIT 1))) AS order_number
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    ${wtJoin}
    ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: withBalances(invoices as any[]), total, page, limit, totalPages: Math.ceil(total / limit) });
});

/** Quantity in metric tons, or null when the unit is not a weight. */
function toMt(qty: number, unit?: string | null): number | null {
  const u = String(unit || '').trim().toLowerCase();
  if (['mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't'].includes(u)) return qty;
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(u)) return qty / 1000;
  if (['lb', 'lbs', 'pound', 'pounds'].includes(u)) return qty / 2204.6226218;
  return null;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * POST /export-details {ids} — what each invoice itself says, for the Excel
 * exports: a generated invoice is read off its document (the filed version,
 * never unsaved draft edits) — lines, tonnage, subtotal / freight / insurance /
 * VAT / total, incoterm, payment terms; an uploaded one gives its recorded
 * amount and tonnage (else the order's lines). `check` names any difference
 * between the document and the recorded amount / tonnage.
 */
router.post('/export-details', (req: Request, res: Response) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 20000);
  if (!ids.length) { res.json({}); return; }
  const out: Record<number, any> = {};
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.prepare(`
      SELECT i.*, op.operation_number, op.order_id AS op_order_id,
        (SELECT d.data FROM invoice_documents d WHERE d.invoice_id = i.id AND d.status = 'final' ORDER BY d.id DESC LIMIT 1) AS doc_data
      FROM invoices i
      LEFT JOIN operations op ON op.id = COALESCE(i.operation_id, (SELECT id FROM operations WHERE operation_number = i.our_ref LIMIT 1))
      WHERE i.id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk) as any[];
    for (const r of rows) {
      // A non-EUR invoice converted at 1 (or not at all): the FX service was unreachable
      const fxNote = String(r.currency || 'EUR').toUpperCase() !== 'EUR' && (r.fx_rate == null || Number(r.fx_rate) === 1)
        ? `EUR amount without a real ${String(r.currency).toUpperCase()} rate — check it` : '';
      let doc: DocumentData | null = null;
      if (r.doc_data) { try { doc = JSON.parse(r.doc_data); } catch { doc = null; } }
      const checks: string[] = [];
      if (doc && Array.isArray(doc.items) && doc.items.length) {
        const items = doc.items;
        const t = computeTotals(doc);
        const tonnes = items.map(it => toMt(Number(it.quantity) || 0, it.quantity_unit));
        const mt = tonnes.some(x => x != null) ? tonnes.reduce((a: number, x) => a + (x || 0), 0) : null;
        if (Math.abs((Number(r.amount) || 0) - t.total) > 0.01) checks.push(`recorded amount ${round(Number(r.amount) || 0)} ≠ invoice total ${round(t.total)}`);
        if (mt != null && r.quantity_mt != null && Math.abs(Number(r.quantity_mt) - mt) > 0.001) checks.push(`recorded tonnage ${r.quantity_mt} ≠ invoice ${round(mt, 3)}`);
        out[r.id] = {
          source: 'Generated invoice',
          products: items.map(it => it.commercial_name || it.description || it.reference || '').filter(Boolean).join('; '),
          references: items.map(it => it.reference || '').filter(Boolean).join('; '),
          quantities: items.map(it => `${Number(it.quantity) || 0} ${it.quantity_unit || ''}`.trim()).join('; '),
          unit_prices: items.map(it => `${Number(it.unit_price) || 0}`).join('; '),
          lots: items.flatMap(it => lotsOf(it as any)).join('; '),
          tonnage_mt: mt != null ? round(mt, 3) : null,
          subtotal: round(t.subtotal), freight: t.freight ? round(t.freight) : null, insurance: t.insurance ? round(t.insurance) : null,
          vat: t.vat ? round(t.vat) : null, total: round(t.total), currency: t.currency,
          incoterm: doc.incoterm || doc.delivery || '', payment_terms: doc.payment_terms || '',
          po_number: doc.po_number || r.po_number || '', our_ref: doc.our_ref || r.our_ref || '',
          check: [...checks, fxNote].filter(Boolean).join('; '),
        };
        continue;
      }
      // Uploaded invoice: its recorded figures; tonnage typed on it, else the order's lines
      const orderId = r.op_order_id;
      const lines = orderId ? db.prepare('SELECT description, quantity, unit, unit_price FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as any[] : [];
      const lineMt = lines.map(l => toMt(Number(l.quantity) || 0, l.unit));
      const orderMt = lineMt.some(x => x != null) ? lineMt.reduce((a: number, x) => a + (x || 0), 0) : null;
      const mt = r.quantity_mt != null ? Number(r.quantity_mt) : orderMt;
      out[r.id] = {
        source: 'Uploaded invoice',
        products: lines.map(l => l.description || '').filter(Boolean).join('; '),
        references: '', quantities: lines.map(l => `${Number(l.quantity) || 0} ${l.unit || ''}`.trim()).join('; '),
        unit_prices: lines.map(l => (l.unit_price != null ? String(l.unit_price) : '')).join('; '), lots: '',
        tonnage_mt: mt != null ? round(mt, 3) : null,
        subtotal: null, freight: null, insurance: null, vat: null,
        total: r.amount != null ? round(Number(r.amount)) : null, currency: r.currency || 'EUR',
        incoterm: '', payment_terms: '', po_number: r.po_number || '', our_ref: r.our_ref || '',
        check: [r.quantity_mt == null && orderMt != null ? 'tonnage from the order (none typed on the invoice)' : '', fxNote].filter(Boolean).join('; '),
      };
    }
  }
  res.json(out);
});

/**
 * Register of customer invoices, by invoice number, to check the numbering:
 * client, country, order, operation and its category. `entity` (BE / NL) is
 * read off the operation number, else the invoice number, as documents do.
 */
router.get('/register', (req: Request, res: Response) => {
  const entity = String(req.query.entity || '');
  const rows = db.prepare(`
    SELECT i.id, i.invoice_number, i.invoice_date, i.created_at, i.status, i.po_number,
      i.amount, i.currency, i.fx_rate, i.eur_amount, i.quantity_mt, i.due_date, i.payment_date,
      CASE WHEN i.file_path IS NOT NULL THEN 1 ELSE 0 END AS has_file,
      (SELECT COUNT(*) FROM wire_transfers w WHERE w.invoice_id = i.id AND w.file_path IS NOT NULL) AS wire_files,
      c.name AS customer_name,
      op.id AS operation_id, op.operation_number, op.category, op.country AS operation_country,
      o.id AS order_id, o.order_number, o.destination AS order_destination,
      t.id AS technology_operation_id, t.to_number
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN operations op ON op.id = COALESCE(i.operation_id,
      (SELECT id FROM operations WHERE operation_number = i.our_ref LIMIT 1))
    LEFT JOIN orders o ON o.id = op.order_id
    LEFT JOIN technology_operations t ON t.id = i.technology_operation_id
    WHERE i.type = 'customer'
  `).all() as any[];

  const data = rows
    .map(r => ({
      ...r,
      // A technology invoice (TI…) shows its TO number as the operation, category "technology"
      ...(r.to_number && !r.operation_number ? { operation_number: r.to_number, category: 'technology' } : {}),
      entity: entityFromOperationNumber(r.operation_number || r.invoice_number),
      country: r.operation_country || resolveCountry(r.order_destination) || null,
    }))
    .filter(r => !isEntityCode(entity) || r.entity === entity)
    .sort((a, b) => String(a.invoice_number).localeCompare(String(b.invoice_number), undefined, { numeric: true }));
  res.json({ data: withBalances(data) });
});

// Monthly summary: invoices generated & wire transfers made (in EUR)
router.get('/monthly-summary', (_req: Request, res: Response) => {
  // Customer invoices aggregated by month (use eur_amount when available, else amount)
  const invoicesByMonth = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(i.invoice_date, i.created_at)) as month,
      SUM(COALESCE(i.eur_amount, i.amount)) as total_eur,
      COUNT(*) as count
    FROM invoices i
    WHERE i.type = 'customer' AND i.status != 'cancelled'
    GROUP BY month ORDER BY month
  `).all() as { month: string; total_eur: number; count: number }[];

  // Wire transfers aggregated by month (use eur_amount when available, else amount)
  const wiresByMonth = db.prepare(`
    SELECT strftime('%Y-%m', wt.transfer_date) as month,
      SUM(COALESCE(wt.eur_amount, wt.amount)) as total_eur,
      COUNT(*) as count
    FROM wire_transfers wt
    JOIN invoices i ON wt.invoice_id = i.id
    WHERE i.type = 'customer'
    GROUP BY month ORDER BY month
  `).all() as { month: string; total_eur: number; count: number }[];

  res.json({ invoicesByMonth, wiresByMonth });
});

// Bulk-download the attached files of multiple invoices as a single ZIP.
// Registered before '/:id' so the literal path isn't captured as an id.
/**
 * POST /bulk-download {ids, folders?, include_wire_transfers?} — the chosen
 * invoices' files in one ZIP (Customer Invoices → Invoices list): named
 * "<invoice#> - <client>", flat or in a folder per client / month / operation,
 * optionally with each invoice's wire transfer files beside it.
 */
router.post('/bulk-download', (req: Request, res: Response) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 5000);
  if (!ids.length) { res.status(400).json({ error: 'No invoices chosen' }); return; }
  const folders = ['client', 'month', 'operation'].includes(String(req.body?.folders)) ? String(req.body.folders) : 'none';
  const withWires = req.body?.include_wire_transfers === true;

  const files: { absPath: string; name: string }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.prepare(`
      SELECT i.id, i.invoice_number, i.invoice_date, i.file_path, i.file_name,
        COALESCE(c.name, s.name) AS party, COALESCE(op.operation_number, t.to_number) AS operation_number
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      LEFT JOIN operations op ON op.id = COALESCE(i.operation_id, (SELECT id FROM operations WHERE operation_number = i.our_ref LIMIT 1))
      LEFT JOIN technology_operations t ON t.id = i.technology_operation_id
      WHERE i.id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk) as any[];
    for (const r of rows) {
      const folder = folders === 'client' ? safeName(r.party || 'No client')
        : folders === 'month' ? (String(r.invoice_date || '').slice(0, 7) || 'No date')
        : folders === 'operation' ? safeName(r.operation_number || 'No operation') : '';
      const prefix = folder ? `${folder}/` : '';
      const base = safeName(`${r.invoice_number || `invoice-${r.id}`}${r.party ? ` - ${r.party}` : ''}`);
      const absPath = r.file_path ? resolveUpload('invoices', r.file_path) : null;
      if (absPath) files.push({ absPath, name: `${prefix}${base}${path.extname(r.file_name || r.file_path) || '.pdf'}` });
      if (withWires) {
        const wires = db.prepare('SELECT id, transfer_date, file_path, file_name FROM wire_transfers WHERE invoice_id = ? AND file_path IS NOT NULL ORDER BY transfer_date, id').all(r.id) as any[];
        wires.forEach((w, n) => {
          const wirePath = resolveUpload('wire-transfers', w.file_path);
          if (!wirePath) return;
          const suffix = wires.length > 1 ? ` ${n + 1}` : '';
          files.push({ absPath: wirePath, name: `${prefix}${safeName(`${r.invoice_number || `invoice-${r.id}`} - wire transfer${suffix}`)}${path.extname(w.file_name || w.file_path) || '.pdf'}` });
        });
      }
    }
  }
  if (!files.length) { res.status(404).json({ error: 'None of the chosen invoices has a file attached' }); return; }
  streamZip(res, `invoices-${todayISO()}.zip`, files);
});

router.get('/bulk-download', (req: Request, res: Response) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) { res.status(400).json({ error: 'No invoice IDs provided' }); return; }

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, invoice_number, file_path, file_name FROM invoices WHERE id IN (${placeholders}) AND file_path IS NOT NULL`
  ).all(...ids) as any[];

  const files = rows
    .map(r => {
      const absPath = resolveUpload('invoices', r.file_path);
      if (!absPath) return null;
      const ext = path.extname(r.file_name || r.file_path) || '';
      return { absPath, name: `${safeName(r.invoice_number || `invoice-${r.id}`)}${ext}` };
    })
    .filter((f): f is { absPath: string; name: string } => f !== null);

  if (!files.length) { res.status(404).json({ error: 'None of the selected invoices have an attached file' }); return; }

  streamZip(res, `invoices-${todayISO()}.zip`, files);
});

// ── Check amounts (lib/invoiceAmountCheck.ts) ────────────────────────────────
// Uploaded customer invoices re-read from their file: the ones whose recorded
// amount differs from the total on the page, to correct one by one

router.get('/amount-check', (_req: Request, res: Response) => {
  ensureAmountCheckTable();
  res.json(amountCheckOverview());
});

router.post('/amount-check/run', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(501).json({ error: 'AI reading is not set up on the server (no API key)' }); return; }
  ensureAmountCheckTable();
  res.json({ ...startAmountCheck(), ...amountCheckOverview() });
});

router.post('/:id/amount-check/apply', async (req: Request, res: Response) => {
  ensureAmountCheckTable();
  const amount = req.body?.amount != null && req.body.amount !== '' ? Number(req.body.amount) : undefined;
  const result = await applyAmountCheck(Number(req.params.id), amount);
  if (!result) { res.status(404).json({ error: 'No reading to apply for this invoice' }); return; }
  notifyAdmin({ action: 'updated', entity: 'Invoice', label: result.invoice.invoice_number,
    detail: `Amount corrected ${result.from} → ${result.to} ${result.invoice.currency || ''} (read from the invoice file)`,
    performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  refreshEstimatedPaymentDate(db, result.invoice.operation_id ?? null);
  res.json({ ...result.invoice, ...(balancesFor([result.invoice]).get(result.invoice.id) || {}) });
});

router.post('/:id/amount-check/keep', (req: Request, res: Response) => {
  ensureAmountCheckTable();
  if (!keepAmountCheck(Number(req.params.id))) { res.status(404).json({ error: 'No reading for this invoice' }); return; }
  res.json({ ok: true });
});

router.get('/:id', (req: Request, res: Response) => {
  const invoice = db.prepare(`
    SELECT i.*, c.name as customer_name, s.name as supplier_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.id = ?
  `).get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const invoiceId = Number(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC').all(invoiceId);
  const history = db.prepare(`
    SELECT sh.*, u.display_name as changed_by_name
    FROM status_history sh LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.entity_type = 'invoice' AND sh.entity_id = ? ORDER BY sh.created_at DESC
  `).all(invoiceId);
  const wire_transfers = db.prepare(`
    SELECT wt.*, u.display_name as approved_by_name
    FROM wire_transfers wt LEFT JOIN users u ON wt.approved_by = u.id
    WHERE wt.invoice_id = ? ORDER BY wt.created_at DESC
  `).all(invoiceId);

  res.json({ ...invoice, ...(balancesFor([invoice]).get(invoice.id) || {}), payments, status_history: history, wire_transfers });
});

router.post('/', uploadInvoice.single('file'), async (req: Request, res: Response) => {
  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, our_ref, po_number, operation_id, quantity_mt } = req.body;
  if (!invoice_number || !type || !amount) {
    res.status(400).json({ error: 'invoice_number, type, and amount are required' });
    return;
  }
  if (!Number.isFinite(parseFloat(amount))) {
    res.status(400).json({ error: 'amount must be a number' });
    return;
  }

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  try {
    // Compute EUR conversion at creation time for non-EUR invoices
    const invCurrency = currency || 'USD';
    let fx_rate: number | null = null;
    let eur_amount: number | null = null;
    if (invCurrency.toUpperCase() !== 'EUR') {
      const dateForRate = invoice_date || todayISO();
      fx_rate = await getEurRate(invCurrency, dateForRate);
      eur_amount = parseFloat(amount) * fx_rate;
    }

    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, file_path, file_name, our_ref, po_number, operation_id, fx_rate, eur_amount, quantity_mt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoice_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type, parseFloat(amount), invCurrency, status || 'draft', due_date || null, invoice_date || null, payment_date || null, notes || null,
      file_path, file_name, our_ref || null, po_number || null, operation_id ? Number(operation_id) : null,
      fx_rate, eur_amount, parseTonnage(quantity_mt)
    );
    const invoiceId = result.lastInsertRowid;

    // Record initial status
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('invoice', ?, ?, ?)`)
      .run(invoiceId, status || 'draft', req.user!.userId);

    // Billing the customer starts the payment-terms clock, so the operation's
    // estimated payment date is derived now rather than left for someone to
    // work out by hand.
    refreshEstimatedPaymentDate(db, operation_id ? Number(operation_id) : null);

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    notifyAdmin({ action: 'created', entity: 'Invoice', label: invoice.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
    res.status(201).json(invoice);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Invoice number already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.put('/:id', uploadInvoice.single('file'), async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, our_ref, po_number, operation_id, quantity_mt } = req.body;

  // Delete old file if new one uploaded
  let file_path = existing.file_path;
  let file_name = existing.file_name;
  if (req.file) {
    if (existing.file_path) {
      try {
        archiveStored('invoices', existing.file_path, { section: 'Invoices', context: contextOf(`Invoice ${existing.invoice_number}`, 'replaced by a new file'), fileName: existing.file_name, reason: 'replaced' }, archivedBy(req));
      } catch (err) {
        console.warn('[invoices] Failed to delete old invoice file:', err);
      }
    }
    file_path = req.file.filename;
    file_name = req.file.originalname;
  }

  // A field left out keeps its stored value; a field sent blank clears it
  const keep = (sent: any, stored: any) => (sent === undefined ? stored : (sent === '' ? null : sent));
  const today = todayISO();
  const finalType = type || existing.type;
  const finalInvoiceDate = keep(invoice_date, existing.invoice_date);
  const finalStatus = status || existing.status;
  // Marking an invoice paid without a date records today
  const finalPaymentDate = keep(payment_date, existing.payment_date)
    ?? (finalStatus === 'paid' ? (existing.payment_date || today) : null);

  // Recompute EUR conversion when amount or currency changes
  const parsedAmount = parseFloat(amount);
  const finalAmount = Number.isFinite(parsedAmount) ? parsedAmount : existing.amount;
  const finalCurrency = String(currency || existing.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(finalCurrency)) { res.status(400).json({ error: 'Currency must be a 3-letter code' }); return; }
  let fx_rate = existing.fx_rate;
  let eur_amount = existing.eur_amount;
  if (finalCurrency !== 'EUR') {
    const dateForRate = finalInvoiceDate || today;
    fx_rate = await getEurRate(finalCurrency, dateForRate);
    eur_amount = finalAmount * fx_rate;
  } else {
    fx_rate = null;
    eur_amount = null;
  }

  try {
    db.prepare(`
      UPDATE invoices SET invoice_number=?, customer_id=?, supplier_id=?, type=?, amount=?, currency=?, status=?, due_date=?, invoice_date=?, payment_date=?, notes=?, file_path=?, file_name=?, our_ref=?, po_number=?, operation_id=?, fx_rate=?, eur_amount=?, quantity_mt=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      invoice_number || existing.invoice_number,
      // Leaving the party out of the request must not unlink it
      finalType === 'customer' ? keep(customer_id, existing.customer_id) : null,
      finalType === 'supplier' ? keep(supplier_id, existing.supplier_id) : null,
      finalType, finalAmount, currency ? finalCurrency : existing.currency,
      finalStatus, keep(due_date, existing.due_date), finalInvoiceDate,
      finalPaymentDate,
      keep(notes, existing.notes),
      file_path, file_name, keep(our_ref, existing.our_ref), keep(po_number, existing.po_number),
      operation_id !== undefined ? (operation_id ? Number(operation_id) : null) : existing.operation_id,
      fx_rate, eur_amount,
      quantity_mt !== undefined ? parseTonnage(quantity_mt) : existing.quantity_mt,
      req.params.id
    );

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    // Both operations: the one the invoice moved away from loses its estimate,
    // the one it moved to (or stayed on, with a new date) gains a fresh one.
    refreshEstimatedPaymentDate(db, existing.operation_id);
    refreshEstimatedPaymentDate(db, invoice.operation_id);
    notifyAdmin({ action: 'updated', entity: 'Invoice', label: invoice.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
    res.json(invoice);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const VALID_INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled', 'paid_with_other'] as const;

router.patch('/:id/status', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { status, notes } = req.body;
  if (!status) { res.status(400).json({ error: 'Status is required' }); return; }
  if (!VALID_INVOICE_STATUSES.includes(status)) {
    res.status(400).json({ error: `Status must be one of: ${VALID_INVOICE_STATUSES.join(', ')}` });
    return;
  }

  // Auto-fill payment_date when transitioning to 'paid' so the invoice lands in the
  // dashboard's Paid YTD bucket (which requires payment_date IS NOT NULL). Without
  // this, the invoice silently leaves Pending without entering Paid YTD and the
  // total revenues figure drops.
  if (status === 'paid' && !existing.payment_date) {
    const today = todayISO();
    db.prepare(`UPDATE invoices SET status=?, payment_date=?, updated_at=datetime('now') WHERE id=?`).run(status, today, req.params.id);
  } else if (status !== 'paid' && existing.status === 'paid') {
    // Reverting away from paid: clear payment_date so it doesn't pollute YTD if re-paid later
    db.prepare(`UPDATE invoices SET status=?, payment_date=NULL, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  } else {
    db.prepare(`UPDATE invoices SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  }
  db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, ?, ?, ?)`)
    .run(req.params.id, existing.status, status, req.user!.userId, notes || null);

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  notifyAdmin({ action: 'status changed', entity: 'Invoice', label: invoice.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId, detail: status });
  res.json(invoice);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  // A generated invoice goes with its recorded copy, freeing its number
  const generated = db.prepare('SELECT * FROM invoice_documents WHERE invoice_id = ?').all(req.params.id) as any[];
  for (const doc of generated) deleteInvoiceDocument(doc, { keepRecorded: true });

  if (existing.file_path) {
    try {
      archiveStored('invoices', existing.file_path, { section: 'Invoices', context: contextOf(`Invoice ${existing.invoice_number}`, ownerOf(existing.operation_id).number), fileName: existing.file_name }, archivedBy(req));
    } catch (err) {
      console.warn('[invoices] Failed to delete invoice file:', err);
    }
  }

  // wire_transfers reference this invoice with ON DELETE RESTRICT, so they must
  // go first — and their proof files with them, which no cascade could remove.
  const transfers = db.prepare('SELECT id, file_path, file_name FROM wire_transfers WHERE invoice_id = ?').all(req.params.id) as any[];
  for (const wt of transfers) {
    if (wt.file_path) {
      try {
        archiveStored('wire-transfers', wt.file_path, { section: 'Wire transfers', context: `Wire transfer for invoice ${existing.invoice_number} (invoice deleted)`, fileName: wt.file_name }, archivedBy(req));
      } catch (err) {
        console.warn('[invoices] Failed to delete wire transfer file:', err);
      }
    }
  }
  db.prepare('DELETE FROM wire_transfers WHERE invoice_id = ?').run(req.params.id);

  // status_history has no FK, so its rows would linger after the invoice is gone
  try { db.prepare(`DELETE FROM status_history WHERE entity_type = 'invoice' AND entity_id = ?`).run(req.params.id); } catch { /* best effort */ }
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  refreshEstimatedPaymentDate(db, existing.operation_id);
  notifyAdmin({ action: 'deleted', entity: 'Invoice', label: existing.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: 'Invoice deleted' });
});

// Wire Transfer endpoints
router.get('/:id/wire-transfers', (req: Request, res: Response) => {
  const invoiceId = Number(req.params.id);
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const transfers = db.prepare(`
    SELECT wt.*, u.display_name as approved_by_name
    FROM wire_transfers wt LEFT JOIN users u ON wt.approved_by = u.id
    WHERE wt.invoice_id = ? ORDER BY wt.created_at DESC
  `).all(invoiceId);
  res.json(transfers);
});

router.post('/:id/wire-transfers', uploadWireTransfer.single('file'), async (req: Request, res: Response) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const payment_date = req.body.payment_date || req.body.transfer_date || todayISO();
  const bank_reference = req.body.bank_reference || null;
  const amount = req.body.amount != null ? parseFloat(req.body.amount) : invoice.amount;

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  const invoiceCurrency = (invoice.currency || 'USD').toUpperCase();
  const wireCurrency = (req.body.currency ? String(req.body.currency).toUpperCase() : invoiceCurrency);

  try {
    let fx_rate = 1;
    let eur_amount = amount;
    if (wireCurrency !== invoiceCurrency) {
      // The wire was settled in a different currency than the invoice was issued in —
      // convert from the currency actually transferred, not the invoice's.
      if (wireCurrency === 'EUR') {
        fx_rate = 1;
        eur_amount = amount;
      } else {
        try {
          fx_rate = await getEurRate(wireCurrency, payment_date);
          eur_amount = amount * fx_rate;
        } catch (fxErr) {
          console.warn(`[wire-transfer] FX lookup failed for ${wireCurrency}/${payment_date}, proceeding without conversion:`, fxErr);
        }
      }
    // Reuse the invoice's stored fx_rate when present so the wire's EUR value lines up
    // with the invoice's book value. Otherwise the dashboard's Paid YTD shifts whenever
    // FX moves between invoice_date and payment_date.
    } else if (invoice.fx_rate != null) {
      fx_rate = invoice.fx_rate;
      eur_amount = amount * fx_rate;
    } else if ((invoice.currency || 'USD').toUpperCase() === 'EUR') {
      fx_rate = 1;
      eur_amount = amount;
    } else {
      try {
        fx_rate = await getEurRate(invoice.currency || 'USD', payment_date);
        eur_amount = amount * fx_rate;
      } catch (fxErr) {
        console.warn(`[wire-transfer] FX lookup failed for ${invoice.currency}/${payment_date}, proceeding without conversion:`, fxErr);
      }
    }

    const result = db.prepare(`
      INSERT INTO wire_transfers (invoice_id, amount, transfer_date, bank_reference, fx_rate, eur_amount, status, file_path, file_name, currency)
      VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
    `).run(Number(req.params.id), amount, payment_date, bank_reference, fx_rate, eur_amount, file_path, file_name, wireCurrency);
    // Less than the invoice (all its wires counted)? What is still owed, in the invoice's currency
    const balance = balancesFor([invoice]).get(Number(invoice.id)) || { paid_amount: null, outstanding: null };

    // Force immediate disk save — do NOT rely on the 100ms debounce for critical financial data
    db.saveToDisk();

    // For already-paid invoices, the wire is just additional documentation: don't touch
    // status, payment_date, or status history — that would shift the existing YTD bucket.
    if (invoice.status !== 'paid') {
      const prevStatus = invoice.status;
      db.prepare(`UPDATE invoices SET status='paid', payment_date=?, updated_at=datetime('now') WHERE id=?`).run(payment_date, req.params.id);
      db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, 'paid', ?, 'Auto-paid via wire transfer upload')`)
        .run(req.params.id, prevStatus, req.user!.userId);
      db.saveToDisk();
    }

    // Auto-complete linked operation: delivered + at least one wire transfer uploaded = completed
    if (invoice.operation_id) {
      const operation = db.prepare('SELECT status FROM operations WHERE id = ?').get(invoice.operation_id) as any;
      if (operation && operation.status === 'delivered') {
        db.prepare(`UPDATE operations SET status='completed', updated_at=datetime('now') WHERE id=?`).run(invoice.operation_id);
      }
    }

    notifyAdmin({ action: 'status changed', entity: 'Invoice',
      label: invoice.invoice_number,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
      detail: balance.outstanding
        ? `Wire transfer uploaded — ${balance.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoiceCurrency} still outstanding`
        : 'Paid via wire transfer upload' });

    // Money in: announce it to the people chosen in User Management → Payments
    if (invoice.type === 'customer') {
      const info = db.prepare(`
        SELECT c.name AS customer_name, op.id AS operation_id, op.operation_number
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN operations op ON op.id = i.operation_id
        WHERE i.id = ?
      `).get(invoice.id) as any;
      void sendPaymentReceivedEmail({
        customerName: info?.customer_name || null,
        invoiceNumber: invoice.invoice_number,
        operationNumber: info?.operation_number || null,
        operationId: info?.operation_id || null,
        amount, currency: wireCurrency, eurAmount: eur_amount,
        paymentDate: payment_date, bankReference: bank_reference,
        recordedBy: req.user?.display_name || null,
        wireFilePath: file_path, wireFileName: file_name,
        outstanding: balance.outstanding, invoiceAmount: Number(invoice.amount) || null, invoiceCurrency,
      });
    }

    const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ?').get(result.lastInsertRowid) as any;
    res.status(201).json({ ...transfer, invoice_amount: invoice.amount, invoice_currency: invoiceCurrency, ...balance });
  } catch (err: any) {
    console.error('[wire-transfer] Upload failed:', err);
    res.status(500).json({ error: err.message || 'Failed to process wire transfer' });
  }
});

router.delete('/:id/wire-transfers/:transferId', (req: Request, res: Response) => {
  const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ? AND invoice_id = ?').get(req.params.transferId, req.params.id) as any;
  if (!transfer) { res.status(404).json({ error: 'Wire transfer not found' }); return; }

  if (transfer.file_path) {
    const inv = db.prepare('SELECT invoice_number FROM invoices WHERE id = ?').get(req.params.id) as any;
    archiveStored('wire-transfers', transfer.file_path, { section: 'Wire transfers', context: `Wire transfer for invoice ${inv?.invoice_number || ''}`, fileName: transfer.file_name }, archivedBy(req));
  }

  // Get invoice's operation_id before modifying
  const invoiceForRevert = db.prepare('SELECT operation_id FROM invoices WHERE id = ?').get(req.params.id) as any;

  db.prepare('DELETE FROM wire_transfers WHERE id = ?').run(transfer.id);

  // An invoice can be paid by several wire transfers. Only revert to 'sent' once the LAST
  // wire transfer is removed — otherwise the invoice stays paid (and the operation completed).
  const remaining = (db.prepare('SELECT COUNT(*) as count FROM wire_transfers WHERE invoice_id = ?').get(req.params.id) as any).count;

  if (remaining === 0) {
    // Revert invoice to sent and clear payment_date
    db.prepare(`UPDATE invoices SET status='sent', payment_date=NULL, updated_at=datetime('now') WHERE id=?`).run(req.params.id);
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, 'paid', 'sent', ?, 'Wire transfer deleted — reverted to sent')`)
      .run(req.params.id, req.user!.userId);

    // If the operation was completed, revert to delivered (invoice is no longer paid)
    if (invoiceForRevert?.operation_id) {
      db.prepare(`UPDATE operations SET status='delivered', updated_at=datetime('now') WHERE id=? AND status='completed'`)
        .run(invoiceForRevert.operation_id);
    }
  }

  // Force immediate disk save — critical financial data
  db.saveToDisk();

  res.json({ message: 'Wire transfer deleted' });
});

export default router;
