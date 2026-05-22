import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');

/** Resolve an uploaded file to an absolute path, guarding against path traversal. */
export function resolveUpload(subfolder: string, filename: string): string | null {
  if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
  const p = path.join(uploadsBase, subfolder, filename);
  return fs.existsSync(p) ? p : null;
}

/** Turn an arbitrary label into a safe filename base (no path separators / illegal chars). */
export function safeName(label: string): string {
  return (label || 'file').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'file';
}

/** Stream a set of files to the response as a single ZIP download, de-duplicating names. */
export function streamZip(res: Response, zipName: string, files: { absPath: string; name: string }[]): void {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
  archive.pipe(res);

  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    const ext = path.extname(f.name);
    const base = f.name.slice(0, f.name.length - ext.length);
    let i = 1;
    while (used.has(name.toLowerCase())) {
      name = `${base} (${i})${ext}`;
      i++;
    }
    used.add(name.toLowerCase());
    archive.file(f.absPath, { name });
  }

  archive.finalize();
}
