/**
 * Weekly backup by email: Monday 06:00 Brussels time by default. Set up in
 * User Management → Backups: each recipient (an app user, or another email
 * address) gets their own choice — everything (database + all uploads), or
 * the tabs they pick (Customers, Operations, Supplier Invoices…). Each part is
 * built once per run and is its own ZIP; parts too large to attach are named
 * in the email instead, to be downloaded from Settings → Backup.
 */
import fs from 'fs';
import cron from 'node-cron';
import { Resend } from 'resend';
import db from '../database.js';
import { BACKUP_PART_LABELS, writeBackupPart, type BackupPart } from './backup.js';

/** Who gets the backup and what: `user:<id>` (their account email) or `email:<address>`. */
export interface BackupRecipient { recipient: string; parts: BackupPart[] }

export interface BackupEmailSettings {
  enabled: boolean;
  recipients: BackupRecipient[];
  /** 0-6, Sunday = 0 */
  day: number;
  hour: number;
  minute: number;
}

export interface BackupEmailResult { ok: boolean; at: string; message: string }

export const BACKUP_TIMEZONE = 'Europe/Brussels';
export const BACKUP_PARTS = Object.keys(BACKUP_PART_LABELS) as BackupPart[];

const DEFAULTS: BackupEmailSettings = { enabled: true, recipients: [], day: 1, hour: 6, minute: 0 };
/** What recipients saved before per-recipient choices received. */
const LEGACY_PARTS: BackupPart[] = ['database', 'invoices', 'operations'];

/** Resend caps a message at 40 MB after base64 (+33%), so stay under ~25 MB of ZIP per email. */
const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readSetting(key: string): any {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
    return row ? JSON.parse(row.value) : null;
  } catch { return null; }
}

function writeSetting(key: string, value: unknown) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(key, JSON.stringify(value));
}

/** Whatever is stored, as a complete, valid settings object. */
export function normalizeBackupEmailSettings(raw: any): BackupEmailSettings {
  const r = raw && typeof raw === 'object' ? raw : {};
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  const cleanParts = (list: unknown): BackupPart[] =>
    [...new Set((Array.isArray(list) ? list : []).filter((p: any) => BACKUP_PARTS.includes(p)) as BackupPart[])];
  // Settings saved before per-recipient choices: a list of addresses sharing one set of parts
  const legacyParts = cleanParts(r.parts).length ? cleanParts(r.parts) : LEGACY_PARTS;
  const userByEmail = (email: string) =>
    db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email) as { id: number } | undefined;
  const list = Array.isArray(r.recipients) ? r.recipients : String(r.recipients || '').split(/[,;\s]+/);
  const recipients = new Map<string, BackupRecipient>();
  for (const item of list) {
    let key = '';
    let parts: BackupPart[] = [];
    if (typeof item === 'string') {
      const email = item.trim();
      if (!EMAIL_RE.test(email)) continue;
      const user = userByEmail(email);
      key = user ? `user:${user.id}` : `email:${email.toLowerCase()}`;
      parts = legacyParts;
    } else if (item && typeof item === 'object') {
      const raw = String((item as any).recipient || '').trim();
      if (/^user:\d+$/.test(raw)) key = raw;
      else if (/^email:/.test(raw) && EMAIL_RE.test(raw.slice(6))) key = `email:${raw.slice(6).toLowerCase()}`;
      parts = cleanParts((item as any).parts);
    }
    if (key && parts.length) recipients.set(key, { recipient: key, parts });
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULTS.enabled,
    recipients: [...recipients.values()],
    day: int(r.day, 0, 6, DEFAULTS.day),
    hour: int(r.hour, 0, 23, DEFAULTS.hour),
    minute: int(r.minute, 0, 59, DEFAULTS.minute),
  };
}

export function getBackupEmailSettings(): BackupEmailSettings {
  return normalizeBackupEmailSettings(readSetting('backup_email'));
}

export function getLastBackupEmail(): BackupEmailResult | null {
  return readSetting('backup_email_last');
}

/** The address a recipient's backup goes to; null for a user without an email (or gone). */
export function recipientEmail(key: string): string | null {
  if (key.startsWith('email:')) return key.slice(6);
  const id = Number(key.slice(5));
  const row = Number.isInteger(id) ? db.prepare('SELECT email FROM users WHERE id = ?').get(id) as any : null;
  return row?.email && EMAIL_RE.test(row.email) ? row.email : null;
}

/** Drops a deleted user's backup choice. */
export function removeBackupRecipientUser(userId: number) {
  const settings = getBackupEmailSettings();
  const next = settings.recipients.filter(r => r.recipient !== `user:${userId}`);
  if (next.length !== settings.recipients.length) writeSetting('backup_email', { ...settings, recipients: next });
}

export function saveBackupEmailSettings(settings: BackupEmailSettings) {
  writeSetting('backup_email', settings);
  startBackupEmailScheduler();
}

