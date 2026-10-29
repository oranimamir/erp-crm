import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import db, { getStorageInfo } from '../database.js';

const router = Router();

// GET /api/health/storage — admin-only diagnostic that exposes the resolved
// persistence paths, DB file size, and key row counts. Use this in production
// to verify that DB_PATH / UPLOADS_PATH / BACKUPS_PATH point at a persistent
// volume and that data is actually being preserved across deploys.
router.get('/storage', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const info = getStorageInfo();
  const counts: Record<string, number | null> = {};
  for (const t of ['operations', 'invoices', 'orders', 'customers', 'suppliers', 'operation_documents', 'wire_transfers', 'payments', 'working_capital_forecasts']) {
    try {
      const r = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any;
      counts[t] = Number(r?.c ?? 0);
    } catch {
      counts[t] = null;
    }
  }
  // Dangling references are invisible in normal use; surface the count here
  let fkViolations: number | null = null;
  try {
    fkViolations = (db.prepare('PRAGMA foreign_key_check').all() as any[]).length;
  } catch {
    fkViolations = null;
  }

  let uploadsSize = 0;
  let uploadsCount = 0;
  try {
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) {
          try {
            uploadsSize += fs.statSync(full).size;
            uploadsCount += 1;
          } catch {}
        }
      }
    };
    walk(info.uploads_path);
  } catch {}

  res.json({
    ...info,
    disk: diskBreakdown(info),
    row_counts: counts,
    foreign_key_violations: fkViolations,
    uploads_file_count: uploadsCount,
    uploads_total_bytes: uploadsSize,
  });
});

/** Size and file count of a folder (or file), leaving out the `skip` folders. */
function sizeOf(target: string, skip: Set<string>): { bytes: number; files: number } {
  let bytes = 0, files = 0;
  const walk = (p: string) => {
    if (skip.has(p)) return;
    let st: fs.Stats;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) {
      let entries: string[] = [];
      try { entries = fs.readdirSync(p); } catch { return; }
      for (const e of entries) walk(path.join(p, e));
    } else if (st.isFile()) { bytes += st.size; files += 1; }
  };
  walk(target);
  return { bytes, files };
}

const UPLOAD_LABELS: Record<string, string> = {
  archive: 'Archive (deleted / replaced files)',
  'operation-docs': 'Operation & NCO documents',
  invoices: 'Customer & supplier invoices',
  'wire-transfers': 'Wire transfers',
  orders: 'Order documents',
  'supplier-docs': 'Supplier documents',
  'product-docs': 'Product documents library',
  'batch-documents': 'Batch documents',
  'technology-expenses': 'Technology expenses',
};

/**
 * Where the disk space goes: the database (and the supplier invoice PDFs kept
 * inside it), its safety copies, the saved backups and each uploads folder;
 * plus the rest of the volume when all three paths share one folder.
 */
function diskBreakdown(info: ReturnType<typeof getStorageInfo>) {
  const dbFile = path.resolve(info.db_path);
  const dataDir = path.dirname(dbFile);
  const uploads = path.resolve(info.uploads_path);
  const backups = path.resolve(info.backups_path);
  const inside = (child: string, parent: string) => child !== parent && child.startsWith(parent + path.sep);
  const items: Array<{ label: string; bytes: number; files: number; hint?: string }> = [];

  const dbSize = sizeOf(dbFile, new Set());
  let pdfBytes = 0;
  try { pdfBytes = Number((db.prepare('SELECT COALESCE(SUM(LENGTH(embedded_pdf)), 0) AS b FROM demo_invoices').get() as any)?.b || 0); } catch { /* no table */ }
  items.push({ label: 'Database', ...dbSize,
    hint: pdfBytes ? `about ${(pdfBytes / 1048576).toFixed(0)} MB of it is supplier invoice PDFs stored inside the database` : undefined });

  const nestedSkip = new Set([dbFile, uploads, backups]);
  const copies = sizeOf(dataDir, nestedSkip);
  if (copies.files) items.push({ label: 'Database safety copies', ...copies, hint: 'Earlier copies of the database kept in case the main file is damaged' });

  const backupSize = sizeOf(backups, new Set());
  items.push({ label: 'Saved backups', ...backupSize, hint: 'The scheduled backups (the last 4 are kept); each is a ZIP of the database and every uploaded file' });

  const uploadsSkip = new Set([backups, dbFile]);
  let entries: string[] = [];
  try { entries = fs.readdirSync(uploads); } catch { /* no uploads yet */ }
  for (const name of entries.sort()) {
    const full = path.join(uploads, name);
    if (uploadsSkip.has(full)) continue;
    const size = sizeOf(full, uploadsSkip);
    if (size.bytes) items.push({ label: UPLOAD_LABELS[name] || `Uploads: ${name}`, ...size });
  }

  // The rest of the volume, when the three paths share a persistent folder
  let other: { bytes: number; files: number } | null = null;
  let root: string | null = null;
  if (info.db_path_from_env && info.uploads_path_from_env && info.backups_path_from_env) {
    const parts = [dataDir, uploads, backups].map(p => p.split(path.sep));
    const common: string[] = [];
    for (let i = 0; parts.every(p => i < p.length && p[i] === parts[0][i]); i++) common.push(parts[0][i]);
    root = common.join(path.sep) || null;
    if (root && root !== path.sep) {
      const total = sizeOf(root, new Set());
      const counted = items.reduce((s, x) => s + x.bytes, 0);
      other = { bytes: Math.max(0, total.bytes - counted), files: Math.max(0, total.files - items.reduce((s, x) => s + x.files, 0)) };
      if (other.bytes > 1048576) items.push({ label: 'Other files on the volume', ...other, hint: `Not in the database, uploads or backups folders (under ${root})` });
    } else root = null;
  }

  items.sort((a, b) => b.bytes - a.bytes);
  return {
    items,
    total_bytes: items.reduce((s, x) => s + x.bytes, 0),
    root,
    backups_inside_uploads: inside(backups, uploads),
  };
}

export default router;
