import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createBackupArchive, listBackups, getBackupsDir } from '../lib/backup.js';
import { buildCronExpr, startBackupScheduler, BackupSchedule } from '../lib/backup-scheduler.js';
import db from '../database.js';

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

// GET /api/backup/schedule — return current backup schedule
router.get('/schedule', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'backup_schedule'").get() as any;
  const sched = row ? JSON.parse(row.value) : { frequency: 'weekly', day: 0, hour: 2, minute: 0 };
  res.json(sched);
});

// PUT /api/backup/schedule — update backup schedule
router.put('/schedule', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const { frequency, day, hour, minute } = req.body;
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
    res.status(400).json({ error: 'frequency must be daily, weekly, or monthly' });
    return;
  }
  const h = Number(hour);
  const m = Number(minute ?? 0);
  const d = Number(day ?? 0);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    res.status(400).json({ error: 'hour must be 0-23, minute must be 0-59' });
    return;
  }
  if (frequency === 'weekly' && (d < 0 || d > 6)) {
    res.status(400).json({ error: 'day must be 0-6 for weekly schedule' });
    return;
  }
  if (frequency === 'monthly' && (d < 1 || d > 28)) {
    res.status(400).json({ error: 'day must be 1-28 for monthly schedule' });
    return;
  }

  const sched: BackupSchedule = { frequency, day: d, hour: h, minute: m };
  const expr = buildCronExpr(sched);
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('backup_schedule', ?, datetime('now'))"
  ).run(JSON.stringify(sched));
  startBackupScheduler(expr);
  res.json({ ok: true, expression: expr });
});

export default router;
