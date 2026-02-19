import { Resend } from 'resend';
import db from '../database.js';

export type NotifyAction = 'created' | 'updated' | 'deleted' | 'status changed';

export interface NotifyPayload {
  action: NotifyAction;
  entity: string;      // 'Customer', 'Invoice', 'Order', etc.
  label: string;       // Name or identifier
  performedBy: string; // Display name of user who acted
  detail?: string;     // Optional extra info (e.g. new status)
}

/** Fire-and-forget: sends an email to all admin users with an email set. */
export function notifyAdmin(payload: NotifyPayload): void {
  _send(payload).catch(err =>
    console.error('[notify] Failed to send admin notification:', err?.message || err)
  );
}

async function _send(payload: NotifyPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const admins = db.prepare(
    `SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != ''`
  ).all() as Array<{ email: string }>;

  if (admins.length === 0) return;

  const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
  const appUrl = process.env.APP_URL || '';

  const actionColor: Record<string, string> = {
    created: '#16a34a',
    updated: '#2563eb',
    deleted: '#dc2626',
    'status changed': '#d97706',
  };
  const color = actionColor[payload.action] || '#6b7280';

  const now = new Date().toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }) + ' UTC';

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  <div style="background:#4f46e5;padding:16px 24px;display:flex;align-items:center;gap:10px;">
    <div style="background:white;color:#4f46e5;font-weight:700;font-size:13px;padding:4px 10px;border-radius:6px;">C</div>
    <span style="color:white;font-weight:700;font-size:17px;">CirculERP</span>
    <span style="margin-left:auto;color:#c7d2fe;font-size:12px;">Admin Notification</span>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 20px;font-size:16px;color:#111827;">
      A <strong style="color:${color};">${payload.entity}</strong> was
      <strong style="color:${color};">${payload.action}</strong>
      by <strong>${payload.performedBy}</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;width:35%;">Entity</td>
        <td style="padding:10px 14px;color:#111827;">${payload.entity}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Name / ID</td>
        <td style="padding:10px 14px;color:#111827;font-weight:500;">${payload.label}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Action</td>
        <td style="padding:10px 14px;color:${color};font-weight:600;text-transform:capitalize;">${payload.action}${payload.detail ? ` → ${payload.detail}` : ''}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Performed by</td>
        <td style="padding:10px 14px;color:#111827;">${payload.performedBy}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-weight:600;color:#6b7280;">Time</td>
        <td style="padding:10px 14px;color:#6b7280;">${now}</td>
      </tr>
    </table>
    ${appUrl ? `<div style="margin-top:20px;"><a href="${appUrl}" style="background:#4f46e5;color:white;padding:10px 20px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">Open CirculERP →</a></div>` : ''}
  </div>
</div>`;

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to: admins.map(a => a.email),
    subject: `[CirculERP] ${payload.entity} ${payload.action}: ${payload.label}`,
    html,
  });
}
