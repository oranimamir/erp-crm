import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../database.js';
import { archiveDir } from '../lib/archive.js';
import { notifyAdmin } from '../lib/notify.js';

/** Archive tab: files users deleted or replaced (lib/archive.ts). Everyone reads; an admin deletes for good. */
const router = Router();
const SAFE = /^[a-zA-Z0-9._-]+$/;

// GET /api/archive?search=&section=&page=&limit=
router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit)) || 50));
  const conditions: string[] = [];
  const params: any[] = [];
  const search = String(req.query.search || '').trim();
  if (search) {
    conditions.push('(file_name LIKE ? OR context LIKE ? OR deleted_by_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const section = String(req.query.section || '').trim();
  if (section) { conditions.push('section = ?'); params.push(section); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM archived_files ${where}`).get(...params) as any).n;
  const data = db.prepare(`SELECT * FROM archived_files ${where} ORDER BY deleted_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  const sections = (db.prepare('SELECT section, COUNT(*) AS count FROM archived_files GROUP BY section ORDER BY section').all() as any[]);
  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit), sections });
});

// DELETE /api/archive/:id — removes the file for good (admin)
router.delete('/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const row = db.prepare('SELECT * FROM archived_files WHERE id = ?').get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  if (SAFE.test(row.stored_name)) {
    const full = path.join(archiveDir, row.stored_name);
    if (fs.existsSync(full)) { try { fs.unlinkSync(full); } catch { /* best effort */ } }
  }
  db.prepare('DELETE FROM archived_files WHERE id = ?').run(row.id);
  db.saveToDisk();
  notifyAdmin({ action: 'deleted', entity: 'Archived file', label: `${row.file_name} (${row.section})`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ ok: true });
});

export default router;
