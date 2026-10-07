import { Router, Request } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { removeProductDocumentFiles } from '../lib/productDocs.js';

const router = Router();

// SKU is optional (products added from the document library get theirs later); blank = none
const skuOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const labelOf = (p: { name: string; sku: string | null }) => (p.sku ? `${p.name} (${p.sku})` : p.name);

// GET / — list with pagination and search
router.get('/', (req, res) => {
  const { page = '1', limit = '20', search = '', category = '' } = req.query as Record<string, string>;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params: any[] = [];

  if (search) {
    where += ' AND (name LIKE ? OR sku LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM products WHERE ${where}`).get(...params) as any).count;
  const data = db.prepare(`SELECT * FROM products WHERE ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

  res.json({ data, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
});

// POST / — create
router.post('/', (req, res) => {
  const { name, sku, category = 'raw_material', unit = 'tons', notes = '' } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO products (name, sku, category, unit, notes) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), skuOf(sku), category, unit, notes);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid) as any;
    notifyAdmin({ action: 'created', entity: 'Product', label: labelOf(product), performedBy: (req as Request).user?.display_name || 'Unknown', performedById: (req as Request).user?.userId });
    res.status(201).json(product);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(400).json({ error: 'SKU already exists' });
    }
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /:id — update
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, sku, category, notes } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const existing = db.prepare('SELECT id, sku FROM products WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  try {
    db.prepare(
      "UPDATE products SET name=?, sku=?, category=?, notes=?, updated_at=datetime('now') WHERE id=?"
    ).run(name.trim(), sku === undefined ? existing.sku : skuOf(sku), category, notes ?? null, id);
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    notifyAdmin({ action: 'updated', entity: 'Product', label: labelOf(updated), performedBy: (req as Request).user?.display_name || 'Unknown', performedById: (req as Request).user?.userId });
    res.json(updated);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(400).json({ error: 'SKU already exists' });
    }
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT name, sku FROM products WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  removeProductDocumentFiles(Number(id));
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  notifyAdmin({ action: 'deleted', entity: 'Product', label: labelOf(existing), performedBy: (req as Request).user?.display_name || 'Unknown', performedById: (req as Request).user?.userId });
  res.json({ success: true });
});

export default router;
