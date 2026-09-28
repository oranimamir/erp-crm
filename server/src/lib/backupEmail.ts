/**
 * Weekly backup by email: Monday 06:00 Brussels time by default. The admin
 * chooses who receives it and what it holds (database, uploaded documents,
 * invoices by category). Each part is its own ZIP; parts too large to attach
 * are named in the email instead, to be downloaded from Settings → Backup.
 */
import fs from 'fs';
import cron from 'node-cron';
import { Resend } from 'resend';
import db from '../database.js';
import { BACKUP_PART_LABELS, writeBackupPart, type BackupPart } from './backup.js';

export interface BackupEmailSettings {
  enabled: boolean;
  recipients: string[];
  parts: BackupPart[];
  /** 0-6, Sunday = 0 */
  day: number;
  hour: number;
  minute: number;
}

export interface BackupEmailResult { ok: boolean; at: string; message: string }

export const BACKUP_TIMEZONE = 'Europe/Brussels';
export const BACKUP_PARTS = Object.keys(BACKUP_PART_LABELS) as BackupPart[];

const DEFAULTS: BackupEmailSettings = {
  enabled: true, recipients: [], parts: ['database', 'invoices', 'operations'], day: 1, hour: 6, minute: 0,
};

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
  const recipients = (Array.isArray(r.recipients) ? r.recipients : String(r.recipients || '').split(/[,;\s]+/))
    .map((s: unknown) => String(s).trim()).filter((s: string) => EMAIL_RE.test(s));
  const parts = (Array.isArray(r.parts) ? r.parts : DEFAULTS.parts).filter((p: any) => BACKUP_PARTS.includes(p));
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULTS.enabled,
    recipients: [...new Set<string>(recipients)],
    parts: parts.length ? [...new Set<BackupPart>(parts)] : DEFAULTS.parts,
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
  if (!settings.recipients.length) return finish(false, 'No recipients set');

  const stamp = at.replace(/[:.]/g, '-').slice(0, 19);
  // A part can come as several ZIPs (operations are split to stay emailable)
  const files: Array<{ part: BackupPart; label: string; filename: string; path: string; size: number }> = [];
  try {
    for (const part of settings.parts) {
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

    // Pack the parts into as few emails as fit; a part too big for any email is only named
    const tooLarge = files.filter(f => f.size > MAX_EMAIL_BYTES);
    const batches: Array<typeof files> = [];
    for (const f of files.filter(f => f.size <= MAX_EMAIL_BYTES)) {
      const batch = batches.find(b => b.reduce((s, x) => s + x.size, 0) + f.size <= MAX_EMAIL_BYTES);
      if (batch) batch.push(f); else batches.push([f]);
    }
    if (!batches.length) batches.push([]);

    const when = formatStamp(new Date(at));
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const day = at.slice(0, 10);

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
  <p style="font-size:12px;color:#6b7280;">Sent automatically. Recipients and contents are set by an admin in Settings → Backup.</p>
</div>`;
      const { error } = await resend.emails.send({
        from, to: settings.recipients, subject: `ERP backup — ${when.slice(0, 10)}${of}`, html,
        attachments: batch.map(f => ({
          filename: f.filename,
          content: fs.readFileSync(f.path).toString('base64'),
        })),
      });
      if (error) throw new Error(error.message || 'Resend rejected the message');
    }

    const sent = [...new Set(files.filter(f => f.size <= MAX_EMAIL_BYTES).map(f => BACKUP_PART_LABELS[f.part]))];
    const summary = [
      sent.length ? `${sent.join(', ')} sent to ${settings.recipients.join(', ')}` : `Notice sent to ${settings.recipients.join(', ')}`,
      ...tooLarge.map(f => `${f.label} too large to email (${mb(f.size)})`),
    ].join('; ');
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
