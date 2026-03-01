import { Router, Request, Response } from 'express';
import db from '../database.js';
import { getEurRate } from '../lib/fx.js';

const router = Router();

async function sumLiveEur(rows: { amount: number; currency: string }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const currencies = [...new Set(rows.map(r => (r.currency || 'USD').toUpperCase()).filter(c => c !== 'EUR'))];
  const rates: Record<string, number> = {};
  await Promise.all(currencies.map(async c => { rates[c] = await getEurRate(c, 'latest'); }));
  return rows.reduce((sum, row) => {
    const curr = (row.currency || 'USD').toUpperCase();
    return sum + row.amount * (curr === 'EUR' ? 1 : (rates[curr] ?? 1));
  }, 0);
}

const VALID_SUPPLIER_CATEGORIES = ['logistics', 'blenders', 'raw_materials', 'shipping'];

// GET /analytics/years — list of years that have invoice data
router.get('/years', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT year FROM (
      SELECT DISTINCT strftime('%Y', invoice_date) as year FROM invoices WHERE invoice_date IS NOT NULL
      UNION
      SELECT DISTINCT strftime('%Y', created_at) as year FROM invoices
    ) ORDER BY year DESC
  `).all() as any[];
  res.json(rows.map(r => r.year).filter(Boolean));
});

// GET /analytics/filters — customers and suppliers (with category) for dropdowns
router.get('/filters', (_req: Request, res: Response) => {
  const customers = db.prepare('SELECT id, name FROM customers ORDER BY name').all();
  const suppliers = db.prepare('SELECT id, name, category FROM suppliers ORDER BY name').all();
  res.json({ customers, suppliers });
});

// GET /analytics/summary
//   ?year=2026
//   &month_from=1  (1–12, default 1)
//   &month_to=12   (1–12, default 12, must be >= month_from)
//   &customer_id=
//   &supplier_id=
//   &supplier_category=  (logistics|blenders|raw_materials|shipping)
router.get('/summary', async (req: Request, res: Response) => {
  // ── Year ────────────────────────────────────────────────────────────────────
  const yearNum = parseInt((req.query.year as string) || new Date().getFullYear().toString());
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    res.status(400).json({ error: 'Invalid year' }); return;
  }
  const year = String(yearNum);

  // ── Month range ──────────────────────────────────────────────────────────────
  const rawFrom = parseInt(req.query.month_from as string || '1');
  const rawTo = parseInt(req.query.month_to as string || '12');
  const monthStart = Math.min(Math.max(isNaN(rawFrom) ? 1 : rawFrom, 1), 12);
  const monthEnd = Math.max(Math.min(isNaN(rawTo) ? 12 : rawTo, 12), monthStart);

  const dateStart = `${year}-${String(monthStart).padStart(2, '0')}-01`;
  const dateEnd = `${year}-${String(monthEnd).padStart(2, '0')}-31`;

  // ── Customer / Supplier ID filters ───────────────────────────────────────────
  const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;
  const supplierId = req.query.supplier_id ? parseInt(req.query.supplier_id as string) : null;
  if (req.query.customer_id && (isNaN(customerId!) || customerId! <= 0)) {
    res.status(400).json({ error: 'Invalid customer_id' }); return;
  }
  if (req.query.supplier_id && (isNaN(supplierId!) || supplierId! <= 0)) {
    res.status(400).json({ error: 'Invalid supplier_id' }); return;
  }

  // ── Supplier category filter ─────────────────────────────────────────────────
  const supplierCategory = req.query.supplier_category as string || '';
  if (supplierCategory && !VALID_SUPPLIER_CATEGORIES.includes(supplierCategory)) {
    res.status(400).json({ error: 'Invalid supplier_category' }); return;
  }

  // Safe WHERE clauses (integer IDs only — no string injection; category validated against whitelist)
  const custWhere = customerId ? `AND i.customer_id = ${customerId}` : '';
  const suppWhere = supplierId ? `AND i.supplier_id = ${supplierId}` : '';
  const custWhereOnly = customerId ? `AND customer_id = ${customerId}` : '';
  const suppWhereOnly = supplierId ? `AND supplier_id = ${supplierId}` : '';

  // Supplier category: JOIN + condition added to each supplier branch
  const catJoin = supplierCategory ? `JOIN suppliers s ON i.supplier_id = s.id` : '';
  const catCond = supplierCategory ? `AND s.category = '${supplierCategory}'` : '';

  // ── Monthly received (customer invoices paid) ──────────────────────────────
  const receivedRows = db.prepare(`
    SELECT month, SUM(amt) as received FROM (
      SELECT strftime('%Y-%m', wt.transfer_date) as month,
             COALESCE(wt.eur_amount, wt.amount) as amt
      FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
      WHERE i.type = 'customer' AND wt.transfer_date BETWEEN ? AND ? ${custWhere}
      UNION ALL
      SELECT strftime('%Y-%m', p.payment_date) as month, p.amount as amt
      FROM payments p JOIN invoices i ON p.invoice_id = i.id
      WHERE i.type = 'customer' AND p.payment_date BETWEEN ? AND ? ${custWhere}
      UNION ALL
      SELECT strftime('%Y-%m', i.payment_date) as month,
             COALESCE(i.eur_amount, i.amount) as amt
      FROM invoices i
      WHERE i.type = 'customer' AND i.status = 'paid'
        AND i.payment_date IS NOT NULL AND i.payment_date BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
        ${custWhere}
    ) GROUP BY month
  `).all(dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd) as any[];

  // ── Monthly paid out (supplier invoices paid) ──────────────────────────────
  const paidRows = db.prepare(`
    SELECT month, SUM(amt) as paid_out FROM (
      SELECT strftime('%Y-%m', wt.transfer_date) as month,
             COALESCE(wt.eur_amount, wt.amount) as amt
      FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
      ${catJoin}
      WHERE i.type = 'supplier' AND wt.transfer_date BETWEEN ? AND ? ${suppWhere} ${catCond}
      UNION ALL
      SELECT strftime('%Y-%m', p.payment_date) as month, p.amount as amt
      FROM payments p JOIN invoices i ON p.invoice_id = i.id
      ${catJoin}
      WHERE i.type = 'supplier' AND p.payment_date BETWEEN ? AND ? ${suppWhere} ${catCond}
      UNION ALL
      SELECT strftime('%Y-%m', i.payment_date) as month,
             COALESCE(i.eur_amount, i.amount) as amt
      FROM invoices i
      ${catJoin}
      WHERE i.type = 'supplier' AND i.status = 'paid'
        AND i.payment_date IS NOT NULL AND i.payment_date BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
        ${suppWhere} ${catCond}
    ) GROUP BY month
  `).all(dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd) as any[];

  // ── Build full month grid ──────────────────────────────────────────────────
  const months: Record<string, { month: string; received: number; paid_out: number }> = {};
  for (let m = monthStart; m <= monthEnd; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    months[key] = { month: key, received: 0, paid_out: 0 };
  }
  for (const r of receivedRows) {
    if (months[r.month]) months[r.month].received = Number(r.received) || 0;
  }
  for (const p of paidRows) {
    if (months[p.month]) months[p.month].paid_out = Number(p.paid_out) || 0;
  }
  const monthly = Object.values(months);

  // ── By customer ──────────────────────────────────────────────────────────
  const byCustomer = db.prepare(`
    SELECT c.name as customer_name, c.id as customer_id,
      COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) as total,
      COUNT(*) as invoice_count
    FROM invoices i JOIN customers c ON i.customer_id = c.id
    WHERE i.type = 'customer' AND i.status = 'paid'
      AND COALESCE(
        (SELECT MAX(wt.transfer_date) FROM wire_transfers wt WHERE wt.invoice_id = i.id),
        i.payment_date, i.invoice_date
      ) BETWEEN ? AND ?
      ${custWhere}
    GROUP BY i.customer_id ORDER BY total DESC LIMIT 20
  `).all(dateStart, dateEnd) as any[];

  // ── By supplier ──────────────────────────────────────────────────────────
  const bySupplier = db.prepare(`
    SELECT s.name as supplier_name, s.id as supplier_id, s.category,
      COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) as total,
      COUNT(*) as invoice_count
    FROM invoices i JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.type = 'supplier' AND i.status = 'paid'
      AND COALESCE(
        (SELECT MAX(wt.transfer_date) FROM wire_transfers wt WHERE wt.invoice_id = i.id),
        i.payment_date, i.invoice_date
      ) BETWEEN ? AND ?
      ${suppWhere} ${catCond}
    GROUP BY i.supplier_id ORDER BY total DESC LIMIT 20
  `).all(dateStart, dateEnd) as any[];

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalReceived = monthly.reduce((s, m) => s + m.received, 0);
  const totalPaidOut = monthly.reduce((s, m) => s + m.paid_out, 0);

  // Pending: sent/overdue invoices WITH a due_date in the selected year — live FX
  const outstandingRows = db.prepare(`
    SELECT amount, UPPER(COALESCE(currency, 'USD')) as currency
    FROM invoices
    WHERE type = 'customer' AND status IN ('sent', 'overdue') AND due_date IS NOT NULL
      AND strftime('%Y', due_date) = ? ${custWhereOnly}
  `).all(year) as any[];
  const outstanding = await sumLiveEur(outstandingRows);

  // Expected: sent invoices with NO due_date (unscheduled) — live FX
  const expectedRows = db.prepare(`
    SELECT amount, UPPER(COALESCE(currency, 'USD')) as currency
    FROM invoices
    WHERE type = 'customer' AND status = 'sent' AND due_date IS NULL ${custWhereOnly}
  `).all() as any[];
  const expectedReceivable = await sumLiveEur(expectedRows);

  // Outstanding supplier payable — live FX
  const payableRows = db.prepare(`
    SELECT i.amount, UPPER(COALESCE(i.currency, 'USD')) as currency
    FROM invoices i
    ${catJoin}
    WHERE i.type = 'supplier' AND i.status IN ('draft', 'sent', 'overdue')
    ${suppWhereOnly} ${catCond}
  `).all() as any[];
  const outstandingPayable = await sumLiveEur(payableRows);

  res.json({
    monthly,
    by_customer: byCustomer,
    by_supplier: bySupplier,
    totals: {
      received: totalReceived,
      paid_out: totalPaidOut,
      net: totalReceived - totalPaidOut,
      outstanding,           // sent/overdue WITH due_date
      expected: expectedReceivable, // sent WITHOUT due_date
      outstanding_payable: outstandingPayable,
    },
  });
});

// SQL expression that converts any recognised unit to metric tons (MT).
// 1 MT = 1000 kg = 2204.6226218 lbs
const MT_EXPR = `
  CASE
    WHEN LOWER(oi.unit) IN ('mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't')
      THEN oi.quantity
    WHEN LOWER(oi.unit) IN ('kg', 'kgs', 'kilogram', 'kilograms')
      THEN oi.quantity / 1000.0
    WHEN LOWER(oi.unit) IN ('lbs', 'lb', 'pound', 'pounds')
      THEN oi.quantity / 2204.6226218
    ELSE NULL
  END`;

// GET /analytics/quantity — monthly metric tons (MT) sold from customer orders
router.get('/quantity', (req: Request, res: Response) => {
  const yearNum = parseInt((req.query.year as string) || new Date().getFullYear().toString());
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    res.status(400).json({ error: 'Invalid year' }); return;
  }
  const year = String(yearNum);

  const rawFrom = parseInt(req.query.month_from as string || '1');
  const rawTo = parseInt(req.query.month_to as string || '12');
  const monthStart = Math.min(Math.max(isNaN(rawFrom) ? 1 : rawFrom, 1), 12);
  const monthEnd = Math.max(Math.min(isNaN(rawTo) ? 12 : rawTo, 12), monthStart);

  const dateStart = `${year}-${String(monthStart).padStart(2, '0')}-01`;
  const dateEnd = `${year}-${String(monthEnd).padStart(2, '0')}-31`;

  const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;
  if (req.query.customer_id && (isNaN(customerId!) || customerId! <= 0)) {
    res.status(400).json({ error: 'Invalid customer_id' }); return;
  }
  const custWhere = customerId ? `AND o.customer_id = ${customerId}` : '';

  const tonsRows = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(o.order_date, date(o.created_at))) as month,
           SUM(${MT_EXPR}) as tons
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.type = 'customer'
      AND COALESCE(o.order_date, date(o.created_at)) BETWEEN ? AND ?
      ${custWhere}
    GROUP BY month
  `).all(dateStart, dateEnd) as any[];

  const months: Record<string, { month: string; tons: number }> = {};
  for (let m = monthStart; m <= monthEnd; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    months[key] = { month: key, tons: 0 };
  }
  for (const r of tonsRows) {
    if (months[r.month]) months[r.month].tons = Number(r.tons) || 0;
  }

  const monthly = Object.values(months);
  const totalTons = monthly.reduce((s, m) => s + m.tons, 0);

  // Per-customer breakdown
  const byCustomer = db.prepare(`
    SELECT o.customer_id, c.name as customer_name, SUM(${MT_EXPR}) as tons
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN customers c ON o.customer_id = c.id
    WHERE o.type = 'customer'
      AND COALESCE(o.order_date, date(o.created_at)) BETWEEN ? AND ?
      ${custWhere}
    GROUP BY o.customer_id
    ORDER BY tons DESC
    LIMIT 30
  `).all(dateStart, dateEnd) as any[];

  res.json({ monthly, total_tons: totalTons, by_customer: byCustomer });
});

export default router;
