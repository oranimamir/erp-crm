import { Router } from 'express';
import archiver from 'archiver';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'erp.db');
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');

// GET /api/backup — admin only, streams a ZIP of DB + all uploaded files
router.get('/', (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `erp-backup-${timestamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('error', err => {
    console.error('Backup archive error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed' });
  });

  archive.pipe(res);

  // Add database file
  if (fs.existsSync(dbPath)) {
    archive.file(dbPath, { name: 'database/erp.db' });
  }

  // Add all uploaded files
  if (fs.existsSync(uploadsBase)) {
    archive.directory(uploadsBase, 'uploads');
  }

  archive.finalize();
});

export default router;
