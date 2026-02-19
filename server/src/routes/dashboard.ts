import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

router.get('/stats', (_req: Request, res: Response) => {
  const customers = (db.prepare('SELECT COUNT(*) as count FROM customers').get() as any).count;
  const suppliers = (db.prepare('SELECT COUNT(*) as count FROM suppliers').get() as any).count;
  const totalOrders = (db.prepare('SELECT COUNT(*) as count FROM orders').get() as any).count;
  const activeOrders = (db.prepare("SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('completed', 'cancelled')").get() as any).count;
  const totalInvoices = (db.prepare('SELECT COUNT(*) as count FROM invoices').get() as any).count;
  const pendingInvoiceAmount = (db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE type = 'customer' AND status IN ('draft', 'sent', 'overdue')").get() as any).total;
  const paidInvoiceAmount = (db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE type = 'customer' AND status = 'paid'").get() as any).total;
  const totalPayments = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments').get() as any).total;
  const activeShipments = (db.prepare("SELECT COUNT(*) as count FROM shipments WHERE status NOT IN ('delivered', 'returned', 'failed')").get() as any).count;

  res.json({
    customers, suppliers, totalOrders, activeOrders,
    totalInvoices, pendingInvoiceAmount, paidInvoiceAmount,
    totalPayments, activeShipments,
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
    ORDER BY i.created_at DESC LIMIT 10
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
  // Months from January of current year up to current month.
  // Counts both explicit payment records AND invoices marked as paid (status='paid')
  // without a payment record, using payment_date falling back to invoice_date / created_at.
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
        SELECT SUM(amount) FROM (
          SELECT p.amount FROM payments p
          JOIN invoices i ON p.invoice_id = i.id
          WHERE i.type = 'customer'
            AND strftime('%Y-%m', p.payment_date) = months.m
          UNION ALL
          SELECT i.amount FROM invoices i
          WHERE i.type = 'customer' AND i.status = 'paid'
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
            AND strftime('%Y-%m', COALESCE(i.payment_date, i.invoice_date, i.created_at)) = months.m
        )
      ), 0) as received,
      COALESCE((
        SELECT SUM(amount) FROM (
          SELECT p.amount FROM payments p
          JOIN invoices i ON p.invoice_id = i.id
          WHERE i.type = 'supplier'
            AND strftime('%Y-%m', p.payment_date) = months.m
          UNION ALL
          SELECT i.amount FROM invoices i
          WHERE i.type = 'supplier' AND i.status = 'paid'
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
            AND strftime('%Y-%m', COALESCE(i.payment_date, i.invoice_date, i.created_at)) = months.m
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

export default router;
