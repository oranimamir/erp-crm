import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

router.get('/stats', (_req: Request, res: Response) => {
  const customers = (db.prepare('SELECT COUNT(*) as count FROM customers').get() as any).count;
  const suppliers = (db.prepare('SELECT COUNT(*) as count FROM suppliers').get() as any).count;
  const totalOrders = (db.prepare('SELECT COUNT(*) as count FROM orders').get() as any).count;
  const activeOrders = (db.prepare("SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('completed', 'cancelled')").get() as any).count;
  const totalInvoices = (db.prepare('SELECT COUNT(*) as count FROM invoices').get() as any).count;
  // Pending: sent/overdue invoices that HAVE a due date in the current year (matches analytics default)
  const pendingAmount = (db.prepare("SELECT COALESCE(SUM(COALESCE(eur_amount, amount)), 0) as total FROM invoices WHERE type = 'customer' AND status IN ('sent', 'overdue') AND due_date IS NOT NULL AND strftime('%Y', due_date) = strftime('%Y', 'now')").get() as any).total;
  // Expected: sent invoices with NO due date — amount expected but not yet scheduled
  const expectedAmount = (db.prepare("SELECT COALESCE(SUM(COALESCE(eur_amount, amount)), 0) as total FROM invoices WHERE type = 'customer' AND status = 'sent' AND due_date IS NULL").get() as any).total;
  const paidInvoiceAmount = (db.prepare("SELECT COALESCE(SUM(COALESCE(eur_amount, amount)), 0) as total FROM invoices WHERE type = 'customer' AND status = 'paid'").get() as any).total;
  // Paid YTD: actual payments received in the current calendar year
  const paidYTD = (db.prepare(`
    SELECT COALESCE(SUM(eur_val), 0) as total FROM (
      SELECT COALESCE(wt.eur_amount, wt.amount) as eur_val
      FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
      WHERE i.type = 'customer' AND strftime('%Y', wt.transfer_date) = strftime('%Y', 'now')
      UNION ALL
      SELECT p.amount FROM payments p JOIN invoices i ON p.invoice_id = i.id
      WHERE i.type = 'customer' AND strftime('%Y', p.payment_date) = strftime('%Y', 'now')
      UNION ALL
      SELECT COALESCE(i.eur_amount, i.amount) FROM invoices i
      WHERE i.type = 'customer' AND i.status = 'paid'
        AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
        AND i.payment_date IS NOT NULL AND strftime('%Y', i.payment_date) = strftime('%Y', 'now')
    )
  `).get() as any).total;
  const totalPayments = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments').get() as any).total;
  const activeShipments = (db.prepare("SELECT COUNT(*) as count FROM shipments WHERE status NOT IN ('delivered', 'returned', 'failed')").get() as any).count;

  res.json({
    customers, suppliers, totalOrders, activeOrders,
    totalInvoices, pendingAmount, expectedAmount, paidInvoiceAmount, paidYTD,
    totalPayments, activeShipments,
    currency: 'EUR',
  });
});

router.get('/recent-orders', (_req: Request, res: Response) => {
  const orders = db.prepare(`
    SELECT o.*, c.name as customer_name, s.name as supplier_name
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();
  res.json(orders);
});

router.get('/pending-invoices', (_req: Request, res: Response) => {
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.type = 'customer' AND i.status IN ('draft', 'sent', 'overdue')
    ORDER BY i.due_date ASC, i.created_at DESC LIMIT 200
  `).all();
  res.json(invoices);
});

router.get('/shipping-overview', (_req: Request, res: Response) => {
  const shipments = db.prepare(`
    SELECT sh.*, c.name as customer_name, s.name as supplier_name, o.order_number
    FROM shipments sh
    LEFT JOIN customers c ON sh.customer_id = c.id
    LEFT JOIN suppliers s ON sh.supplier_id = s.id
    LEFT JOIN orders o ON sh.order_id = o.id
    WHERE sh.status NOT IN ('delivered', 'returned', 'failed')
    ORDER BY sh.created_at DESC LIMIT 10
  `).all();
  res.json(shipments);
});

