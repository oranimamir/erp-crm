import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../database.js';
import { authenticateToken, generateToken } from '../middleware/auth.js';
import { sendOtpEmail, notifyAdmin } from '../lib/notify.js';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // 2FA required for all users — block login if no email set
  if (!user.email) {
    res.status(403).json({ error: 'Your account does not have an email address set. Please contact an administrator to enable login.' });
    return;
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO login_otps (user_id, code, expires_at) VALUES (?, ?, ?)`).run(user.id, code, expiresAt);
  try {
    await sendOtpEmail(user.email, code);
  } catch (err: any) {
    console.error('[auth] OTP send failed:', err?.message || err);
    res.status(503).json({ error: 'Failed to send login code. Please contact an administrator.' });
    return;
  }
  res.json({ step: 'otp', user_id: user.id });
});

router.post('/verify-otp', (req: Request, res: Response) => {
  const { user_id, code } = req.body;
  if (!user_id || !code) {
    res.status(400).json({ error: 'user_id and code are required' });
    return;
  }

  const otp = db.prepare(
    `SELECT * FROM login_otps WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`
  ).get(user_id, code) as any;

  if (!otp) {
    res.status(401).json({ error: 'Invalid or expired code' });
    return;
  }

  db.prepare(`UPDATE login_otps SET used = 1 WHERE id = ?`).run(otp.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id) as any;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const token = generateToken({ userId: user.id, username: user.username, display_name: user.display_name || user.username, role: user.role });
  notifyAdmin({ action: 'logged in', entity: 'User', label: user.display_name || user.username, performedBy: user.display_name || user.username });
  res.json({
    token,
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
  });
});

router.post('/register', (req: Request, res: Response) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) {
    res.status(400).json({ error: 'Username, password, and display_name are required' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)').run(
    username, hash, display_name
  );

  const token = generateToken({ userId: result.lastInsertRowid as number, username, display_name, role: 'user' });
  res.status(201).json({
    token,
    user: { id: result.lastInsertRowid, username, display_name, role: 'user' },
  });
});

router.get('/me', authenticateToken, (req: Request, res: Response) => {
  const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(req.user!.userId) as any;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// Get invitation info (public)
router.get('/invite-info', (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(400).json({ error: 'Token is required' });
    return;
  }

  const invitation = db.prepare(
    'SELECT id, email, display_name, role, expires_at, accepted_at FROM user_invitations WHERE token = ?'
  ).get(token) as any;

  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  if (invitation.accepted_at) {
    res.status(410).json({ error: 'This invitation has already been used' });
    return;
  }
  if (new Date(invitation.expires_at) < new Date()) {
    res.status(410).json({ error: 'This invitation has expired' });
    return;
  }

  res.json({ email: invitation.email, display_name: invitation.display_name, role: invitation.role });
});

// Accept invitation (public)
router.post('/accept-invite', (req: Request, res: Response) => {
  const { token, username, password, display_name } = req.body;

  if (!token || !username || !password) {
    res.status(400).json({ error: 'Token, username, and password are required' });
    return;
  }
  if (password.length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  const invitation = db.prepare(
    'SELECT * FROM user_invitations WHERE token = ?'
  ).get(token) as any;

  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  if (invitation.accepted_at) {
    res.status(410).json({ error: 'This invitation has already been used' });
    return;
  }
  if (new Date(invitation.expires_at) < new Date()) {
    res.status(410).json({ error: 'This invitation has expired' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const finalDisplayName = display_name || invitation.display_name || username;
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, finalDisplayName, invitation.role || 'user', invitation.email);

  // Mark invitation as accepted
  db.prepare(
    "UPDATE user_invitations SET accepted_at = datetime('now') WHERE id = ?"
  ).run(invitation.id);

  const jwtToken = generateToken({
    userId: result.lastInsertRowid as number,
    username,
    display_name: finalDisplayName,
    role: invitation.role || 'user',
  });

  res.status(201).json({
    token: jwtToken,
    user: {
      id: result.lastInsertRowid,
      username,
      display_name: finalDisplayName,
      role: invitation.role || 'user',
    },
  });
});

router.post('/resend-otp', async (req: Request, res: Response) => {
  const { user_id } = req.body;
  if (!user_id) {
    res.status(400).json({ error: 'user_id is required' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id) as any;
  if (!user || !user.email) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Rate-limit: don't allow resend if a valid OTP was issued in the last 60 seconds
  const recent = db.prepare(
    `SELECT id FROM login_otps WHERE user_id = ? AND used = 0 AND expires_at > datetime('now') AND created_at > datetime('now', '-60 seconds') LIMIT 1`
  ).get(user_id);
  if (recent) {
    res.status(429).json({ error: 'Please wait before requesting a new code' });
    return;
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO login_otps (user_id, code, expires_at) VALUES (?, ?, ?)`).run(user.id, code, expiresAt);

  try {
    await sendOtpEmail(user.email, code);
  } catch (err: any) {
    console.error('[auth] OTP resend failed:', err?.message || err);
    res.status(503).json({ error: 'Failed to send login code. Please contact an administrator.' });
    return;
  }

  res.json({ ok: true });
});

router.post('/change-password', authenticateToken, (req: Request, res: Response) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    res.status(400).json({ error: 'Current password and new password are required' });
    return;
  }
  if (new_password.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as any;
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, req.user!.userId);
  res.json({ message: 'Password changed successfully' });
});

export default router;
