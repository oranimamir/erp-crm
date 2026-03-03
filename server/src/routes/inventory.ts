import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchDocDir = process.env.UPLOADS_PATH
  ? path.join(process.env.UPLOADS_PATH, 'batch-documents')
  : path.join(__dirname, '..', '..', 'uploads', 'batch-documents');
fs.mkdirSync(batchDocDir, { recursive: true });

const uploadBatchDoc = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, batchDocDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    conditions.push('(i.name LIKE ? OR i.sku LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) { conditions.push('i.category = ?'); params.push(category); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM inventory_items i ${where}`).get(...params) as any).count;
  const items = db.prepare(`
    SELECT i.*, s.name as supplier_name
    FROM inventory_items i
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    ${where} ORDER BY i.name ASC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: items, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post('/', (req: Request, res: Response) => {
  const { name, sku, category, quantity, unit, min_stock_level, supplier_id, unit_cost, notes } = req.body;
  if (!name || !sku || !category) {
    res.status(400).json({ error: 'name, sku, and category are required' });
    return;
  }

  try {
    const result = db.prepare(`
      INSERT INTO inventory_items (name, sku, category, quantity, unit, min_stock_level, supplier_id, unit_cost, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, sku, category, parseFloat(quantity) || 0, unit || 'pcs', parseFloat(min_stock_level) || 0, supplier_id || null, parseFloat(unit_cost) || 0, notes || null);

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(result.lastInsertRowid) as any;
    notifyAdmin({ action: 'created', entity: 'Inventory Item', label: `${item.name} (${item.sku})`, performedBy: req.user?.display_name || 'Unknown' });
    res.status(201).json(item);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'SKU already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  const { name, sku, category, quantity, unit, min_stock_level, supplier_id, unit_cost, notes } = req.body;

  try {
    db.prepare(`
      UPDATE inventory_items SET name=?, sku=?, category=?, quantity=?, unit=?, min_stock_level=?, supplier_id=?, unit_cost=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      name || existing.name, sku || existing.sku, category || existing.category,
      quantity != null ? parseFloat(quantity) : existing.quantity,
      unit || existing.unit,
      min_stock_level != null ? parseFloat(min_stock_level) : existing.min_stock_level,
      supplier_id !== undefined ? (supplier_id || null) : existing.supplier_id,
      unit_cost != null ? parseFloat(unit_cost) : existing.unit_cost,
      notes ?? existing.notes, req.params.id
    );

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
    notifyAdmin({ action: 'updated', entity: 'Inventory Item', label: `${item.name} (${item.sku})`, performedBy: req.user?.display_name || 'Unknown' });
    res.json(item);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'SKU already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.patch('/:id/adjust', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  const { adjustment, reason } = req.body;
  if (adjustment == null) { res.status(400).json({ error: 'adjustment is required' }); return; }

  const newQty = existing.quantity + parseFloat(adjustment);
  if (newQty < 0) { res.status(400).json({ error: 'Stock cannot go below zero' }); return; }

  db.prepare(`UPDATE inventory_items SET quantity=?, updated_at=datetime('now') WHERE id=?`).run(newQty, req.params.id);

  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  res.json(item);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  db.prepare('DELETE FROM inventory_items WHERE id = ?').run(req.params.id);
  notifyAdmin({ action: 'deleted', entity: 'Inventory Item', label: `${existing.name} (${existing.sku})`, performedBy: req.user?.display_name || 'Unknown' });
  res.json({ message: 'Item deleted' });
});

// ── Batch CRUD ────────────────────────────────────────────────────────────────

router.get('/batches', (_req: Request, res: Response) => {
  const batches = db.prepare('SELECT * FROM batches ORDER BY batch_number ASC').all();
  const result = (batches as any[]).map(b => {
    const documents = db.prepare(
      'SELECT id, document_type, document_name, file_path, file_name, created_at FROM batch_documents WHERE batch_id = ? ORDER BY created_at ASC'
    ).all(b.id);
    return { ...b, documents };
  });
  res.json(result);
});

router.post('/batches', (req: Request, res: Response) => {
  const { batch_number, product } = req.body;
  if (!batch_number) { res.status(400).json({ error: 'batch_number is required' }); return; }
  try {
    const result = db.prepare(
      `INSERT INTO batches (batch_number, product) VALUES (?, ?)`
    ).run(batch_number, product || null);
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(result.lastInsertRowid) as any;
    res.status(201).json({ ...batch, documents: [] });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Batch number already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.put('/batches/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Batch not found' }); return; }
  const { batch_number, product } = req.body;
  try {
    db.prepare(
      `UPDATE batches SET batch_number=?, product=? WHERE id=?`
    ).run(
      batch_number || existing.batch_number,
      product !== undefined ? (product || null) : existing.product,
      req.params.id
    );
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id) as any;
    const documents = db.prepare('SELECT id, document_type, document_name, file_path, file_name, created_at FROM batch_documents WHERE batch_id = ? ORDER BY created_at ASC').all(batch.id);
    res.json({ ...batch, documents });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Batch number already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.delete('/batches/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Batch not found' }); return; }
  db.prepare('DELETE FROM batches WHERE id = ?').run(req.params.id);
  res.json({ message: 'Batch deleted' });
});

router.post('/batches/:id/links', (req: Request, res: Response) => {
  const batch = db.prepare('SELECT id FROM batches WHERE id = ?').get(req.params.id) as any;
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  const { article } = req.body;
  if (!article) { res.status(400).json({ error: 'article is required' }); return; }
  try {
    const result = db.prepare(
      `INSERT INTO batch_warehouse_links (batch_id, article) VALUES (?, ?)`
    ).run(req.params.id, article);
    const link = db.prepare('SELECT * FROM batch_warehouse_links WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(link);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Article already linked to this batch' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.delete('/batches/links/:linkId', (req: Request, res: Response) => {
  const link = db.prepare('SELECT * FROM batch_warehouse_links WHERE id = ?').get(req.params.linkId) as any;
  if (!link) { res.status(404).json({ error: 'Link not found' }); return; }
  db.prepare('DELETE FROM batch_warehouse_links WHERE id = ?').run(req.params.linkId);
  res.json({ message: 'Link removed' });
});

// ── Batch documents ────────────────────────────────────────────────────────────

router.post('/batches/:id/documents', uploadBatchDoc.single('file'), (req: Request, res: Response) => {
  const batch = db.prepare('SELECT id FROM batches WHERE id = ?').get(req.params.id) as any;
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const { document_type, document_name } = req.body;
  if (!document_type || !['coa', 'other'].includes(document_type)) {
    res.status(400).json({ error: 'document_type must be "coa" or "other"' });
    return;
  }
  const result = db.prepare(
    `INSERT INTO batch_documents (batch_id, document_type, document_name, file_path, file_name) VALUES (?, ?, ?, ?, ?)`
  ).run(req.params.id, document_type, document_name || null, req.file.filename, req.file.originalname);
  const doc = db.prepare('SELECT * FROM batch_documents WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(doc);
});

router.delete('/batches/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM batch_documents WHERE id = ?').get(req.params.docId) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  try { fs.unlinkSync(path.join(batchDocDir, doc.file_path)); } catch (_) {}
  db.prepare('DELETE FROM batch_documents WHERE id = ?').run(req.params.docId);
  res.json({ message: 'Document deleted' });
});

export default router;
