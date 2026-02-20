import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
await initializeDatabase();

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
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

// Serve built client in production
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));

// Error handling for multer
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

// SPA fallback - serve index.html for non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
