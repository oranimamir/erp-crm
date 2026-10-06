import { Resend } from 'resend';
import db from '../database.js';

export type NotifyAction = 'created' | 'updated' | 'deleted' | 'status changed' | 'logged in';

export interface NotifyPayload {
  action: NotifyAction;
  entity: string;       // 'Customer', 'Invoice', 'Order', etc.
  label: string;        // Name or identifier
  performedBy: string;  // Display name of user who acted
  performedById?: number; // User ID — excluded from receiving their own notifications
  detail?: string;      // Optional extra info (e.g. new status)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Settings → Operation change emails: when on, every change made to an
 * operation (Operations tab — create, edit, status, dates, country, documents,
 * delete) is also emailed to these recipients. The person who made the change
 * is left out, as with the per-user "Notify" emails.
 */
export interface OperationNotifySettings { enabled: boolean; recipients: string[] }

export function normalizeOperationNotify(raw: any): OperationNotifySettings {
  const parts = Array.isArray(raw?.recipients) ? raw.recipients : String(raw?.recipients ?? '').split(/[,;\s]+/);
  const recipients = [...new Set<string>(parts.map((r: any) => String(r).trim()).filter((r: string) => EMAIL_RE.test(r)))];
  return { enabled: !!raw?.enabled, recipients };
}

export function getOperationNotifySettings(): OperationNotifySettings {
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'operation_notifications'`).get() as any;
    return normalizeOperationNotify(row ? JSON.parse(row.value) : null);
  } catch {
    return normalizeOperationNotify(null);
  }
}

export function setOperationNotifySettings(value: OperationNotifySettings): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('operation_notifications', ?, datetime('now'))")
    .run(JSON.stringify(value));
}

/**
 * Settings → Who is notified about whom (admin): pairs of recipient + user
 * whose changes that recipient does NOT hear about — e.g. Denis is not told
 * what Caro does. Everything not listed is sent. A recipient is an app user
 * (`user:<id>`) or an email typed under Operation change emails (`email:<addr>`).
 */
export interface NotificationMute { recipient: string; actor: number }

export function normalizeMutes(raw: any): NotificationMute[] {
  const seen = new Set<string>();
  const out: NotificationMute[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    const recipient = String(m?.recipient ?? '').trim().toLowerCase();
    const actor = Number(m?.actor);
    if (!/^(user:\d+|email:\S+@\S+)$/.test(recipient) || !Number.isInteger(actor) || actor <= 0) continue;
    const key = `${recipient}|${actor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ recipient, actor });
  }
  return out;
}

export function getNotificationMutes(): NotificationMute[] {
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'notification_mutes'`).get() as any;
    return normalizeMutes(row ? JSON.parse(row.value) : []);
  } catch {
    return [];
  }
}

export function setNotificationMutes(value: NotificationMute[]): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('notification_mutes', ?, datetime('now'))")
    .run(JSON.stringify(value));
}

/**
 * Replaces one recipient's mutes, leaving everyone else's as stored — two
 * admins editing different people never overwrite each other.
 */
export function setMutesForRecipient(recipient: string, actors: number[]): NotificationMute[] {
  const key = recipient.trim().toLowerCase();
  const others = getNotificationMutes().filter(m => m.recipient !== key);
  const next = normalizeMutes([...others, ...actors.map(actor => ({ recipient: key, actor }))]);
  setNotificationMutes(next);
  return next;
}

/** Drops every rule that names this user, as recipient or as the person acting. */
export function removeMutesForUser(userId: number): void {
  const all = getNotificationMutes();
  const kept = all.filter(m => m.actor !== userId && m.recipient !== `user:${userId}`);
  if (kept.length !== all.length) setNotificationMutes(kept);
}

/** The users whose changes this app user has been set not to hear about. */
export function mutedActorsForUser(userId: number): number[] {
  return getNotificationMutes().filter(m => m.recipient === `user:${userId}`).map(m => m.actor);
}

/** Record fields (customer names, invoice numbers…) are user-entered and go into HTML email */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Sends a one-time login code to a user's email. Throws if sending fails. */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[notify] RESEND_API_KEY is not set — cannot send OTP email');
    throw new Error('Email service is not configured');
  }
  await _sendOtp(to, code);
}

async function _sendOtp(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY!;
  const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  <div style="background:#4f46e5;padding:16px 24px;">
    <span style="color:white;font-weight:700;font-size:17px;">CirculERP — Login Code</span>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 16px;font-size:15px;color:#111827;">Your one-time login code is:</p>
    <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#4f46e5;padding:16px;background:#f0f0ff;border-radius:8px;text-align:center;font-family:monospace;">${code}</div>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">This code expires in 10 minutes. Do not share it with anyone.</p>
  </div>
</div>`;
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to,
    subject: `[CirculERP] Your login code: ${code}`,
    html,
  });
}

