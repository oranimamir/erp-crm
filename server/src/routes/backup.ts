import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'erp.db');

// GET /api/backup — admin only, streams the SQLite database file
router.get('/', (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  if (!fs.existsSync(dbPath)) {
    res.status(404).json({ error: 'Database file not found' });
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `erp-backup-${timestamp}.db`;
  const stats = fs.statSync(dbPath);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stats.size);

  fs.createReadStream(dbPath).pipe(res);
});

export default router;
