import { Router, Request, Response } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import db from '../database.js';
import { isEntityCode } from '../lib/companyEntity.js';
import { notifyAdmin } from '../lib/notify.js';
import { getEurRate } from '../lib/fx.js';
import { archiveStored, archivedBy } from '../lib/archive.js';
import { AiBudgetError } from '../lib/aiBudget.js';
import { readSupplierInvoice, isCreditError, invoiceReaderConfigured, isPdf, pdfText } from '../lib/supplierInvoiceReader.js';
import { decideCurrency, isChineseSupplier } from '../lib/invoiceCurrency.js';
import { uploadTechnologyExpense } from '../middleware/upload.js';
import { parsePDFInvoice, invoiceCategories } from './demo-expenses.js';
import { deleteInvoiceDocument } from './invoice-documents.js';
import { todayISO } from '../lib/today.js';
import { syncProjectExpenses, relabelProject } from '../lib/projectExpenses.js';

/**
 * Technology operations (TO): technology services TripleW provides and is
 * reimbursed for on its expenses. Numbered TO + entity + year + running number
 * like sales operations (TOBE20260001). Expenses (supplier invoices / receipts)
 * are uploaded to the operation and invoiced as TI… invoices
 * (routes/invoice-documents.ts `to_id`), which count as revenue.
 */

const router = Router();

export const TO_STATUSES = ['open', 'completed', 'cancelled'] as const;
const STATUS_LABEL: Record<string, string> = { open: 'Open', completed: 'Completed', cancelled: 'Cancelled' };
const isStatus = (v: unknown): v is string => TO_STATUSES.includes(v as any);
const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
const SECTION = 'Technology operations';

function yearOf(date: string | null | undefined): number {
  const m = String(date || '').match(/^(\d{4})-\d{2}-\d{2}$/);
  return m ? Number(m[1]) : Number(todayISO().slice(0, 4));
}

/**
 * The next TO number of an entity and year: one after the highest already
 * used, keeping its zero padding — TOBE20260007 → TOBE20260008; the first of a
 * year is TO<entity><year>0001 (as `nextOperationNumber` for SO numbers).
 */
