import { Router, Request } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';

const router = Router();

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
  if (!name?.trim() || !sku?.trim()) {
    return res.status(400).json({ error: 'Name and SKU are required' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO products (name, sku, category, unit, notes) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), sku.trim(), category, unit, notes);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid) as any;
    notifyAdmin({ action: 'created', entity: 'Product', label: `${product.name} (${product.sku})`, performedBy: (req as Request).user?.display_name || 'Unknown' });
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
  if (!name?.trim() || !sku?.trim()) {
    return res.status(400).json({ error: 'Name and SKU are required' });
  }
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  try {
    db.prepare(
      "UPDATE products SET name=?, sku=?, category=?, notes=?, updated_at=datetime('now') WHERE id=?"
    ).run(name.trim(), sku.trim(), category, notes ?? null, id);
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    notifyAdmin({ action: 'updated', entity: 'Product', label: `${updated.name} (${updated.sku})`, performedBy: (req as Request).user?.display_name || 'Unknown' });
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
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  notifyAdmin({ action: 'deleted', entity: 'Product', label: `${existing.name} (${existing.sku})`, performedBy: (req as Request).user?.display_name || 'Unknown' });
  res.json({ success: true });
});

export default router;
