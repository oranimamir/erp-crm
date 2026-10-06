import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';

/**
 * "Send documents": an operation's (or NCO's) documents as attachments of one
 * email, in the order the user put them, optionally numbered 01 - …, 02 - ….
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

/** Resend's limit is 40 MB per message incl. encoding; base64 adds a third. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

function storedPath(filePath: string): string | null {
  if (!SAFE_NAME.test(filePath)) return null;
  const abs = path.join(docsDir, filePath);
  return fs.existsSync(abs) ? abs : null;
}

/** Adds `file_size` (bytes, null when the file is missing) to stored documents. */
export function withSizes<T extends { file_path: string }>(docs: T[]): Array<T & { file_size: number | null }> {
  return docs.map(d => {
    const abs = storedPath(d.file_path);
    let size: number | null = null;
    if (abs) { try { size = fs.statSync(abs).size; } catch { /* unreadable */ } }
    return { ...d, file_size: size };
  });
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "Quality certificate.pdf" → safe attachment name, numbered when asked. */
function attachmentName(name: string, index: number, total: number, numbered: boolean): string {
  const clean = String(name || 'document').replace(/[\\/:*?"<>|\r\n]+/g, '-').trim() || 'document';
  if (!numbered) return clean;
  const width = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(width, '0')} - ${clean}`;
}

export interface SendRequestBody { to?: unknown; cc?: unknown; subject?: unknown; message?: unknown; documents?: unknown; numbered?: unknown }

export type SendResult = { status: number; body: any };

/**
 * Validates and sends. `docs` are the owner's documents; `documents` in the
 * body is the chosen ids in order — any id not among `docs` is refused.
 */
export async function sendDocumentsEmail(
  body: SendRequestBody,
  docs: Array<{ id: number; file_path: string; file_name: string }>,
  defaults: { subject: string; reference: string; company: string },
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { status: 501, body: { error: 'Email sending is not configured (missing RESEND_API_KEY)' } };

  const split = (v: unknown) => String(v ?? '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const to = split(body.to);
  const cc = split(body.cc);
  if (!to.length) return { status: 400, body: { error: 'At least one recipient email is required' } };
  const invalid = [...to, ...cc].filter(r => !EMAIL_RE.test(r));
  if (invalid.length) return { status: 400, body: { error: `Invalid email address: ${invalid.join(', ')}` } };

  const ids = (Array.isArray(body.documents) ? body.documents : []).map(Number);
  if (!ids.length) return { status: 400, body: { error: 'Choose at least one document' } };
  const byId = new Map(docs.map(d => [d.id, d]));
  if (ids.some(id => !byId.has(id))) return { status: 400, body: { error: 'A chosen document does not belong here' } };
  const chosen = [...new Set(ids)].map(id => byId.get(id)!);

  const missing: string[] = [];
  const files: Array<{ name: string; abs: string; size: number }> = [];
  for (const d of chosen) {
    const abs = storedPath(d.file_path);
    if (!abs) { missing.push(d.file_name); continue; }
    files.push({ name: d.file_name, abs, size: fs.statSync(abs).size });
  }
  if (missing.length) return { status: 404, body: { error: `File missing on the server: ${missing.join(', ')}` } };

  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 3)
      .map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join(', ');
    return {
      status: 413,
      body: { error: `Attachments add up to ${(total / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB. Untick some of the largest: ${biggest}` },
    };
  }

  const numbered = body.numbered === true;
  const attachments = files.map((f, i) => ({
    filename: attachmentName(f.name, i, files.length, numbered),
    content: fs.readFileSync(f.abs).toString('base64'),
  }));

  const subject = String(body.subject ?? '').trim() || defaults.subject;
  const message = String(body.message ?? '').trim();
  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p style="font-size:14px;white-space:pre-wrap;">${message
    ? escapeHtml(message)
    : `Please find attached the documents for ${escapeHtml(defaults.reference)}.`}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;margin-top:12px;">
    ${attachments.map((a, i) => `<tr${i % 2 ? '' : ' style="background:#f9fafb;"'}><td style="padding:6px 10px;">${escapeHtml(a.filename)}</td></tr>`).join('')}
  </table>
  <p style="font-size:14px;margin-top:20px;">Kind regards,<br/>${escapeHtml(defaults.company)}</p>
</div>`;

  try {
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const { error } = await resend.emails.send({ from, to, ...(cc.length ? { cc } : {}), subject, html, attachments });
    if (error) throw new Error(error.message || 'Resend rejected the message');
    return { status: 200, body: { message: `${attachments.length} document${attachments.length === 1 ? '' : 's'} sent to ${to.join(', ')}`, to, count: attachments.length } };
  } catch (err: any) {
    console.error('[documentMail] send failed:', err?.message || err);
    return { status: 502, body: { error: `Failed to send email: ${err?.message || 'unknown error'}` } };
  }
}