export function nextTechnologyNumber(entity: string, year: number = yearOf(null)): string {
  const prefix = `TO${entity.toUpperCase()}${year}`;
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const used = db.prepare('SELECT to_number AS n FROM technology_operations WHERE UPPER(to_number) LIKE ?').all(`${prefix}%`) as any[];
  let max = 0;
  let width = 4;
  for (const { n } of used) {
    const m = pattern.exec(String(n || '').trim());
    if (!m) continue;
    const value = Number(m[1]);
    if (value > max) { max = value; width = Math.max(4, m[1].length); }
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

/** The running number inside a number that follows the series (TOBE20260007 → 7), else 0. */
function seqOf(number: string, entity: string, year: number): number {
  const m = number.toUpperCase().match(new RegExp(`^TO${entity}${year}(\\d+)$`));
  return m ? Number(m[1]) : 0;
}

const CUSTOM_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._\-/]{1,39}$/;
function numberTaken(number: string, exceptId?: number): boolean {
  const row = db.prepare('SELECT id FROM technology_operations WHERE lower(to_number) = lower(?)').get(number) as any;
  return !!row && row.id !== exceptId;
}

const SELECT = `
  SELECT t.*, c.name AS customer_name,
    (SELECT COALESCE(SUM(COALESCE(e.eur_amount, e.net_amount)), 0) FROM technology_expenses e WHERE e.to_id = t.id) AS expenses_eur,
    (SELECT COUNT(*) FROM technology_expenses e WHERE e.to_id = t.id) AS expense_count,
    (SELECT COUNT(*) FROM technology_expenses e WHERE e.to_id = t.id AND e.invoice_document_id IS NULL) AS uninvoiced_count,
    (SELECT COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) FROM invoices i WHERE i.technology_operation_id = t.id) AS invoiced_eur
  FROM technology_operations t
  LEFT JOIN customers c ON c.id = t.customer_id
`;

const EXPENSE_SELECT = `
  SELECT e.*, d.invoice_number, d.status AS invoice_status
  FROM technology_expenses e
  LEFT JOIN invoice_documents d ON d.id = e.invoice_document_id
`;

function detail(id: number | string) {
  const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as any;
  if (!row) return null;
  const expenses = db.prepare(`${EXPENSE_SELECT} WHERE e.to_id = ? ORDER BY e.expense_date IS NULL, e.expense_date, e.id`).all(row.id);
  const invoices = (db.prepare(`
    SELECT d.id, d.invoice_number, d.status, d.data, d.draft_data IS NOT NULL AS has_draft, d.created_at, d.updated_at,
      i.id AS recorded_id, i.status AS recorded_status, i.amount AS recorded_amount, i.currency AS recorded_currency, i.invoice_date
    FROM invoice_documents d
    LEFT JOIN invoices i ON i.id = d.invoice_id
    WHERE d.to_id = ?
    ORDER BY d.id DESC
  `).all(row.id) as any[]).map(inv => {
    let data: any = {};
    try { data = JSON.parse(inv.data); } catch { /* corrupt row */ }
    const items: any[] = Array.isArray(data.items) ? data.items : [];
    const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
    const total = subtotal + (Number(data.freight) || 0) + (Number(data.insurance) || 0) + (Number(data.vat) || 0);
    const { data: _omit, ...rest } = inv;
    return {
      ...rest, doc_date: data.doc_date || null, total: Math.round(total * 100) / 100,
      currency: String(items.find(it => it?.currency)?.currency || 'EUR').toUpperCase(),
    };
  });
  return { ...row, expenses, invoices };
}

// ── Operations ────────────────────────────────────────────────────────────

// GET /api/technology-operations?entity=BE&status=open&search=
router.get('/', (req: Request, res: Response) => {
  syncProjectExpenses();
  const conditions: string[] = [];
  const params: any[] = [];
  const entity = String(req.query.entity || '').toUpperCase();
  if (isEntityCode(entity)) { conditions.push('t.entity = ?'); params.push(entity); }
  if (isStatus(req.query.status)) { conditions.push('t.status = ?'); params.push(req.query.status); }
  const search = String(req.query.search || '').trim();
  if (search) {
    conditions.push('(t.to_number LIKE ? OR t.title LIKE ? OR c.name LIKE ? OR t.notes LIKE ?)');
    params.push(...Array(4).fill(`%${search}%`));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  res.json({ data: db.prepare(`${SELECT} ${where} ORDER BY t.year DESC, t.entity, t.seq DESC, t.id DESC`).all(...params) });
});

// GET /api/technology-operations/next-number?entity=BE&date=2026-10-11 — preview only
router.get('/next-number', (req: Request, res: Response) => {
  const entity = String(req.query.entity || '').toUpperCase();
  if (!isEntityCode(entity)) { res.status(400).json({ error: 'Choose the entity (BE or NL)' }); return; }
  res.json({ to_number: nextTechnologyNumber(entity, yearOf(req.query.date as string)) });
});

router.get('/:id', (req: Request, res: Response) => {
  syncProjectExpenses();
  const row = detail(req.params.id as string);
  if (!row) { res.status(404).json({ error: 'Technology operation not found' }); return; }
  res.json(row);
});

function customerError(id: unknown): string | null {
  const n = Number(id);
  if (!n || !db.prepare('SELECT id FROM customers WHERE id = ?').get(n)) return 'Choose the customer';
  return null;
}

// POST /api/technology-operations — {entity, to_number ('' = automatic), customer_id, title, to_date, status, notes}
router.post('/', (req: Request, res: Response) => {
  const body = req.body || {};
  const entity = String(body.entity || '').toUpperCase();
  if (!isEntityCode(entity)) { res.status(400).json({ error: 'Choose the entity (BE or NL)' }); return; }
  const custErr = customerError(body.customer_id);
  if (custErr) { res.status(400).json({ error: custErr }); return; }
  if (body.to_date && !validDate(body.to_date)) { res.status(400).json({ error: 'Invalid date' }); return; }
  const status = body.status ? body.status : 'open';
  if (!isStatus(status)) { res.status(400).json({ error: 'Unknown status' }); return; }
  const date = body.to_date || todayISO();
  const year = yearOf(date);
  const typed = String(body.to_number ?? '').trim();
  const title = String(body.title ?? '').trim() || null;
  const notes = String(body.notes ?? '').trim() || null;

  const insert = (number: string) => db.prepare(`
    INSERT INTO technology_operations (to_number, entity, year, seq, customer_id, title, to_date, status, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(number, entity, year, seqOf(number, entity, year), Number(body.customer_id), title, date, status, notes, req.user?.userId ?? null);

  if (typed) {
    if (!CUSTOM_NUMBER.test(typed)) { res.status(400).json({ error: 'The number may use letters, digits and - _ . / only' }); return; }
    if (numberTaken(typed)) {
      res.status(409).json({ error: `${typed} is already used`, suggested: nextTechnologyNumber(entity, year) });
      return;
    }
    const result = insert(typed);
    notifyAdmin({ action: 'created', entity: 'Technology Operation', label: typed, detail: title || undefined, ...who(req) });
    res.status(201).json(detail(Number(result.lastInsertRowid)));
    return;
  }
  // Two people creating at once can pick the same number — the second takes the next one
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = nextTechnologyNumber(entity, year);
    try {
      const result = insert(number);
      notifyAdmin({ action: 'created', entity: 'Technology Operation', label: number, detail: title || undefined, ...who(req) });
      res.status(201).json(detail(Number(result.lastInsertRowid)));
      return;
    } catch (err: any) {
      if (!/UNIQUE/i.test(String(err?.message))) throw err;
    }
  }
  res.status(409).json({ error: 'Could not assign a number — try again' });
});

// PUT /api/technology-operations/:id — a field left out keeps its value
router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM technology_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Technology operation not found' }); return; }
  const body = req.body || {};
  const customerId = body.customer_id === undefined ? existing.customer_id : body.customer_id;
  const custErr = customerError(customerId);
  if (custErr) { res.status(400).json({ error: custErr }); return; }
  if (body.to_date !== undefined && body.to_date && !validDate(body.to_date)) { res.status(400).json({ error: 'Invalid date' }); return; }
  const status = body.status === undefined || body.status === '' ? existing.status : body.status;
  if (!isStatus(status)) { res.status(400).json({ error: 'Unknown status' }); return; }
  const title = body.title === undefined ? existing.title : (String(body.title ?? '').trim() || null);
  const notes = body.notes === undefined ? existing.notes : (String(body.notes ?? '').trim() || null);
  const date = body.to_date === undefined ? existing.to_date : (body.to_date || null);

  let number = existing.to_number as string;
  const typed = String(body.to_number ?? '').trim();
  if (body.to_number !== undefined && typed && typed !== existing.to_number) {
    if (!CUSTOM_NUMBER.test(typed)) { res.status(400).json({ error: 'The number may use letters, digits and - _ . / only' }); return; }
    if (numberTaken(typed, existing.id)) {
      res.status(409).json({ error: `${typed} is already used`, suggested: nextTechnologyNumber(existing.entity, existing.year) });
      return;
    }
    number = typed;
  }

  db.prepare(`
    UPDATE technology_operations
    SET to_number = ?, seq = ?, customer_id = ?, title = ?, to_date = ?, status = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(number, number === existing.to_number ? existing.seq : seqOf(number, existing.entity, existing.year),
    Number(customerId), title, date, status, notes, existing.id);
  if (title !== existing.title) { relabelProject(existing.id); syncProjectExpenses(); }

  const changes = [
    number !== existing.to_number ? `renumbered from ${existing.to_number}` : '',
    status !== existing.status ? `status: ${STATUS_LABEL[existing.status] || existing.status} → ${STATUS_LABEL[status]}` : '',
    title !== existing.title ? `title: ${title || '—'}` : '',
  ].filter(Boolean);
  notifyAdmin({
    action: 'updated', entity: 'Technology Operation', label: number,
    detail: changes.length ? changes.join('; ') : undefined, ...who(req),
  });
  res.json(detail(existing.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM technology_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Technology operation not found' }); return; }
  const paid = db.prepare(`
    SELECT i.invoice_number FROM invoices i
    WHERE i.technology_operation_id = ?
      AND (EXISTS (SELECT 1 FROM wire_transfers w WHERE w.invoice_id = i.id) OR i.status = 'paid')
  `).all(existing.id) as any[];
  if (paid.length) {
    res.status(400).json({ error: `Invoice ${paid.map(p => p.invoice_number).join(', ')} is paid — it can't be deleted with the operation` });
    return;
  }
  for (const inv of db.prepare('SELECT * FROM invoice_documents WHERE to_id = ?').all(existing.id) as any[]) deleteInvoiceDocument(inv);
  const by = archivedBy(req);
  for (const e of db.prepare('SELECT * FROM technology_expenses WHERE to_id = ?').all(existing.id) as any[]) {
    if (e.file_path) archiveStored('technology-expenses', e.file_path, { section: SECTION, context: expenseContext(existing.to_number, e), fileName: e.file_name }, by);
  }
  db.prepare('DELETE FROM technology_expenses WHERE to_id = ?').run(existing.id);
  db.prepare('DELETE FROM technology_operations WHERE id = ?').run(existing.id);
  notifyAdmin({ action: 'deleted', entity: 'Technology Operation', label: existing.to_number, ...who(req) });
  res.json({ ok: true });
});

// ── Expenses ──────────────────────────────────────────────────────────────

function expenseContext(toNumber: string, e: any): string {
  const what = [e.supplier_name, e.reference].filter(Boolean).join(' ');
  return what ? `${toNumber} — ${what}` : toNumber;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const numOrNull = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** EUR value of the net amount on the expense date (null when the rate is unavailable). */
async function eurOf(net: number, currency: string, date: string | null): Promise<{ fx_rate: number | null; eur_amount: number | null }> {
  if (currency === 'EUR') return { fx_rate: 1, eur_amount: round2(net) };
  try {
    const rate = await getEurRate(currency, date || todayISO());
    return { fx_rate: rate, eur_amount: round2(net * rate) };
  } catch { return { fx_rate: null, eur_amount: null }; }
}

let creditOutUntil = 0;

/** readExpenseRaw with the currency rules (Chinese suppliers invoice in USD, a code in the text counts). */
async function readExpense(buf: Buffer, fileName: string, sha: string) {
  const r = await readExpenseRaw(buf, fileName, sha);
  const text = isPdf(buf) ? (await pdfText(buf)).text : '';
  const read = r.read_by === 'ai' ? r.currency : (r.currency === 'EUR' ? null : r.currency);
  const d = decideCurrency(read, text, isChineseSupplier({ name: r.supplier_name, country: (r as any).supplier_country, text }));
  if (d.currency === r.currency && !d.note) return r;
  const note = d.note === 'currency_china_eur' ? 'Chinese supplier in EUR — check the currency'
    : d.currency !== r.currency ? `Currency set to ${d.currency}${d.note === 'currency_china_usd' ? ' (Chinese supplier)' : ' (shown on the invoice)'} — please check` : null;
  return { ...r, currency: d.currency, read_warning: [r.read_warning, note].filter(Boolean).join(' · ') || null };
}

/** What an uploaded expense says: Claude first (cached by sha256, within the AI budget), the basic reader otherwise. */
async function readExpenseRaw(buf: Buffer, fileName: string, sha: string) {
  let warning: string | null = null;
  if (invoiceReaderConfigured() && Date.now() >= creditOutUntil) {
    try {
      const x = await readSupplierInvoice({ fileHash: sha, file: buf, categories: invoiceCategories() });
      if (x) {
        const sign = x.is_credit_note ? -1 : 1;
        const net = x.net_amount ?? (x.total_amount != null && x.vat_amount != null ? x.total_amount - x.vat_amount : x.total_amount);
        return {
          expense_date: x.issue_date, supplier_name: x.supplier_name, reference: x.invoice_number,
          description: x.description, currency: (x.currency || 'EUR').toUpperCase(),
          net_amount: net != null ? sign * Math.abs(net) : 0,
          vat_amount: x.vat_amount != null ? sign * Math.abs(x.vat_amount) : null,
          total_amount: x.total_amount != null ? sign * Math.abs(x.total_amount) : null,
          read_by: 'ai', read_warning: net == null ? 'Amount not found — please check' : null, supplier_country: x.supplier_country,
        };
      }
      warning = 'Could not be read automatically — please check';
    } catch (err: any) {
      if (isCreditError(err)) creditOutUntil = Date.now() + 5 * 60_000;
      warning = err instanceof AiBudgetError ? 'Monthly AI limit reached — read by the basic reader, please check' : 'AI reading unavailable — read by the basic reader, please check';
      console.warn(`[technology] Claude read failed for ${fileName}:`, err?.message || err);
    }
  } else {
    warning = 'AI reading unavailable — read by the basic reader, please check';
  }
  if (isPdf(buf)) {
    const r = await parsePDFInvoice(buf, fileName);
    return {
      expense_date: r.issueDate, supplier_name: r.supplierName === 'Unknown' ? null : r.supplierName, reference: r.invoiceId,
      description: null, currency: (r.currency || 'EUR').toUpperCase(), net_amount: Number(r.amount) || 0,
      vat_amount: Number(r.vatAmount) || null, total_amount: r.amount ? round2(Number(r.amount) + (Number(r.vatAmount) || 0)) : null,
      read_by: 'basic', read_warning: warning,
    };
  }
  return {
    expense_date: null, supplier_name: null, reference: null, description: null, currency: 'EUR',
    net_amount: 0, vat_amount: null, total_amount: null, read_by: 'manual', read_warning: warning || 'Fill in the amounts',
  };
}

/** Fields of a manual expense / an edit, normalised. */
function expenseFields(body: any, existing: any = {}) {
  const pick = (key: string) => (body[key] === undefined ? existing[key] ?? null : body[key]);
  const text = (key: string) => { const v = pick(key); return v == null ? null : (String(v).trim() || null); };
  const date = text('expense_date');
  return {
    expense_date: date && validDate(date) ? date : null,
    supplier_name: text('supplier_name'),
    reference: text('reference'),
    description: text('description'),
    currency: (String(pick('currency') || 'EUR').trim().toUpperCase() || 'EUR').slice(0, 3),
    net_amount: numOrNull(pick('net_amount')) ?? 0,
    vat_amount: numOrNull(pick('vat_amount')),
    total_amount: numOrNull(pick('total_amount')),
  };
}

function loadTo(id: unknown) {
  return db.prepare('SELECT * FROM technology_operations WHERE id = ?').get(Number(id)) as any;
}

// POST /api/technology-operations/:id/expenses — multipart `files` (each read and added), or JSON (a manual expense)
router.post('/:id/expenses', uploadTechnologyExpense.array('files', 50), async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  const to = loadTo(req.params.id);
  if (!to) {
    for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* best effort */ } }
    res.status(404).json({ error: 'Technology operation not found' });
    return;
  }
  const added: number[] = [];
  if (!files.length) {
    const f = expenseFields(req.body || {});
    const fx = await eurOf(f.net_amount, f.currency, f.expense_date);
    const result = db.prepare(`
      INSERT INTO technology_expenses (to_id, expense_date, supplier_name, reference, description, net_amount, vat_amount, total_amount,
        currency, fx_rate, eur_amount, read_by, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
    `).run(to.id, f.expense_date || todayISO(), f.supplier_name, f.reference, f.description, f.net_amount, f.vat_amount, f.total_amount,
      f.currency, fx.fx_rate, fx.eur_amount, req.user?.userId ?? null);
    added.push(Number(result.lastInsertRowid));
  }
  for (const file of files) {
    if (!/^[a-zA-Z0-9._-]+$/.test(file.filename)) { try { fs.unlinkSync(file.path); } catch { /* best effort */ } continue; }
    const buf = fs.readFileSync(file.path);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const r = await readExpense(buf, file.originalname, sha);
    const fx = await eurOf(r.net_amount, r.currency, r.expense_date);
    const result = db.prepare(`
      INSERT INTO technology_expenses (to_id, expense_date, supplier_name, reference, description, net_amount, vat_amount, total_amount,
        currency, fx_rate, eur_amount, file_path, file_name, sha256, read_by, read_warning, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(to.id, r.expense_date, r.supplier_name, r.reference, r.description, round2(r.net_amount), r.vat_amount, r.total_amount,
      r.currency, fx.fx_rate, fx.eur_amount, file.filename, file.originalname, sha, r.read_by, r.read_warning, req.user?.userId ?? null);
    added.push(Number(result.lastInsertRowid));
  }
  notifyAdmin({
    action: 'created', entity: 'Technology Operation Expense', label: to.to_number,
    detail: `${added.length} expense(s) added`, ...who(req),
  });
  const rows = added.length
    ? db.prepare(`${EXPENSE_SELECT} WHERE e.id IN (${added.map(() => '?').join(',')})`).all(...added)
    : [];
  res.status(201).json({ expenses: rows });
});

// PUT /api/technology-operations/:id/expenses/:expenseId — a field left out keeps its value; EUR redone
router.put('/:id/expenses/:expenseId', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM technology_expenses WHERE id = ? AND to_id = ?').get(Number(req.params.expenseId), Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Expense not found' }); return; }
  if (existing.demo_invoice_id) { res.status(400).json({ error: 'This expense comes from Supplier Invoices → Project expenses — edit it there' }); return; }
  const f = expenseFields(req.body || {}, existing);
  const fx = await eurOf(f.net_amount, f.currency, f.expense_date);
  db.prepare(`
    UPDATE technology_expenses SET expense_date = ?, supplier_name = ?, reference = ?, description = ?, net_amount = ?, vat_amount = ?,
      total_amount = ?, currency = ?, fx_rate = ?, eur_amount = ?, read_warning = NULL
    WHERE id = ?
  `).run(f.expense_date, f.supplier_name, f.reference, f.description, f.net_amount, f.vat_amount, f.total_amount,
    f.currency, fx.fx_rate, fx.eur_amount, existing.id);
  res.json(db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(existing.id));
});

// DELETE /api/technology-operations/:id/expenses/:expenseId — not while it is on a generated invoice; the file goes to the Archive
router.delete('/:id/expenses/:expenseId', (req: Request, res: Response) => {
  const expense = db.prepare(`${EXPENSE_SELECT} WHERE e.id = ? AND e.to_id = ?`).get(Number(req.params.expenseId), Number(req.params.id)) as any;
  if (!expense) { res.status(404).json({ error: 'Expense not found' }); return; }
  if (expense.demo_invoice_id) { res.status(400).json({ error: 'This expense comes from Supplier Invoices → Project expenses — delete it there, or move it to another project' }); return; }
  if (expense.invoice_document_id && expense.invoice_status === 'final') {
    res.status(400).json({ error: `This expense is on invoice ${expense.invoice_number} — remove it from the invoice first` });
    return;
  }
  const to = loadTo(expense.to_id);
  if (expense.file_path) {
    archiveStored('technology-expenses', expense.file_path, { section: SECTION, context: expenseContext(to?.to_number || '', expense), fileName: expense.file_name }, archivedBy(req));
  }
  db.prepare('DELETE FROM technology_expenses WHERE id = ?').run(expense.id);
  notifyAdmin({ action: 'deleted', entity: 'Technology Operation Expense', label: `${to?.to_number || ''} — ${expense.file_name || expense.supplier_name || 'expense'}`, ...who(req) });
  res.json({ ok: true });
});

export default router;
