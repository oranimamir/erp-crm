import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import db from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// backup.ts lives in server/src/lib, so the DB (server/data/erp.db) is two levels up,
// matching database.ts which is in server/src and uses one '..'.
const dbPath      = process.env.DB_PATH      || path.join(__dirname, '..', '..', 'data', 'erp.db');
const uploadsBase = process.env.UPLOADS_PATH  || path.join(__dirname, '..', '..', 'uploads');
const backupsDir  = process.env.BACKUPS_PATH  || path.join(__dirname, '..', '..', 'backups');

const MAX_BACKUPS = 4; // keep ~1 month of weekly backups

export function getBackupsDir() { return backupsDir; }

// ── Categorized invoice files ───────────────────────────────────────────────────
// Add every invoice file to the archive foldered by category, using its ORIGINAL
// uploaded filename. Categories:
//   Customer Invoices / Supplier Invoices  → disk files in uploads/invoices
//   Demo Suppliers / Sales Activities Suppliers → base64 embedded_pdf in demo_invoices
// `prefix` nests the whole tree (e.g. 'Invoices by Category/') for the full backup.

function sanitizeName(name: string): string {
  return (name || 'file').replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || 'file';
}

// Ensure a unique name within a folder — original names can collide across invoices.
function uniqueName(used: Set<string>, folder: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let i = 1;
  while (used.has(`${folder}/${candidate.toLowerCase()}`)) {
    candidate = `${base} (${i})${ext}`;
    i++;
  }
  used.add(`${folder}/${candidate.toLowerCase()}`);
  return candidate;
}

function addCategorizedInvoices(archive: archiver.Archiver, prefix = ''): void {
  const used = new Set<string>();

  // Disk-backed customer + supplier invoices (uploads/invoices/<file_path>).
  const diskInvoices = db.prepare(
    `SELECT type, invoice_number, file_path, file_name FROM invoices WHERE file_path IS NOT NULL`
  ).all() as any[];
  for (const inv of diskInvoices) {
    const full = path.join(uploadsBase, 'invoices', inv.file_path);
    if (!fs.existsSync(full)) continue;
    const folder = `${prefix}${inv.type === 'supplier' ? 'Supplier Invoices' : 'Customer Invoices'}`;
    const orig = sanitizeName(inv.file_name || inv.file_path);
    const name = uniqueName(used, folder, orig);
    archive.file(full, { name: `${folder}/${name}` });
  }

  // Embedded demo / sales-activities invoices (base64 PDF stored in the DB).
  let demoRows: any[] = [];
  try {
    demoRows = db.prepare(
      `SELECT domain, invoice_id, supplier, pdf_filename, embedded_pdf FROM demo_invoices WHERE embedded_pdf IS NOT NULL`
    ).all() as any[];
  } catch { /* table may not exist */ }
  for (const r of demoRows) {
    const folder = `${prefix}${r.domain === 'sales' ? 'Sales Activities Suppliers' : 'Demo Suppliers'}`;
    let b64 = String(r.embedded_pdf);
    const at = b64.indexOf('base64,');
    if (at >= 0) b64 = b64.slice(at + 7); // strip data-URI prefix if present
    let buf: Buffer;
    try { buf = Buffer.from(b64, 'base64'); } catch { continue; }
    if (!buf.length) continue;
    let orig = sanitizeName(r.pdf_filename || `${r.supplier || 'invoice'}-${r.invoice_id || ''}`);
    if (!/\.[a-z0-9]+$/i.test(orig)) orig += '.pdf';
    const name = uniqueName(used, folder, orig);
    archive.append(buf, { name: `${folder}/${name}` });
  }
}

/**
 * Pipe a ZIP of invoice files organized into category folders (original filenames)
 * into any writable stream. Used by the on-demand "download invoices by category".
 */
export function createCategorizedInvoiceArchive(output: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', resolve);
    output.on('finish', resolve);
    archive.pipe(output);
    addCategorizedInvoices(archive);
    archive.finalize();
  });
}

/**
 * Pipe a full ZIP backup (DB + all uploaded files) into any writable stream.
 * Used by both the on-demand HTTP download and the scheduled file writer.
 */
export function createBackupArchive(output: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', resolve);
    // for response streams 'finish' fires instead of 'close'
    output.on('finish', resolve);

    archive.pipe(output);

    if (fs.existsSync(dbPath)) {
      archive.file(dbPath, { name: 'erp.db' });
    }

    if (fs.existsSync(uploadsBase)) {
      archive.directory(uploadsBase, 'uploads');
    }

    // Also include invoice files organized by category with original filenames,
    // alongside the raw uploads/ tree (raw kept for full fidelity).
    addCategorizedInvoices(archive, 'Invoices by Category/');

    archive.finalize();
  });
}

/**
 * Write a timestamped backup ZIP to the backups folder and prune old ones.
 * Called by the weekly cron job.
 */
export async function runScheduledBackup(): Promise<string> {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename  = `erp-backup-${timestamp}.zip`;
  const outputPath = path.join(backupsDir, filename);

  const output = fs.createWriteStream(outputPath);
  await createBackupArchive(output);

  // Prune: keep only the most recent MAX_BACKUPS files
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('erp-backup-') && f.endsWith('.zip'))
    .sort(); // ISO timestamps sort lexicographically = chronologically

  for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    fs.unlinkSync(path.join(backupsDir, f));
  }

  console.log(`[Backup] Saved ${filename} — kept last ${MAX_BACKUPS} weekly backups`);
  return filename;
}

/** List saved weekly backup files, newest first. */
export function listBackups(): { filename: string; size: number; created_at: string }[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('erp-backup-') && f.endsWith('.zip'))
    .sort().reverse()
    .map(f => {
      const stats = fs.statSync(path.join(backupsDir, f));
      return { filename: f, size: stats.size, created_at: stats.mtime.toISOString() };
    });
}
