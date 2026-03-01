import { Router, Request, Response } from 'express';
import db from '../database.js';
import { getEurRate } from '../lib/fx.js';
import { uploadOperationDoc } from '../middleware/upload.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const router = Router();

// ── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', (_req: Request, res: Response) => {
  const categories = db.prepare('SELECT * FROM document_categories ORDER BY name ASC').all();
  res.json(categories);
});

router.post('/categories', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: 'Category name is required' });
    return;
  }
  try {
    const result = db.prepare('INSERT INTO document_categories (name) VALUES (?)').run(name.trim());
    const cat = db.prepare('SELECT * FROM document_categories WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(cat);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Category already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

// ── Operations list ───────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const sortDir = (req.query.sort_dir as string) === 'asc' ? 'ASC' : 'DESC';
  const sortByMap: Record<string, string> = {
    order_date: 'COALESCE(o.order_date, op.created_at)',
    created_at: 'op.created_at',
    status:     'op.status',
    name:       'COALESCE(c.name, s.name)',
  };
  const sortBy = sortByMap[(req.query.sort_by as string)] || sortByMap.order_date;
  const offset = (page - 1) * limit;

  const tab = (req.query.tab as string) || 'active';

  const conditions: string[] = [];
  const params: any[] = [];
  if (tab === 'completed') {
    conditions.push("op.status = 'completed'");
  } else {
    conditions.push("op.status != 'completed'");
  }
  if (search) {
    conditions.push('(op.operation_number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`
    SELECT COUNT(*) as count FROM operations op
    LEFT JOIN customers c ON op.customer_id = c.id
    LEFT JOIN suppliers s ON op.supplier_id = s.id
    ${where}
  `).get(...params) as any).count;

  const operations = db.prepare(`
    SELECT op.*,
      c.name as customer_name,
      s.name as supplier_name,
      o.order_number,
      o.order_date,
      o.type as order_type,
      o.total_amount as order_total,
      o.file_path as order_file_path,
      o.file_name as order_file_name,
      (SELECT COUNT(*) FROM operation_documents od WHERE od.operation_id = op.id) as doc_count,
      (SELECT COUNT(*) FROM invoices i WHERE i.operation_id = op.id) as invoice_count,
      (SELECT COALESCE(SUM(CASE WHEN i.eur_amount IS NOT NULL THEN i.eur_amount WHEN UPPER(COALESCE(i.currency,'USD'))='EUR' THEN i.amount ELSE 0 END), 0) FROM invoices i WHERE i.operation_id = op.id) as invoice_eur_base,
      (SELECT COALESCE(SUM(CASE WHEN i.eur_amount IS NULL AND UPPER(COALESCE(i.currency,'USD'))!='EUR' THEN i.amount ELSE 0 END), 0) FROM invoices i WHERE i.operation_id = op.id) as invoice_fx_amount,
      (SELECT i.currency FROM invoices i WHERE i.eur_amount IS NULL AND UPPER(COALESCE(i.currency,'USD'))!='EUR' AND i.operation_id = op.id ORDER BY i.id LIMIT 1) as invoice_fx_currency,
      (SELECT COALESCE(SUM(
        CASE
          WHEN LOWER(oi.unit) IN ('mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't') THEN oi.quantity
          WHEN LOWER(oi.unit) IN ('kg', 'kgs', 'kilogram', 'kilograms') THEN oi.quantity / 1000.0
          WHEN LOWER(oi.unit) IN ('lbs', 'lb', 'pound', 'pounds') THEN oi.quantity / 2204.6226218
          ELSE NULL
        END
      ), 0) FROM order_items oi WHERE oi.order_id = op.order_id) as quantity_mt,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = op.order_id) as quantity_raw,
      (SELECT oi.unit FROM order_items oi WHERE oi.order_id = op.order_id ORDER BY oi.id LIMIT 1) as quantity_unit,
      (SELECT COALESCE(SUM(i.amount), 0) FROM invoices i WHERE i.operation_id = op.id) as invoice_amount_raw,
      (SELECT i.currency FROM invoices i WHERE i.operation_id = op.id ORDER BY i.id LIMIT 1) as invoice_currency
    FROM operations op
    LEFT JOIN customers c ON op.customer_id = c.id
    LEFT JOIN suppliers s ON op.supplier_id = s.id
    LEFT JOIN orders o ON op.order_id = o.id
    ${where} ORDER BY ${sortBy} ${sortDir} LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Fetch live FX rates for any non-EUR invoice amounts not yet converted
  const fxCurrencies = new Set(
    (operations as any[])
      .filter((op: any) => op.invoice_fx_amount > 0 && op.invoice_fx_currency)
      .map((op: any) => (op.invoice_fx_currency as string).toUpperCase())
  );
  const rates: Record<string, number> = {};
  await Promise.all([...fxCurrencies].map(async (c) => {
    rates[c] = await getEurRate(c, 'latest');
  }));

  const data = (operations as any[]).map((op: any) => {
    const fxRate = op.invoice_fx_currency ? (rates[(op.invoice_fx_currency as string).toUpperCase()] ?? 1) : 1;
    return {
      ...op,
      invoice_total: (op.invoice_eur_base || 0) + (op.invoice_fx_amount || 0) * fxRate,
    };
  });

  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// ── Single operation ──────────────────────────────────────────────────────────

router.get('/:id', (req: Request, res: Response) => {
  const operation = db.prepare(`
    SELECT op.*,
      c.name as customer_name,
      s.name as supplier_name,
      o.order_number, o.type as order_type, o.total_amount as order_total,
      o.status as order_status, o.order_date, o.inco_terms, o.destination,
      o.transport, o.delivery_date, o.payment_terms, o.description as order_description,
      o.file_path as order_file_path, o.file_name as order_file_name,
      o.operation_number as order_operation_number
    FROM operations op
    LEFT JOIN customers c ON op.customer_id = c.id
    LEFT JOIN suppliers s ON op.supplier_id = s.id
    LEFT JOIN orders o ON op.order_id = o.id
    WHERE op.id = ?
  `).get(req.params.id) as any;

  if (!operation) { res.status(404).json({ error: 'Operation not found' }); return; }

  const documents = db.prepare(`
    SELECT od.*, dc.name as category_name
    FROM operation_documents od
    LEFT JOIN document_categories dc ON od.category_id = dc.id
    WHERE od.operation_id = ?
    ORDER BY od.created_at DESC
  `).all(operation.id);

  const invoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.type, i.amount, i.currency, i.status, i.due_date, i.invoice_date,
      i.file_path, i.file_name,
      c.name as customer_name, s.name as supplier_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.operation_id = ?
    ORDER BY i.created_at DESC
  `).all(operation.id);

  const orderItems = operation.order_id
    ? db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(operation.order_id)
    : [];

  res.json({ ...operation, documents, invoices, order_items: orderItems });
});

// ── Create operation ──────────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  const { operation_number, order_id, customer_id, supplier_id, notes } = req.body;
  if (!operation_number) {
    res.status(400).json({ error: 'operation_number is required' });
    return;
  }
  try {
    const result = db.prepare(`
      INSERT INTO operations (operation_number, order_id, customer_id, supplier_id, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(operation_number, order_id || null, customer_id || null, supplier_id || null, notes || null);
    const op = db.prepare('SELECT * FROM operations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(op);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Operation number already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

// ── Patch status ──────────────────────────────────────────────────────────────

router.patch('/:id/status', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Operation not found' }); return; }
  const { status } = req.body;
  if (!status) { res.status(400).json({ error: 'status is required' }); return; }

  if (status === 'completed') {
    if (existing.status !== 'delivered') {
      res.status(400).json({ error: 'Operation must be delivered before it can be completed' });
      return;
    }
    const unpaid = (db.prepare(
      `SELECT COUNT(*) as count FROM invoices WHERE operation_id = ? AND status NOT IN ('paid','cancelled')`
    ).get(req.params.id) as any).count;
    if (unpaid > 0) {
      res.status(400).json({ error: 'All invoices must be paid before the operation can be completed' });
      return;
    }
  }

  db.prepare(`UPDATE operations SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  res.json({ id: existing.id, status });
});

// ── Ship operation ─────────────────────────────────────────────────────────────
// Sets status to 'shipped' AND updates all customer invoices:
//   invoice_date = ship_date, due_date = due_date, draft→sent

router.post('/:id/ship', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Operation not found' }); return; }

  const { ship_date, due_date } = req.body;
  if (!ship_date || !due_date) {
    res.status(400).json({ error: 'ship_date and due_date are required' }); return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ship_date) || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
    res.status(400).json({ error: 'Dates must be YYYY-MM-DD' }); return;
  }

  // Update operation: status + ship_date (invoice_date stays on the invoice itself)
  db.prepare(`UPDATE operations SET status = 'shipped', ship_date = ?, updated_at = datetime('now') WHERE id = ?`).run(ship_date, req.params.id);

  // Update customer invoices: set due_date only — invoice_date is per the uploaded invoice
  const invoices = db.prepare(
    "SELECT id, status FROM invoices WHERE operation_id = ? AND type = 'customer'"
  ).all(req.params.id) as any[];

  for (const inv of invoices) {
    const newStatus = inv.status === 'draft' ? 'sent' : inv.status;
    db.prepare(`
      UPDATE invoices
      SET due_date = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(due_date, newStatus, inv.id);

    if (inv.status === 'draft') {
      try {
        db.prepare(
          "INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('invoice', ?, 'sent', ?)"
        ).run(inv.id, req.user!.userId);
      } catch { /* ignore */ }
    }
  }

  res.json({ ok: true, invoices_updated: invoices.length });
});

// ── Update operation ──────────────────────────────────────────────────────────

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Operation not found' }); return; }

  const { operation_number, status, notes, order_id, customer_id, supplier_id } = req.body;
  try {
    db.prepare(`
      UPDATE operations SET operation_number=?, status=?, notes=?, order_id=?, customer_id=?, supplier_id=?, updated_at=datetime('now') WHERE id=?
    `).run(
      operation_number || existing.operation_number,
      status || existing.status,
      notes ?? existing.notes,
      order_id !== undefined ? (order_id || null) : existing.order_id,
      customer_id !== undefined ? (customer_id || null) : existing.customer_id,
      supplier_id !== undefined ? (supplier_id || null) : existing.supplier_id,
      req.params.id
    );
    const op = db.prepare('SELECT * FROM operations WHERE id = ?').get(req.params.id);
    res.json(op);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Delete operation ──────────────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM operations WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Operation not found' }); return; }

  // Delete all associated document files
  const docs = db.prepare('SELECT file_path FROM operation_documents WHERE operation_id = ?').all(req.params.id) as any[];
  for (const doc of docs) {
    const fp = path.join(uploadsBase, 'operation-docs', doc.file_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  db.prepare('DELETE FROM operations WHERE id = ?').run(req.params.id);
  res.json({ message: 'Operation deleted' });
});

// ── Upload document ───────────────────────────────────────────────────────────

router.post('/:id/documents', uploadOperationDoc.single('file'), (req: Request, res: Response) => {
  const operation = db.prepare('SELECT id FROM operations WHERE id = ?').get(req.params.id);
  if (!operation) { res.status(404).json({ error: 'Operation not found' }); return; }

  if (!req.file) {
    res.status(400).json({ error: 'File is required' });
    return;
  }

  const { category_id, notes } = req.body;

  const result = db.prepare(`
    INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    category_id ? Number(category_id) : null,
    req.file.filename,
    req.file.originalname,
    notes || null
  );

  const doc = db.prepare(`
    SELECT od.*, dc.name as category_name
    FROM operation_documents od
    LEFT JOIN document_categories dc ON od.category_id = dc.id
    WHERE od.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(doc);
});

// ── Delete document ───────────────────────────────────────────────────────────

router.delete('/:id/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare(
    'SELECT * FROM operation_documents WHERE id = ? AND operation_id = ?'
  ).get(Number(req.params.docId), Number(req.params.id)) as any;

  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

  const fp = path.join(uploadsBase, 'operation-docs', doc.file_path);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);

  db.prepare('DELETE FROM operation_documents WHERE id = ?').run(doc.id);
  res.json({ message: 'Document deleted' });
});

export default router;
