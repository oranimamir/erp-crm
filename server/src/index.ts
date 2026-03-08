import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { initializeDatabase } from './database.js';
import { authenticateToken } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import supplierRoutes from './routes/suppliers.js';
import invoiceRoutes from './routes/invoices.js';
import invoiceScanRoutes from './routes/invoice-scan.js';
import paymentRoutes from './routes/payments.js';
import orderRoutes from './routes/orders.js';
import orderScanRoutes from './routes/order-scan.js';
import shipmentRoutes from './routes/shipments.js';
import dashboardRoutes from './routes/dashboard.js';
import fileRoutes from './routes/files.js';
import userRoutes from './routes/users.js';
import inventoryRoutes from './routes/inventory.js';
import productionRoutes from './routes/production.js';
import wireTransferScanRoutes from './routes/wire-transfer-scan.js';
import productRoutes from './routes/products.js';
import invoiceGenerateRoutes from './routes/invoice-generate.js';
import invoiceTemplateRoutes from './routes/invoice-template.js';
import operationRoutes from './routes/operations.js';
import analyticsRoutes from './routes/analytics.js';
import packagingRoutes from './routes/packaging.js';
import backupRoutes from './routes/backup.js';
import warehouseStockRoutes from './routes/warehouse-stock.js';
import notificationRoutes from './routes/notifications.js';
import cron from 'node-cron';
import { checkEmailForStockUpdates } from './lib/email-stock.js';
import { startBackupScheduler, buildCronExpr } from './lib/backup-scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Require JWT_SECRET in production; warn loudly in development
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start in production.');
    process.exit(1);
  } else {
    console.warn('⚠️  JWT_SECRET is not set — using insecure default. Set it in your .env file.');
  }
}

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow file previews/embeds
  contentSecurityPolicy: false,     // Managed by the SPA
}));

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.APP_URL
  ? [process.env.APP_URL, 'http://localhost:5173', 'http://localhost:3001']
  : ['http://localhost:5173', 'http://localhost:3001']; // Restrict to localhost even in dev

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  maxAge: 86400, // Cache preflight for 24h
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Strict limiter for login — 20 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Very strict limiter for OTP verification — 5 attempts per 10 min per IP
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP attempts. Please try again in 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter — 300 req per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Initialize database
await initializeDatabase();

// Schedule backup based on DB-stored schedule (default: weekly Sunday 02:00 UTC)
{
  const schedRow = db.prepare("SELECT value FROM app_settings WHERE key = 'backup_schedule'").get() as any;
  const sched = schedRow ? JSON.parse(schedRow.value) : { frequency: 'weekly', day: 0, hour: 2, minute: 0 };
  startBackupScheduler(buildCronExpr(sched));
}

// Poll inbox for warehouse stock CSV every 15 minutes
cron.schedule('*/15 * * * *', () => {
  if (process.env.STOCK_EMAIL_USER) {
    checkEmailForStockUpdates().catch(err => console.error('[Email stock]', err));
  }
});

// ── Public routes (with rate limiting) ───────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/verify-otp', otpLimiter);
app.use('/api/auth/accept-invite', authLimiter);
app.use('/api/auth', authRoutes);

// ── Diagnostic endpoint (temporary — remove after debugging) ──────────────────
app.get('/api/debug-data', (_req, res) => {
  const version = 'v2-2026-03-08';
  const wireTransfers = db.prepare('SELECT wt.*, i.invoice_number, i.operation_id FROM wire_transfers wt LEFT JOIN invoices i ON wt.invoice_id = i.id').all();
  const invoicesWithOps = db.prepare('SELECT id, invoice_number, operation_id, type, status, payment_date, invoice_date FROM invoices WHERE operation_id IS NOT NULL').all();
  const allInvoices = db.prepare('SELECT id, invoice_number, operation_id, type, status, payment_date, invoice_date FROM invoices').all();
  const marchExpenses = db.prepare(`
    SELECT 'wire_transfer' as source, wt.id, wt.amount, wt.transfer_date as date, wt.eur_amount, i.invoice_number, i.type
    FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
    WHERE i.type = 'supplier' AND wt.transfer_date BETWEEN '2026-03-01' AND '2026-03-31'
    UNION ALL
    SELECT 'invoice_payment' as source, ip.id, ip.amount, ip.payment_date as date, ip.eur_amount, i.invoice_number, i.type
    FROM invoice_payments ip JOIN invoices i ON ip.invoice_id = i.id
    WHERE i.type = 'supplier' AND ip.payment_date BETWEEN '2026-03-01' AND '2026-03-31'
    UNION ALL
    SELECT 'payment' as source, p.id, p.amount, p.payment_date as date, NULL as eur_amount, i.invoice_number, i.type
    FROM payments p JOIN invoices i ON p.invoice_id = i.id
    WHERE i.type = 'supplier' AND p.payment_date BETWEEN '2026-03-01' AND '2026-03-31'
    UNION ALL
    SELECT 'legacy_paid' as source, i.id, i.amount, i.payment_date as date, i.eur_amount, i.invoice_number, i.type
    FROM invoices i
    WHERE i.type = 'supplier' AND i.status = 'paid' AND i.payment_date BETWEEN '2026-03-01' AND '2026-03-31'
      AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
  `).all();
  const tableSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wire_transfers'").get();
  res.json({ version, wireTransfers, invoicesWithOps, allInvoices, marchExpenses, tableSchema });
});

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api/customers', authenticateToken, customerRoutes);
app.use('/api/suppliers', authenticateToken, supplierRoutes);
app.use('/api/invoices/scan', authenticateToken, invoiceScanRoutes);
app.use('/api/invoices', authenticateToken, invoiceRoutes);
app.use('/api/payments', authenticateToken, paymentRoutes);
app.use('/api/orders/scan', authenticateToken, orderScanRoutes);
app.use('/api/orders', authenticateToken, orderRoutes);
app.use('/api/shipments', authenticateToken, shipmentRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/files', authenticateToken, fileRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/inventory', authenticateToken, inventoryRoutes);
app.use('/api/production', authenticateToken, productionRoutes);
app.use('/api/wire-transfers/scan', authenticateToken, wireTransferScanRoutes);
app.use('/api/products', authenticateToken, productRoutes);
app.use('/api/invoice-generate', authenticateToken, invoiceGenerateRoutes);
app.use('/api/invoice-template', authenticateToken, invoiceTemplateRoutes);
app.use('/api/operations', authenticateToken, operationRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/packaging', authenticateToken, packagingRoutes);
app.use('/api/backup', authenticateToken, backupRoutes);
app.use('/api/warehouse-stock', authenticateToken, warehouseStockRoutes);
app.use('/api/notifications', authenticateToken, notificationRoutes);

// ── Serve built client in production ─────────────────────────────────────────
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));

// ── Error handling ────────────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Log full error server-side only — never expose stack traces or DB details to clients
  console.error('[Error]', err?.message || err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    return;
  }
  // Safe user-facing multer/upload errors
  if (err.message?.includes('Only PDF') || err.message?.includes('files are allowed')) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
