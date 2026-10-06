import { Router, Request, Response } from 'express';
import db from '../database.js';
import { uploadProductDoc } from '../middleware/upload.js';
import { notifyAdmin } from '../lib/notify.js';
import {
  SELECT_PRODUCT_DOCS, PRODUCT_DOC_KINDS, KIND_CATEGORY, ProductDocKind,
  unlinkProductFile, matchProduct, copyToOperationDocs, categoryIdByName,
} from '../lib/productDocs.js';

/**
 * Inventory → Documents: the MSDS / product specification sheet library.
 * Operations take copies (`POST /copy`), suggested per order line (`GET /suggest`).
 */

const router = Router();

const KIND_LABEL: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Product Specification Sheet' };
const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
const isKind = (v: unknown): v is ProductDocKind => PRODUCT_DOC_KINDS.includes(v as ProductDocKind);

// GET /api/product-documents?kind=msds&product_id=3
router.get('/', (req: Request, res: Response) => {
  const conditions: string[] = [];
  const params: any[] = [];
  if (isKind(req.query.kind)) { conditions.push('d.kind = ?'); params.push(req.query.kind); }
  const productId = Number(req.query.product_id);
  if (Number.isInteger(productId) && productId > 0) { conditions.push('d.product_id = ?'); params.push(productId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  res.json({ data: db.prepare(`${SELECT_PRODUCT_DOCS} ${where} ORDER BY p.name COLLATE NOCASE, d.kind, d.created_at DESC`).all(...params) });
});

/**
 * GET /api/product-documents/suggest?operation_id=
 * The operation's order lines, each with the catalogue product it names and
 * that product's library documents.
 */
router.get('/suggest', (req: Request, res: Response) => {
  const operationId = Number(req.query.operation_id);
  const op = Number.isInteger(operationId)
    ? db.prepare('SELECT id, order_id FROM operations WHERE id = ?').get(operationId) as any
    : null;
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return; }

  const lines = op.order_id
    ? db.prepare('SELECT id, description, client_product_name FROM order_items WHERE order_id = ? ORDER BY id').all(op.order_id) as any[]
    : [];
  res.json({ lines: suggestFor(lines) });
});

export function suggestFor(lines: Array<{ description?: string | null; client_product_name?: string | null }>) {
  const products = db.prepare('SELECT id, name, sku FROM products').all() as any[];
  const docs = db.prepare(`${SELECT_PRODUCT_DOCS} ORDER BY d.created_at DESC`).all() as any[];
  return lines.map(line => {
    const product = matchProduct(line, products);
    return {
      description: line.description || line.client_product_name || '',
      product,
      documents: product ? docs.filter(d => d.product_id === product.id) : [],
    };
  });
}

// POST /api/product-documents — multipart: file, product_id, kind, notes
router.post('/', uploadProductDoc.single('file'), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'File is required' }); return; }
  const productId = Number(req.body?.product_id);
  const kind = req.body?.kind;
  const product = Number.isInteger(productId) ? db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as any : null;
  if (!product || !isKind(kind)) {
    unlinkProductFile(req.file.filename);
    res.status(400).json({ error: product ? 'Choose MSDS or Product Specification Sheet' : 'Choose the product' });
    return;
  }
  const result = db.prepare(`
    INSERT INTO product_documents (product_id, kind, file_path, file_name, notes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(product.id, kind, req.file.filename, req.file.originalname, String(req.body?.notes ?? '').trim() || null, req.user?.userId ?? null);
  notifyAdmin({ action: 'created', entity: 'Product Document', label: `${KIND_LABEL[kind]} — ${product.name}`, ...who(req) });
  res.status(201).json(db.prepare(`${SELECT_PRODUCT_DOCS} WHERE d.id = ?`).get(result.lastInsertRowid));
});

// PUT /api/product-documents/:id — optional new file; notes left out keep their value
router.put('/:id', uploadProductDoc.single('file'), (req: Request, res: Response) => {
  const existing = db.prepare(`${SELECT_PRODUCT_DOCS} WHERE d.id = ?`).get(Number(req.params.id)) as any;
  if (!existing) {
    if (req.file) unlinkProductFile(req.file.filename);
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const notes = req.body?.notes === undefined ? existing.notes : (String(req.body.notes).trim() || null);
  db.prepare(`
    UPDATE product_documents SET file_path = ?, file_name = ?, notes = ?, uploaded_by = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    req.file?.filename ?? existing.file_path, req.file?.originalname ?? existing.file_name, notes,
    req.file ? (req.user?.userId ?? null) : existing.uploaded_by, existing.id,
  );
  if (req.file) unlinkProductFile(existing.file_path);
  notifyAdmin({ action: 'updated', entity: 'Product Document', label: `${KIND_LABEL[existing.kind as ProductDocKind]} — ${existing.product_name}`, ...who(req) });
  res.json(db.prepare(`${SELECT_PRODUCT_DOCS} WHERE d.id = ?`).get(existing.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare(`${SELECT_PRODUCT_DOCS} WHERE d.id = ?`).get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Document not found' }); return; }
  db.prepare('DELETE FROM product_documents WHERE id = ?').run(existing.id);
  unlinkProductFile(existing.file_path);
  notifyAdmin({ action: 'deleted', entity: 'Product Document', label: `${KIND_LABEL[existing.kind as ProductDocKind]} — ${existing.product_name}`, ...who(req) });
  res.json({ ok: true });
});

/**
 * POST /api/product-documents/copy — { ids: number[], operation_id }
 * Files a copy of each library document under the operation (category MSDS /
 * Product Specification Sheet).
 */
router.post('/copy', (req: Request, res: Response) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
  if (!ids.length) { res.status(400).json({ error: 'Choose at least one document' }); return; }
  const operationId = Number(req.body?.operation_id);
  const op = Number.isInteger(operationId)
    ? db.prepare('SELECT id, operation_number FROM operations WHERE id = ?').get(operationId) as any
    : null;
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return; }

  const added: any[] = [];
  const missing: string[] = [];
  for (const id of [...new Set<number>(ids)]) {
    const doc = db.prepare(`${SELECT_PRODUCT_DOCS} WHERE d.id = ?`).get(id) as any;
    if (!doc) continue;
    const stored = copyToOperationDocs(doc);
    if (!stored) { missing.push(doc.file_name); continue; }
    const kind = doc.kind as ProductDocKind;
    const result = db.prepare(`
      INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)
    `).run(op.id, categoryIdByName(KIND_CATEGORY[kind]), stored, doc.file_name, `${KIND_LABEL[kind]} — ${doc.product_name}`);
    added.push(result.lastInsertRowid);
  }
  if (added.length) {
    notifyAdmin({ action: 'updated', entity: 'Operation', label: `Operation ${op.operation_number}`, detail: `${added.length} product document(s) added from the library`, ...who(req) });
  }
  res.json({ added: added.length, missing });
});

export default router;
