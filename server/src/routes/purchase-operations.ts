import { Router, Request, Response } from 'express';
import fs from 'fs';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { withSizes } from '../lib/documentMail.js';
import { archiveStored, archivedBy, contextOf } from '../lib/archive.js';
import { uploadPurchaseOperationDocs } from '../middleware/upload.js';
import { deletePurchaseOrderRow } from './purchase-orders.js';
import { todayISO } from '../lib/today.js';

/**
 * Purchase operations (PO<year><nnnn>, e.g. PO20260001): a purchase from a
 * supplier. The first step is its supplier purchase order (routes/purchase-orders.ts
 * `purchase_operation_id`, numbered as the operation); the supplier's documents
 * are uploaded alongside, several at once. Sales operations can file a copy of
 * the PO (`POST /api/operations/:id/documents/from-purchase-po`) and pick these
 * documents for their shipping documents (document source `purchase`).
 * Never revenue / analytics.
 */

const router = Router();
const SECTION = 'Purchase operations';
const SAFE = /^[a-zA-Z0-9._-]+$/;
const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });

function yearOf(date: string | null | undefined): number {
  const m = String(date || '').match(/^(\d{4})-\d{2}-\d{2}$/);
  return m ? Number(m[1]) : Number(todayISO().slice(0, 4));
}

/** One after the highest PO<year>… already used, zero padding kept; the first of a year is PO<year>0001. */
export function nextPurchaseOperationNumber(year: number = yearOf(null)): string {
  const prefix = `PO${year}`;
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const used = db.prepare('SELECT po_number AS n FROM purchase_operations WHERE UPPER(po_number) LIKE ?').all(`${prefix}%`) as any[];
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

function seqOf(number: string, year: number): number {
  const m = number.toUpperCase().match(new RegExp(`^PO${year}(\\d+)$`));
  return m ? Number(m[1]) : 0;
}

const CUSTOM_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._\-/]{1,39}$/;
function numberTaken(number: string, exceptId?: number): boolean {
  const row = db.prepare('SELECT id FROM purchase_operations WHERE lower(po_number) = lower(?)').get(number) as any;
  // The PO document carries the same number — one used by another purchase order is taken too
  const po = db.prepare('SELECT id, purchase_operation_id FROM purchase_orders WHERE lower(po_number) = lower(?)').get(number) as any;
  return (!!row && row.id !== exceptId) || (!!po && po.purchase_operation_id !== exceptId);
}

/**
 * A PO the user uploaded (not generated here): a document filed as Purchase
 * Order other than the generated PO's own. Newest first.
 */
const UPLOADED_PO = `
  SELECT d.id FROM purchase_operation_documents d
  JOIN document_categories c ON c.id = d.category_id
  WHERE d.purchase_operation_id = p.id AND lower(c.name) = 'purchase order'
    AND d.id NOT IN (SELECT po.purchase_operation_document_id FROM purchase_orders po
                     WHERE po.purchase_operation_id = p.id AND po.purchase_operation_document_id IS NOT NULL)
  ORDER BY d.created_at DESC, d.id DESC LIMIT 1
`;

