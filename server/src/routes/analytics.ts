import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

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

// GET /analytics/filters — customers and suppliers for dropdowns
router.get('/filters', (_req: Request, res: Response) => {
  const customers = db.prepare('SELECT id, name FROM customers ORDER BY name').all();
  const suppliers = db.prepare('SELECT id, name FROM suppliers ORDER BY name').all();
  res.json({ customers, suppliers });
});

// GET /analytics/summary?year=2026&quarter=1&customer_id=&supplier_id=
router.get('/summary', (req: Request, res: Response) => {
  const year = (req.query.year as string) || new Date().getFullYear().toString();
  const quarter = parseInt(req.query.quarter as string || '0') || 0;
  const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;
  const supplierId = req.query.supplier_id ? parseInt(req.query.supplier_id as string) : null;

  // Date range
  let monthStart: number, monthEnd: number;
  if (quarter >= 1 && quarter <= 4) {
    monthStart = (quarter - 1) * 3 + 1;
    monthEnd = quarter * 3;
  } else {
    monthStart = 1;
    monthEnd = 12;
  }
  const dateStart = `${year}-${String(monthStart).padStart(2, '0')}-01`;
  const dateEnd = `${year}-${String(monthEnd).padStart(2, '0')}-31`;

  // Safe integer-only dynamic conditions (no user string injection)
  const custWhere = customerId ? `AND i.customer_id = ${customerId}` : '';
  const suppWhere = supplierId ? `AND i.supplier_id = ${supplierId}` : '';
  const custWhereOnly = customerId ? `AND customer_id = ${customerId}` : '';

  // ── Monthly received (customer income) ────────────────────────────────────
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

  // ── Monthly paid out (supplier expenses) ─────────────────────────────────
  const paidRows = db.prepare(`
    SELECT month, SUM(amt) as paid_out FROM (
      SELECT strftime('%Y-%m', wt.transfer_date) as month,
             COALESCE(wt.eur_amount, wt.amount) as amt
      FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
      WHERE i.type = 'supplier' AND wt.transfer_date BETWEEN ? AND ? ${suppWhere}
      UNION ALL
      SELECT strftime('%Y-%m', p.payment_date) as month, p.amount as amt
      FROM payments p JOIN invoices i ON p.invoice_id = i.id
      WHERE i.type = 'supplier' AND p.payment_date BETWEEN ? AND ? ${suppWhere}
      UNION ALL
      SELECT strftime('%Y-%m', i.payment_date) as month,
             COALESCE(i.eur_amount, i.amount) as amt
      FROM invoices i
      WHERE i.type = 'supplier' AND i.status = 'paid'
        AND i.payment_date IS NOT NULL AND i.payment_date BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
        ${suppWhere}
    ) GROUP BY month
  `).all(dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd) as any[];

  // ── Build full month grid ─────────────────────────────────────────────────
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

  // ── By customer ───────────────────────────────────────────────────────────
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
    GROUP BY i.customer_id ORDER BY total DESC LIMIT 10
  `).all(dateStart, dateEnd) as any[];

  // ── By supplier ───────────────────────────────────────────────────────────
  const bySupplier = db.prepare(`
    SELECT s.name as supplier_name, s.id as supplier_id,
      COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) as total,
      COUNT(*) as invoice_count
    FROM invoices i JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.type = 'supplier' AND i.status = 'paid'
      AND COALESCE(
        (SELECT MAX(wt.transfer_date) FROM wire_transfers wt WHERE wt.invoice_id = i.id),
        i.payment_date, i.invoice_date
      ) BETWEEN ? AND ?
      ${suppWhere}
    GROUP BY i.supplier_id ORDER BY total DESC LIMIT 10
  `).all(dateStart, dateEnd) as any[];

  // ── Invoice status breakdown ──────────────────────────────────────────────
  const statusBreakdown = db.prepare(`
    SELECT status, COUNT(*) as count,
      COALESCE(SUM(COALESCE(eur_amount, amount)), 0) as total
    FROM invoices WHERE type = 'customer' ${custWhereOnly}
    GROUP BY status
  `).all() as any[];

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalReceived = monthly.reduce((s, m) => s + m.received, 0);
  const totalPaidOut = monthly.reduce((s, m) => s + m.paid_out, 0);
  const outstanding = (db.prepare(`
    SELECT COALESCE(SUM(COALESCE(eur_amount, amount)), 0) as total
    FROM invoices WHERE type = 'customer' AND status IN ('draft', 'sent', 'overdue') ${custWhereOnly}
  `).get() as any).total;

  res.json({
    monthly,
    by_customer: byCustomer,
    by_supplier: bySupplier,
    status_breakdown: statusBreakdown,
    totals: {
      received: totalReceived,
      paid_out: totalPaidOut,
      net: totalReceived - totalPaidOut,
      outstanding,
    },
  });
});

export default router;
