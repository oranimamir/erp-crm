import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    conditions.push('(i.name LIKE ? OR i.sku LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) { conditions.push('i.category = ?'); params.push(category); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM inventory_items i ${where}`).get(...params) as any).count;
  const items = db.prepare(`
    SELECT i.*, s.name as supplier_name
    FROM inventory_items i
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    ${where} ORDER BY i.name ASC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: items, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post('/', (req: Request, res: Response) => {
  const { name, sku, category, quantity, unit, min_stock_level, supplier_id, unit_cost, notes } = req.body;
  if (!name || !sku || !category) {
    res.status(400).json({ error: 'name, sku, and category are required' });
    return;
  }

  try {
    const result = db.prepare(`
      INSERT INTO inventory_items (name, sku, category, quantity, unit, min_stock_level, supplier_id, unit_cost, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, sku, category, parseFloat(quantity) || 0, unit || 'pcs', parseFloat(min_stock_level) || 0, supplier_id || null, parseFloat(unit_cost) || 0, notes || null);

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(item);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'SKU already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  const { name, sku, category, quantity, unit, min_stock_level, supplier_id, unit_cost, notes } = req.body;

  try {
    db.prepare(`
      UPDATE inventory_items SET name=?, sku=?, category=?, quantity=?, unit=?, min_stock_level=?, supplier_id=?, unit_cost=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      name || existing.name, sku || existing.sku, category || existing.category,
      quantity != null ? parseFloat(quantity) : existing.quantity,
      unit || existing.unit,
      min_stock_level != null ? parseFloat(min_stock_level) : existing.min_stock_level,
      supplier_id !== undefined ? (supplier_id || null) : existing.supplier_id,
      unit_cost != null ? parseFloat(unit_cost) : existing.unit_cost,
      notes ?? existing.notes, req.params.id
    );

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
    res.json(item);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'SKU already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.patch('/:id/adjust', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  const { adjustment, reason } = req.body;
  if (adjustment == null) { res.status(400).json({ error: 'adjustment is required' }); return; }

  const newQty = existing.quantity + parseFloat(adjustment);
  if (newQty < 0) { res.status(400).json({ error: 'Stock cannot go below zero' }); return; }

  db.prepare(`UPDATE inventory_items SET quantity=?, updated_at=datetime('now') WHERE id=?`).run(newQty, req.params.id);

  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  res.json(item);
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  db.prepare('DELETE FROM inventory_items WHERE id = ?').run(req.params.id);
  res.json({ message: 'Item deleted' });
});

export default router;
