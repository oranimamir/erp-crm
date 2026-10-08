import { Router, Request, Response } from 'express';
import db from '../database.js';
import path from 'path';
import fs from 'fs';
import { notifyAdmin } from '../lib/notify.js';
import { uploadSupplierDoc } from '../middleware/upload.js';
import { uploadsBase } from '../lib/productDocs.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  // Exports and pickers ask for everything at once, so the cap is set well above the data size
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    conditions.push('(name LIKE ? OR email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM suppliers ${where}`).get(...params) as any).count;
  const suppliers = db.prepare(`SELECT * FROM suppliers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  res.json({ data: suppliers, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// Suppliers that have documents (the General document tile's supplier picker)
router.get('/with-documents', (_req: Request, res: Response) => {
  res.json(db.prepare(`
    SELECT s.id, s.name, s.category, COUNT(sd.id) AS document_count
    FROM suppliers s JOIN supplier_documents sd ON sd.supplier_id = s.id
    GROUP BY s.id ORDER BY LOWER(s.name)
  `).all());
});

router.get('/:id', (req: Request, res: Response) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  res.json(supplier);
});

router.post('/', (req: Request, res: Response) => {
  const { name, email, phone, address, category, notes, vat_number, contact_person } = req.body;
  if (!name || !category) { res.status(400).json({ error: 'Name and category are required' }); return; }

  const validCategories = ['logistics', 'blenders', 'raw_materials', 'shipping'];
  if (category && !validCategories.includes(category)) {
    res.status(400).json({ error: `Category must be one of: ${validCategories.join(', ')}` });
    return;
  }

  const result = db.prepare(
    'INSERT INTO suppliers (name, email, phone, address, category, notes, vat_number, contact_person) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, email || null, phone || null, address || null, category, notes || null, vat_number || null, contact_person || null);

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid) as any;
  notifyAdmin({ action: 'created', entity: 'Supplier', label: supplier.name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.status(201).json(supplier);
});

/**
 * The supplier record for a name on the Suppliers list. That list also shows
 * names known only from expense invoices; opening one creates its record, so
 * its details can be filled in for trading purchase orders.
 */
router.post('/resolve', (req: Request, res: Response) => {
  const name = String(req.body?.name || '').trim();
  if (!name) { res.status(400).json({ error: 'Name is required' }); return; }

  const existing = db.prepare('SELECT * FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(?)').get(name) as any;
  if (existing) { res.json(existing); return; }

  const hint = String(req.body?.category || '').toLowerCase();
  const category = /blend/.test(hint) ? 'blenders'
    : /logist/.test(hint) ? 'logistics'
    : /ship|freight/.test(hint) ? 'shipping'
    : 'raw_materials';
  const result = db.prepare('INSERT INTO suppliers (name, category) VALUES (?, ?)').run(name, category);
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid) as any;
  notifyAdmin({ action: 'created', entity: 'Supplier', label: supplier.name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.status(201).json(supplier);
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id, vat_number, contact_person FROM suppliers WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }

  const { name, email, phone, address, category, notes, vat_number, contact_person } = req.body;
  if (!name || !category) { res.status(400).json({ error: 'Name and category are required' }); return; }

  db.prepare(
    `UPDATE suppliers SET name=?, email=?, phone=?, address=?, category=?, notes=?, vat_number=?, contact_person=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, email || null, phone || null, address || null, category, notes || null,
    // Kept when a form that doesn't show them saves
    vat_number !== undefined ? (vat_number || null) : existing.vat_number,
    contact_person !== undefined ? (contact_person || null) : existing.contact_person,
    req.params.id);

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id) as any;
  notifyAdmin({ action: 'updated', entity: 'Supplier', label: supplier.name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json(supplier);
});

router.patch('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }

  const { name, category } = req.body as { name?: string; category?: string };
  const validCategories = ['logistics', 'blenders', 'raw_materials', 'shipping'];
  if (category !== undefined && !validCategories.includes(category)) {
    res.status(400).json({ error: `Category must be one of: ${validCategories.join(', ')}` });
    return;
  }

  const updates: string[] = [];
  const params: any[] = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (category !== undefined) { updates.push('category = ?'); params.push(category); }
  if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(req.params.id);
  db.prepare(`UPDATE suppliers SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id) as any;
  notifyAdmin({ action: 'updated', entity: 'Supplier', label: supplier.name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json(supplier);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(req.params.id) as any;
  const files = db.prepare('SELECT file_path FROM supplier_documents WHERE supplier_id = ?').all(req.params.id) as any[];
  const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Supplier not found' }); return; }
  db.prepare('DELETE FROM supplier_documents WHERE supplier_id = ?').run(req.params.id);
  files.forEach(f => unlinkSupplierFile(f.file_path));
  notifyAdmin({ action: 'deleted', entity: 'Supplier', label: existing?.name || `#${req.params.id}`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: 'Supplier deleted' });
});

