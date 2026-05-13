import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import db from '../database.js';
import { cellText, cellNumber, normalizeLabel, derivePeriodMonth } from '../lib/excel-helpers.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'net-salaries');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.xlsx';
    cb(null, `salary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') cb(null, true);
    else cb(new Error('Only Excel (.xlsx/.xls/.xlsm) files are allowed'));
  },
});

// ─── PARSER ───────────────────────────────────────────────────────────────────

interface ParsedSalaryRow {
  employee_name: string;
  net_amount: number;
}

interface ParsedSalarySheet {
  rows: ParsedSalaryRow[];
  detected_month: string | null;
  total: number;
}

async function parseSalarySheet(filePath: string): Promise<ParsedSalarySheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excel file has no worksheets');

  const maxRow = Math.min(ws.rowCount, 500);
  const maxCol = Math.min(ws.columnCount, 30);

  let nameCol = -1;
  let amountCol = -1;
  let headerRow = -1;
  let detectedMonth: string | null = null;

  // Scan for month/period anywhere in the sheet (first 20 rows)
  for (let r = 1; r <= Math.min(maxRow, 20); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const raw = row.getCell(c).value;
      if (!detectedMonth) {
        const m = derivePeriodMonth(raw);
        if (m) detectedMonth = m;
      }
    }
  }

  // Find header row with name + amount columns
  const namePatterns = ['name', 'employee', 'employee name', 'werknemer', 'naam'];
  const amountPatterns = ['net', 'netto', 'net amount', 'net salary', 'net pay', 'amount', 'salary', 'bedrag', 'nettoloon'];

  for (let r = 1; r <= Math.min(maxRow, 30); r++) {
    const row = ws.getRow(r);
    let foundName = -1;
    let foundAmount = -1;

    for (let c = 1; c <= maxCol; c++) {
      const label = normalizeLabel(cellText(row.getCell(c).value));
      if (!label) continue;
      if (foundName < 0 && namePatterns.some(p => label.includes(p))) foundName = c;
      if (foundAmount < 0 && amountPatterns.some(p => label.includes(p))) foundAmount = c;
    }

    if (foundName > 0 && foundAmount > 0) {
      nameCol = foundName;
      amountCol = foundAmount;
      headerRow = r;
      break;
    }
  }

  if (headerRow < 0) throw new Error('Could not find header row with employee name and amount columns');

  const rows: ParsedSalaryRow[] = [];
  for (let r = headerRow + 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell(nameCol).value).trim();
    const amount = cellNumber(row.getCell(amountCol).value);
    if (!name || amount == null || amount <= 0) continue;
    rows.push({ employee_name: name, net_amount: Math.round(amount * 100) / 100 });
  }

  const total = Math.round(rows.reduce((s, r) => s + r.net_amount, 0) * 100) / 100;
  return { rows, detected_month: detectedMonth, total };
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// POST /api/net-salaries/upload
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const existing = db.prepare('SELECT id, original_filename FROM net_salary_uploads WHERE file_hash = ?').get(fileHash) as any;
    if (existing) {
      fs.unlinkSync(file.path);
      res.status(409).json({ error: `Duplicate file — already uploaded as "${existing.original_filename}"` });
      return;
    }

    const parsed = await parseSalarySheet(file.path);
    if (parsed.rows.length === 0) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: 'No salary rows found in the file' });
      return;
    }

    const month = (req.body.month as string) || parsed.detected_month;
    if (!month) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: 'Could not detect month from file. Please provide a month parameter (YYYY-MM).' });
      return;
    }

    const user = (req as any).user;
    const uploadResult = db.prepare(`
      INSERT INTO net_salary_uploads (original_filename, stored_filename, month, employee_count, total_amount, file_hash, file_size, uploaded_by, uploaded_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      file.originalname, file.filename, month,
      parsed.rows.length, parsed.total, fileHash, file.size,
      user?.userId || null, user?.display_name || ''
    );

    const uploadId = uploadResult.lastInsertRowid;

    for (const row of parsed.rows) {
      db.prepare('INSERT INTO net_salaries (upload_id, employee_name, net_amount, currency, month) VALUES (?, ?, ?, ?, ?)')
        .run(uploadId, row.employee_name, row.net_amount, 'EUR', month);
    }

    db.saveToDisk();

    res.json({
      upload: {
        id: uploadId,
        original_filename: file.originalname,
        month,
        employee_count: parsed.rows.length,
        total_amount: parsed.total,
        uploaded_at: new Date().toISOString(),
      },
      rows: parsed.rows,
    });
  } catch (err: any) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('[net-salaries] upload error:', err);
    res.status(400).json({ error: err.message || 'Failed to process salary file' });
  }
});

// GET /api/net-salaries — list salary rows
router.get('/', (req: Request, res: Response) => {
  try {
    const { month, employee, upload_id } = req.query as Record<string, string>;
    const where: string[] = [];
    const params: any[] = [];
    if (month) { where.push('ns.month = ?'); params.push(month); }
    if (employee) { where.push('LOWER(ns.employee_name) LIKE ?'); params.push(`%${employee.toLowerCase()}%`); }
    if (upload_id) { where.push('ns.upload_id = ?'); params.push(upload_id); }

    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`
      SELECT ns.*, u.original_filename as upload_filename
      FROM net_salaries ns
      LEFT JOIN net_salary_uploads u ON ns.upload_id = u.id
      ${w}
      ORDER BY ns.month DESC, ns.employee_name ASC
    `).all(...params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch net salaries' });
  }
});

// GET /api/net-salaries/uploads — list upload batches
router.get('/uploads', (req: Request, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    let sql = 'SELECT * FROM net_salary_uploads';
    const params: any[] = [];
    if (month) { sql += ' WHERE month = ?'; params.push(month); }
    sql += ' ORDER BY month DESC, uploaded_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// GET /api/net-salaries/summary — monthly totals
router.get('/summary', (_req: Request, res: Response) => {
  try {
    const data = db.prepare(`
      SELECT month, SUM(net_amount) as total, COUNT(*) as employee_count
      FROM net_salaries
      GROUP BY month
      ORDER BY month DESC
    `).all();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// DELETE /api/net-salaries/uploads/:id
router.delete('/uploads/:id', (req: Request, res: Response) => {
  try {
    const upload = db.prepare('SELECT * FROM net_salary_uploads WHERE id = ?').get(req.params.id) as any;
    if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

    // Delete the stored file
    const filePath = path.join(uploadsDir, upload.stored_filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.prepare('DELETE FROM net_salaries WHERE upload_id = ?').run(req.params.id);
    db.prepare('DELETE FROM net_salary_uploads WHERE id = ?').run(req.params.id);
    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete upload' });
  }
});

// GET /api/net-salaries/uploads/:id/file — download original
router.get('/uploads/:id/file', (req: Request, res: Response) => {
  try {
    const upload = db.prepare('SELECT original_filename, stored_filename FROM net_salary_uploads WHERE id = ?').get(req.params.id) as any;
    if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }
    const filePath = path.join(uploadsDir, upload.stored_filename);
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }
    res.download(filePath, upload.original_filename);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to download file' });
  }
});

export default router;
