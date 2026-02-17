import { Router, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

function serveFile(subfolder: string) {
  return (req: Request, res: Response) => {
    const filename = req.params.filename as string;
    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const filePath = path.join(__dirname, '..', '..', 'uploads', subfolder, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.sendFile(filePath);
  };
}

router.get('/invoices/:filename', serveFile('invoices'));
router.get('/payments/:filename', serveFile('payments'));
router.get('/wire-transfers/:filename', serveFile('wire-transfers'));

export default router;
