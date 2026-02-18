import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../database.js';
import { authenticateToken, generateToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', (req: Request, res: Response) => {
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

  const token = generateToken({ userId: user.id, username: user.username, role: user.role });
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

  const token = generateToken({ userId: result.lastInsertRowid as number, username, role: 'user' });
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
  if (password.length < 4) {
    res.status(400).json({ error: 'Password must be at least 4 characters' });
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

export default router;
