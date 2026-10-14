import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../database.js';
import { requestUser } from '../lib/archive.js';

// If JWT_SECRET isn't set we fall back to an ephemeral random secret for the
// lifetime of this process — never a hardcoded constant. Production is
// guarded by the fail-fast check in index.ts, so this only matters in dev,
// where it means tokens are invalidated on restart (an acceptable tradeoff
// versus a shared default).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const SERVICE_API_KEY = process.env.SERVICE_API_KEY || '';

export interface AuthPayload {
  userId: number;
  username: string;
  display_name: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // Allow service-to-service calls via API key (for budget dashboard integration)
  const apiKey = req.headers['x-api-key'];
  if (SERVICE_API_KEY && typeof apiKey === 'string' && safeEqual(apiKey, SERVICE_API_KEY)) {
    req.user = { userId: 0, username: 'service', display_name: 'Budget Dashboard', role: 'admin' };
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let decoded: AuthPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  // A login challenge (password checked, code not yet) is never a session
  if ((decoded as any).purpose) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // The token only proves who the caller was when it was issued. A deleted
  // user must lose access at once, and a role change must apply at once, so
  // identity and role are read from the users table on every request.
  const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(decoded.userId) as any;
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.user = { userId: user.id, username: user.username, display_name: user.display_name || user.username, role: user.role };
  // Lets deep helpers (e.g. the archive) know who is acting
  requestUser.run({ id: user.id, name: req.user.display_name }, () => next());
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
}

/**
 * Proof that the password was right, handed out by /login and required by
 * /verify-otp and /resend-otp. Without it the code step could be reached with
 * a bare user id, leaving the 6-digit code as the only factor.
 */
export function generateOtpChallenge(userId: number): string {
  return jwt.sign({ purpose: 'otp', otp_user: userId }, JWT_SECRET, { expiresIn: '15m', algorithm: 'HS256' });
}

export function otpChallengeValid(challenge: unknown, userId: unknown): boolean {
  if (typeof challenge !== 'string' || !challenge) return false;
  try {
    const d = jwt.verify(challenge, JWT_SECRET, { algorithms: ['HS256'] }) as any;
    return d?.purpose === 'otp' && Number(d.otp_user) === Number(userId);
  } catch {
    return false;
  }
}
