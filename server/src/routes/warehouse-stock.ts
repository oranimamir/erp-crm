import { Router, Request, Response } from 'express';
import multer from 'multer';
import db from '../database.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET / — return stock aggregated by (article, pc) + upload history
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT
      MAX(principal)    as principal,
      article,
      MAX(searchname)   as searchname,
      MAX(description)  as description,
      SUM(stock)        as stock,
      MAX(pc)           as pc,
      SUM(gross_weight) as gross_weight,
      SUM(nett_weight)  as nett_weight
    FROM warehouse_stock
    GROUP BY article, pc
    ORDER BY MAX(description) ASC, article ASC
  `).all();

  const history = db.prepare(`
    SELECT id, uploaded_at, rows_imported, filename, uploaded_by
    FROM warehouse_stock_uploads
    ORDER BY uploaded_at DESC
    LIMIT 10
  `).all();

  res.json({ data: rows, history });
});

// POST /upload — replace all data from a semicolon-delimited CSV
router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const content = req.file.buffer.toString('utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    res.status(400).json({ error: 'File is empty or has no data rows' });
    return;
  }

  // Parse header row — detect delimiter
  const headerLine = lines[0];
  const delimiter = headerLine.includes(';') ? ';' : ',';
  const headers = headerLine.split(delimiter).map(h => h.toLowerCase().trim());

  const idx = {
    principal:    headers.indexOf('principal'),
    article:      headers.indexOf('article'),
    searchname:   headers.indexOf('searchname'),
    description:  headers.indexOf('description'),
    stock:        headers.indexOf('stock'),
    pc:           headers.indexOf('pc'),
    gross_weight: headers.indexOf('gross weight'),
    nett_weight:  headers.indexOf('nett weight'),
  };

  if (idx.article === -1) {
    res.status(400).json({ error: 'CSV missing required column "article". Check the file format.' });
    return;
  }

  const now = new Date().toISOString();
  const uploadedBy = (req as any).user?.display_name || 'Unknown';

  try {
    db.exec('DELETE FROM warehouse_stock');

    const insert = db.prepare(`
      INSERT INTO warehouse_stock (principal, article, searchname, description, stock, pc, gross_weight, nett_weight, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      if (cols.length < 2) continue;

      const article = cols[idx.article]?.trim();
      if (!article) continue;

      insert.run(
        idx.principal    >= 0 ? cols[idx.principal]?.trim()           || null : null,
        article,
        idx.searchname   >= 0 ? cols[idx.searchname]?.trim()          || null : null,
        idx.description  >= 0 ? cols[idx.description]?.trim()         || null : null,
        idx.stock        >= 0 ? parseInt(cols[idx.stock])              || 0   : 0,
        idx.pc           >= 0 ? cols[idx.pc]?.trim()                   || null : null,
        idx.gross_weight >= 0 ? parseFloat(cols[idx.gross_weight])     || null : null,
        idx.nett_weight  >= 0 ? parseFloat(cols[idx.nett_weight])      || null : null,
        now,
      );
      inserted++;
    }

    // Log this upload to history
    db.prepare(`
      INSERT INTO warehouse_stock_uploads (uploaded_at, rows_imported, filename, uploaded_by)
      VALUES (?, ?, ?, ?)
    `).run(now, inserted, req.file.originalname || null, uploadedBy);

    res.json({ message: `Imported ${inserted} rows`, inserted, uploadedAt: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
