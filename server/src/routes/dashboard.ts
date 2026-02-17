import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

router.get('/stats', (_req: Request, res: Response) => {
  const customers = (db.prepare('SELECT COUNT(*) as count FROM customers').get() as any).count;
  const suppliers = (db.prepare('SELECT COUNT(*) as count FROM suppliers').get() as any).count;
  const totalOrders = (db.prepare('SELECT COUNT(*) as count FROM orders').get() as any).count;
  const activeOrders = (db.prepare("SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('completed', 'cancelled')").get() as any).count;
  const totalInvoices = (db.prepare('SELECT COUNT(*) as count FROM invoices').get() as any).count;
  const pendingInvoiceAmount = (db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE status IN ('draft', 'sent', 'overdue')").get() as any).total;
  const paidInvoiceAmount = (db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE status = 'paid'").get() as any).total;
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
    SELECT i.*, c.name as customer_name, s.name as supplier_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.status IN ('draft', 'sent', 'overdue')
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

export default router;
