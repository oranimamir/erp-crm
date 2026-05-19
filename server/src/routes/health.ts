import { Router, Request, Response } from 'express';
import fs from 'fs';
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
    row_counts: counts,
    uploads_file_count: uploadsCount,
    uploads_total_bytes: uploadsSize,
  });
});

export default router;
