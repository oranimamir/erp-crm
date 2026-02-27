import { Router, Request, Response } from 'express';
import multer from 'multer';
import db from '../database.js';
import { parseAndInsertStockCsv } from '../lib/parse-stock-csv.js';
import { checkEmailForStockUpdates, isEmailStockConfigured } from '../lib/email-stock.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET / — return all individual rows + upload history
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT whs, location, principal, article, searchname, description, stock, pc, gross_weight, nett_weight
    FROM warehouse_stock
    ORDER BY description ASC, article ASC, whs ASC, location ASC
  `).all();

  const history = db.prepare(`
    SELECT id, uploaded_at, rows_imported, filename, uploaded_by, source
    FROM warehouse_stock_uploads
    ORDER BY uploaded_at DESC
    LIMIT 10
  `).all();

  res.json({ data: rows, history });
});

// GET /email-config — returns whether email polling is configured and the inbox address
router.get('/email-config', (_req: Request, res: Response) => {
  res.json({
    configured: isEmailStockConfigured(),
    address: process.env.STOCK_EMAIL_USER || null,
  });
});

// POST /check-email — manually trigger email check (for testing / immediate refresh)
router.post('/check-email', async (_req: Request, res: Response) => {
  if (!isEmailStockConfigured()) {
    res.status(400).json({ error: 'Email stock polling is not configured. Set STOCK_EMAIL_USER and STOCK_EMAIL_PASS.' });
    return;
  }
  try {
    await checkEmailForStockUpdates();
    res.json({ message: 'Email check complete' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /upload — manual CSV upload via browser
router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const uploadedBy = (req as any).user?.display_name || 'Unknown';
    const inserted = parseAndInsertStockCsv(content, {
      filename: req.file.originalname,
      uploadedBy,
      source: 'manual',
    });
    res.json({ message: `Imported ${inserted} rows`, inserted });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
