import { Router, Request, Response } from 'express';
import db from '../database.js';
import { uploadPayment } from '../middleware/upload.js';
import { notifyAdmin } from '../lib/notify.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const router = Router();

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  const invoice_id = req.query.invoice_id as string;

  let where = '';
  const params: any[] = [];
  if (invoice_id) { where = 'WHERE p.invoice_id = ?'; params.push(invoice_id); }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM payments p ${where}`).get(...params) as any).count;
  const payments = db.prepare(`
    SELECT p.*, i.invoice_number, i.type,
      CASE WHEN i.type='customer' THEN c.name ELSE s.name END as entity_name
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    ${where} ORDER BY p.payment_date DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: payments, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/:id', (req: Request, res: Response) => {
  const payment = db.prepare(`
    SELECT p.*, i.invoice_number, i.type, i.amount as invoice_amount, i.status as invoice_status,
      CASE WHEN i.type='customer' THEN c.name ELSE s.name END as entity_name
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!payment) { res.status(404).json({ error: 'Payment not found' }); return; }
  res.json(payment);
});

router.post('/', uploadPayment.single('file'), (req: Request, res: Response) => {
  const { invoice_id, amount, payment_date, payment_method, reference, notes } = req.body;
  if (!invoice_id || !amount || !payment_date || !payment_method) {
    res.status(400).json({ error: 'invoice_id, amount, payment_date, and payment_method are required' });
    return;
  }

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  const result = db.prepare(`
    INSERT INTO payments (invoice_id, amount, payment_date, payment_method, reference, notes, file_path, file_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(invoice_id, parseFloat(amount), payment_date, payment_method, reference || null, notes || null, file_path, file_name);

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid) as any;
  const inv = db.prepare('SELECT invoice_number FROM invoices WHERE id = ?').get(invoice_id) as any;
  notifyAdmin({ action: 'created', entity: 'Payment', label: `$${parseFloat(amount).toLocaleString()} on ${inv?.invoice_number || `Invoice #${invoice_id}`}`, performedBy: req.user?.display_name || 'Unknown' });
  res.status(201).json(payment);
});

router.put('/:id', uploadPayment.single('file'), (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Payment not found' }); return; }

  const { invoice_id, amount, payment_date, payment_method, reference, notes } = req.body;

  let file_path = existing.file_path;
  let file_name = existing.file_name;
  if (req.file) {
    if (existing.file_path) {
      const oldPath = path.join(uploadsBase, 'payments', existing.file_path);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    file_path = req.file.filename;
    file_name = req.file.originalname;
  }

  db.prepare(`
    UPDATE payments SET invoice_id=?, amount=?, payment_date=?, payment_method=?, reference=?, notes=?, file_path=?, file_name=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    invoice_id || existing.invoice_id, parseFloat(amount) || existing.amount,
    payment_date || existing.payment_date, payment_method || existing.payment_method,
    reference ?? existing.reference, notes ?? existing.notes, file_path, file_name, req.params.id
  );

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  res.json(payment);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Payment not found' }); return; }

  if (existing.file_path) {
    const filePath = path.join(uploadsBase, 'payments', existing.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  notifyAdmin({ action: 'deleted', entity: 'Payment', label: `$${existing.amount?.toLocaleString()} (Payment #${req.params.id})`, performedBy: req.user?.display_name || 'Unknown' });
  res.json({ message: 'Payment deleted' });
});

export default router;
