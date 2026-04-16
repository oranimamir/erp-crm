import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import db from '../database.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'employee-expenses');
fs.mkdirSync(uploadsDir, { recursive: true });

// One-time backfill: compute file_hash for legacy rows missing it
try {
  const rows = db.prepare(
    `SELECT id, stored_filename FROM employee_expenses WHERE file_hash IS NULL`
  ).all() as any[];
  let updated = 0;
  for (const r of rows) {
    const full = path.join(uploadsDir, r.stored_filename);
    if (!fs.existsSync(full)) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    try {
      db.prepare(`UPDATE employee_expenses SET file_hash = ? WHERE id = ?`).run(hash, r.id);
      updated++;
    } catch { /* duplicate hash on legacy row — leave null */ }
  }
  if (updated > 0) {
    db.saveToDisk();
    console.log(`[employee-expenses] Backfilled file_hash for ${updated} rows`);
  }
} catch (err) {
  console.warn('[employee-expenses] hash backfill failed:', err);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.xlsx';
    cb(null, `expense-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
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

interface ParsedExpense {
  employee_name: string;
  period_label: string;
  period_month: string | null;
  total_amount: number;
}

function cellText(v: any): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    // ExcelJS rich text / hyperlink / formula result
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink ?? '');
  }
  return String(v);
}

function cellNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'object' && 'result' in v && typeof v.result === 'number') return v.result;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.,\-]/g, '').replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }
  return null;
}

function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/[:：\s]+$/, '');
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function derivePeriodMonth(raw: any): string | null {
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  const s = cellText(raw).toLowerCase();
  if (!s) return null;
  // YYYY-MM or YYYY/MM
  let m = s.match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  // YYYYMM (e.g. 202603)
  m = s.match(/(\d{4})(\d{2})/);
  if (m) {
    const mm = parseInt(m[2], 10);
    if (mm >= 1 && mm <= 12) return `${m[1]}-${m[2]}`;
  }
  // "jan 2026" / "january 2026" / "jan-feb 2026"
  m = s.match(/([a-z]{3,9})[\s\-/]*\d{0,2}[\s\-/]*(\d{4})/);
  if (m) {
    const monKey = m[1].slice(0, 3);
    if (MONTHS[monKey]) return `${m[2]}-${String(MONTHS[monKey]).padStart(2, '0')}`;
  }
  return null;
}

async function parseExpenseNote(filePath: string): Promise<ParsedExpense> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excel file has no worksheets');

  let employee = '';
  let periodRaw: any = '';
  let periodLabel = '';
  let lastTotalRow = -1;
  let lastTotalCol = -1;

  const maxRow = Math.min(ws.rowCount, 200);
  const maxCol = Math.min(ws.columnCount, 20);

  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      const text = cellText(cell.value);
      if (!text) continue;
      const label = normalizeLabel(text);

      if (!employee && (label === 'name' || label === 'employee' || label === 'employee name')) {
        for (let nc = c + 1; nc <= maxCol; nc++) {
          const v = cellText(row.getCell(nc).value).trim();
          if (v) { employee = v; break; }
        }
      }

      if (!periodLabel && (label === 'period' || label === 'month' || label === 'trip')) {
        for (let nc = c + 1; nc <= maxCol; nc++) {
          const raw = row.getCell(nc).value;
          const v = cellText(raw).trim();
          if (v) { periodRaw = raw; periodLabel = v; break; }
        }
      }

      if (label === 'total' || label === 'grand total') {
        lastTotalRow = r;
        lastTotalCol = c;
      }
    }
  }

  let total = 0;
  if (lastTotalRow > 0) {
    const row = ws.getRow(lastTotalRow);
    for (let nc = lastTotalCol + 1; nc <= maxCol; nc++) {
      const n = cellNumber(row.getCell(nc).value);
      if (n != null) { total = n; break; }
    }
  }

  // Fallback: if no employee found, use filename hint
  if (!employee) {
    const base = path.basename(filePath, path.extname(filePath));
    employee = base.replace(/^expense\s*note\s*/i, '').replace(/\d{4,}/g, '').replace(/[_\-]/g, ' ').trim() || 'Unknown';
  }

  return {
    employee_name: employee,
    period_label: periodLabel,
    period_month: derivePeriodMonth(periodRaw) || derivePeriodMonth(periodLabel),
    total_amount: Math.round(total * 100) / 100,
  };
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/employee-expenses — list (optional filters)
router.get('/', (req: Request, res: Response) => {
  const { employee, month, search } = req.query as Record<string, string>;
  const where: string[] = [];
  const params: any[] = [];
  if (employee) { where.push('employee_name = ?'); params.push(employee); }
  if (month) { where.push('period_month = ?'); params.push(month); }
  if (search) {
    where.push('(employee_name LIKE ? OR period_label LIKE ? OR original_filename LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const sql = `
    SELECT id, employee_name, period_label, period_month, total_amount, currency,
           original_filename, file_size, uploaded_by_name, uploaded_at
    FROM employee_expenses
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(period_month, '') DESC, uploaded_at DESC
  `;
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/employee-expenses/employees — distinct employees
router.get('/employees', (_req: Request, res: Response) => {
  const rows = db.prepare(
    `SELECT employee_name, COUNT(*) as count, SUM(total_amount) as total
     FROM employee_expenses
     GROUP BY employee_name
     ORDER BY employee_name`
  ).all();
  res.json(rows);
});

// POST /api/employee-expenses — upload a new expense note
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  try {
    // Hash the uploaded file — reject if we've seen identical bytes before
    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const existing = db.prepare(
      `SELECT id, employee_name, period_label, original_filename, uploaded_at
       FROM employee_expenses WHERE file_hash = ?`
    ).get(fileHash) as any;

    if (existing) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      res.status(409).json({
        error: `Duplicate file — already uploaded as "${existing.original_filename}" (${existing.employee_name}, ${existing.period_label || existing.uploaded_at})`,
        duplicate: existing,
      });
      return;
    }

    const parsed = await parseExpenseNote(file.path);

    // Allow client override of employee / period
    const employee = (req.body.employee_name as string)?.trim() || parsed.employee_name;
    const periodLabel = (req.body.period_label as string)?.trim() || parsed.period_label;
    const periodMonth = (req.body.period_month as string)?.trim() || parsed.period_month || null;
    const totalOverride = req.body.total_amount != null && req.body.total_amount !== ''
      ? parseFloat(req.body.total_amount) : null;
    const total = totalOverride != null && isFinite(totalOverride) ? totalOverride : parsed.total_amount;

    const result = db.prepare(`
      INSERT INTO employee_expenses
        (employee_name, period_label, period_month, total_amount, currency,
         original_filename, stored_filename, file_size, file_hash, uploaded_by, uploaded_by_name)
      VALUES (?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?)
    `).run(
      employee,
      periodLabel,
      periodMonth,
      total,
      file.originalname,
      path.basename(file.path),
      file.size,
      fileHash,
      req.user?.userId ?? null,
      req.user?.display_name ?? req.user?.username ?? '',
    );

    db.saveToDisk();

    const row = db.prepare(`SELECT * FROM employee_expenses WHERE id = ?`).get(result.lastInsertRowid);
    res.json({ expense: row, parsed });
  } catch (err: any) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    console.error('[employee-expenses] parse failed:', err?.message || err);
    res.status(400).json({ error: `Could not parse expense note: ${err?.message || 'unknown error'}` });
  }
});

// GET /api/employee-expenses/:id/file — download original
router.get('/:id/file', (req: Request, res: Response) => {
  const row = db.prepare(
    `SELECT stored_filename, original_filename FROM employee_expenses WHERE id = ?`
  ).get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  const full = path.join(uploadsDir, row.stored_filename);
  if (!fs.existsSync(full)) { res.status(404).json({ error: 'File missing' }); return; }
  res.download(full, row.original_filename);
});

// PATCH /api/employee-expenses/:id — edit metadata
router.patch('/:id', (req: Request, res: Response) => {
  const row = db.prepare(`SELECT id FROM employee_expenses WHERE id = ?`).get(req.params.id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const allowed = ['employee_name', 'period_label', 'period_month', 'total_amount'] as const;
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      fields.push(`${f} = ?`);
      params.push(f === 'total_amount' ? parseFloat(req.body[f]) : req.body[f]);
    }
  }
  if (!fields.length) { res.json({ ok: true }); return; }
  params.push(req.params.id);
  db.prepare(`UPDATE employee_expenses SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  db.saveToDisk();
  const updated = db.prepare(`SELECT * FROM employee_expenses WHERE id = ?`).get(req.params.id);
  res.json(updated);
});

// DELETE /api/employee-expenses/:id
router.delete('/:id', (req: Request, res: Response) => {
  const row = db.prepare(
    `SELECT stored_filename FROM employee_expenses WHERE id = ?`
  ).get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  try { fs.unlinkSync(path.join(uploadsDir, row.stored_filename)); } catch { /* ignore */ }
  db.prepare(`DELETE FROM employee_expenses WHERE id = ?`).run(req.params.id);
  db.saveToDisk();
  res.json({ ok: true });
});

export default router;
