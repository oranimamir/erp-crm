import { Router, Request, Response } from 'express';
import db from '../database.js';
import { getAiMonthlyLimit, setAiMonthlyLimit, aiSpentThisMonth } from '../lib/aiBudget.js';

/**
 * App-wide settings edited on the Settings page. For now: the default
 * recipients pre-filled when an invoice or a packing list is emailed.
 */

const router = Router();

type Recipients = { to: string[]; cc: string[] };
export interface DocumentEmails { invoice: Recipients; packing_list: Recipients }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function list(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/);
  return [...new Set(parts.map(v => String(v).trim()).filter(Boolean))];
}

function normalize(raw: any): DocumentEmails {
  const pick = (r: any): Recipients => ({
    to: list(r?.to).filter(e => EMAIL_RE.test(e)),
    cc: list(r?.cc).filter(e => EMAIL_RE.test(e)),
  });
  return { invoice: pick(raw?.invoice), packing_list: pick(raw?.packing_list) };
}

export function getDocumentEmails(): DocumentEmails {
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'document_emails'`).get() as any;
    return normalize(row ? JSON.parse(row.value) : null);
  } catch {
    return normalize(null);
  }
}

// GET /api/settings/document-emails — everyone signed in (the email dialogs read it)
router.get('/document-emails', (_req: Request, res: Response) => {
  res.json(getDocumentEmails());
});

// PUT /api/settings/document-emails — admin only
router.put('/document-emails', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const body = req.body || {};
  const typed = [body.invoice?.to, body.invoice?.cc, body.packing_list?.to, body.packing_list?.cc].flatMap(list);
  const invalid = typed.filter(e => !EMAIL_RE.test(e));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.join(', ')}` }); return; }

  const value = normalize(body);
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('document_emails', ?, datetime('now'))")
    .run(JSON.stringify(value));
  res.json(value);
});

// GET /api/settings/ai-limit — monthly AI spending limit for invoice reading, and this month's spend
router.get('/ai-limit', (_req: Request, res: Response) => {
  const limit = getAiMonthlyLimit(), spent = aiSpentThisMonth();
  res.json({ monthly_usd: limit, spent_usd: Math.round(spent * 100) / 100, left_usd: Math.max(0, Math.round((limit - spent) * 100) / 100) });
});

// PUT /api/settings/ai-limit — admin only
router.put('/ai-limit', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const n = Number(req.body?.monthly_usd);
  if (!isFinite(n) || n < 0 || n > 10000) { res.status(400).json({ error: 'Enter an amount between 0 and 10000' }); return; }
  setAiMonthlyLimit(n);
  const spent = aiSpentThisMonth();
  res.json({ monthly_usd: n, spent_usd: Math.round(spent * 100) / 100, left_usd: Math.max(0, Math.round((n - spent) * 100) / 100) });
});

export default router;