function formatStamp(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BACKUP_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Builds the chosen parts and emails them; the outcome is kept for the Settings page. */
export async function sendBackupEmail(settings = getBackupEmailSettings()): Promise<BackupEmailResult> {
  const at = new Date().toISOString();
  const finish = (ok: boolean, message: string): BackupEmailResult => {
    const result = { ok, at, message };
    try { writeSetting('backup_email_last', result); } catch { /* the send itself matters more */ }
    console.log(`[BackupEmail] ${ok ? 'sent' : 'failed'}: ${message}`);
    return result;
  };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return finish(false, 'Email is not configured on the server (RESEND_API_KEY missing)');
  const targets = settings.recipients
    .map(r => ({ ...r, email: recipientEmail(r.recipient) }))
    .filter((r): r is BackupRecipient & { email: string } => !!r.email);
  if (!targets.length) return finish(false, 'No recipients set');

  const stamp = at.replace(/[:.]/g, '-').slice(0, 19);
  // Every part anyone gets, built once; a part can come as several ZIPs (operations are split to stay emailable)
  const wanted = [...new Set(targets.flatMap(t => t.parts))];
  const files: Array<{ part: BackupPart; label: string; filename: string; path: string; size: number }> = [];
  try {
    for (const part of wanted) {
      const paths = await writeBackupPart(part, stamp);
      paths.forEach((filePath, i) => {
        const of = paths.length > 1 ? ` (${i + 1} of ${paths.length})` : '';
        files.push({
          part, path: filePath, size: fs.statSync(filePath).size,
          label: `${BACKUP_PART_LABELS[part]}${of}`,
          filename: `erp-${part}-${at.slice(0, 10)}${paths.length > 1 ? `-${i + 1}of${paths.length}` : ''}.zip`,
        });
      });
    }

    const when = formatStamp(new Date(at));
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const outcomes: string[] = [];
    const failures: string[] = [];

    for (const target of targets) {
     try {
      const mine = files.filter(f => target.parts.includes(f.part));
      // Pack this recipient's parts into as few emails as fit; a part too big for any email is only named
      const tooLarge = mine.filter(f => f.size > MAX_EMAIL_BYTES);
      const batches: Array<typeof files> = [];
      for (const f of mine.filter(f => f.size <= MAX_EMAIL_BYTES)) {
        const batch = batches.find(b => b.reduce((sum, x) => sum + x.size, 0) + f.size <= MAX_EMAIL_BYTES);
        if (batch) batch.push(f); else batches.push([f]);
      }
      if (!batches.length) batches.push([]);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const of = batches.length > 1 ? ` (${i + 1} of ${batches.length})` : '';
        const rows = [
          ...batch.map(f => `<li>${f.label} — attached (${mb(f.size)})</li>`),
          ...(i === 0 ? tooLarge.map(f =>
            `<li>${f.label} — ${mb(f.size)}, too large to email: download the full backup from Settings → Backup</li>`) : []),
        ];
        const html = `
<div style="font-family:sans-serif;max-width:560px;color:#111827;">
  <p style="font-size:15px;">ERP backup of ${when} (Brussels time)${of}.</p>
  <ul style="font-size:14px;">${rows.join('')}</ul>
  <p style="font-size:12px;color:#6b7280;">Sent automatically. What each person receives is set by an admin in User Management → Backups.</p>
</div>`;
        const { error } = await resend.emails.send({
          from, to: [target.email], subject: `ERP backup — ${when.slice(0, 10)}${of}`, html,
          attachments: batch.map(f => ({
            filename: f.filename,
            content: fs.readFileSync(f.path).toString('base64'),
          })),
        });
        if (error) throw new Error(error.message || 'Resend rejected the message');
      }
      const sent = [...new Set(mine.filter(f => f.size <= MAX_EMAIL_BYTES).map(f => BACKUP_PART_LABELS[f.part]))];
      outcomes.push(`${target.email}: ${sent.length ? sent.join(', ') : 'notice only'}${tooLarge.length ? ` (too large to email: ${tooLarge.map(f => f.label).join(', ')})` : ''}`);
     } catch (err: any) {
      // One address failing never stops the others
      failures.push(`${target.email}: ${err?.message || 'failed'}`);
     }
    }

    const summary = [...outcomes, ...failures.map(f => `FAILED ${f}`)].join('; ');
    if (failures.length) return finish(false, summary);
    return finish(true, summary);
  } catch (err: any) {
    return finish(false, err?.message || 'unknown error');
  } finally {
    for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* best effort */ } }
  }
}

let task: cron.ScheduledTask | null = null;

/** (Re)schedules the email from the stored settings. */
export function startBackupEmailScheduler() {
  if (task) { task.stop(); task = null; }
  const s = getBackupEmailSettings();
  if (!s.enabled) { console.log('[BackupEmail] Disabled'); return; }
  const expr = `${s.minute} ${s.hour} * * ${s.day}`;
  task = cron.schedule(expr, () => {
    sendBackupEmail().catch(err => console.error('[BackupEmail]', err));
  }, { timezone: BACKUP_TIMEZONE });
  console.log(`[BackupEmail] Scheduled: ${expr} (${BACKUP_TIMEZONE})`);
}
