import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const status = (req.query.status as string) || '';
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    conditions.push('(p.lot_number LIKE ? OR p.product_name LIKE ? OR c.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { conditions.push('p.status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`
    SELECT COUNT(*) as count FROM production_batches p
    LEFT JOIN customers c ON p.customer_id = c.id
    ${where}
  `).get(...params) as any).count;

  const batches = db.prepare(`
    SELECT p.*, c.name as customer_name, s.name as toller_name, o.order_number
    FROM production_batches p
    LEFT JOIN customers c ON p.customer_id = c.id
    LEFT JOIN suppliers s ON p.toller_supplier_id = s.id
    LEFT JOIN orders o ON p.order_id = o.id
    ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: batches, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/:id', (req: Request, res: Response) => {
  const batch = db.prepare(`
    SELECT p.*, c.name as customer_name, s.name as toller_name, o.order_number
    FROM production_batches p
    LEFT JOIN customers c ON p.customer_id = c.id
    LEFT JOIN suppliers s ON p.toller_supplier_id = s.id
    LEFT JOIN orders o ON p.order_id = o.id
    WHERE p.id = ?
  `).get(req.params.id) as any;
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }

  const history = db.prepare(`
    SELECT sh.*, u.display_name as changed_by_name
    FROM status_history sh LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.entity_type = 'production' AND sh.entity_id = ? ORDER BY sh.created_at DESC
  `).all(batch.id);

  res.json({ ...batch, status_history: history });
});

router.post('/', (req: Request, res: Response) => {
  const { lot_number, order_id, customer_id, product_name, toller_supplier_id, ingredients_at_toller, quantity, unit, notes } = req.body;
  if (!lot_number || !product_name) {
    res.status(400).json({ error: 'lot_number and product_name are required' });
    return;
  }

  try {
    const result = db.prepare(`
      INSERT INTO production_batches (lot_number, order_id, customer_id, product_name, toller_supplier_id, ingredients_at_toller, quantity, unit, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lot_number, order_id || null, customer_id || null, product_name,
      toller_supplier_id || null, ingredients_at_toller ? 1 : 0,
      parseFloat(quantity) || 0, unit || 'kg', notes || null
    );

    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('production', ?, 'new_order', ?)`)
      .run(result.lastInsertRowid, req.user!.userId);

    const batch = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(batch);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Lot number already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Batch not found' }); return; }

  const { lot_number, order_id, customer_id, product_name, toller_supplier_id, ingredients_at_toller, quantity, unit, notes } = req.body;

  try {
    db.prepare(`
      UPDATE production_batches SET lot_number=?, order_id=?, customer_id=?, product_name=?, toller_supplier_id=?, ingredients_at_toller=?, quantity=?, unit=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      lot_number || existing.lot_number,
      order_id !== undefined ? (order_id || null) : existing.order_id,
      customer_id !== undefined ? (customer_id || null) : existing.customer_id,
      product_name || existing.product_name,
      toller_supplier_id !== undefined ? (toller_supplier_id || null) : existing.toller_supplier_id,
      ingredients_at_toller !== undefined ? (ingredients_at_toller ? 1 : 0) : existing.ingredients_at_toller,
      quantity != null ? parseFloat(quantity) : existing.quantity,
      unit || existing.unit, notes ?? existing.notes, req.params.id
    );

    const batch = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(req.params.id);
    res.json(batch);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/status', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Batch not found' }); return; }

  const { status, notes } = req.body;
  if (!status) { res.status(400).json({ error: 'Status is required' }); return; }

  db.prepare(`UPDATE production_batches SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('production', ?, ?, ?, ?, ?)`)
    .run(req.params.id, existing.status, status, req.user!.userId, notes || null);

  const batch = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(req.params.id);
  res.json(batch);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Batch not found' }); return; }

  db.prepare('DELETE FROM production_batches WHERE id = ?').run(req.params.id);
  res.json({ message: 'Batch deleted' });
});

export default router;
