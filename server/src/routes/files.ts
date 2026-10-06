import { Router, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const router = Router();

// Only these render in the browser; anything else (e.g. an old batch document
// that is HTML or SVG) is sent as a download so it can never run as a page on
// the app's origin
const INLINE_TYPES = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif']);

function serveFile(subfolder: string) {
  return (req: Request, res: Response) => {
    const filename = req.params.filename as string;
    // Allowlist: only timestamps, hex chars, dots, hyphens — no traversal possible
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const filePath = path.join(uploadsBase, subfolder, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    if (!INLINE_TYPES.has(path.extname(filename).toLowerCase())) {
      res.attachment(filename);
      res.type('application/octet-stream');
    }
    res.sendFile(filePath);
  };
}

router.get('/invoices/:filename', serveFile('invoices'));
router.get('/payments/:filename', serveFile('payments'));
router.get('/wire-transfers/:filename', serveFile('wire-transfers'));
router.get('/orders/:filename', serveFile('orders'));
router.get('/operation-docs/:filename', serveFile('operation-docs'));
router.get('/batch-documents/:filename', serveFile('batch-documents'));
router.get('/product-docs/:filename', serveFile('product-docs'));

export default router;
