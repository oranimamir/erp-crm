import { Router, Request, Response } from 'express';
import db from '../database.js';
import { getAiMonthlyLimit, setAiMonthlyLimit, aiSpentThisMonth } from '../lib/aiBudget.js';
import { todayISO } from '../lib/today.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { signaturesDir, signatureFileOf } from '../lib/poApproval.js';
import { archiveStored, archivedBy } from '../lib/archive.js';
import { getPaymentNotifySettings, setPaymentNotifySettings, normalizePaymentNotify, sendPaymentReceivedEmail } from '../lib/paymentEmail.js';
import { getOperationNotifySettings, setOperationNotifySettings, normalizeOperationNotify, getNotificationMutes, normalizeMutes, setMutesForRecipient } from '../lib/notify.js';

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

// GET /api/settings/ai-limit — monthly AI spending limit for invoice reading, and this month's spend (admin only)
router.get('/ai-limit', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
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

// GET /api/settings/operation-notifications — who is emailed when an operation changes (admin only)
router.get('/operation-notifications', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  res.json({ ...getOperationNotifySettings(), email_configured: !!process.env.RESEND_API_KEY });
});

// PUT /api/settings/operation-notifications — admin only
router.put('/operation-notifications', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const body = req.body || {};
  const invalid = list(body.recipients).filter(e => !EMAIL_RE.test(e));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.join(', ')}` }); return; }
  const value = normalizeOperationNotify(body);
  if (value.enabled && !value.recipients.length) { res.status(400).json({ error: 'Add at least one recipient' }); return; }
  setOperationNotifySettings(value);
  res.json({ ...value, email_configured: !!process.env.RESEND_API_KEY });
});

// GET /api/settings/payment-notifications — who is emailed when a customer wire transfer is uploaded (admin)
router.get('/payment-notifications', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  res.json({ ...getPaymentNotifySettings(), email_configured: !!process.env.RESEND_API_KEY });
});

// PUT /api/settings/payment-notifications {recipients: ['user:<id>' | 'email:<addr>']} — admin only
router.put('/payment-notifications', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const raw = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const invalid = raw.map((r: any) => String(r ?? '')).filter((r: string) => r.startsWith('email:') && !EMAIL_RE.test(r.slice(6)));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.map((r: string) => r.slice(6)).join(', ')}` }); return; }
  const value = normalizePaymentNotify(req.body);
  setPaymentNotifySettings(value);
  res.json({ ...value, email_configured: !!process.env.RESEND_API_KEY });
});

// POST /api/settings/payment-notifications/test — a sample payment email to the saved recipients
router.post('/payment-notifications/test', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const result = await sendPaymentReceivedEmail({
    customerName: 'Test Customer (sample)', invoiceNumber: 'TEST-0001', operationNumber: null, operationId: null,
    amount: 12345.67, currency: 'USD', eurAmount: 11400, paymentDate: todayISO(),
    bankReference: 'This is a test email', recordedBy: req.user?.display_name || null, wireFilePath: null, wireFileName: null,
  });
  res.status(result.ok ? 200 : 400).json(result.ok ? result : { ...result, error: result.message });
});

// ── Supplier PO approval: who needs it, and the admins' signatures ─────────

const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(png|jpe?g|webp)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Upload the signature as a PNG, JPG or WebP image'));
  },
});

// GET /api/settings/po-approvals — every user: whether their supplier POs need approval, whether an admin has a signature
router.get('/po-approvals', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const users = db.prepare(`SELECT id, username, display_name, email, role, po_requires_approval FROM users ORDER BY role DESC, COALESCE(display_name, username)`).all() as any[];
  res.json(users.map(u => ({ ...u, po_requires_approval: !!u.po_requires_approval, has_signature: !!signatureFileOf(u.id) })));
});

// PUT /api/settings/po-approvals/:userId {requires} — admins never need approval
router.put('/po-approvals/:userId', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.userId) as any;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.role === 'admin') { res.status(400).json({ error: 'Admins approve purchase orders themselves' }); return; }
  db.prepare('UPDATE users SET po_requires_approval = ? WHERE id = ?').run(req.body?.requires ? 1 : 0, user.id);
  res.json({ id: user.id, po_requires_approval: !!req.body?.requires });
});

// POST /api/settings/po-approvals/:userId/signature — multipart `file` (an admin's signature image)
router.post('/po-approvals/:userId/signature', signatureUpload.single('file'), (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const user = db.prepare('SELECT id, role, signature_file, COALESCE(display_name, username) AS name FROM users WHERE id = ?').get(req.params.userId) as any;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.role !== 'admin') { res.status(400).json({ error: 'Only admins sign purchase orders' }); return; }
  if (!req.file) { res.status(400).json({ error: 'Choose the signature image' }); return; }
  fs.mkdirSync(signaturesDir, { recursive: true });
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.jpeg', '.jpg');
  const stored = `signature-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(signaturesDir, stored), req.file.buffer);
  db.prepare('UPDATE users SET signature_file = ? WHERE id = ?').run(stored, user.id);
  if (user.signature_file) {
    archiveStored('signatures', user.signature_file, { section: 'Users', context: `Signature of ${user.name}`, fileName: user.signature_file, reason: 'replaced' }, archivedBy(req));
  }
  res.json({ id: user.id, has_signature: true });
});

// DELETE /api/settings/po-approvals/:userId/signature
router.delete('/po-approvals/:userId/signature', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const user = db.prepare('SELECT id, signature_file, COALESCE(display_name, username) AS name FROM users WHERE id = ?').get(req.params.userId) as any;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.signature_file) {
    archiveStored('signatures', user.signature_file, { section: 'Users', context: `Signature of ${user.name}`, fileName: user.signature_file, reason: 'deleted' }, archivedBy(req));
  }
  db.prepare('UPDATE users SET signature_file = NULL WHERE id = ?').run(user.id);
  res.json({ id: user.id, has_signature: false });
});

// GET /api/settings/po-approvals/:userId/signature — the image (admins only)
router.get('/po-approvals/:userId/signature', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const file = signatureFileOf(Number(req.params.userId));
  if (!file) { res.status(404).json({ error: 'No signature' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(signaturesDir, file));
});

// GET /api/settings/notification-rules — who is not told about whose changes (admin only)
router.get('/notification-rules', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const users = db.prepare(
    `SELECT id, username, display_name, email, role, notify_on_changes FROM users ORDER BY COALESCE(display_name, username)`
  ).all();
  const ops = getOperationNotifySettings();
  res.json({ mutes: getNotificationMutes(), users, operation_recipients: ops.enabled ? ops.recipients : [] });
});

// PUT /api/settings/notification-rules/:recipient — admin only; body { muted_actors: number[] }.
// Replaces only this recipient's rules (user:<id> or email:<addr>).
router.put('/notification-rules/:recipient', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const recipient = String(req.params.recipient || '').trim().toLowerCase();
  if (!/^(user:\d+|email:\S+@\S+)$/.test(recipient)) { res.status(400).json({ error: 'Invalid recipient' }); return; }
  const raw = Array.isArray(req.body?.muted_actors) ? req.body.muted_actors : [];
  const actors = normalizeMutes(raw.map((actor: unknown) => ({ recipient, actor }))).map(m => m.actor);
  res.json({ mutes: setMutesForRecipient(recipient, actors) });
});

export default router;
