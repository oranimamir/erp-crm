import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import db from '../database.js';
import { uploadProductDoc } from '../middleware/upload.js';
import { notifyAdmin } from '../lib/notify.js';
import {
  PRODUCT_DOC_KINDS, KIND_LABEL, KIND_CATEGORY, ProductDocKind,
  listProductDocs, getProductDoc, docLabel, setDocumentProducts, parseProductIds,
  unlinkProductFile, matchProduct, copyToOperationDocs, categoryIdByName,
} from '../lib/productDocs.js';
import { importLibraryZip, parseLibraryFileName } from '../lib/productLibrary.js';

/**
 * Inventory → Documents: the MSDS / product specification sheet / declaration
 * library. Operations take copies (`POST /copy`), suggested per invoice or
 * order line (`GET /suggest`).
 */

const router = Router();

const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
const isKind = (v: unknown): v is ProductDocKind => PRODUCT_DOC_KINDS.includes(v as ProductDocKind);
const zipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// GET /api/product-documents?kind=msds&product_id=3
router.get('/', (req: Request, res: Response) => {
  const conditions: string[] = [];
  const params: any[] = [];
  if (isKind(req.query.kind)) { conditions.push('d.kind = ?'); params.push(req.query.kind); }
  const productId = Number(req.query.product_id);
  if (Number.isInteger(productId) && productId > 0) {
    conditions.push('d.id IN (SELECT document_id FROM product_document_products WHERE product_id = ?)');
    params.push(productId);
  }
  res.json({ data: listProductDocs(conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params) });
});

/** Lines of the operation's generated invoice (final over draft, newest), else null. */
function invoiceLines(operationId: number): Array<{ description: string; client_product_name: string }> | null {
  const rows = db.prepare(`
    SELECT data FROM invoice_documents WHERE operation_id = ?
    ORDER BY CASE WHEN status = 'final' THEN 0 ELSE 1 END, updated_at DESC, id DESC
  `).all(operationId) as any[];
  for (const row of rows) {
    let data: any;
    try { data = JSON.parse(row.data); } catch { continue; }
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.lines) ? data.lines : [];
    const lines = items
      .map((it: any) => ({
        description: [it.product, it.description, it.commercial_name, it.name].filter(Boolean).join(' '),
        client_product_name: [it.client_product_name, it.reference].filter(Boolean).join(' '),
      }))
      .filter((l: any) => l.description || l.client_product_name);
    if (lines.length) return lines;
  }
  return null;
}

/**
 * GET /api/product-documents/suggest?operation_id=
 * The operation's products — read off its generated invoice, else its order —
 * each with the catalogue product it names and that product's library
 * documents; plus the general documents (linked to no product).
 */
router.get('/suggest', (req: Request, res: Response) => {
  const operationId = Number(req.query.operation_id);
  const op = Number.isInteger(operationId)
    ? db.prepare('SELECT id, order_id FROM operations WHERE id = ?').get(operationId) as any
    : null;
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return; }

  const fromInvoice = invoiceLines(op.id);
  const lines = fromInvoice ?? (op.order_id
    ? db.prepare('SELECT id, description, client_product_name FROM order_items WHERE order_id = ? ORDER BY id').all(op.order_id) as any[]
    : []);
  const docs = listProductDocs();
  res.json({
    source: fromInvoice ? 'invoice' : 'order',
    lines: suggestFor(lines, docs),
    general: docs.filter(d => d.products.length === 0),
  });
});

export function suggestFor(
  lines: Array<{ description?: string | null; client_product_name?: string | null }>,
  docs: any[] = listProductDocs(),
) {
  const products = db.prepare('SELECT id, name, sku FROM products').all() as any[];
  return lines.map(line => {
    const product = matchProduct(line, products);
    return {
      description: line.description || line.client_product_name || '',
      product,
      documents: product ? docs.filter(d => d.products.some((p: any) => p.id === product.id)) : [],
    };
  });
}