router.get('/monthly-payments', (_req: Request, res: Response) => {
  const months = db.prepare(`
    WITH RECURSIVE months(m) AS (
      SELECT strftime('%Y-01', 'now')
      UNION ALL
      SELECT strftime('%Y-%m', m || '-01', '+1 month') FROM months
      WHERE m < strftime('%Y-%m', 'now')
    )
    SELECT
      months.m as month,
      COALESCE((
        SELECT SUM(eur_val) FROM (
          SELECT COALESCE(wt.eur_amount, wt.amount) as eur_val FROM wire_transfers wt
          JOIN invoices i ON wt.invoice_id = i.id
          WHERE i.type = 'customer'
            AND strftime('%Y-%m', wt.transfer_date) = months.m
          UNION ALL
          SELECT p.amount FROM payments p
          JOIN invoices i ON p.invoice_id = i.id
          WHERE i.type = 'customer'
            AND strftime('%Y-%m', p.payment_date) = months.m
          UNION ALL
          SELECT COALESCE(i.eur_amount, i.amount) FROM invoices i
          WHERE i.type = 'customer' AND i.status = 'paid'
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
            AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
            AND i.payment_date IS NOT NULL
            AND strftime('%Y-%m', i.payment_date) = months.m
        )
      ), 0) as received,
      COALESCE((
        SELECT SUM(eur_val) FROM (
          SELECT COALESCE(wt.eur_amount, wt.amount) as eur_val FROM wire_transfers wt
          JOIN invoices i ON wt.invoice_id = i.id
          WHERE i.type = 'supplier'
            AND strftime('%Y-%m', wt.transfer_date) = months.m
          UNION ALL
          SELECT p.amount FROM payments p
          JOIN invoices i ON p.invoice_id = i.id
          WHERE i.type = 'supplier'
            AND strftime('%Y-%m', p.payment_date) = months.m
          UNION ALL
          SELECT COALESCE(i.eur_amount, i.amount) FROM invoices i
          WHERE i.type = 'supplier' AND i.status = 'paid'
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
            AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
            AND i.payment_date IS NOT NULL
            AND strftime('%Y-%m', i.payment_date) = months.m
        )
      ), 0) as paid_out
    FROM months ORDER BY months.m
  `).all();
  res.json(months);
});

router.get('/in-transit', (_req: Request, res: Response) => {
  const shipments = db.prepare(`
    SELECT sh.*, c.name as customer_name, o.order_number
    FROM shipments sh
    LEFT JOIN customers c ON sh.customer_id = c.id
    LEFT JOIN orders o ON sh.order_id = o.id
    WHERE sh.type = 'customer' AND sh.status IN ('in_transit', 'out_for_delivery')
    ORDER BY sh.estimated_delivery ASC
  `).all();
  res.json(shipments);
});

