import { Router, Request, Response } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';

const router = Router();

// List customers with pagination and search
router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const offset = (page - 1) * limit;

  let where = '';
  const params: any[] = [];
  if (search) {
    where = 'WHERE name LIKE ? OR email LIKE ? OR company LIKE ?';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM customers ${where}`).get(...params) as any).count;
  const customers = db.prepare(`SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  res.json({ data: customers, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// Get single customer
router.get('/:id', (req: Request, res: Response) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }
  res.json(customer);
});

// Create customer
router.post('/', (req: Request, res: Response) => {
  const { name, email, phone, address, company, notes } = req.body;
  if (!name) { res.status(400).json({ error: 'Name is required' }); return; }

  const result = db.prepare(
    'INSERT INTO customers (name, email, phone, address, company, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, email || null, phone || null, address || null, company || null, notes || null);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid) as any;
  notifyAdmin({ action: 'created', entity: 'Customer', label: customer.name, performedBy: req.user?.display_name || 'Unknown' });
  res.status(201).json(customer);
});

// Update customer
router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Customer not found' }); return; }

  const { name, email, phone, address, company, notes } = req.body;
  if (!name) { res.status(400).json({ error: 'Name is required' }); return; }

  db.prepare(
    `UPDATE customers SET name=?, email=?, phone=?, address=?, company=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, email || null, phone || null, address || null, company || null, notes || null, req.params.id);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
  notifyAdmin({ action: 'updated', entity: 'Customer', label: customer.name, performedBy: req.user?.display_name || 'Unknown' });
  res.json(customer);
});

// Delete customer
router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT name FROM customers WHERE id = ?').get(req.params.id) as any;
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Customer not found' }); return; }
  notifyAdmin({ action: 'deleted', entity: 'Customer', label: existing?.name || `#${req.params.id}`, performedBy: req.user?.display_name || 'Unknown' });
  res.json({ message: 'Customer deleted' });
});

// Get customer's invoices
router.get('/:id/invoices', (req: Request, res: Response) => {
  const invoices = db.prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(invoices);
});

// Get customer's orders
router.get('/:id/orders', (req: Request, res: Response) => {
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(orders);
});

// Get customer's shipments
router.get('/:id/shipments', (req: Request, res: Response) => {
  const shipments = db.prepare('SELECT * FROM shipments WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(shipments);
});

export default router;
