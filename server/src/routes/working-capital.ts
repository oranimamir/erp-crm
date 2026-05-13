import { Router, Request, Response } from 'express';
import db from '../database.js';
import { getEurRate } from '../lib/fx.js';

const router = Router();

const VALID_STATUSES = ['planned', 'actualized', 'cancelled'] as const;

router.get('/', (req: Request, res: Response) => {
  const status = (req.query.status as string) || '';
  const year   = (req.query.year   as string) || '';
  const month  = (req.query.month  as string) || '';
  const supplier_id = (req.query.supplier_id as string) || '';
  const order_id    = (req.query.order_id    as string) || '';

  const conditions: string[] = [];
  const params: any[] = [];
  if (status) { conditions.push('w.status = ?'); params.push(status); }
  if (year)   { conditions.push("strftime('%Y', w.expected_date) = ?"); params.push(year); }
  if (month)  { conditions.push("strftime('%m', w.expected_date) = ?"); params.push(month.padStart(2, '0')); }
  if (supplier_id) { conditions.push('w.supplier_id = ?'); params.push(Number(supplier_id)); }
  if (order_id)    { conditions.push('w.order_id = ?');    params.push(Number(order_id)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT w.*, s.name AS supplier_name, o.order_number
    FROM working_capital_forecasts w
    LEFT JOIN suppliers s ON s.id = w.supplier_id
    LEFT JOIN orders    o ON o.id = w.order_id
    ${where}
    ORDER BY w.expected_date ASC, w.id ASC
  `).all(...params);
  res.json(rows);
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare(`
    SELECT w.*, s.name AS supplier_name, o.order_number
    FROM working_capital_forecasts w
    LEFT JOIN suppliers s ON s.id = w.supplier_id
    LEFT JOIN orders    o ON o.id = w.order_id
    WHERE w.id = ?
  `).get(req.params.id);
  if (!row) { res.status(404).json({ error: 'Forecast entry not found' }); return; }
  res.json(row);
});

router.post('/', async (req: Request, res: Response) => {
  const {
    description, supplier_id, order_id, amount, currency,
    expected_date, status, notes,
  } = req.body;

  if (!description || amount == null || !expected_date) {
    res.status(400).json({ error: 'description, amount, and expected_date are required' });
    return;
  }
  const amt = parseFloat(amount);
  if (!isFinite(amt) || amt <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }
  const cur = (currency || 'EUR').toUpperCase();
  const st  = status || 'planned';
  if (!VALID_STATUSES.includes(st as any)) {
    res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    return;
  }

  let fx_rate: number | null = null;
  let eur_amount: number | null = null;
  try {
    if (cur !== 'EUR') {
      fx_rate = await getEurRate(cur, expected_date);
      eur_amount = amt * fx_rate;
    }
  } catch (err: any) {
    console.warn('[working-capital] FX lookup failed:', err?.message || err);
  }

  try {
    const result = db.prepare(`
      INSERT INTO working_capital_forecasts
        (description, supplier_id, order_id, amount, currency, fx_rate, eur_amount, expected_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      description,
      supplier_id ? Number(supplier_id) : null,
      order_id    ? Number(order_id)    : null,
      amt, cur, fx_rate, eur_amount, expected_date, st, notes || null,
    );
    const row = db.prepare(`
      SELECT w.*, s.name AS supplier_name, o.order_number
      FROM working_capital_forecasts w
      LEFT JOIN suppliers s ON s.id = w.supplier_id
      LEFT JOIN orders    o ON o.id = w.order_id
      WHERE w.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM working_capital_forecasts WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Forecast entry not found' }); return; }

  const {
    description, supplier_id, order_id, amount, currency,
    expected_date, status, notes,
  } = req.body;

  const finalAmount   = amount != null ? parseFloat(amount) : existing.amount;
  const finalCurrency = (currency || existing.currency || 'EUR').toUpperCase();
  const finalDate     = expected_date || existing.expected_date;
  const finalStatus   = status || existing.status;
  if (!VALID_STATUSES.includes(finalStatus)) {
    res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    return;
  }

  // Recompute FX if amount, currency, or expected_date changed (or if EUR fields missing for non-EUR entry)
  let fx_rate = existing.fx_rate;
  let eur_amount = existing.eur_amount;
  const amountChanged   = amount   != null && parseFloat(amount) !== existing.amount;
  const currencyChanged = currency != null && finalCurrency !== (existing.currency || 'EUR').toUpperCase();
  const dateChanged     = expected_date != null && expected_date !== existing.expected_date;
  if (finalCurrency === 'EUR') {
    fx_rate = null;
    eur_amount = null;
  } else if (amountChanged || currencyChanged || dateChanged || existing.fx_rate == null) {
    try {
      fx_rate = await getEurRate(finalCurrency, finalDate);
      eur_amount = finalAmount * fx_rate;
    } catch (err: any) {
      console.warn('[working-capital] FX lookup failed on update:', err?.message || err);
    }
  } else {
    eur_amount = finalAmount * (existing.fx_rate as number);
  }

  try {
    db.prepare(`
      UPDATE working_capital_forecasts SET
        description = ?,
        supplier_id = ?,
        order_id    = ?,
        amount      = ?,
        currency    = ?,
        fx_rate     = ?,
        eur_amount  = ?,
        expected_date = ?,
        status      = ?,
        notes       = ?,
        updated_at  = datetime('now')
      WHERE id = ?
    `).run(
      description ?? existing.description,
      supplier_id !== undefined ? (supplier_id ? Number(supplier_id) : null) : existing.supplier_id,
      order_id    !== undefined ? (order_id    ? Number(order_id)    : null) : existing.order_id,
      finalAmount, finalCurrency, fx_rate, eur_amount, finalDate, finalStatus,
      notes !== undefined ? (notes || null) : existing.notes,
      req.params.id,
    );
    const row = db.prepare(`
      SELECT w.*, s.name AS supplier_name, o.order_number
      FROM working_capital_forecasts w
      LEFT JOIN suppliers s ON s.id = w.supplier_id
      LEFT JOIN orders    o ON o.id = w.order_id
      WHERE w.id = ?
    `).get(req.params.id);
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM working_capital_forecasts WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Forecast entry not found' }); return; }
  db.prepare('DELETE FROM working_capital_forecasts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Forecast entry deleted' });
});

export default router;
