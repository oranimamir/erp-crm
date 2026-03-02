import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath      = process.env.DB_PATH      || path.join(__dirname, '..', 'data', 'erp.db');
const uploadsBase = process.env.UPLOADS_PATH  || path.join(__dirname, '..', '..', 'uploads');
const backupsDir  = process.env.BACKUPS_PATH  || path.join(__dirname, '..', '..', 'backups');

const MAX_BACKUPS = 4; // keep ~1 month of weekly backups

export function getBackupsDir() { return backupsDir; }

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