const SELECT = `
  SELECT p.*, COALESCE(s.name, p.supplier_name) AS supplier_label, s.category AS supplier_category,
    (SELECT COUNT(*) FROM purchase_operation_documents d WHERE d.purchase_operation_id = p.id) AS document_count,
    (SELECT po.id FROM purchase_orders po WHERE po.purchase_operation_id = p.id ORDER BY po.id DESC LIMIT 1) AS purchase_order_id,
    (SELECT po.status FROM purchase_orders po WHERE po.purchase_operation_id = p.id ORDER BY po.id DESC LIMIT 1) AS generated_status,
    (${UPLOADED_PO}) AS uploaded_po_document_id
  FROM purchase_operations p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

/**
 * Where the PO stands: 'final' (generated here), 'uploaded' (the supplier's /
 * our own PO uploaded as a document), 'draft' (being prepared here), or null.
 */
function withPoStatus<T extends { generated_status: string | null; uploaded_po_document_id: number | null }>(row: T) {
  const status = row.generated_status === 'final' ? 'final'
    : row.uploaded_po_document_id ? 'uploaded'
    : row.generated_status === 'draft' ? 'draft' : null;
  return { ...row, purchase_order_status: status };
}

/** A file name that reads as a purchase order: "PO 4500123.pdf", "Purchase Order …", or the operation's number. */
export function looksLikePurchaseOrder(fileName: string, poNumber: string): boolean {
  const stem = String(fileName || '').replace(/\.[A-Za-z0-9]+$/, '');
  if (poNumber && stem.toLowerCase().includes(poNumber.toLowerCase())) return true;
  return /(^|[^a-z])p\.?o([^a-z]|$)/i.test(stem) || /purchase[\s_.-]*order/i.test(stem) || /bestelbon|bestellung|ordine[\s_-]*d.?acquisto|orden[\s_-]*de[\s_-]*compra/i.test(stem);
}

function purchaseOrderCategoryId(): number | null {
  db.prepare(`INSERT OR IGNORE INTO document_categories (name) VALUES ('Purchase Order')`).run();
  return (db.prepare(`SELECT id FROM document_categories WHERE name = 'Purchase Order'`).get() as any)?.id ?? null;
}

/**
 * Uploads with no category whose name reads as a PO are filed as Purchase
 * Order — on upload, and for documents uploaded before this (on read) — so the
 * operation knows its PO is in. Only while it has no PO filed that way yet.
 */
function recognizeUploadedPo(purchaseOperationId: number): void {
  const op = db.prepare(`SELECT p.id, p.po_number, (${UPLOADED_PO}) AS uploaded FROM purchase_operations p WHERE p.id = ?`).get(purchaseOperationId) as any;
  if (!op || op.uploaded) return;
  const generatedDoc = (db.prepare('SELECT purchase_operation_document_id AS id FROM purchase_orders WHERE purchase_operation_id = ? AND purchase_operation_document_id IS NOT NULL').get(op.id) as any)?.id ?? null;
  const candidates = db.prepare('SELECT id, file_name FROM purchase_operation_documents WHERE purchase_operation_id = ? AND category_id IS NULL ORDER BY created_at DESC, id DESC').all(op.id) as any[];
  const hit = candidates.find(d => d.id !== generatedDoc && looksLikePurchaseOrder(d.file_name, op.po_number));
  if (!hit) return;
  const categoryId = purchaseOrderCategoryId();
  if (categoryId) db.prepare('UPDATE purchase_operation_documents SET category_id = ? WHERE id = ?').run(categoryId, hit.id);
}

const DOCS_SELECT = `
  SELECT d.*, c.name AS category_name FROM purchase_operation_documents d
  LEFT JOIN document_categories c ON c.id = d.category_id
