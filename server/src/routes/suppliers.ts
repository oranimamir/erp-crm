import { Router, Request, Response } from 'express';
import db from '../database.js';

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

router.get('/:id', (req: Request, res: Response) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  res.json(supplier);
});

router.post('/', (req: Request, res: Response) => {
  const { name, email, phone, address, category, notes } = req.body;
  if (!name || !category) { res.status(400).json({ error: 'Name and category are required' }); return; }

  const validCategories = ['logistics', 'blenders', 'raw_materials', 'shipping'];
  if (!validCategories.includes(category)) {
    res.status(400).json({ error: `Category must be one of: ${validCategories.join(', ')}` });
    return;
  }

  const result = db.prepare(
    'INSERT INTO suppliers (name, email, phone, address, category, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, email || null, phone || null, address || null, category, notes || null);

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(supplier);
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }

  const { name, email, phone, address, category, notes } = req.body;
  if (!name || !category) { res.status(400).json({ error: 'Name and category are required' }); return; }

  db.prepare(
    `UPDATE suppliers SET name=?, email=?, phone=?, address=?, category=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, email || null, phone || null, address || null, category, notes || null, req.params.id);

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  res.json(supplier);
});

router.delete('/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Supplier not found' }); return; }
  res.json({ message: 'Supplier deleted' });
});

router.get('/:id/invoices', (req: Request, res: Response) => {
  const invoices = db.prepare('SELECT * FROM invoices WHERE supplier_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(invoices);
});

router.get('/:id/orders', (req: Request, res: Response) => {
  const orders = db.prepare('SELECT * FROM orders WHERE supplier_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(orders);
});

router.get('/:id/shipments', (req: Request, res: Response) => {
  const shipments = db.prepare('SELECT * FROM shipments WHERE supplier_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(shipments);
});

export default router;
