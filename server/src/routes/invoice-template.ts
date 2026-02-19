import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PDFParse } from 'pdf-parse';

const router = Router();

const uploadsBase = process.env.UPLOADS_PATH || path.join(process.cwd(), 'uploads');
const templateCfgPath = path.join(uploadsBase, 'invoice-template-config.json');

// Supported template extensions
const ALLOWED_EXTS = ['.pdf', '.docx'];

// Find whichever template file exists
function findTemplateFile(): string | null {
  for (const ext of ALLOWED_EXTS) {
    const p = path.join(uploadsBase, `invoice-template${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function getTemplatePdfPath(): string | null {
  const p = path.join(uploadsBase, 'invoice-template.pdf');
  return fs.existsSync(p) ? p : null;
}

// multer – save with correct extension
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadsBase, { recursive: true });
    cb(null, uploadsBase);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `invoice-template${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF or Word (.docx) files are allowed'));
  },
});

// ── Text extraction helpers ───────────────────────────────────────────────
function extractConfig(text: string): Record<string, string> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cfg: Record<string, string> = {};

  for (const line of lines) {
    const lc = line.toLowerCase();
    if      (lc.startsWith('tel:')   || lc.startsWith('tel '))   cfg.company_tel   = line.replace(/^tel[: ]*/i, '').trim();
    else if (lc.startsWith('phone:') || lc.startsWith('phone ')) cfg.company_tel   = line.replace(/^phone[: ]*/i, '').trim();
    else if (lc.startsWith('email:') || lc.startsWith('email ')) cfg.company_email = line.replace(/^email[: ]*/i, '').trim();
    else if (lc.startsWith('vat:')   || lc.startsWith('vat '))   cfg.company_vat   = line.replace(/^vat[: ]*/i, '').trim();
    else if (lc.startsWith('iban:')  || lc.startsWith('iban '))  cfg.iban          = line.replace(/^iban[: ]*/i, '').trim();
    else if (lc.startsWith('bic:')   || lc.startsWith('bic '))   cfg.bic           = line.replace(/^bic[: ]*/i, '').trim();
    else if (lc.startsWith('swift:') || lc.startsWith('swift ')) cfg.bic           = line.replace(/^swift[: ]*/i, '').trim();
    else if (lc.startsWith('bank:')  || lc.startsWith('bank '))  cfg.bank_name     = line.replace(/^bank[: ]*/i, '').trim();
  }

  // Company name = first substantial, non-label, non-all-caps line
  const labelPrefixes = /^(tel|phone|email|vat|iban|bic|swift|bank|invoice|billing|contact|line|reference|commercial|packaging|quantity|price|total|terms|payment|details|date|sq#|ref#|po#|fax|remark|incoterm|delivery)/i;
  const nonLabels = lines.filter(l =>
    l.length > 3 && !labelPrefixes.test(l) && !l.match(/^\d/) && l !== l.toUpperCase()
  );
  if (nonLabels[0]) cfg.company_name     = nonLabels[0];
  if (nonLabels[1]) cfg.company_address1 = nonLabels[1];
  if (nonLabels[2]) cfg.company_address2 = nonLabels[2];

  return cfg;
}

async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === '.docx') {
    // Use mammoth for Word documents
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else {
    // PDF
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      return result.text;
    } catch {
      return '';
    }
  }
}

// ── GET / — return config ────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const templateFile = findTemplateFile();
  if (!templateFile) { res.json({ exists: false }); return; }

  let config: Record<string, string> = {};
  if (fs.existsSync(templateCfgPath)) {
    try { config = JSON.parse(fs.readFileSync(templateCfgPath, 'utf8')); } catch { /**/ }
  }
  const ext = path.extname(templateFile).toLowerCase();
  res.json({ exists: true, fileType: ext === '.docx' ? 'docx' : 'pdf', config });
});

// ── POST / — upload template ─────────────────────────────────────────────
router.post('/', upload.single('template'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  // Remove any previously stored template with a different extension
  for (const ext of ALLOWED_EXTS) {
    const old = path.join(uploadsBase, `invoice-template${ext}`);
    if (old !== req.file.path && fs.existsSync(old)) fs.unlinkSync(old);
  }

  let config: Record<string, string> = {};
  try {
    const text = await extractTextFromFile(req.file.path);
    config = extractConfig(text);
  } catch { /* extraction optional */ }

  fs.writeFileSync(templateCfgPath, JSON.stringify(config, null, 2));
  const ext = path.extname(req.file.originalname).toLowerCase();
  res.json({ exists: true, fileType: ext === '.docx' ? 'docx' : 'pdf', config });
});

// ── DELETE / — remove template ───────────────────────────────────────────
router.delete('/', (_req: Request, res: Response) => {
  for (const ext of ALLOWED_EXTS) {
    const p = path.join(uploadsBase, `invoice-template${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (fs.existsSync(templateCfgPath)) fs.unlinkSync(templateCfgPath);
  res.json({ exists: false });
});

export default router;
