import { Router, Request, Response } from 'express';
import db from '../database.js';
import { uploadInvoice, uploadWireTransfer } from '../middleware/upload.js';
import { notifyAdmin } from '../lib/notify.js';
import { getEurRate } from '../lib/fx.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const router = Router();

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const status = (req.query.status as string) || '';
  const type = (req.query.type as string) || '';
  const year  = (req.query.year  as string) || '';
  const month = (req.query.month as string) || '';
  const offset = (page - 1) * limit;

  const sortFieldMap: Record<string, string> = {
    date: 'COALESCE(i.invoice_date, i.created_at)',
    amount: 'i.amount',
    name: 'COALESCE(c.name, s.name)',
  };
  const sortBy = (req.query.sort_by as string) || 'date';
  const sortDir = (req.query.sort_dir as string) === 'asc' ? 'ASC' : 'DESC';
  const orderBy = `${sortFieldMap[sortBy] || sortFieldMap.date} ${sortDir}`;

  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { conditions.push('i.status = ?'); params.push(status); }
  if (type)   { conditions.push('i.type = ?'); params.push(type); }
  if (year)   { conditions.push("strftime('%Y', COALESCE(i.invoice_date, i.created_at)) = ?"); params.push(year); }
  if (month)  { conditions.push("strftime('%m', COALESCE(i.invoice_date, i.created_at)) = ?"); params.push(month.padStart(2, '0')); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN suppliers s ON i.supplier_id = s.id ${where}`).get(...params) as any).count;
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name, s.name as supplier_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?
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
  const invoice_payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date ASC').all(invoice.id);
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

  res.json({ ...invoice, payments, invoice_payments, status_history: history, wire_transfers });
});

router.post('/', uploadInvoice.single('file'), async (req: Request, res: Response) => {
  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, our_ref, po_number, operation_id, initial_payment_amount, initial_payment_date, remainder_due_date } = req.body;
  if (!invoice_number || !type || !amount) {
    res.status(400).json({ error: 'invoice_number, type, and amount are required' });
    return;
  }

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  try {
    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, file_path, file_name, our_ref, po_number, operation_id, remainder_due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoice_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type, parseFloat(amount), currency || 'USD', status || 'draft', due_date || null, invoice_date || null, payment_date || null, notes || null,
      file_path, file_name, our_ref || null, po_number || null, operation_id ? Number(operation_id) : null,
      remainder_due_date || null
    );
    const invoiceId = result.lastInsertRowid;

    // Record initial status
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('invoice', ?, ?, ?)`)
      .run(invoiceId, status || 'draft', req.user!.userId);

    // Handle initial payment for supplier invoices
    if (type === 'supplier' && initial_payment_amount && initial_payment_date) {
      const payAmt = parseFloat(initial_payment_amount);
      const invoiceAmt = parseFloat(amount);
      if (payAmt > 0) {
        const fx_rate = await getEurRate(currency || 'USD', initial_payment_date);
        const eur_amount = payAmt * fx_rate;
        db.prepare(`
          INSERT INTO invoice_payments (invoice_id, amount, currency, fx_rate, eur_amount, payment_date, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(invoiceId, payAmt, currency || 'EUR', fx_rate, eur_amount, initial_payment_date, req.user!.userId);

        const newStatus = payAmt >= invoiceAmt ? 'paid' : 'partially_paid';
        const newPaymentDate = newStatus === 'paid' ? initial_payment_date : null;
        db.prepare(`UPDATE invoices SET status=?, payment_date=?, updated_at=datetime('now') WHERE id=?`)
          .run(newStatus, newPaymentDate, invoiceId);
        db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, ?, ?, ?)`)
          .run(invoiceId, status || 'draft', newStatus, req.user!.userId, 'Initial payment recorded');
      }
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    notifyAdmin({ action: 'created', entity: 'Invoice', label: invoice.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
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

  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, our_ref, po_number, operation_id } = req.body;

  // Delete old file if new one uploaded
  let file_path = existing.file_path;
  let file_name = existing.file_name;
  if (req.file) {
    if (existing.file_path) {
      const oldPath = path.join(uploadsBase, 'invoices', existing.file_path);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    file_path = req.file.filename;
    file_name = req.file.originalname;
  }

  try {
    db.prepare(`
      UPDATE invoices SET invoice_number=?, customer_id=?, supplier_id=?, type=?, amount=?, currency=?, status=?, due_date=?, invoice_date=?, payment_date=?, notes=?, file_path=?, file_name=?, our_ref=?, po_number=?, operation_id=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      invoice_number || existing.invoice_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type || existing.type, parseFloat(amount) || existing.amount, currency || existing.currency,
      status || existing.status, due_date || existing.due_date, invoice_date ?? existing.invoice_date,
      // Auto-set payment_date to today when marking as paid and no date provided
      payment_date ?? ((status === 'paid' && !existing.payment_date) ? new Date().toISOString().split('T')[0] : existing.payment_date),
      notes ?? existing.notes,
      file_path, file_name, our_ref ?? existing.our_ref, po_number ?? existing.po_number,
      operation_id !== undefined ? (operation_id ? Number(operation_id) : null) : existing.operation_id,
      req.params.id
    );

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    notifyAdmin({ action: 'updated', entity: 'Invoice', label: invoice.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
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

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  notifyAdmin({ action: 'status changed', entity: 'Invoice', label: invoice.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId, detail: status });
  res.json(invoice);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  if (existing.file_path) {
    const filePath = path.join(uploadsBase, 'invoices', existing.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  notifyAdmin({ action: 'deleted', entity: 'Invoice', label: existing.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: 'Invoice deleted' });
});

// Payment installment endpoints

router.post('/:id/payments', async (req: Request, res: Response) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { amount, payment_date, notes } = req.body;
  if (!amount || !payment_date) {
    res.status(400).json({ error: 'amount and payment_date are required' });
    return;
  }

  const payAmt = parseFloat(amount);
  if (isNaN(payAmt) || payAmt <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  try {
    const fx_rate = await getEurRate(invoice.currency || 'USD', payment_date);
    const eur_amount = payAmt * fx_rate;

    db.prepare(`
      INSERT INTO invoice_payments (invoice_id, amount, currency, fx_rate, eur_amount, payment_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, payAmt, invoice.currency || 'EUR', fx_rate, eur_amount, payment_date, notes || null, req.user!.userId);

    // Recalculate total paid in invoice currency
    const { total: totalPaid } = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM invoice_payments WHERE invoice_id = ?').get(req.params.id) as any;

    const prevStatus = invoice.status;
    let newStatus: string;
    let newPaymentDate: string | null = null;
    if (totalPaid >= invoice.amount) {
      newStatus = 'paid';
      newPaymentDate = payment_date;
    } else {
      newStatus = 'partially_paid';
    }

    db.prepare(`UPDATE invoices SET status=?, payment_date=?, updated_at=datetime('now') WHERE id=?`)
      .run(newStatus, newPaymentDate, req.params.id);

    if (prevStatus !== newStatus) {
      db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, ?, ?, ?)`)
        .run(req.params.id, prevStatus, newStatus, req.user!.userId, 'Payment installment added');
      notifyAdmin({ action: 'status changed', entity: 'Invoice', label: invoice.invoice_number,
        performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId, detail: newStatus });
    }

    const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    const allPayments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date ASC').all(req.params.id);
    res.status(201).json({ invoice: updatedInvoice, payments: allPayments });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to add payment' });
  }
});

router.delete('/:id/payments/:paymentId', (req: Request, res: Response) => {
  const payment = db.prepare('SELECT * FROM invoice_payments WHERE id = ? AND invoice_id = ?').get(req.params.paymentId, req.params.id) as any;
  if (!payment) { res.status(404).json({ error: 'Payment not found' }); return; }

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  db.prepare('DELETE FROM invoice_payments WHERE id = ?').run(payment.id);

  const { total: totalPaid } = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM invoice_payments WHERE invoice_id = ?').get(req.params.id) as any;

  const prevStatus = invoice.status;
  let newStatus: string;
  let newPaymentDate: string | null = invoice.payment_date;
  if (totalPaid <= 0) {
    newStatus = 'sent';
    newPaymentDate = null;
  } else if (totalPaid < invoice.amount) {
    newStatus = 'partially_paid';
    newPaymentDate = null;
  } else {
    newStatus = 'paid';
  }

  db.prepare(`UPDATE invoices SET status=?, payment_date=?, updated_at=datetime('now') WHERE id=?`)
    .run(newStatus, newPaymentDate, req.params.id);

  if (prevStatus !== newStatus) {
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, ?, ?, ?)`)
      .run(req.params.id, prevStatus, newStatus, req.user!.userId, 'Payment installment deleted');
  }

  res.json({ message: 'Payment deleted' });
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

router.post('/:id/wire-transfers', uploadWireTransfer.single('file'), async (req: Request, res: Response) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const payment_date = req.body.payment_date || req.body.transfer_date || new Date().toISOString().split('T')[0];
  const bank_reference = req.body.bank_reference || null;
  const amount = req.body.amount != null ? parseFloat(req.body.amount) : invoice.amount;

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  try {
    const fx_rate = await getEurRate(invoice.currency || 'USD', payment_date);
    const eur_amount = amount * fx_rate;

    const result = db.prepare(`
      INSERT INTO wire_transfers (invoice_id, amount, transfer_date, bank_reference, fx_rate, eur_amount, status, file_path, file_name)
      VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)
    `).run(req.params.id, amount, payment_date, bank_reference, fx_rate, eur_amount, file_path, file_name);

    // Immediately mark invoice as paid, and set payment_date from wire transfer date
    const prevStatus = invoice.status;
    db.prepare(`UPDATE invoices SET status='paid', payment_date=?, updated_at=datetime('now') WHERE id=?`).run(payment_date, req.params.id);
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, 'paid', ?, 'Auto-paid via wire transfer upload')`)
      .run(req.params.id, prevStatus, req.user!.userId);

    // Auto-complete linked operation when delivered and all its invoices are paid/cancelled
    if (invoice.operation_id) {
      const unpaid = (db.prepare(
        `SELECT COUNT(*) as count FROM invoices WHERE operation_id = ? AND status NOT IN ('paid','cancelled')`
      ).get(invoice.operation_id) as any).count;
      if (unpaid === 0) {
        const operation = db.prepare('SELECT status FROM operations WHERE id = ?').get(invoice.operation_id) as any;
        if (operation && operation.status === 'delivered') {
          db.prepare(`UPDATE operations SET status='completed', updated_at=datetime('now') WHERE id=?`).run(invoice.operation_id);
        }
      }
    }

    notifyAdmin({ action: 'status changed', entity: 'Invoice',
      label: invoice.invoice_number,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
      detail: 'Paid via wire transfer upload' });

    const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(transfer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process wire transfer' });
  }
});

router.delete('/:id/wire-transfers/:transferId', (req: Request, res: Response) => {
  const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ? AND invoice_id = ?').get(req.params.transferId, req.params.id) as any;
  if (!transfer) { res.status(404).json({ error: 'Wire transfer not found' }); return; }

  if (transfer.file_path) {
    const filePath = path.join(uploadsBase, 'wire-transfers', transfer.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  // Get invoice's operation_id before modifying
  const invoiceForRevert = db.prepare('SELECT operation_id FROM invoices WHERE id = ?').get(req.params.id) as any;

  db.prepare('DELETE FROM wire_transfers WHERE id = ?').run(transfer.id);

  // Revert invoice to sent and clear payment_date
  db.prepare(`UPDATE invoices SET status='sent', payment_date=NULL, updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, 'paid', 'sent', ?, 'Wire transfer deleted — reverted to sent')`)
    .run(req.params.id, req.user!.userId);

  // If the operation was completed, revert to delivered (invoice is no longer paid)
  if (invoiceForRevert?.operation_id) {
    db.prepare(`UPDATE operations SET status='delivered', updated_at=datetime('now') WHERE id=? AND status='completed'`)
      .run(invoiceForRevert.operation_id);
  }

  res.json({ message: 'Wire transfer deleted' });
});

export default router;
