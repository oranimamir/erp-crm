import { Router, Request, Response } from 'express';
import db from '../database.js';
import { uploadInvoice } from '../middleware/upload.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const status = (req.query.status as string) || '';
  const type = (req.query.type as string) || '';
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { conditions.push('i.status = ?'); params.push(status); }
  if (type) { conditions.push('i.type = ?'); params.push(type); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN suppliers s ON i.supplier_id = s.id ${where}`).get(...params) as any).count;
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name, s.name as supplier_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: invoices, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/:id', (req: Request, res: Response) => {
  const invoice = db.prepare(`
    SELECT i.*, c.name as customer_name, s.name as supplier_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.id = ?
  `).get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC').all(invoice.id);
  const history = db.prepare(`
    SELECT sh.*, u.display_name as changed_by_name
    FROM status_history sh LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.entity_type = 'invoice' AND sh.entity_id = ? ORDER BY sh.created_at DESC
  `).all(invoice.id);

  res.json({ ...invoice, payments, status_history: history });
});

router.post('/', uploadInvoice.single('file'), (req: Request, res: Response) => {
  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, notes } = req.body;
  if (!invoice_number || !type || !amount) {
    res.status(400).json({ error: 'invoice_number, type, and amount are required' });
    return;
  }

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  try {
    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, notes, file_path, file_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoice_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type, parseFloat(amount), currency || 'USD', status || 'draft', due_date || null, notes || null,
      file_path, file_name
    );

    // Record initial status
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('invoice', ?, ?, ?)`)
      .run(result.lastInsertRowid, status || 'draft', req.user!.userId);

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(invoice);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Invoice number already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.put('/:id', uploadInvoice.single('file'), (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, notes } = req.body;

  // Delete old file if new one uploaded
  let file_path = existing.file_path;
  let file_name = existing.file_name;
  if (req.file) {
    if (existing.file_path) {
      const oldPath = path.join(__dirname, '..', '..', 'uploads', 'invoices', existing.file_path);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    file_path = req.file.filename;
    file_name = req.file.originalname;
  }

  try {
    db.prepare(`
      UPDATE invoices SET invoice_number=?, customer_id=?, supplier_id=?, type=?, amount=?, currency=?, status=?, due_date=?, notes=?, file_path=?, file_name=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      invoice_number || existing.invoice_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type || existing.type, parseFloat(amount) || existing.amount, currency || existing.currency,
      status || existing.status, due_date || existing.due_date, notes ?? existing.notes,
      file_path, file_name, req.params.id
    );

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    res.json(invoice);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/status', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { status, notes } = req.body;
  if (!status) { res.status(400).json({ error: 'Status is required' }); return; }

  db.prepare(`UPDATE invoices SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, ?, ?, ?)`)
    .run(req.params.id, existing.status, status, req.user!.userId, notes || null);

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  res.json(invoice);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  if (existing.file_path) {
    const filePath = path.join(__dirname, '..', '..', 'uploads', 'invoices', existing.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ message: 'Invoice deleted' });
});

export default router;
