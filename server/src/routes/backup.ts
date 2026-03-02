import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createBackupArchive, listBackups, getBackupsDir } from '../lib/backup.js';

const router = Router();

// GET /api/backup — stream a fresh full backup ZIP (DB + all uploads)
router.get('/', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="erp-backup-${timestamp}.zip"`);
    await createBackupArchive(res);
  } catch (err) {
    console.error('[Backup] Download error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create backup' });
  }
});

// GET /api/backup/list — list saved weekly backups
router.get('/list', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  res.json(listBackups());
});

// GET /api/backup/download/:filename — download a saved weekly backup
router.get('/download/:filename', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const { filename } = req.params;
  // Only allow our own backup filenames to prevent path traversal
  if (!/^erp-backup-[\dT-]+\.zip$/.test(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filepath = path.join(getBackupsDir(), filename);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }
  res.download(filepath, filename);
});

export default router;
