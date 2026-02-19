import { Router, Request, Response } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';

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
    conditions.push('(sh.tracking_number LIKE ? OR sh.carrier LIKE ? OR c.name LIKE ? OR s.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { conditions.push('sh.status = ?'); params.push(status); }
  if (type) { conditions.push('sh.type = ?'); params.push(type); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`
    SELECT COUNT(*) as count FROM shipments sh
    LEFT JOIN customers c ON sh.customer_id = c.id
    LEFT JOIN suppliers s ON sh.supplier_id = s.id ${where}
  `).get(...params) as any).count;

  const shipments = db.prepare(`
    SELECT sh.*, c.name as customer_name, s.name as supplier_name, o.order_number
    FROM shipments sh
    LEFT JOIN customers c ON sh.customer_id = c.id
    LEFT JOIN suppliers s ON sh.supplier_id = s.id
    LEFT JOIN orders o ON sh.order_id = o.id
    ${where} ORDER BY sh.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: shipments, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/:id', (req: Request, res: Response) => {
  const shipment = db.prepare(`
    SELECT sh.*, c.name as customer_name, s.name as supplier_name, o.order_number
    FROM shipments sh
    LEFT JOIN customers c ON sh.customer_id = c.id
    LEFT JOIN suppliers s ON sh.supplier_id = s.id
    LEFT JOIN orders o ON sh.order_id = o.id
    WHERE sh.id = ?
  `).get(req.params.id) as any;
  if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

  const history = db.prepare(`
    SELECT sh.*, u.display_name as changed_by_name
    FROM status_history sh LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.entity_type = 'shipment' AND sh.entity_id = ? ORDER BY sh.created_at DESC
  `).all(shipment.id);

  res.json({ ...shipment, status_history: history });
});

router.post('/', (req: Request, res: Response) => {
  const { order_id, customer_id, supplier_id, type, tracking_number, carrier, status, estimated_delivery, notes } = req.body;
  if (!type) { res.status(400).json({ error: 'type is required' }); return; }

  try {
    const result = db.prepare(`
      INSERT INTO shipments (order_id, customer_id, supplier_id, type, tracking_number, carrier, status, estimated_delivery, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order_id || null,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type, tracking_number || null, carrier || null, status || 'pending',
      estimated_delivery || null, notes || null
    );

    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('shipment', ?, ?, ?)`)
      .run(result.lastInsertRowid, status || 'pending', req.user!.userId);

    const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(result.lastInsertRowid) as any;
    notifyAdmin({ action: 'created', entity: 'Shipment', label: shipment.tracking_number || `Shipment #${shipment.id}`, performedBy: req.user?.display_name || 'Unknown' });
    res.status(201).json(shipment);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Shipment not found' }); return; }

  const { order_id, customer_id, supplier_id, type, tracking_number, carrier, status, estimated_delivery, notes } = req.body;

  try {
    db.prepare(`
      UPDATE shipments SET order_id=?, customer_id=?, supplier_id=?, type=?, tracking_number=?, carrier=?, status=?, estimated_delivery=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      order_id ?? existing.order_id,
      (type || existing.type) === 'customer' ? (customer_id || existing.customer_id) : null,
      (type || existing.type) === 'supplier' ? (supplier_id || existing.supplier_id) : null,
      type || existing.type, tracking_number ?? existing.tracking_number,
      carrier ?? existing.carrier, status || existing.status,
      estimated_delivery ?? existing.estimated_delivery, notes ?? existing.notes, req.params.id
    );

    const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id) as any;
    notifyAdmin({ action: 'updated', entity: 'Shipment', label: shipment.tracking_number || `Shipment #${shipment.id}`, performedBy: req.user?.display_name || 'Unknown' });
    res.json(shipment);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/status', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Shipment not found' }); return; }

  const { status, notes } = req.body;
  if (!status) { res.status(400).json({ error: 'Status is required' }); return; }

  db.prepare(`UPDATE shipments SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('shipment', ?, ?, ?, ?, ?)`)
    .run(req.params.id, existing.status, status, req.user!.userId, notes || null);

  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
  res.json(shipment);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT tracking_number FROM shipments WHERE id = ?').get(req.params.id) as any;
  const result = db.prepare('DELETE FROM shipments WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Shipment not found' }); return; }
  notifyAdmin({ action: 'deleted', entity: 'Shipment', label: existing?.tracking_number || `Shipment #${req.params.id}`, performedBy: req.user?.display_name || 'Unknown' });
  res.json({ message: 'Shipment deleted' });
});

export default router;