// POST /api/product-documents — multipart: file, kind, product_ids (JSON array; empty = general), title, notes
router.post('/', uploadProductDoc.single('file'), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'File is required' }); return; }
  const kind = req.body?.kind;
  if (!isKind(kind)) {
    unlinkProductFile(req.file.filename);
    res.status(400).json({ error: 'Choose MSDS, Product Specification Sheet or Declaration' });
    return;
  }
  const parsed = parseLibraryFileName(req.file.originalname);
  const title = String(req.body?.title ?? '').trim() || parsed.title;
  const result = db.prepare(`
    INSERT INTO product_documents (kind, title, doc_code, file_path, file_name, notes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(kind, title, parsed.code, req.file.filename, req.file.originalname,
    String(req.body?.notes ?? '').trim() || null, req.user?.userId ?? null);
  const id = Number(result.lastInsertRowid);
  setDocumentProducts(id, parseProductIds(req.body?.product_ids) ?? []);
  notifyAdmin({ action: 'created', entity: 'Product Document', label: `${KIND_LABEL[kind]} — ${title}`, ...who(req) });
  res.status(201).json(getProductDoc(id));
});

// POST /api/product-documents/import — multipart: file (ZIP), kind
router.post('/import', zipUpload.single('file'), async (req: Request, res: Response) => {
  const kind = req.body?.kind;
  if (!req.file) { res.status(400).json({ error: 'Choose a ZIP file' }); return; }
  if (!isKind(kind)) { res.status(400).json({ error: 'Choose MSDS, Product Specification Sheet or Declaration' }); return; }
  if (path.extname(req.file.originalname).toLowerCase() !== '.zip') { res.status(400).json({ error: 'Only ZIP files can be imported' }); return; }
  try {
    const result = await importLibraryZip(req.file.buffer, kind, req.user?.userId ?? null);
    const parts = [`${result.imported} added`, `${result.replaced} replaced`, `${result.skipped} unchanged`];
    if (result.productsCreated.length) parts.push(`${result.productsCreated.length} product(s) created`);
    notifyAdmin({ action: 'updated', entity: 'Product Document', label: `${KIND_LABEL[kind]} library import`, detail: parts.join(', '), ...who(req) });
    res.json(result);
  } catch (err: any) {
    console.error('[product-documents] import failed:', err);
    res.status(400).json({ error: 'Could not read the ZIP file' });
  }
});

// PUT /api/product-documents/:id — optional new file; title / notes / product_ids left out keep their value
router.put('/:id', uploadProductDoc.single('file'), (req: Request, res: Response) => {
  const existing = getProductDoc(Number(req.params.id));
  if (!existing) {
    if (req.file) unlinkProductFile(req.file.filename);
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const notes = req.body?.notes === undefined ? existing.notes : (String(req.body.notes).trim() || null);
  const title = req.body?.title === undefined ? existing.title : (String(req.body.title).trim() || null);
  db.prepare(`
    UPDATE product_documents SET file_path = ?, file_name = ?, title = ?, notes = ?, sha256 = ?, uploaded_by = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    req.file?.filename ?? existing.file_path, req.file?.originalname ?? existing.file_name, title, notes,
    req.file ? null : existing.sha256, req.file ? (req.user?.userId ?? null) : existing.uploaded_by, existing.id,
  );
  const productIds = parseProductIds(req.body?.product_ids);
  if (productIds) setDocumentProducts(existing.id, productIds);
  if (req.file) unlinkProductFile(existing.file_path);
  notifyAdmin({ action: 'updated', entity: 'Product Document', label: `${KIND_LABEL[existing.kind as ProductDocKind]} — ${docLabel({ title, file_name: existing.file_name })}`, ...who(req) });
  res.json(getProductDoc(existing.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = getProductDoc(Number(req.params.id));
  if (!existing) { res.status(404).json({ error: 'Document not found' }); return; }
  db.prepare('DELETE FROM product_documents WHERE id = ?').run(existing.id);
  unlinkProductFile(existing.file_path);
  notifyAdmin({ action: 'deleted', entity: 'Product Document', label: `${KIND_LABEL[existing.kind as ProductDocKind]} — ${docLabel(existing)}`, ...who(req) });
  res.json({ ok: true });
});

/**
 * POST /api/product-documents/copy — { ids: number[], operation_id }
 * Files a copy of each library document under the operation (category MSDS /
 * Product Specification Sheet / Declaration).
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
    const doc = getProductDoc(id);
    if (!doc) continue;
    const stored = copyToOperationDocs(doc);
    if (!stored) { missing.push(doc.file_name); continue; }
    const kind = doc.kind as ProductDocKind;
    const result = db.prepare(`
      INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)
    `).run(op.id, categoryIdByName(KIND_CATEGORY[kind]), stored, doc.file_name, `${KIND_LABEL[kind]} — ${docLabel(doc)}`);
    added.push(result.lastInsertRowid);
  }
  if (added.length) {
    notifyAdmin({ action: 'updated', entity: 'Operation', label: `Operation ${op.operation_number}`, detail: `${added.length} product document(s) added from the library`, ...who(req) });
  }
  res.json({ added: added.length, missing });
});

export default router;
