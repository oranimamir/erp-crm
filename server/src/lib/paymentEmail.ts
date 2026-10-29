import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';

/**
 * "We got paid" email: every wire transfer uploaded on a customer invoice is
 * announced to the people chosen in User Management → Payments — app users
 * (`user:<id>`, their account email) or other addresses (`email:<addr>`).
 * Stored in app_settings 'payment_notifications' as { recipients: [...] };
 * no recipients = no email. Sending never throws and never holds up the upload.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SETTING = 'payment_notifications';
/** Resend's limit is 40 MB per email; keep the attached wire well under it. */
const MAX_ATTACHMENT = 10 * 1024 * 1024;

export interface PaymentNotifySettings { recipients: string[] }

export function normalizePaymentNotify(raw: any): PaymentNotifySettings {
  const list = Array.isArray(raw?.recipients) ? raw.recipients : [];
  const recipients = new Set<string>();
  for (const item of list) {
    const r = String(item ?? '').trim();
    if (/^user:\d+$/.test(r)) recipients.add(r);
    else if (r.startsWith('email:') && EMAIL_RE.test(r.slice(6))) recipients.add(`email:${r.slice(6).toLowerCase()}`);
  }
  return { recipients: [...recipients] };
}

export function getPaymentNotifySettings(): PaymentNotifySettings {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING) as any;
    return normalizePaymentNotify(row ? JSON.parse(row.value) : null);
  } catch {
    return { recipients: [] };
  }
}

export function setPaymentNotifySettings(value: PaymentNotifySettings): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(SETTING, JSON.stringify(normalizePaymentNotify(value)));
}

/** Drops a deleted user from the list. */
export function removePaymentRecipientUser(userId: number): void {
  const settings = getPaymentNotifySettings();
  const next = settings.recipients.filter(r => r !== `user:${userId}`);
  if (next.length !== settings.recipients.length) setPaymentNotifySettings({ recipients: next });
}

function recipientEmail(key: string): string | null {
  if (key.startsWith('email:')) return key.slice(6);
  const id = Number(key.slice(5));
  const row = Number.isInteger(id) ? db.prepare('SELECT email FROM users WHERE id = ?').get(id) as any : null;
  return row?.email && EMAIL_RE.test(row.email) ? row.email : null;
}