router.get('/overdue-invoices', (_req: Request, res: Response) => {
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.type = 'customer'
      AND i.due_date IS NOT NULL
      AND i.due_date < date('now')
      AND i.status NOT IN ('paid', 'cancelled')
    ORDER BY i.due_date ASC
  `).all();
  res.json(invoices);
});

router.get('/open-operations', (_req: Request, res: Response) => {
  const ops = db.prepare(`
    SELECT op.id, op.operation_number, op.status, op.created_at,
      c.name as customer_name, s.name as supplier_name,
      o.order_number,
      (SELECT COUNT(*) FROM invoices i WHERE i.operation_id = op.id) as invoice_count
    FROM operations op
    LEFT JOIN customers c ON op.customer_id = c.id
    LEFT JOIN suppliers s ON op.supplier_id = s.id
    LEFT JOIN orders o ON op.order_id = o.id
    WHERE op.status != 'delivered'
    ORDER BY op.created_at DESC
    LIMIT 20
  `).all();
  res.json(ops);
});

router.get('/forecast', (_req: Request, res: Response) => {
  const year = new Date().getFullYear();
  const data = [];
  for (let m = 1; m <= 12; m++) {
    const monthStr = `${year}-${String(m).padStart(2, '0')}`;
    const paid = (db.prepare(`
      SELECT COALESCE(SUM(eur_val), 0) as total FROM (
        SELECT COALESCE(wt.eur_amount, wt.amount) as eur_val
        FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
        WHERE i.type = 'customer' AND strftime('%Y-%m', wt.transfer_date) = ?
        UNION ALL
        SELECT p.amount FROM payments p JOIN invoices i ON p.invoice_id = i.id
        WHERE i.type = 'customer' AND strftime('%Y-%m', p.payment_date) = ?
        UNION ALL
        SELECT COALESCE(i.eur_amount, i.amount) FROM invoices i
        WHERE i.type = 'customer' AND i.status = 'paid'
          AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
          AND i.payment_date IS NOT NULL AND strftime('%Y-%m', i.payment_date) = ?
      )
    `).get(monthStr, monthStr, monthStr) as any).total;
    // Pending: sent/overdue invoices WITH a due_date, allocated to that due_date month
    const pending = (db.prepare(`
      SELECT COALESCE(SUM(COALESCE(eur_amount, amount)), 0) as total
      FROM invoices WHERE type = 'customer' AND status IN ('sent', 'overdue')
        AND due_date IS NOT NULL AND strftime('%Y-%m', due_date) = ?
    `).get(monthStr) as any).total;
    data.push({ month: monthStr, paid: Number(paid), pending: Number(pending) });
  }
  // Expected: sent invoices with NO due_date — total amount expected but unscheduled
  const expected = (db.prepare(`
    SELECT COALESCE(SUM(COALESCE(eur_amount, amount)), 0) as total
    FROM invoices WHERE type = 'customer' AND status = 'sent' AND due_date IS NULL
  `).get() as any).total;
  res.json({ months: data, expected: Number(expected) });
});

router.get('/paid-invoices', (_req: Request, res: Response) => {
  const invoices = db.prepare(`
    SELECT
      i.id, i.invoice_number, i.currency,
      c.name as customer_name,
      COALESCE(wt.transfer_date, i.payment_date, i.created_at) as paid_date,
      COALESCE(wt.eur_amount, i.eur_amount, i.amount) as eur_val
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN (
      SELECT invoice_id,
             MAX(transfer_date) as transfer_date,
             SUM(COALESCE(eur_amount, amount)) as eur_amount
      FROM wire_transfers GROUP BY invoice_id
    ) wt ON wt.invoice_id = i.id
    WHERE i.type = 'customer' AND i.status = 'paid'
    ORDER BY COALESCE(wt.transfer_date, i.payment_date, i.created_at) DESC
    LIMIT 30
  `).all();
  res.json(invoices);
});

router.get('/supplier-payments', (_req: Request, res: Response) => {
  const data = db.prepare(`
    SELECT
      strftime('%Y-%m', p.payment_date) as month,
      s.name as supplier_name,
      SUM(p.amount) as total
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id AND i.type = 'supplier'
    JOIN suppliers s ON i.supplier_id = s.id
    WHERE p.payment_date >= date('now', '-6 months')
    GROUP BY month, s.id
    ORDER BY month, total DESC
  `).all();
  res.json(data);
});

router.get('/customer-payments', (_req: Request, res: Response) => {
  const data = db.prepare(`
    SELECT
      strftime('%Y-%m', p.payment_date) as month,
      c.name as customer_name,
      SUM(p.amount) as total
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id AND i.type = 'customer'
    JOIN customers c ON i.customer_id = c.id
    WHERE p.payment_date >= date('now', '-6 months')
    GROUP BY month, c.id
    ORDER BY month, total DESC
  `).all();
  res.json(data);
});

router.get('/tons-ytd', (_req: Request, res: Response) => {
  const year = new Date().getFullYear().toString();
  // Convert all units to metric tons: 1 MT = 1000 kg = 2204.6226218 lbs
  const result = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN LOWER(oi.unit) IN ('mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't')
          THEN oi.quantity
        WHEN LOWER(oi.unit) IN ('kg', 'kgs', 'kilogram', 'kilograms')
          THEN oi.quantity / 1000.0
        WHEN LOWER(oi.unit) IN ('lbs', 'lb', 'pound', 'pounds')
          THEN oi.quantity / 2204.6226218
        ELSE NULL
      END
    ), 0) as total_tons
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.type = 'customer'
      AND strftime('%Y', COALESCE(o.order_date, date(o.created_at))) = ?
  `).get(year) as any;
  res.json({ total_tons: Number(result.total_tons), year: parseInt(year) });
});

export default router;
