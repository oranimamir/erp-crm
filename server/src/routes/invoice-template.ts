import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PDFParse } from 'pdf-parse';

const router = Router();

const uploadsBase = process.env.UPLOADS_PATH || path.join(process.cwd(), 'uploads');
const templatePdfPath  = path.join(uploadsBase, 'invoice-template.pdf');
const templateCfgPath  = path.join(uploadsBase, 'invoice-template-config.json');

// multer – store directly as invoice-template.pdf
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadsBase, { recursive: true });
    cb(null, uploadsBase);
  },
  filename: (_req, _file, cb) => cb(null, 'invoice-template.pdf'),
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

// ── Text extraction helpers ───────────────────────────────────────────────
function extractConfig(text: string): Record<string, string> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cfg: Record<string, string> = {};

  for (const line of lines) {
    const lc = line.toLowerCase();
    if (lc.startsWith('tel:') || lc.startsWith('tel '))           cfg.company_tel     = line.replace(/^tel[: ]*/i, '').trim();
    else if (lc.startsWith('phone:') || lc.startsWith('phone '))  cfg.company_tel     = line.replace(/^phone[: ]*/i, '').trim();
    else if (lc.startsWith('email:') || lc.startsWith('email '))  cfg.company_email   = line.replace(/^email[: ]*/i, '').trim();
    else if (lc.startsWith('vat:')   || lc.startsWith('vat '))    cfg.company_vat     = line.replace(/^vat[: ]*/i, '').trim();
    else if (lc.startsWith('iban:')  || lc.startsWith('iban '))   cfg.iban            = line.replace(/^iban[: ]*/i, '').trim();
    else if (lc.startsWith('bic:')   || lc.startsWith('bic '))    cfg.bic             = line.replace(/^bic[: ]*/i, '').trim();
    else if (lc.startsWith('swift:') || lc.startsWith('swift '))  cfg.bic             = line.replace(/^swift[: ]*/i, '').trim();
    else if (lc.startsWith('bank:')  || lc.startsWith('bank '))   cfg.bank_name       = line.replace(/^bank[: ]*/i, '').trim();
  }

  // Company name = first substantial non-label line (>3 chars, not all-caps label)
  const labelPrefixes = /^(tel|phone|email|vat|iban|bic|swift|bank|invoice|billing|contact|line|reference|commercial|packaging|quantity|price|total|terms|payment|details|date|sq#|ref#|po#|fax|remark|incoterm|delivery)/i;
  const nonLabels = lines.filter(l =>
    l.length > 3 &&
    !labelPrefixes.test(l) &&
    !l.match(/^\d/) &&             // doesn't start with digit
    l !== l.toUpperCase()           // not all-caps
  );
  if (nonLabels[0]) cfg.company_name     = nonLabels[0];
  if (nonLabels[1]) cfg.company_address1 = nonLabels[1];
  if (nonLabels[2]) cfg.company_address2 = nonLabels[2];

  return cfg;
}

// ── GET / — return config (or empty) ────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const exists = fs.existsSync(templatePdfPath);
  if (!exists) { res.json({ exists: false }); return; }

  let config: Record<string, string> = {};
  if (fs.existsSync(templateCfgPath)) {
    try { config = JSON.parse(fs.readFileSync(templateCfgPath, 'utf8')); } catch { /**/ }
  }
  res.json({ exists: true, config });
});

// ── POST / — upload template ─────────────────────────────────────────────
router.post('/', upload.single('template'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  // Parse text to extract company info
  let config: Record<string, string> = {};
  try {
    const buffer = fs.readFileSync(templatePdfPath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    config = extractConfig(result.text);
  } catch { /* extraction optional – proceed without it */ }

  fs.writeFileSync(templateCfgPath, JSON.stringify(config, null, 2));
  res.json({ exists: true, config });
});

// ── DELETE / — remove template ───────────────────────────────────────────
router.delete('/', (_req: Request, res: Response) => {
  if (fs.existsSync(templatePdfPath))  fs.unlinkSync(templatePdfPath);
  if (fs.existsSync(templateCfgPath)) fs.unlinkSync(templateCfgPath);
  res.json({ exists: false });
});

export { templatePdfPath };
export default router;
