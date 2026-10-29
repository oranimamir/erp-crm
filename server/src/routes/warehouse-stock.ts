import { Router, Request, Response } from 'express';
import multer from 'multer';
import db from '../database.js';
import { parseAndInsertStockCsv, insertStockRows, excelRows, missingBatchesInStock } from '../lib/parse-stock-csv.js';
import { checkEmailForStockUpdates, isEmailStockConfigured } from '../lib/email-stock.js';
import { notifyAdmin } from '../lib/notify.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** `?warehouse=` → a warehouse id, or null for all of them. */
function warehouseParam(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /?warehouse=all|<id> — stock rows (with their warehouse), upload history, and the
// batch numbers in that stock that are not in Batches (flagged, never created)
router.get('/', (req: Request, res: Response) => {
  const wid = warehouseParam(req.query.warehouse);
  const where = wid ? 'WHERE ws.warehouse_id = ?' : '';
  const args = wid ? [wid] : [];
  const rows = db.prepare(`
    SELECT ws.warehouse_id, w.name AS warehouse_name, ws.whs, ws.location, ws.principal, ws.article, ws.searchname,
           ws.description, ws.stock, ws.pc, ws.gross_weight, ws.nett_weight, ws.batch_number
    FROM warehouse_stock ws LEFT JOIN warehouses w ON w.id = ws.warehouse_id
    ${where}
    ORDER BY ws.description ASC, ws.article ASC, w.name ASC, ws.whs ASC, ws.location ASC
  `).all(...args);

  const history = db.prepare(`
    SELECT u.id, u.uploaded_at, u.rows_imported, u.filename, u.uploaded_by, u.source, u.warehouse_id, w.name AS warehouse_name
    FROM warehouse_stock_uploads u LEFT JOIN warehouses w ON w.id = u.warehouse_id
    ${wid ? 'WHERE u.warehouse_id = ?' : ''}
    ORDER BY u.uploaded_at DESC
    LIMIT 10
  `).all(...args);

  res.json({ data: rows, history, missing_batches: missingBatchesInStock(wid) });
});

// GET /warehouses — every warehouse with its row count, stock total and last upload
router.get('/warehouses', (_req: Request, res: Response) => {
  res.json(db.prepare(`
    SELECT w.id, w.name, w.created_at,
      (SELECT COUNT(*) FROM warehouse_stock ws WHERE ws.warehouse_id = w.id) AS rows_count,
      (SELECT MAX(uploaded_at) FROM warehouse_stock_uploads u WHERE u.warehouse_id = w.id) AS last_upload
    FROM warehouses w ORDER BY w.id
  `).all());
});

// POST /warehouses {name} — add a warehouse
router.post('/warehouses', (req: Request, res: Response) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 60) { res.status(400).json({ error: 'Give the warehouse a name (up to 60 characters)' }); return; }
  if (/^all$/i.test(name)) { res.status(400).json({ error: '"All" is taken by the all-warehouses view' }); return; }
  try {
    const r = db.prepare('INSERT INTO warehouses (name) VALUES (?)').run(name);
    notifyAdmin({ action: 'created', entity: 'Warehouse', label: name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
    res.status(201).json(db.prepare('SELECT * FROM warehouses WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    res.status(err.message?.includes('UNIQUE') ? 409 : 400).json({ error: err.message?.includes('UNIQUE') ? `There is already a warehouse called ${name}` : err.message });
  }
});

// PUT /warehouses/:id {name} — rename
router.put('/warehouses/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Warehouse not found' }); return; }
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 60 || /^all$/i.test(name)) { res.status(400).json({ error: 'Give the warehouse a name (up to 60 characters)' }); return; }
  try {
    db.prepare('UPDATE warehouses SET name = ? WHERE id = ?').run(name, existing.id);
    res.json(db.prepare('SELECT * FROM warehouses WHERE id = ?').get(existing.id));
  } catch (err: any) {
    res.status(err.message?.includes('UNIQUE') ? 409 : 400).json({ error: err.message?.includes('UNIQUE') ? `There is already a warehouse called ${name}` : err.message });
  }
});

// DELETE /warehouses/:id — removes the warehouse with its stock rows and upload history (never the last one)
router.delete('/warehouses/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Warehouse not found' }); return; }
  if ((db.prepare('SELECT COUNT(*) AS c FROM warehouses').get() as any).c <= 1) {
    res.status(400).json({ error: 'Keep at least one warehouse' });
    return;
  }
  db.transaction(() => {
    db.prepare('DELETE FROM warehouse_stock WHERE warehouse_id = ?').run(existing.id);
    db.prepare('DELETE FROM warehouse_stock_uploads WHERE warehouse_id = ?').run(existing.id);
    db.prepare('DELETE FROM warehouses WHERE id = ?').run(existing.id);
  })();
  notifyAdmin({ action: 'deleted', entity: 'Warehouse', label: existing.name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ deleted: existing.id });
});

// POST /missing-batches/add {batch_numbers: [...]} — the user chose to add flagged batch
// numbers to Batches (product = the stock description); nothing is added on upload
router.post('/missing-batches/add', (req: Request, res: Response) => {
  const wanted = (Array.isArray(req.body?.batch_numbers) ? req.body.batch_numbers : [])
    .map((b: unknown) => String(b ?? '').trim()).filter(Boolean);
  if (!wanted.length) { res.status(400).json({ error: 'No batch numbers given' }); return; }
  const missing = new Map(missingBatchesInStock(null).map(m => [m.batch_number.trim().toUpperCase(), m]));
  const added: string[] = [];
  for (const b of wanted) {
    const m = missing.get(b.toUpperCase());
    if (!m) continue; // already in Batches, or not in the stock
    db.prepare('INSERT OR IGNORE INTO batches (batch_number, product) VALUES (?, ?)').run(m.batch_number.trim(), m.description || null);
    added.push(m.batch_number.trim());
  }
  res.json({ added });
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

// POST /upload — multipart `file` (.csv or .xlsx) + `warehouse_id`: replaces that warehouse's stock
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const warehouseId = warehouseParam(req.body?.warehouse_id);
  const warehouse = warehouseId ? db.prepare('SELECT * FROM warehouses WHERE id = ?').get(warehouseId) as any : null;
  if (!warehouse) { res.status(400).json({ error: 'Choose the warehouse this stock belongs to' }); return; }

  try {
    const uploadedBy = (req as any).user?.display_name || 'Unknown';
    const meta = { filename: req.file.originalname, uploadedBy, source: 'manual' as const, warehouseId: warehouse.id };
    const isExcel = /\.xlsx$/i.test(req.file.originalname);
    if (/\.xls$/i.test(req.file.originalname)) {
      res.status(400).json({ error: 'Save the file as .xlsx (Excel workbook) or .csv and upload it again' });
      return;
    }
    const { inserted, missingBatches } = isExcel
      ? insertStockRows(await excelRows(req.file.buffer), meta)
      : parseAndInsertStockCsv(req.file.buffer.toString('utf-8'), meta);
    notifyAdmin({ action: 'created', entity: 'Warehouse Stock', label: `${warehouse.name}: ${inserted} rows from ${req.file.originalname}`, performedBy: uploadedBy, performedById: (req as any).user?.userId });
    res.json({ message: `Imported ${inserted} rows into ${warehouse.name}`, inserted, missingBatches, warehouse: warehouse.name });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
