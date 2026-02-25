import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './database.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Warn if JWT_SECRET is using the insecure default
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set — using insecure default. Set it in your .env file.');
}

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow file previews/embeds
  contentSecurityPolicy: false,     // Managed by the SPA
}));

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.APP_URL
  ? [process.env.APP_URL, 'http://localhost:5173', 'http://localhost:3001']
  : true; // Dev fallback: allow all

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
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

// ── Public routes (with rate limiting) ───────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/accept-invite', authLimiter);
app.use('/api/auth', authRoutes);

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

// ── Serve built client in production ─────────────────────────────────────────
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));

// ── Error handling ────────────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    return;
  }
  if (err.message?.includes('Only PDF')) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
