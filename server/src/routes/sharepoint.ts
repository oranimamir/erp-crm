import { Router, Request, Response } from 'express';
import db from '../database.js';
import { scanNewOperations, downloadFileBuffer } from '../lib/sharepoint.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const router = Router();

// ── Manual scan ───────────────────────────────────────────────────────────────

router.get('/scan', async (_req: Request, res: Response) => {
  try {
    const result = await scanNewOperations();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Scan failed' });
  }
});

// ── Pending count (used by header badge) ──────────────────────────────────────

router.get('/pending/count', (_req: Request, res: Response) => {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM sharepoint_pending WHERE status = 'pending'"
  ).get() as any;
  res.json({ count: row.count });
});

// ── Pending list ──────────────────────────────────────────────────────────────

router.get('/pending', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const status = (req.query.status as string) || 'pending';
  const offset = (page - 1) * limit;

  const total = (db.prepare(
    'SELECT COUNT(*) as count FROM sharepoint_pending WHERE status = ?'
  ).get(status) as any).count;

  const items = db.prepare(`
    SELECT sp.*, u.display_name as imported_by_name, op.operation_number as imported_operation_number
    FROM sharepoint_pending sp
    LEFT JOIN users u ON sp.imported_by = u.id
    LEFT JOIN operations op ON sp.operation_id = op.id
    WHERE sp.status = ?
    ORDER BY sp.detected_at DESC
    LIMIT ? OFFSET ?
  `).all(status, limit, offset);

  res.json({ data: items, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// ── Import ────────────────────────────────────────────────────────────────────

router.post('/pending/:id/import', async (req: Request, res: Response) => {
  const pending = db.prepare('SELECT * FROM sharepoint_pending WHERE id = ?').get(req.params.id) as any;
  if (!pending) { res.status(404).json({ error: 'Pending item not found' }); return; }
  if (pending.status !== 'pending') {
    res.status(400).json({ error: `Item is already ${pending.status}` });
    return;
  }

  let files: Array<{ name: string; downloadUrl: string; type: string }>;
  try {
    files = JSON.parse(pending.files);
  } catch {
    res.status(400).json({ error: 'Invalid files data' });
    return;
  }

  // Ensure upload directories exist
  fs.mkdirSync(path.join(uploadsBase, 'operation-docs'), { recursive: true });
  fs.mkdirSync(path.join(uploadsBase, 'invoices'), { recursive: true });

  try {
    // 1. Create the operation
    const opResult = db.prepare(
      "INSERT INTO operations (operation_number, notes) VALUES (?, ?)"
    ).run(
      pending.folder_name,
      `Imported from SharePoint on ${new Date().toISOString().split('T')[0]}`
    );
    const operationId = opResult.lastInsertRowid;

    // 2. Download and store each file
    for (const file of files) {
      if (file.type === 'other' || !file.downloadUrl) continue;

      const ext = path.extname(file.name).toLowerCase() || '.pdf';
      const generatedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

      let buffer: Buffer;
      try {
        buffer = await downloadFileBuffer(file.downloadUrl);
      } catch (dlErr: any) {
        console.warn(`[SharePoint import] Could not download "${file.name}":`, dlErr.message);
        continue;
      }

      if (file.type === 'order') {
        fs.writeFileSync(path.join(uploadsBase, 'operation-docs', generatedName), buffer);
        db.prepare(
          'INSERT INTO operation_documents (operation_id, file_path, file_name, notes) VALUES (?, ?, ?, ?)'
        ).run(operationId, generatedName, file.name, 'Imported from SharePoint');
      } else if (file.type === 'invoice') {
        fs.writeFileSync(path.join(uploadsBase, 'invoices', generatedName), buffer);
        // Generate a unique invoice number from the folder name + timestamp
        const invoiceNumber = `${pending.folder_name}-${Date.now()}`;
        db.prepare(`
          INSERT INTO invoices (invoice_number, type, amount, currency, status, file_path, file_name, operation_id)
          VALUES (?, 'customer', 0, 'EUR', 'draft', ?, ?, ?)
        `).run(invoiceNumber, generatedName, file.name, operationId);
      }
    }

    // 3. Mark as imported
    db.prepare(`
      UPDATE sharepoint_pending
      SET status = 'imported', operation_id = ?, imported_at = datetime('now'), imported_by = ?
      WHERE id = ?
    `).run(operationId, req.user!.userId, pending.id);

    const op = db.prepare('SELECT * FROM operations WHERE id = ?').get(operationId);
    res.status(201).json({ operation: op, operationId });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

// ── Ignore ────────────────────────────────────────────────────────────────────

router.post('/pending/:id/ignore', (req: Request, res: Response) => {
  const pending = db.prepare('SELECT * FROM sharepoint_pending WHERE id = ?').get(req.params.id) as any;
  if (!pending) { res.status(404).json({ error: 'Pending item not found' }); return; }
  if (pending.status !== 'pending') {
    res.status(400).json({ error: `Item is already ${pending.status}` });
    return;
  }
  db.prepare("UPDATE sharepoint_pending SET status = 'ignored' WHERE id = ?").run(pending.id);
  res.json({ message: 'Ignored' });
});

export default router;
