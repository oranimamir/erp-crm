import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../database.js';

const router = Router();

// Admin-only middleware
function requireAdmin(req: Request, res: Response, next: Function) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// List users with pagination, search, role filter
router.get('/', requireAdmin, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const role = (req.query.role as string) || '';
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    conditions.push('(username LIKE ? OR display_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM users ${where}`).get(...params) as any).count;
  const users = db.prepare(
    `SELECT id, username, display_name, email, role, notify_on_changes, created_at, updated_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ data: users, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// Create user
router.post('/', requireAdmin, (req: Request, res: Response) => {
  const { username, display_name, email, password, role } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  if (role && !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'Role must be admin or user' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, display_name, email, role) VALUES (?, ?, ?, ?, ?)'
  ).run(username, password_hash, display_name || username, email || null, role || 'user');

  const user = db.prepare('SELECT id, username, display_name, email, role, notify_on_changes, created_at, updated_at FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

// Update user
router.put('/:id', requireAdmin, (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const { display_name, email, role, password } = req.body;

  if (role && !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'Role must be admin or user' });
    return;
  }
  if (password && password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  if (password) {
    const password_hash = bcrypt.hashSync(password, 10);
    db.prepare(
      `UPDATE users SET display_name=?, email=?, role=?, password_hash=?, updated_at=datetime('now') WHERE id=?`
    ).run(display_name || null, email || null, role || 'user', password_hash, req.params.id);
  } else {
    db.prepare(
      `UPDATE users SET display_name=?, email=?, role=?, updated_at=datetime('now') WHERE id=?`
    ).run(display_name || null, email || null, role || 'user', req.params.id);
  }

  const user = db.prepare('SELECT id, username, display_name, email, role, notify_on_changes, created_at, updated_at FROM users WHERE id = ?').get(req.params.id);
  res.json(user);
});

// Delete user
router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const userId = Number(req.params.id);

  if (userId === req.user?.userId) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ message: 'User deleted' });
});

// Toggle notify_on_changes for a user
router.patch('/:id/notify', requireAdmin, (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id, notify_on_changes FROM users WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'User not found' }); return; }
  const newValue = existing.notify_on_changes ? 0 : 1;
  db.prepare(`UPDATE users SET notify_on_changes = ?, updated_at = datetime('now') WHERE id = ?`).run(newValue, req.params.id);
  res.json({ notify_on_changes: newValue });
});

// ── Invite user ───────────────────────────────────────────────────────────────

router.post('/invite', requireAdmin, (req: Request, res: Response) => {
  const { email, display_name, role } = req.body;

  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }
  if (role && !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'Role must be admin or user' });
    return;
  }

  // Check for existing pending invite
  const existingInvite = db.prepare(
    'SELECT id FROM user_invitations WHERE email = ? AND accepted_at IS NULL AND expires_at > datetime(?)'
  ).get(email, new Date().toISOString());
  if (existingInvite) {
    res.status(409).json({ error: 'A pending invitation already exists for this email' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const result = db.prepare(
    'INSERT INTO user_invitations (email, display_name, role, token, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(email, display_name || null, role || 'user', token, req.user!.userId, expiresAt);

  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
  const inviteLink = `${appUrl}/accept-invite?token=${token}`;

  const invitation = db.prepare('SELECT * FROM user_invitations WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...invitation, invite_link: inviteLink });
});

// ── List invitations ──────────────────────────────────────────────────────────

router.get('/invitations', requireAdmin, (_req: Request, res: Response) => {
  const invitations = db.prepare(
    `SELECT ui.*, u.display_name as invited_by_name
     FROM user_invitations ui
     LEFT JOIN users u ON ui.invited_by = u.id
     ORDER BY ui.created_at DESC`
  ).all();
  res.json(invitations);
});

// ── Revoke invitation ─────────────────────────────────────────────────────────

router.delete('/invitations/:id', requireAdmin, (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM user_invitations WHERE id = ? AND accepted_at IS NULL').run(Number(req.params.id));
  if (result.changes === 0) {
    res.status(404).json({ error: 'Invitation not found or already accepted' });
    return;
  }
  res.json({ message: 'Invitation revoked' });
});

export default router;