`;

function detail(id: number | string) {
  if (Number(id) > 0) recognizeUploadedPo(Number(id));
  const raw = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as any;
  if (!raw) return null;
  const row = withPoStatus(raw);
  const documents = db.prepare(`${DOCS_SELECT} WHERE d.purchase_operation_id = ? ORDER BY d.created_at DESC, d.id DESC`).all(row.id) as any[];
  const po = db.prepare('SELECT id, po_number, status, file_path, file_name, source_order_id, purchase_operation_document_id, draft_data IS NOT NULL AS has_draft FROM purchase_orders WHERE purchase_operation_id = ? ORDER BY id DESC LIMIT 1').get(row.id) as any;
  return {
    ...row,
    purchase_order: po || null,
    uploaded_po: documents.find(d => d.id === row.uploaded_po_document_id) || null,
    documents: withSizes(documents).map(d => ({
      ...d, generated: !!po && d.id === po.purchase_operation_document_id, uploaded_po: d.id === row.uploaded_po_document_id,
    })),
  };
}

/** The supplier: one from the list, else a typed name. */
function supplierOf(body: any): { supplier_id: number | null; supplier_name: string | null } | { error: string } {
  const id = Number(body?.supplier_id);
  if (id) {
    const row = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(id) as any;
    if (!row) return { error: 'Supplier not found' };
    // The name is kept too, so it still shows if the supplier record goes
    return { supplier_id: id, supplier_name: row.name || null };
  }
  const name = String(body?.supplier_name ?? '').trim();
  if (!name) return { error: 'Choose the supplier' };
  return { supplier_id: null, supplier_name: name.slice(0, 200) };
}

// GET /api/purchase-operations?search=
router.get('/', (req: Request, res: Response) => {
  const search = String(req.query.search || '').trim();
  const where = search ? 'WHERE (p.po_number LIKE ?1 OR s.name LIKE ?1 OR p.supplier_name LIKE ?1 OR p.notes LIKE ?1)' : '';
  for (const { id } of db.prepare('SELECT id FROM purchase_operations').all() as any[]) recognizeUploadedPo(id);
  const rows = db.prepare(`${SELECT} ${where} ORDER BY p.year DESC, p.seq DESC, p.id DESC`).all(...(search ? [`%${search}%`] : [])) as any[];
  res.json({ data: rows.map(withPoStatus) });
});

// GET /api/purchase-operations/next-number?date= — preview only
router.get('/next-number', (req: Request, res: Response) => {
  res.json({ po_number: nextPurchaseOperationNumber(yearOf(req.query.date as string)) });
});

// GET /api/purchase-operations/for-picking — POs (generated or uploaded) a sales operation can file a copy of
router.get('/for-picking', (_req: Request, res: Response) => {
  for (const { id } of db.prepare('SELECT id FROM purchase_operations').all() as any[]) recognizeUploadedPo(id);
  const generated = db.prepare(`
    SELECT po.id, po.po_number, po.file_path, po.file_name, po.updated_at, po.data, po.purchase_operation_document_id,
      p.id AS purchase_operation_id, p.po_date, COALESCE(s.name, p.supplier_name) AS supplier_label
    FROM purchase_orders po
    JOIN purchase_operations p ON p.id = po.purchase_operation_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE po.status = 'final' AND po.file_path IS NOT NULL AND po.purchase_operation_document_id IS NOT NULL
    ORDER BY p.year DESC, p.seq DESC, p.id DESC
  `).all() as any[];
  // Uploaded POs (filed as Purchase Order, not the generated one)
  const uploaded = db.prepare(`
    SELECT d.id AS purchase_operation_document_id, d.file_path, d.file_name, d.created_at AS updated_at,
      p.po_number, p.id AS purchase_operation_id, p.po_date, p.year, p.seq, COALESCE(s.name, p.supplier_name) AS supplier_label
    FROM purchase_operation_documents d
    JOIN document_categories c ON c.id = d.category_id
    JOIN purchase_operations p ON p.id = d.purchase_operation_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE lower(c.name) = 'purchase order'
      AND d.id NOT IN (SELECT purchase_operation_document_id FROM purchase_orders WHERE purchase_operation_document_id IS NOT NULL)
  `).all() as any[];
  const rows = [
    ...generated.map(({ data, ...r }) => {
      let lines: string[] = [];
      try { lines = (JSON.parse(data)?.items || []).map((it: any) => it?.commercial_name || it?.reference).filter(Boolean); } catch { /* corrupt row */ }
      return { ...r, id: r.purchase_operation_document_id, uploaded: false, products: lines.slice(0, 5) };
    }),
    ...uploaded.map(r => ({ ...r, id: r.purchase_operation_document_id, uploaded: true, products: [] as string[] })),
  ];
  // Newest purchase operation first (as the list)
  const order = new Map((db.prepare('SELECT id FROM purchase_operations ORDER BY year DESC, seq DESC, id DESC').all() as any[]).map((r, i) => [r.id, i]));
  rows.sort((a, b) => (order.get(a.purchase_operation_id) ?? 0) - (order.get(b.purchase_operation_id) ?? 0));
  res.json(rows);
});

router.get('/:id', (req: Request, res: Response) => {
  const row = detail(req.params.id as string);
  if (!row) { res.status(404).json({ error: 'Purchase operation not found' }); return; }
  res.json(row);
});

// POST /api/purchase-operations — {po_number ('' = automatic), supplier_id | supplier_name, po_date, notes}
router.post('/', (req: Request, res: Response) => {
  const body = req.body || {};
  const supplier = supplierOf(body);
  if ('error' in supplier) { res.status(400).json({ error: supplier.error }); return; }
  if (body.po_date && !validDate(body.po_date)) { res.status(400).json({ error: 'Invalid date' }); return; }
  const date = body.po_date || todayISO();
  const year = yearOf(date);
  const typed = String(body.po_number ?? '').trim();
  const notes = String(body.notes ?? '').trim() || null;

  const insert = (number: string) => db.prepare(`
    INSERT INTO purchase_operations (po_number, year, seq, supplier_id, supplier_name, po_date, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(number, year, seqOf(number, year), supplier.supplier_id, supplier.supplier_name, date, notes, req.user?.userId ?? null);

  const created = (id: number, number: string) => {
    const row = detail(id);
    notifyAdmin({ action: 'created', entity: 'Purchase Operation', label: number, detail: row?.supplier_label || undefined, ...who(req) });
    res.status(201).json(row);
  };

  if (typed) {
    if (!CUSTOM_NUMBER.test(typed)) { res.status(400).json({ error: 'The number may use letters, digits and - _ . / only' }); return; }
    if (numberTaken(typed)) { res.status(409).json({ error: `${typed} is already used`, suggested: nextPurchaseOperationNumber(year) }); return; }
    created(Number(insert(typed).lastInsertRowid), typed);
    return;
  }
  // Two people creating at once can pick the same number — the second takes the next one
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = nextPurchaseOperationNumber(year);
    if (numberTaken(number)) continue;
    try {
      created(Number(insert(number).lastInsertRowid), number);
      return;
    } catch (err: any) {
      if (!/UNIQUE/i.test(String(err?.message))) throw err;
    }
  }
  res.status(409).json({ error: 'Could not assign a number — try again' });
});

