import { Router, Request, Response } from 'express';
import db from '../database.js';
import { getEurRate } from '../lib/fx.js';

const router = Router();

const VALID_STATUSES = ['planned', 'actualized', 'cancelled'] as const;

const FORECAST_BASE_SQL = `
  SELECT w.*
  FROM working_capital_forecasts w
`;

function attachOperations(forecasts: any[]) {
  if (forecasts.length === 0) return forecasts;
  const ids = forecasts.map(f => f.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT fo.forecast_id, op.id, op.operation_number,
      COALESCE(c.name, s.name) AS party_name
    FROM working_capital_forecast_operations fo
    JOIN operations op ON op.id = fo.operation_id
    LEFT JOIN customers c ON c.id = op.customer_id
    LEFT JOIN suppliers s ON s.id = op.supplier_id
    WHERE fo.forecast_id IN (${placeholders})
    ORDER BY op.operation_number ASC
  `).all(...ids) as any[];

  const byForecast = new Map<number, any[]>();
  for (const r of rows) {
    if (!byForecast.has(r.forecast_id)) byForecast.set(r.forecast_id, []);
    byForecast.get(r.forecast_id)!.push({
      id: r.id,
      operation_number: r.operation_number,
      party_name: r.party_name,
    });
  }
  for (const f of forecasts) {
    f.operations = byForecast.get(f.id) ?? [];
  }
  return forecasts;
}

function setForecastOperations(forecastId: number, operationIds: number[] | undefined) {
  if (!operationIds) return; // explicit undefined = don't touch links
  db.prepare('DELETE FROM working_capital_forecast_operations WHERE forecast_id = ?').run(forecastId);
  if (operationIds.length === 0) return;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO working_capital_forecast_operations (forecast_id, operation_id) VALUES (?, ?)'
  );
  for (const opId of operationIds) {
    if (Number.isFinite(opId) && opId > 0) insert.run(forecastId, Number(opId));
  }
}

router.get('/supplier-names', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT DISTINCT supplier AS name
    FROM demo_invoices
    WHERE supplier IS NOT NULL AND TRIM(supplier) != ''
    ORDER BY supplier COLLATE NOCASE ASC
  `).all() as any[];
  res.json(rows.map(r => r.name));
});

router.get('/', (req: Request, res: Response) => {
  const status = (req.query.status as string) || '';
  const year   = (req.query.year   as string) || '';
  const month  = (req.query.month  as string) || '';
  const supplier_name = (req.query.supplier_name as string) || '';
  const operation_id  = (req.query.operation_id  as string) || '';

  const conditions: string[] = [];
  const params: any[] = [];
  if (status) { conditions.push('w.status = ?'); params.push(status); }
  if (year)   { conditions.push("strftime('%Y', w.expected_date) = ?"); params.push(year); }
  if (month)  { conditions.push("strftime('%m', w.expected_date) = ?"); params.push(month.padStart(2, '0')); }
  if (supplier_name) { conditions.push('w.supplier_name = ?'); params.push(supplier_name); }
  if (operation_id) {
    conditions.push('EXISTS (SELECT 1 FROM working_capital_forecast_operations fo WHERE fo.forecast_id = w.id AND fo.operation_id = ?)');
    params.push(Number(operation_id));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    ${FORECAST_BASE_SQL}
    ${where}
    ORDER BY w.expected_date ASC, w.id ASC
  `).all(...params) as any[];
  res.json(attachOperations(rows));
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare(`${FORECAST_BASE_SQL} WHERE w.id = ?`).get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: 'Forecast entry not found' }); return; }
  res.json(attachOperations([row])[0]);
});

router.post('/', async (req: Request, res: Response) => {
  const {
    description, supplier_name, operation_ids, amount, currency,
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
        (description, supplier_name, amount, currency, fx_rate, eur_amount, expected_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      description,
      supplier_name?.trim() || null,
      amt, cur, fx_rate, eur_amount, expected_date, st, notes || null,
    );
    const forecastId = Number(result.lastInsertRowid);
    setForecastOperations(forecastId, Array.isArray(operation_ids) ? operation_ids : []);
    db.saveToDisk();

    const row = db.prepare(`${FORECAST_BASE_SQL} WHERE w.id = ?`).get(forecastId) as any;
    res.status(201).json(attachOperations([row])[0]);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM working_capital_forecasts WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Forecast entry not found' }); return; }

  const {
    description, supplier_name, operation_ids, amount, currency,
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
        description   = ?,
        supplier_name = ?,
        amount        = ?,
        currency      = ?,
        fx_rate       = ?,
        eur_amount    = ?,
        expected_date = ?,
        status        = ?,
        notes         = ?,
        updated_at    = datetime('now')
      WHERE id = ?
    `).run(
      description ?? existing.description,
      supplier_name !== undefined ? (supplier_name?.trim() || null) : existing.supplier_name,
      finalAmount, finalCurrency, fx_rate, eur_amount, finalDate, finalStatus,
      notes !== undefined ? (notes || null) : existing.notes,
      req.params.id,
    );
    if (operation_ids !== undefined) {
      setForecastOperations(Number(req.params.id), Array.isArray(operation_ids) ? operation_ids : []);
    }
    db.saveToDisk();

    const row = db.prepare(`${FORECAST_BASE_SQL} WHERE w.id = ?`).get(req.params.id) as any;
    res.json(attachOperations([row])[0]);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM working_capital_forecasts WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Forecast entry not found' }); return; }
  // ON DELETE CASCADE on the join table cleans up the operation links automatically
  db.prepare('DELETE FROM working_capital_forecasts WHERE id = ?').run(req.params.id);
  db.saveToDisk();
  res.json({ message: 'Forecast entry deleted' });
});

export default router;
