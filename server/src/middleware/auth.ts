import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'erp-crm-secret-key-change-in-production';
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

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // Allow service-to-service calls via API key (for budget dashboard integration)
  const apiKey = req.headers['x-api-key'] as string;
  if (SERVICE_API_KEY && apiKey === SERVICE_API_KEY) {
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

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}