// PUT /api/purchase-operations/:id — a field left out keeps its value
router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM purchase_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase operation not found' }); return; }
  const body = req.body || {};

  let supplierId = existing.supplier_id as number | null;
  let supplierName = existing.supplier_name as string | null;
  if (body.supplier_id !== undefined || body.supplier_name !== undefined) {
    const s = supplierOf(body);
    if ('error' in s) { res.status(400).json({ error: s.error }); return; }
    supplierId = s.supplier_id; supplierName = s.supplier_name;
  }
  if (body.po_date !== undefined && body.po_date && !validDate(body.po_date)) { res.status(400).json({ error: 'Invalid date' }); return; }
  const date = body.po_date === undefined ? existing.po_date : (body.po_date || null);
  const notes = body.notes === undefined ? existing.notes : (String(body.notes ?? '').trim() || null);

  let number = existing.po_number as string;
  const typed = String(body.po_number ?? '').trim();
  if (body.po_number !== undefined && typed && typed !== existing.po_number) {
    if (!CUSTOM_NUMBER.test(typed)) { res.status(400).json({ error: 'The number may use letters, digits and - _ . / only' }); return; }
    if (numberTaken(typed, existing.id)) { res.status(409).json({ error: `${typed} is already used`, suggested: nextPurchaseOperationNumber(existing.year) }); return; }
    number = typed;
  }

  db.prepare(`
    UPDATE purchase_operations SET po_number = ?, seq = ?, supplier_id = ?, supplier_name = ?, po_date = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(number, number === existing.po_number ? existing.seq : seqOf(number, existing.year), supplierId, supplierName, date, notes, existing.id);

  const changes = [
    number !== existing.po_number ? `renumbered from ${existing.po_number} (an already generated PO keeps its number)` : '',
    supplierId !== existing.supplier_id || supplierName !== existing.supplier_name ? 'supplier changed' : '',
  ].filter(Boolean);
  notifyAdmin({ action: 'updated', entity: 'Purchase Operation', label: number, detail: changes.join('; ') || undefined, ...who(req) });
  res.json(detail(existing.id));
});

/** Archives an uploaded document and drops its row. */
function deleteUpload(doc: any, poNumber: string, by: ReturnType<typeof archivedBy> | null) {
  if (SAFE.test(String(doc.file_path || ''))) {
    archiveStored('operation-docs', doc.file_path, { section: SECTION, context: contextOf(poNumber, doc.notes), fileName: doc.file_name }, by);
  }
  db.prepare('DELETE FROM purchase_operation_documents WHERE id = ?').run(doc.id);
}

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM purchase_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase operation not found' }); return; }
  for (const po of db.prepare('SELECT * FROM purchase_orders WHERE purchase_operation_id = ?').all(existing.id) as any[]) deletePurchaseOrderRow(po);
  const by = archivedBy(req);
  for (const doc of db.prepare('SELECT * FROM purchase_operation_documents WHERE purchase_operation_id = ?').all(existing.id) as any[]) {
    deleteUpload(doc, existing.po_number, by);
  }
  db.prepare('DELETE FROM purchase_operations WHERE id = ?').run(existing.id);
  notifyAdmin({ action: 'deleted', entity: 'Purchase Operation', label: existing.po_number, ...who(req) });
  res.json({ ok: true });
});

// ── Documents ─────────────────────────────────────────────────────────────

// POST /api/purchase-operations/:id/documents — multipart: files (several), category_id, notes
router.post('/:id/documents', uploadPurchaseOperationDocs.array('files', 50), (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  const skipped: string[] = (req as any).skippedFiles || [];
  const op = db.prepare('SELECT id, po_number FROM purchase_operations WHERE id = ?').get(req.params.id) as any;
  if (!op) {
    // A refused upload is just removed, not archived
    for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* best effort */ } }
    res.status(404).json({ error: 'Purchase operation not found' });
    return;
  }
  if (!files.length) {
    res.status(400).json({ error: skipped.length ? `Not a supported file type: ${skipped.join(', ')}` : 'Choose at least one file' });
    return;
  }
  const categoryId = Number(req.body?.category_id) || null;
  const notes = String(req.body?.notes ?? '').trim() || null;
  const added = files.map(f => {
    const r = db.prepare('INSERT INTO purchase_operation_documents (purchase_operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)')
      .run(op.id, categoryId, f.filename, f.originalname, notes);
    return Number(r.lastInsertRowid);
  });
  // A PO among the files (no category chosen, named like one) is filed as Purchase Order
  if (!categoryId) recognizeUploadedPo(op.id);
  notifyAdmin({
    action: 'created', entity: 'Purchase Operation Document', label: op.po_number,
    detail: files.length === 1 ? files[0].originalname : `${files.length} documents`, ...who(req),
  });
  res.status(201).json({ added: added.length, skipped, documents: detail(op.id)!.documents });
});

// PUT /api/purchase-operations/:id/documents/:docId — {file_name, category_id, notes}; a field left out keeps its value
router.put('/:id/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM purchase_operation_documents WHERE id = ? AND purchase_operation_id = ?').get(Number(req.params.docId), Number(req.params.id)) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const body = req.body || {};
  let fileName = doc.file_name as string;
  if (body.file_name !== undefined) {
    const typed = String(body.file_name ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-');
    if (!typed) { res.status(400).json({ error: 'The name can\'t be blank' }); return; }
    // The extension stays the stored file's
    const ext = (doc.file_name.match(/\.[A-Za-z0-9]+$/) || [''])[0];
    fileName = ext && !typed.toLowerCase().endsWith(ext.toLowerCase()) ? `${typed}${ext}` : typed;
  }
  const categoryId = body.category_id === undefined ? doc.category_id : (Number(body.category_id) || null);
  const notes = body.notes === undefined ? doc.notes : (String(body.notes ?? '').trim() || null);
  db.prepare('UPDATE purchase_operation_documents SET file_name = ?, category_id = ?, notes = ? WHERE id = ?').run(fileName.slice(0, 300), categoryId, notes, doc.id);
  res.json(db.prepare(`${DOCS_SELECT} WHERE d.id = ?`).get(doc.id));
});

// DELETE /api/purchase-operations/:id/documents/:docId — the generated PO's document deletes the PO
router.delete('/:id/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM purchase_operation_documents WHERE id = ? AND purchase_operation_id = ?').get(Number(req.params.docId), Number(req.params.id)) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const op = db.prepare('SELECT po_number FROM purchase_operations WHERE id = ?').get(doc.purchase_operation_id) as any;
  const po = db.prepare('SELECT * FROM purchase_orders WHERE purchase_operation_document_id = ?').get(doc.id) as any;
  if (po) deletePurchaseOrderRow(po);
  else deleteUpload(doc, op?.po_number || '', archivedBy(req));
  notifyAdmin({ action: 'deleted', entity: 'Purchase Operation Document', label: `${op?.po_number || ''} — ${doc.file_name}`, ...who(req) });
  res.json({ ok: true });
});

export default router;