router.get('/:id/invoices', (req: Request, res: Response) => {
  const invoices = db.prepare('SELECT * FROM invoices WHERE supplier_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(invoices);
});

router.get('/:id/orders', (req: Request, res: Response) => {
  const orders = db.prepare(`
    SELECT o.*,
      (SELECT UPPER(COALESCE(oi.currency, 'USD')) FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id LIMIT 1) as currency
    FROM orders o
    WHERE o.supplier_id = ?
    ORDER BY o.created_at DESC
  `).all(req.params.id);
  res.json(orders);
});

router.get('/:id/shipments', (req: Request, res: Response) => {
  const shipments = db.prepare('SELECT * FROM shipments WHERE supplier_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(shipments);
});

// ── Documents ─────────────────────────────────────────────────────────────
// Supplier-related documentation (certificates, contracts, specs…), files in
// uploads/supplier-docs. Operations copy them in from the General document tile.

const supplierDocsDir = path.join(uploadsBase, 'supplier-docs');
const SAFE = /^[a-zA-Z0-9._-]+$/;

function unlinkSupplierFile(stored: string) {
  if (!SAFE.test(stored)) return;
  try { fs.unlinkSync(path.join(supplierDocsDir, stored)); } catch { /* already gone */ }
}

const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });

const docsOf = (supplierId: number) => db.prepare(`
  SELECT sd.*, u.display_name AS uploaded_by_name FROM supplier_documents sd
  LEFT JOIN users u ON u.id = sd.uploaded_by
  WHERE sd.supplier_id = ? ORDER BY sd.created_at DESC, sd.id DESC
`).all(supplierId).map((d: any) => {
  let file_size: number | null = null;
  try { if (SAFE.test(d.file_path)) file_size = fs.statSync(path.join(supplierDocsDir, d.file_path)).size; } catch { /* missing */ }
  return { ...d, file_size };
});

router.get('/:id/documents', (req: Request, res: Response) => {
  const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(req.params.id) as any;
  if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  res.json(docsOf(supplier.id));
});

// POST /api/suppliers/:id/documents — multipart: files (one or more), doc_type, notes
router.post('/:id/documents', uploadSupplierDoc.array('files', 20), (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(req.params.id) as any;
  if (!supplier) { files.forEach(f => unlinkSupplierFile(f.filename)); res.status(404).json({ error: 'Supplier not found' }); return; }
  if (!files.length) { res.status(400).json({ error: 'Choose at least one file' }); return; }
  const docType = String(req.body?.doc_type ?? '').trim() || null;
  const notes = String(req.body?.notes ?? '').trim() || null;
  for (const f of files) {
    db.prepare(`INSERT INTO supplier_documents (supplier_id, title, doc_type, file_path, file_name, notes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(supplier.id, path.parse(f.originalname).name, docType, f.filename, f.originalname, notes, req.user?.userId ?? null);
  }
  notifyAdmin({
    action: 'updated', entity: 'Supplier', label: supplier.name,
    detail: `${files.length} document${files.length === 1 ? '' : 's'} uploaded`, ...who(req),
  });
  res.status(201).json(docsOf(supplier.id));
});

// PUT /api/suppliers/:id/documents/:docId — title / doc_type / notes; left out keeps, blank clears
router.put('/:id/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM supplier_documents WHERE id = ? AND supplier_id = ?').get(req.params.docId, req.params.id) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const pick = (key: string) => (req.body?.[key] === undefined ? doc[key] : (String(req.body[key]).trim() || null));
  db.prepare('UPDATE supplier_documents SET title = ?, doc_type = ?, notes = ? WHERE id = ?')
    .run(pick('title'), pick('doc_type'), pick('notes'), doc.id);
  res.json(docsOf(doc.supplier_id).find((d: any) => d.id === doc.id));
});

router.delete('/:id/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare(`
    SELECT sd.*, s.name AS supplier_name FROM supplier_documents sd JOIN suppliers s ON s.id = sd.supplier_id
    WHERE sd.id = ? AND sd.supplier_id = ?
  `).get(req.params.docId, req.params.id) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  db.prepare('DELETE FROM supplier_documents WHERE id = ?').run(doc.id);
  unlinkSupplierFile(doc.file_path);
  notifyAdmin({ action: 'updated', entity: 'Supplier', label: doc.supplier_name, detail: `document deleted: ${doc.file_name}`, ...who(req) });
  res.json({ ok: true });
});

export default router;
