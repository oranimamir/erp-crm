import { Router, Request, Response } from 'express';
import db from '../database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// GET /api/notifications — recent activity for users with notify_on_changes = 1
router.get('/', authenticateToken, (req: Request, res: Response) => {
  const user = db.prepare(
    'SELECT notify_on_changes, notifications_last_read_at FROM users WHERE id = ?'
  ).get(req.user!.userId) as any;

  if (!user || !user.notify_on_changes) {
    res.json({ items: [], unread_count: 0, last_read_at: null });
    return;
  }

  const lastRead = user.notifications_last_read_at as string | null;

  const items = db.prepare(`
    SELECT id, entity, action, label, performed_by, created_at
    FROM activity_log
    ORDER BY created_at DESC
    LIMIT 50
  `).all() as any[];

  const unread_count = lastRead
    ? (db.prepare(`SELECT COUNT(*) as c FROM activity_log WHERE created_at > ?`).get(lastRead) as any).c
    : items.length;

  res.json({ items, unread_count, last_read_at: lastRead });
});

// POST /api/notifications/read — mark all notifications as read
router.post('/read', authenticateToken, (req: Request, res: Response) => {
  db.prepare(`UPDATE users SET notifications_last_read_at = datetime('now') WHERE id = ?`).run(req.user!.userId);
  res.json({ ok: true });
});

export default router;