/** Fire-and-forget: logs activity and sends an email to all admin users with an email set. */
export function notifyAdmin(payload: NotifyPayload): void {
  // Skip login events — only notify on actual changes
  if (payload.action === 'logged in') return;

  // Always log to activity_log (in-app notifications)
  try {
    db.prepare(
      `INSERT INTO activity_log (entity, action, label, performed_by, performed_by_id) VALUES (?, ?, ?, ?, ?)`
    ).run(payload.entity, payload.action, payload.label, payload.performedBy, payload.performedById ?? null);
  } catch (err: any) {
    console.error('[notify] Failed to log activity:', err?.message || err);
  }
  _send(payload).catch(err =>
    console.error('[notify] Failed to send admin notification:', err?.message || err)
  );
}

async function _send(payload: NotifyPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const admins = db.prepare(
    `SELECT id, email FROM users WHERE notify_on_changes = 1 AND email IS NOT NULL AND email != '' AND id != ?`
  ).all(payload.performedById ?? -1) as Array<{ id: number; email: string }>;
  // Recipients set not to hear about this person's changes are left out
  const mutes = payload.performedById != null
    ? getNotificationMutes().filter(m => m.actor === payload.performedById)
    : [];
  const mutedUsers = new Set(mutes.map(m => m.recipient));
  const isMuted = (email: string) => {
    const lower = email.toLowerCase();
    if (mutedUsers.has(`email:${lower}`)) return true;
    const user = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(lower) as any;
    return !!user && mutedUsers.has(`user:${user.id}`);
  };
  const to = admins.filter(a => !mutedUsers.has(`user:${a.id}`)).map(a => a.email);

  // Operation changes also go to Settings → Operation change emails
  if (payload.entity.startsWith('Operation')) {
    const ops = getOperationNotifySettings();
    if (ops.enabled) {
      const own = payload.performedById != null
        ? ((db.prepare('SELECT email FROM users WHERE id = ?').get(payload.performedById) as any)?.email || '').toLowerCase()
        : '';
      for (const r of ops.recipients) {
        const lower = r.toLowerCase();
        if (lower !== own && !to.some(t => t.toLowerCase() === lower) && !isMuted(r)) to.push(r);
      }
    }
  }

  if (to.length === 0) return;

  const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
  const appUrl = process.env.APP_URL || '';

  const actionColor: Record<string, string> = {
    created: '#16a34a',
    updated: '#2563eb',
    deleted: '#dc2626',
    'status changed': '#d97706',
    'logged in': '#0891b2',
  };
  const color = actionColor[payload.action] || '#6b7280';

  const now = new Date().toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }) + ' UTC';

  const entity = esc(payload.entity);
  const action = esc(payload.action);
  const label = esc(payload.label);
  const performedBy = esc(payload.performedBy);
  const detail = payload.detail ? esc(payload.detail) : '';

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  <div style="background:#4f46e5;padding:16px 24px;display:flex;align-items:center;gap:10px;">
    <div style="background:white;color:#4f46e5;font-weight:700;font-size:13px;padding:4px 10px;border-radius:6px;">C</div>
    <span style="color:white;font-weight:700;font-size:17px;">CirculERP</span>
    <span style="margin-left:auto;color:#c7d2fe;font-size:12px;">Change Notification</span>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 20px;font-size:16px;color:#111827;">
      A <strong style="color:${color};">${entity}</strong> was
      <strong style="color:${color};">${action}</strong>
      by <strong>${performedBy}</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;width:35%;">Entity</td>
        <td style="padding:10px 14px;color:#111827;">${entity}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Name / ID</td>
        <td style="padding:10px 14px;color:#111827;font-weight:500;">${label}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Action</td>
        <td style="padding:10px 14px;color:${color};font-weight:600;text-transform:capitalize;">${action}${detail ? ` → ${detail}` : ''}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Performed by</td>
        <td style="padding:10px 14px;color:#111827;">${performedBy}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Time</td>
        <td style="padding:10px 14px;color:#6b7280;">${now}</td>
      </tr>
    </table>
    ${appUrl ? `<div style="margin-top:20px;"><a href="${esc(appUrl)}" style="background:#4f46e5;color:white;padding:10px 20px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">Open CirculERP →</a></div>` : ''}
  </div>
</div>`;

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to,
    subject: `[CirculERP] ${payload.entity} ${payload.action}: ${payload.label}`,
    html,
  });
}