/** Record fields are user-entered and go into HTML. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
}

function euDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

const HEADLINES = [
  '🎉 HIP HIP HOORAY — WE GOT PAID! 🎉',
  '💸 KA-CHING! THE MONEY HAS LANDED! 💸',
  '🍾 POP THE CHAMPAGNE — A PAYMENT JUST ARRIVED! 🍾',
  '🚀 TO THE BANK AND BEYOND — WE GOT PAID! 🚀',
  '🥳 CASH IS IN THE HOUSE! 🥳',
];
const SIGN_OFFS = [
  'Somebody cue the victory dance. 💃🕺',
  'The accountant is smiling. Rare sight — enjoy it.',
  'Coffee is on the customer today. ☕',
  'Hip hip — HOORAY! Hip hip — HOORAY! 🎺',
  'Another one for the money tree. 🌳💰',
];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export interface PaymentInfo {
  customerName: string | null;
  invoiceNumber: string;
  operationNumber: string | null;
  operationId: number | null;
  amount: number;
  currency: string;
  eurAmount: number | null;
  paymentDate: string;
  bankReference: string | null;
  recordedBy: string | null;
  wireFilePath: string | null;
  wireFileName: string | null;
}

/** The payment-received email as {subject, html}; exported for the test email. */
export function paymentEmailContent(p: PaymentInfo): { subject: string; html: string } {
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const paid = money(p.amount, p.currency);
  const inEur = p.currency !== 'EUR' && p.eurAmount != null ? money(p.eurAmount, 'EUR') : null;
  const who = p.customerName || 'A customer';
  const link = appUrl ? (p.operationId ? `${appUrl}/operations/${p.operationId}` : `${appUrl}/invoices`) : '';
  const row = (label: string, value: string, shade: boolean) => value ? `
      <tr${shade ? ' style="background:#f0fdf4;"' : ''}>
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;width:38%;">${label}</td>
        <td style="padding:10px 14px;color:#111827;font-weight:600;">${value}</td>
      </tr>` : '';
  const rows = [
    ['Customer', esc(p.customerName || '—')],
    ['Invoice', esc(p.invoiceNumber)],
    ['Operation', esc(p.operationNumber || '')],
    ['Amount paid', esc(paid)],
    ['In EUR', esc(inEur || '')],
    ['Payment date', esc(euDate(p.paymentDate))],
    ['Bank reference', esc(p.bankReference || '')],
    ['Recorded by', esc(p.recordedBy || '')],
  ].filter(([, v]) => v);

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;border:1px solid #bbf7d0;border-radius:14px;overflow:hidden;background:#ffffff;">
  <div style="background:linear-gradient(135deg,#16a34a,#22c55e);padding:28px 24px;text-align:center;">
    <p style="margin:0;color:#ffffff;font-size:26px;line-height:1.25;font-weight:900;letter-spacing:0.5px;">${pick(HEADLINES)}</p>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 18px;font-size:18px;color:#111827;line-height:1.5;">
      <strong>${esc(who)}</strong> just paid <strong style="color:#16a34a;font-size:22px;">${esc(paid)}</strong>${inEur ? ` <strong>(${esc(inEur)})</strong>` : ''}
      for invoice <strong>${esc(p.invoiceNumber)}</strong>${p.operationNumber ? ` — operation <strong>${esc(p.operationNumber)}</strong>` : ''}. <strong>Well done, team!</strong>
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;">${rows.map(([l, v], i) => row(l, v, i % 2 === 0)).join('')}
    </table>
    <p style="margin:18px 0 0;font-size:15px;color:#15803d;"><strong>${pick(SIGN_OFFS)}</strong></p>
    ${p.wireFileName ? `<p style="margin:10px 0 0;font-size:12px;color:#6b7280;">The wire transfer is attached.</p>` : ''}
    ${link ? `<div style="margin-top:20px;"><a href="${esc(link)}" style="background:#16a34a;color:white;padding:10px 20px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">Open ${p.operationNumber ? esc(p.operationNumber) : 'the invoices'} →</a></div>` : ''}
  </div>
</div>`;
  return { subject: `🎉 Hip hip hooray — we got paid! ${who} · ${paid}`, html };
}

/**
 * Emails the chosen recipients that a payment came in. Returns what happened,
 * for the test button; the upload route ignores it.
 */
export async function sendPaymentReceivedEmail(p: PaymentInfo, only?: string[]): Promise<{ ok: boolean; message: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, message: 'Email is not set up (RESEND_API_KEY missing)' };
    const keys = only ?? getPaymentNotifySettings().recipients;
    const to = [...new Set(keys.map(recipientEmail).filter((e): e is string => !!e))];
    if (!to.length) return { ok: false, message: 'Nobody is chosen to get payment emails' };

    const { subject, html } = paymentEmailContent(p);
    const attachments: Array<{ filename: string; content: Buffer }> = [];
    if (p.wireFilePath && /^[a-zA-Z0-9._-]+$/.test(p.wireFilePath)) {
      const full = path.join(uploadsBase, 'wire-transfers', p.wireFilePath);
      try {
        if (fs.existsSync(full) && fs.statSync(full).size <= MAX_ATTACHMENT) {
          attachments.push({ filename: p.wireFileName || p.wireFilePath, content: fs.readFileSync(full) });
        }
      } catch { /* sent without the attachment */ }
    }
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const { error } = await new Resend(apiKey).emails.send({ from, to, subject, html, ...(attachments.length ? { attachments } : {}) });
    if (error) {
      console.error('[payment-email] Send failed:', error);
      return { ok: false, message: (error as any).message || 'The email could not be sent' };
    }
    return { ok: true, message: `Sent to ${to.join(', ')}` };
  } catch (err: any) {
    console.error('[payment-email] Send failed:', err?.message || err);
    return { ok: false, message: err?.message || 'The email could not be sent' };
  }
}
