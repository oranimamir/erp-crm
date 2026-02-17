import { Router, Request, Response } from 'express';
import db from '../database.js';
import { uploadInvoice, uploadWireTransfer } from '../middleware/upload.js';
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
  const wire_transfers = db.prepare(`
    SELECT wt.*, u.display_name as approved_by_name
    FROM wire_transfers wt LEFT JOIN users u ON wt.approved_by = u.id
    WHERE wt.invoice_id = ? ORDER BY wt.created_at DESC
  `).all(invoice.id);

  res.json({ ...invoice, payments, status_history: history, wire_transfers });
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

// Wire Transfer endpoints
router.get('/:id/wire-transfers', (req: Request, res: Response) => {
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const transfers = db.prepare(`
    SELECT wt.*, u.display_name as approved_by_name
    FROM wire_transfers wt LEFT JOIN users u ON wt.approved_by = u.id
    WHERE wt.invoice_id = ? ORDER BY wt.created_at DESC
  `).all(req.params.id);
  res.json(transfers);
});

router.post('/:id/wire-transfers', uploadWireTransfer.single('file'), (req: Request, res: Response) => {
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { amount, transfer_date, bank_reference, notes } = req.body;
  if (!amount || !transfer_date) {
    res.status(400).json({ error: 'amount and transfer_date are required' });
    return;
  }

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  const result = db.prepare(`
    INSERT INTO wire_transfers (invoice_id, amount, transfer_date, bank_reference, file_path, file_name, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, parseFloat(amount), transfer_date, bank_reference || null, file_path, file_name, notes || null);

  const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(transfer);
});

router.patch('/:id/wire-transfers/:transferId/approve', (req: Request, res: Response) => {
  const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ? AND invoice_id = ?').get(req.params.transferId, req.params.id) as any;
  if (!transfer) { res.status(404).json({ error: 'Wire transfer not found' }); return; }
  if (transfer.status !== 'pending') { res.status(400).json({ error: 'Only pending transfers can be approved' }); return; }

  db.prepare(`UPDATE wire_transfers SET status='approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(req.user!.userId, transfer.id);

  // Optionally mark invoice as paid
  if (req.body.mark_paid) {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (invoice && invoice.status !== 'paid') {
      db.prepare(`UPDATE invoices SET status='paid', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
      db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, 'paid', ?, 'Auto-marked paid via wire transfer approval')`)
        .run(req.params.id, invoice.status, req.user!.userId);
    }
  }

  const updated = db.prepare(`
    SELECT wt.*, u.display_name as approved_by_name
    FROM wire_transfers wt LEFT JOIN users u ON wt.approved_by = u.id
    WHERE wt.id = ?
  `).get(transfer.id);
  res.json(updated);
});

router.patch('/:id/wire-transfers/:transferId/reject', (req: Request, res: Response) => {
  const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ? AND invoice_id = ?').get(req.params.transferId, req.params.id) as any;
  if (!transfer) { res.status(404).json({ error: 'Wire transfer not found' }); return; }
  if (transfer.status !== 'pending') { res.status(400).json({ error: 'Only pending transfers can be rejected' }); return; }

  const { rejection_reason } = req.body;
  db.prepare(`UPDATE wire_transfers SET status='rejected', rejection_reason=?, approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(rejection_reason || null, req.user!.userId, transfer.id);

  const updated = db.prepare('SELECT * FROM wire_transfers WHERE id = ?').get(transfer.id);
  res.json(updated);
});

export default router;
