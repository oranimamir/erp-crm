import { Router, Request, Response } from 'express';
import db from '../database.js';

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
    conditions.push('(o.order_number LIKE ? OR c.name LIKE ? OR s.name LIKE ? OR o.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { conditions.push('o.status = ?'); params.push(status); }
  if (type) { conditions.push('o.type = ?'); params.push(type); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`
    SELECT COUNT(*) as count FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id ${where}
  `).get(...params) as any).count;

  const orders = db.prepare(`
    SELECT o.*, c.name as customer_name, s.name as supplier_name,
      (SELECT GROUP_CONCAT(DISTINCT currency) FROM order_items WHERE order_id = o.id) as item_currencies
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id
    ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: orders, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/:id', (req: Request, res: Response) => {
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, s.name as supplier_name
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id
    WHERE o.id = ?
  `).get(req.params.id) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const shipments = db.prepare('SELECT * FROM shipments WHERE order_id = ?').all(order.id);
  const history = db.prepare(`
    SELECT sh.*, u.display_name as changed_by_name
    FROM status_history sh LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.entity_type = 'order' AND sh.entity_id = ? ORDER BY sh.created_at DESC
  `).all(order.id);

  res.json({ ...order, items, shipments, status_history: history });
});

router.post('/', (req: Request, res: Response) => {
  const {
    order_number, customer_id, supplier_id, type, status, description, notes, items,
    order_date, inco_terms, destination, transport, delivery_date, payment_terms,
    file_path, file_name, operation_number,
  } = req.body;

  if (!order_number || !type) {
    res.status(400).json({ error: 'order_number and type are required' });
    return;
  }

  const insertOrder = db.transaction(() => {
    let total_amount = 0;
    if (items && Array.isArray(items)) {
      total_amount = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);
    }

    const result = db.prepare(`
      INSERT INTO orders (order_number, customer_id, supplier_id, type, status, total_amount, description, notes,
        order_date, inco_terms, destination, transport, delivery_date, payment_terms, file_path, file_name, operation_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order_number,
      type === 'customer' ? (customer_id || null) : null,
      type === 'supplier' ? (supplier_id || null) : null,
      type, status || 'order_placed', total_amount, description || null, notes || null,
      order_date || null, inco_terms || null, destination || null,
      transport || null, delivery_date || null, payment_terms || null,
      file_path || null, file_name || null, operation_number || null
    );

    const orderId = result.lastInsertRowid;

    if (items && Array.isArray(items)) {
      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, description, quantity, unit, unit_price, currency, packaging, total, client_product_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const item of items) {
        insertItem.run(
          orderId, item.description, item.quantity, item.unit || 'tons',
          item.unit_price, item.currency || 'USD', item.packaging || null,
          item.quantity * item.unit_price, item.client_product_name || null
        );
      }
    }

    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('order', ?, ?, ?)`)
      .run(orderId, status || 'order_placed', req.user!.userId);

    return orderId;
  });

  try {
    const orderId = insertOrder();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId as number);
    res.status(201).json({ ...(order as any), items: orderItems });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Order number already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Order not found' }); return; }

  const {
    order_number, customer_id, supplier_id, type, status, description, notes, items,
    order_date, inco_terms, destination, transport, delivery_date, payment_terms,
    operation_number,
  } = req.body;

  const updateOrder = db.transaction(() => {
    let total_amount = existing.total_amount;
    if (items && Array.isArray(items)) {
      total_amount = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);
      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, description, quantity, unit, unit_price, currency, packaging, total, client_product_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const item of items) {
        insertItem.run(
          req.params.id, item.description, item.quantity, item.unit || 'tons',
          item.unit_price, item.currency || 'USD', item.packaging || null,
          item.quantity * item.unit_price, item.client_product_name || null
        );
      }
    }

    db.prepare(`
      UPDATE orders SET order_number=?, customer_id=?, supplier_id=?, type=?, status=?, total_amount=?,
        description=?, notes=?, order_date=?, inco_terms=?, destination=?, transport=?,
        delivery_date=?, payment_terms=?, operation_number=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      order_number || existing.order_number,
      (type || existing.type) === 'customer' ? (customer_id || existing.customer_id) : null,
      (type || existing.type) === 'supplier' ? (supplier_id || existing.supplier_id) : null,
      type || existing.type, status || existing.status, total_amount,
      description ?? existing.description, notes ?? existing.notes,
      order_date ?? existing.order_date, inco_terms ?? existing.inco_terms,
      destination ?? existing.destination, transport ?? existing.transport,
      delivery_date ?? existing.delivery_date, payment_terms ?? existing.payment_terms,
      operation_number ?? existing.operation_number,
      req.params.id
    );
  });

  try {
    updateOrder();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id as any);
    res.json({ ...(order as any), items: orderItems });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/status', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Order not found' }); return; }

  const { status, notes } = req.body;
  if (!status) { res.status(400).json({ error: 'Status is required' }); return; }

  db.prepare(`UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  db.prepare(`INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, notes) VALUES ('order', ?, ?, ?, ?, ?)`)
    .run(req.params.id, existing.status, status, req.user!.userId, notes || null);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  res.json(order);
});

router.delete('/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Order not found' }); return; }
  res.json({ message: 'Order deleted' });
});

export default router;
