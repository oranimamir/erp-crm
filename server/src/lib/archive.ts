/**
 * Archive of deleted files. Whenever a user deletes (or replaces) an uploaded
 * or generated file, the file is moved here instead of being removed, with a
 * row in `archived_files` saying where it came from, what it belonged to, who
 * deleted it and when. The Archive page (`/archive`) lists them; an admin can
 * delete one for good.
 *
 * Files live in `uploads/archive` (served by `/api/files/archive/`).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { fileURLToPath } from 'url';
import db from '../database.js';

// Same as lib/productDocs.ts (not imported from there: productDocs archives through this module)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
export const archiveDir = path.join(uploadsBase, 'archive');
const SAFE = /^[a-zA-Z0-9._-]+$/;

export interface ArchiveMeta {
  /** Where in the app it was: "Operations", "Suppliers", "Customer invoices"… */
  section: string;
  /** What it belonged to: "SOBE20260125 — Bill of Lading", a supplier's name… */
  context?: string | null;
  /** The name it had in the app (defaults to the stored name) */
  fileName?: string | null;
  reason?: 'deleted' | 'replaced';
}

export interface ArchiveBy { id: number | null; name: string | null }

/** Who the current request is for — set by authenticateToken, read when a deep helper archives a file. */
export const requestUser = new AsyncLocalStorage<ArchiveBy>();

function byOf(by?: ArchiveBy | null): ArchiveBy {
  return by ?? requestUser.getStore() ?? { id: null, name: null };
}

/** `{ id, name }` of the signed-in user of a request. */
export function archivedBy(req: { user?: { userId: number; display_name: string } }): ArchiveBy {
  return { id: req.user?.userId ?? null, name: req.user?.display_name ?? null };
}

function record(stored: string, size: number, meta: ArchiveMeta, by?: ArchiveBy | null) {
  const who = byOf(by);
  db.prepare(`INSERT INTO archived_files (section, context, file_name, stored_name, size, reason, deleted_by_id, deleted_by_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(meta.section, meta.context || null, (meta.fileName || stored).slice(0, 300), stored, size,
      meta.reason || 'deleted', who.id, who.name);
}

function storedNameFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

/**
 * Moves the file at `abs` into the archive (nothing happens when it is
 * missing). Never throws: when the archive can't take it, the file is removed
 * as before so the delete still goes through.
 */
export function archiveFile(abs: string, meta: ArchiveMeta, by?: ArchiveBy | null): boolean {
  try {
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
    fs.mkdirSync(archiveDir, { recursive: true });
    const name = meta.fileName || path.basename(abs);
    const stored = storedNameFor(name);
    const target = path.join(archiveDir, stored);
    const size = fs.statSync(abs).size;
    try {
      fs.renameSync(abs, target);
    } catch {
      fs.copyFileSync(abs, target);
      fs.unlinkSync(abs);
    }
    record(stored, size, { ...meta, fileName: name }, by);
    return true;
  } catch (err: any) {
    console.error('[archive] could not archive', abs, err?.message || err);
    try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* best effort */ }
    return false;
  }
}

/** Section + number of the operation / NCO a document belonged to ("Operations", "SOBE20260125"). */
export function ownerOf(operationId?: number | null, ncoId?: number | null): { section: string; number: string } {
  if (ncoId) {
    const n = db.prepare('SELECT nco_number FROM non_commercial_operations WHERE id = ?').get(ncoId) as any;
    return { section: 'Non-commercial operations', number: n?.nco_number || '' };
  }
  const o = operationId ? db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(operationId) as any : null;
  return { section: 'Operations', number: o?.operation_number || '' };
}

/** "SOBE20260125 — Invoice CIBE…" without empty parts. */
export function contextOf(...parts: Array<string | null | undefined>): string {
  return parts.map(p => (p || '').trim()).filter(Boolean).join(' — ');
}

/** archiveFile for a stored upload: `uploads/<subfolder>/<storedName>` (name must be a plain file name). */
export function archiveStored(subfolder: string, storedName: string | null | undefined, meta: ArchiveMeta, by?: ArchiveBy | null): boolean {
  if (!storedName) return false;
  const base = path.basename(String(storedName));
  if (!SAFE.test(base)) return false;
  return archiveFile(path.join(uploadsBase, subfolder, base), meta, by);
}

/** Archives file content kept in the database (e.g. a supplier invoice's embedded PDF). */
export function archiveBuffer(content: Buffer, meta: ArchiveMeta & { fileName: string }, by?: ArchiveBy | null): boolean {
  try {
    if (!content?.length) return false;
    fs.mkdirSync(archiveDir, { recursive: true });
    const stored = storedNameFor(meta.fileName);
    fs.writeFileSync(path.join(archiveDir, stored), content);
    record(stored, content.length, meta, by);
    return true;
  } catch (err: any) {
    console.error('[archive] could not archive content', meta.fileName, err?.message || err);
    return false;
  }
}
