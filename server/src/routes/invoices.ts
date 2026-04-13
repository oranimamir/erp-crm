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
  const wire  = (req.query.wire  as string) || '';
  const customer = (req.query.customer as string) || '';
  const offset = (page - 1) * limit;

  const sortFieldMap: Record<string, string> = {
    date: 'COALESCE(i.invoice_date, i.created_at)',
    amount: 'i.amount',
    name: 'COALESCE(c.name, s.name)',
    wire_date: 'wt.last_wire_date',
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
  // Support comma-separated multi-values for status, month
  if (status) {
    const statuses = status.split(',').filter(Boolean);
    if (statuses.length === 1) { conditions.push('i.status = ?'); params.push(statuses[0]); }
    else { conditions.push(`i.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
  }
  if (type)   { conditions.push('i.type = ?'); params.push(type); }
  if (year)   { conditions.push("strftime('%Y', COALESCE(i.invoice_date, i.created_at)) = ?"); params.push(year); }
  if (month) {
    const months = month.split(',').filter(Boolean).map((m: string) => m.padStart(2, '0'));
    if (months.length === 1) { conditions.push("strftime('%m', COALESCE(i.invoice_date, i.created_at)) = ?"); params.push(months[0]); }
    else { conditions.push(`strftime('%m', COALESCE(i.invoice_date, i.created_at)) IN (${months.map(() => '?').join(',')})`); params.push(...months); }
  }
  // Date range filter (from/to)
  const dateFrom = (req.query.date_from as string) || '';
  const dateTo   = (req.query.date_to   as string) || '';
  if (dateFrom) { conditions.push("COALESCE(i.invoice_date, date(i.created_at)) >= ?"); params.push(dateFrom); }
  if (dateTo)   { conditions.push("COALESCE(i.invoice_date, date(i.created_at)) <= ?"); params.push(dateTo); }
  if (wire === 'yes') { conditions.push('COALESCE(wt.wire_transfer_count, 0) > 0'); }
  if (wire === 'no')  { conditions.push('(wt.wire_transfer_count IS NULL OR wt.wire_transfer_count = 0)'); }
  if (customer) { conditions.push('c.name LIKE ?'); params.push(`%${customer}%`); }
  // Wire transfer date range filter
  const wireDateFrom = (req.query.wire_date_from as string) || '';
  const wireDateTo   = (req.query.wire_date_to   as string) || '';
  if (wireDateFrom) { conditions.push("wt.last_wire_date >= ?"); params.push(wireDateFrom); }
  if (wireDateTo)   { conditions.push("wt.last_wire_date <= ?"); params.push(wireDateTo); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const wtJoin = `LEFT JOIN (SELECT invoice_id, COUNT(*) as wire_transfer_count, MAX(transfer_date) as last_wire_date FROM wire_transfers GROUP BY invoice_id) wt ON wt.invoice_id = i.id`;
  const total = (db.prepare(`SELECT COUNT(*) as count FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN suppliers s ON i.supplier_id = s.id ${wtJoin} ${where}`).get(...params) as any).count;
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name, s.name as supplier_name,
      COALESCE(wt.wire_transfer_count, 0) as wire_transfer_count,
      wt.last_wire_date
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    ${wtJoin}
    ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: invoices, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// Monthly summary: invoices generated & wire transfers made (in EUR)
router.get('/monthly-summary', (_req: Request, res: Response) => {
  // Customer invoices aggregated by month (use eur_amount when available, else amount)
  const invoicesByMonth = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(i.invoice_date, i.created_at)) as month,
      SUM(COALESCE(i.eur_amount, i.amount)) as total_eur,
      COUNT(*) as count
    FROM invoices i
    WHERE i.type = 'customer' AND i.status != 'cancelled'
    GROUP BY month ORDER BY month
  `).all() as { month: string; total_eur: number; count: number }[];

  // Wire transfers aggregated by month (use eur_amount when available, else amount)
  const wiresByMonth = db.prepare(`
    SELECT strftime('%Y-%m', wt.transfer_date) as month,
      SUM(COALESCE(wt.eur_amount, wt.amount)) as total_eur,
      COUNT(*) as count
    FROM wire_transfers wt
    JOIN invoices i ON wt.invoice_id = i.id
    WHERE i.type = 'customer'
    GROUP BY month ORDER BY month
  `).all() as { month: string; total_eur: number; count: number }[];

  res.json({ invoicesByMonth, wiresByMonth });
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

  const invoiceId = Number(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC').all(invoiceId);
  const history = db.prepare(`
    SELECT sh.*, u.display_name as changed_by_name
    FROM status_history sh LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.entity_type = 'invoice' AND sh.entity_id = ? ORDER BY sh.created_at DESC
  `).all(invoiceId);
  const wire_transfers = db.prepare(`
    SELECT wt.*, u.display_name as approved_by_name
    FROM wire_transfers wt LEFT JOIN users u ON wt.approved_by = u.id
    WHERE wt.invoice_id = ? ORDER BY wt.created_at DESC
  `).all(invoiceId);

  res.json({ ...invoice, payments, status_history: history, wire_transfers });
});

router.post('/', uploadInvoice.single('file'), async (req: Request, res: Response) => {
  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, our_ref, po_number, operation_id } = req.body;
  if (!invoice_number || !type || !amount) {
    res.status(400).json({ error: 'invoice_number, type, and amount are required' });
    return;
  }

  const file_path = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;

  try {
    // Compute EUR conversion at creation time for non-EUR invoices
    const invCurrency = currency || 'USD';
    let fx_rate: number | null = null;
    let eur_amount: number | null = null;
    if (invCurrency.toUpperCase() !== 'EUR') {
      const dateForRate = invoice_date || new Date().toISOString().split('T')[0];
      fx_rate = await getEurRate(invCurrency, dateForRate);
      eur_amount = parseFloat(amount) * fx_rate;
    }

    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, file_path, file_name, our_ref, po_number, operation_id, fx_rate, eur_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoice_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type, parseFloat(amount), invCurrency, status || 'draft', due_date || null, invoice_date || null, payment_date || null, notes || null,
      file_path, file_name, our_ref || null, po_number || null, operation_id ? Number(operation_id) : null,
      fx_rate, eur_amount
    );
    const invoiceId = result.lastInsertRowid;

    // Record initial status
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('invoice', ?, ?, ?)`)
      .run(invoiceId, status || 'draft', req.user!.userId);

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

router.put('/:id', uploadInvoice.single('file'), async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, invoice_date, payment_date, notes, our_ref, po_number, operation_id } = req.body;

  // Delete old file if new one uploaded
  let file_path = existing.file_path;
  let file_name = existing.file_name;
  if (req.file) {
    if (existing.file_path) {
      try {
        const oldPath = path.join(uploadsBase, 'invoices', existing.file_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch (err) {
        console.warn('[invoices] Failed to delete old invoice file:', err);
      }
    }
    file_path = req.file.filename;
    file_name = req.file.originalname;
  }

  // Recompute EUR conversion when amount or currency changes
  const finalAmount = parseFloat(amount) || existing.amount;
  const finalCurrency = (currency || existing.currency || 'USD').toUpperCase();
  let fx_rate = existing.fx_rate;
  let eur_amount = existing.eur_amount;
  if (finalCurrency !== 'EUR') {
    const dateForRate = invoice_date ?? existing.invoice_date ?? new Date().toISOString().split('T')[0];
    fx_rate = await getEurRate(finalCurrency, dateForRate);
    eur_amount = finalAmount * fx_rate;
  } else {
    fx_rate = null;
    eur_amount = null;
  }

  try {
    db.prepare(`
      UPDATE invoices SET invoice_number=?, customer_id=?, supplier_id=?, type=?, amount=?, currency=?, status=?, due_date=?, invoice_date=?, payment_date=?, notes=?, file_path=?, file_name=?, our_ref=?, po_number=?, operation_id=?, fx_rate=?, eur_amount=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      invoice_number || existing.invoice_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type || existing.type, finalAmount, currency || existing.currency,
      status || existing.status, due_date || existing.due_date, invoice_date ?? existing.invoice_date,
      // Auto-set payment_date to today when marking as paid and no date provided
      payment_date ?? ((status === 'paid' && !existing.payment_date) ? new Date().toISOString().split('T')[0] : existing.payment_date),
      notes ?? existing.notes,
      file_path, file_name, our_ref ?? existing.our_ref, po_number ?? existing.po_number,
      operation_id !== undefined ? (operation_id ? Number(operation_id) : null) : existing.operation_id,
      fx_rate, eur_amount,
      req.params.id
    );

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    notifyAdmin({ action: 'updated', entity: 'Invoice', label: invoice.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
    res.json(invoice);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const VALID_INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled', 'paid_with_other'] as const;

router.patch('/:id/status', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { status, notes } = req.body;
  if (!status) { res.status(400).json({ error: 'Status is required' }); return; }
  if (!VALID_INVOICE_STATUSES.includes(status)) {
    res.status(400).json({ error: `Status must be one of: ${VALID_INVOICE_STATUSES.join(', ')}` });
    return;
  }

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
    try {
      const filePath = path.join(uploadsBase, 'invoices', existing.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.warn('[invoices] Failed to delete invoice file:', err);
    }
  }

  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  notifyAdmin({ action: 'deleted', entity: 'Invoice', label: existing.invoice_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: 'Invoice deleted' });
});

// Wire Transfer endpoints
router.get('/:id/wire-transfers', (req: Request, res: Response) => {
  const invoiceId = Number(req.params.id);
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const transfers = db.prepare(`
    SELECT wt.*, u.display_name as approved_by_name
    FROM wire_transfers wt LEFT JOIN users u ON wt.approved_by = u.id
    WHERE wt.invoice_id = ? ORDER BY wt.created_at DESC
  `).all(invoiceId);
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
    let fx_rate = 1;
    let eur_amount = amount;
    try {
      fx_rate = await getEurRate(invoice.currency || 'USD', payment_date);
      eur_amount = amount * fx_rate;
    } catch (fxErr) {
      console.warn(`[wire-transfer] FX lookup failed for ${invoice.currency}/${payment_date}, proceeding without conversion:`, fxErr);
    }

    const result = db.prepare(`
      INSERT INTO wire_transfers (invoice_id, amount, transfer_date, bank_reference, fx_rate, eur_amount, status, file_path, file_name)
      VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)
    `).run(Number(req.params.id), amount, payment_date, bank_reference, fx_rate, eur_amount, file_path, file_name);

    // Force immediate disk save — do NOT rely on the 100ms debounce for critical financial data
    db.saveToDisk();

    // Immediately mark invoice as paid, and set payment_date from wire transfer date
    const prevStatus = invoice.status;
    db.prepare(`UPDATE invoices SET status='paid', payment_date=?, updated_at=datetime('now') WHERE id=?`).run(payment_date, req.params.id);
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('invoice', ?, ?, 'paid', ?, 'Auto-paid via wire transfer upload')`)
      .run(req.params.id, prevStatus, req.user!.userId);

    // Force save again after status update
    db.saveToDisk();

    // Auto-complete linked operation: delivered + at least one wire transfer uploaded = completed
    if (invoice.operation_id) {
      const operation = db.prepare('SELECT status FROM operations WHERE id = ?').get(invoice.operation_id) as any;
      if (operation && operation.status === 'delivered') {
        db.prepare(`UPDATE operations SET status='completed', updated_at=datetime('now') WHERE id=?`).run(invoice.operation_id);
      }
    }

    notifyAdmin({ action: 'status changed', entity: 'Invoice',
      label: invoice.invoice_number,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
      detail: 'Paid via wire transfer upload' });

    const transfer = db.prepare('SELECT * FROM wire_transfers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(transfer);
  } catch (err: any) {
    console.error('[wire-transfer] Upload failed:', err);
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

  // Force immediate disk save — critical financial data
  db.saveToDisk();

  res.json({ message: 'Wire transfer deleted' });
});

export default router;
