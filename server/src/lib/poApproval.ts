import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { todayISO } from './today.js';

/**
 * Supplier PO approval (User Management → PO approvals):
 * - an admin ticks the users whose supplier POs need an admin's approval
 *   (`users.po_requires_approval`); their "Confirm & generate" saves the PO
 *   unsent and asks the admins (`purchase_orders.approval_status = 'pending'`);
 * - an admin approves → the PO is generated with that admin's signature
 *   (`users.signature_file` in uploads/signatures), or rejects with a note;
 * - a PO an admin generates themselves carries their own signature.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
export const signaturesDir = path.join(uploadsBase, 'signatures');
const SAFE = /^[a-zA-Z0-9._-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a generated PO prints under "Approved by". */
export interface PoSignature { name: string; date: string; file: string | null }

/** Whether this user's supplier POs wait for an admin (admins never do). */
export function needsPoApproval(user: { userId?: number; role?: string } | undefined): boolean {
  if (!user?.userId || user.role === 'admin') return false;
  const row = db.prepare('SELECT po_requires_approval FROM users WHERE id = ?').get(user.userId) as any;
  return !!row?.po_requires_approval;
}

/** The stored signature image of a user, when there is one on disk. */
export function signatureFileOf(userId: number | null | undefined): string | null {
  if (!userId) return null;
  const row = db.prepare('SELECT signature_file FROM users WHERE id = ?').get(userId) as any;
  const file = row?.signature_file;
  return file && SAFE.test(file) && fs.existsSync(path.join(signaturesDir, file)) ? file : null;
}

/** The signature block for a PO generated / approved by this admin; null for anyone else. */
export function poSignatureFor(user: { userId?: number; role?: string } | undefined): PoSignature | null {
  if (!user?.userId || user.role !== 'admin') return null;
  const row = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(user.userId) as any;
  if (!row) return null;
  return { name: row.display_name || row.username, date: todayISO(), file: signatureFileOf(user.userId) };
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Marks a PO as waiting for approval and emails the admins; never throws. */
export function requestPoApproval(poId: number, requestedBy: { userId?: number; display_name?: string } | undefined): void {
  db.prepare(`UPDATE purchase_orders SET approval_status = 'pending', approval_requested_by = ?, approval_requested_at = datetime('now'),
    approval_note = NULL WHERE id = ?`).run(requestedBy?.userId ?? null, poId);
  void (async () => {
    try {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return;
      const po = db.prepare('SELECT po_number, data FROM purchase_orders WHERE id = ?').get(poId) as any;
      let supplier = '';
      try { supplier = JSON.parse(po?.data || '{}').client_name || ''; } catch { /* no supplier name */ }
      const to = (db.prepare(`SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL`).all() as any[])
        .map(r => r.email).filter((e: string) => EMAIL_RE.test(e));
      if (!to.length) return;
      const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
      const link = appUrl ? `${appUrl}/purchase-orders/${poId}` : '';
      const who = requestedBy?.display_name || 'A user';
      const html = `
<div style="font-family:sans-serif;max-width:520px;color:#111827;">
  <p style="font-size:16px;"><strong>${esc(who)}</strong> prepared supplier purchase order <strong>${esc(po?.po_number)}</strong>${supplier ? ` for <strong>${esc(supplier)}</strong>` : ''} and it needs an admin's approval.</p>
  <p style="font-size:14px;color:#374151;">Open it, check it, then Approve &amp; generate (your signature is added) or Reject with a note.</p>
  ${link ? `<p><a href="${esc(link)}" style="background:#2563eb;color:white;padding:10px 18px;text-decoration:none;border-radius:8px;font-weight:600;">Review ${esc(po?.po_number)} →</a></p>` : ''}
</div>`;
      const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
      await new Resend(apiKey).emails.send({ from, to, subject: `Approval needed: supplier PO ${po?.po_number || ''}`, html });
    } catch (err: any) {
      console.error('[po-approval] email failed:', err?.message || err);
    }
  })();
}

/** Tells whoever asked that their PO was approved (and generated) or not, with the admin's note; never throws. */
export function notifyPoRequester(poId: number, requesterId: number | null | undefined, approved: boolean, note: string | null, adminName: string): void {
  if (!requesterId) return;
  void (async () => {
    try {
      const apiKey = process.env.RESEND_API_KEY;
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(requesterId) as any;
      if (!apiKey || !user?.email || !EMAIL_RE.test(user.email)) return;
      const po = db.prepare('SELECT po_number FROM purchase_orders WHERE id = ?').get(poId) as any;
      const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
      const link = appUrl ? `${appUrl}/purchase-orders/${poId}` : '';
      const html = `
<div style="font-family:sans-serif;max-width:520px;color:#111827;">
  <p style="font-size:16px;">${approved
    ? `<strong>${esc(adminName)}</strong> approved supplier purchase order <strong>${esc(po?.po_number)}</strong> — it is generated, signed and filed.`
    : `<strong>${esc(adminName)}</strong> did not approve supplier purchase order <strong>${esc(po?.po_number)}</strong>.`}</p>
  ${note ? `<p style="font-size:14px;background:#fef3c7;padding:10px 12px;border-radius:8px;"><strong>Note:</strong> ${esc(note)}</p>` : ''}
  ${link ? `<p><a href="${esc(link)}" style="color:#2563eb;">Open ${esc(po?.po_number)} →</a></p>` : ''}
</div>`;
      const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
      await new Resend(apiKey).emails.send({ from, to: [user.email], subject: `Supplier PO ${po?.po_number || ''} ${approved ? 'approved' : 'not approved'}`, html });
    } catch (err: any) {
      console.error('[po-approval] requester email failed:', err?.message || err);
    }
  })();
}
