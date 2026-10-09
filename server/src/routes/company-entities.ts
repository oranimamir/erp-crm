import { Router, Request, Response } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { ENTITY_CODE_PATTERN, listEntities } from '../lib/companyEntity.js';
import { buildCompanyDetailsPdf } from '../lib/document-pdf.js';
import fs from 'fs';
import path from 'path';
import { uploadEntityDoc } from '../middleware/upload.js';
import { uploadsBase } from '../lib/productDocs.js';
import { readBankDetails } from '../lib/bankDetailsReader.js';

/** The TripleW entities that issue documents — edited on the TripleW Details page. */
const router = Router();

const FIELDS = [
  'company_name', 'address1', 'address2', 'address3', 'tel', 'email', 'vat', 'kvk',
  'contact_person', 'bank_name', 'bank_address',
  'usd_account', 'usd_bic', 'eur_account', 'eur_bic', 'delivery_address',
] as const;

const BANK_FIELDS = ['bank_name', 'bank_address', 'usd_account', 'usd_bic', 'eur_account', 'eur_bic'] as const;
type Bank = Record<typeof BANK_FIELDS[number], string>;

function clean(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function cleanBank(raw: any): Bank {
  return Object.fromEntries(BANK_FIELDS.map(f => [f, clean(raw?.[f])])) as Bank;
}

/** The entity's banks; one saved before there could be several has just the bank in its columns. */
function banksOf(row: any): Bank[] {
  try {
    const list = JSON.parse(row?.banks || 'null');
    if (Array.isArray(list) && list.length) return list.map(cleanBank);
  } catch { /* unreadable list → the columns */ }
  return [cleanBank(row)];
}

function present(row: any): any {
  if (!row) return row;
  const banks = banksOf(row);
  return { ...row, banks, default_bank: Math.min(Math.max(Number(row.default_bank) || 0, 0), banks.length - 1) };
}

function byCode(code: string): any {
  return db.prepare('SELECT * FROM company_entities WHERE code = ?').get(code);
}

// Everyone signed in reads the entities (documents are issued from them);
// only an admin changes them
function requireAdmin(req: Request, res: Response, next: Function) {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  next();
}

router.get('/', (_req: Request, res: Response) => {
  res.json(listEntities().map(present));
});

// GET /api/company-entities/:code/pdf?bank=all|<index> — the entity's details
// sheet to send (invoice design); by default with its default bank only
router.get('/:code/pdf', async (req: Request, res: Response) => {
  const entity = present(byCode(String(req.params.code).toUpperCase()));
  if (!entity) { res.status(404).json({ error: 'Entity not found' }); return; }
  const usable = (b: Bank) => BANK_FIELDS.some(f => b[f]);
  const wanted = String(req.query.bank ?? '');
  const banks: Bank[] = wanted === 'all'
    ? entity.banks.filter(usable)
    : [entity.banks[/^\d+$/.test(wanted) && Number(wanted) < entity.banks.length ? Number(wanted) : entity.default_bank]].filter(usable);
  try {
    const pdf = await buildCompanyDetailsPdf({
      code: entity.code, company_name: clean(entity.company_name),
      address1: clean(entity.address1), address2: clean(entity.address2), address3: clean(entity.address3),
      tel: clean(entity.tel), email: clean(entity.email), vat: clean(entity.vat), kvk: clean(entity.kvk),
      contact_person: clean(entity.contact_person), delivery_address: clean(entity.delivery_address),
      banks, date: new Date().toISOString().slice(0, 10),
    });
    res.attachment(`${clean(entity.company_name).replace(/[\\/:*?"<>|]+/g, '-') || entity.code} - Company details.pdf`);
    res.type('application/pdf');
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to build the PDF' });
  }
});

// ── Account ownership documents (bank letters) ─────────────────────────────

const entityDocsDir = path.join(uploadsBase, 'entity-docs');
const SAFE = /^[a-zA-Z0-9._-]+$/;

function unlinkEntityFile(name: string | null | undefined) {
  if (!name || !SAFE.test(name)) return;
  const full = path.join(entityDocsDir, name);
  if (fs.existsSync(full)) { try { fs.unlinkSync(full); } catch { /* best effort */ } }
}

function presentDoc(row: any) {
  let extracted = null;
  try { extracted = row.extracted ? JSON.parse(row.extracted) : null; } catch { /* unreadable */ }
  return { ...row, extracted };
}

function docsOf(code: string) {
  return (db.prepare('SELECT * FROM company_entity_documents WHERE entity_code = ? ORDER BY created_at DESC, id DESC').all(code) as any[]).map(presentDoc);
}

/** Reads one stored document and saves the reading (or why it failed). */
async function readAndStore(doc: any): Promise<void> {
  try {
    if (!SAFE.test(doc.file_path)) throw new Error('Invalid file');
    const reading = await readBankDetails(fs.readFileSync(path.join(entityDocsDir, doc.file_path)));
    db.prepare('UPDATE company_entity_documents SET extracted = ?, read_error = ? WHERE id = ?')
      .run(reading ? JSON.stringify(reading) : null, reading ? null : 'No bank details found on the document', doc.id);
  } catch (err: any) {
    const msg = err?.name === 'AiBudgetError' ? 'Monthly AI spending limit reached' : (err?.message || 'Could not read the document');
    db.prepare('UPDATE company_entity_documents SET read_error = ? WHERE id = ?').run(String(msg).slice(0, 300), doc.id);
  }
}

router.get('/:code/documents', async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  if (!byCode(code)) { res.status(404).json({ error: 'Entity not found' }); return; }
  // Documents that failed on the forced-tool error (fixed since) are read again once
  const stale = db.prepare("SELECT * FROM company_entity_documents WHERE entity_code = ? AND extracted IS NULL AND read_error LIKE '%tool_choice%'").all(code) as any[];
  for (const doc of stale) await readAndStore(doc);
  if (stale.length) db.saveToDisk();
  res.json(docsOf(code));
});

// POST /api/company-entities/:code/documents — multipart files (PDF / images); each is read for its bank details
router.post('/:code/documents', requireAdmin, uploadEntityDoc.array('files', 20), async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const code = String(req.params.code).toUpperCase();
  const entity = byCode(code);
  if (!entity) { files.forEach(f => unlinkEntityFile(f.filename)); res.status(404).json({ error: 'Entity not found' }); return; }
  if (!files.length) { res.status(400).json({ error: 'Choose at least one file' }); return; }
  const notes = clean(req.body?.notes) || null;
  for (const f of files) {
    const r = db.prepare('INSERT INTO company_entity_documents (entity_code, title, file_path, file_name, notes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(code, path.parse(f.originalname).name, f.filename, f.originalname, notes, req.user?.userId ?? null);
    await readAndStore(db.prepare('SELECT * FROM company_entity_documents WHERE id = ?').get(r.lastInsertRowid));
  }
  db.saveToDisk();
  notifyAdmin({ action: 'updated', entity: 'TripleW Entity', label: `${entity.company_name} (${code})`, detail: `${files.length} account ownership document${files.length === 1 ? '' : 's'} uploaded`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.status(201).json(docsOf(code));
});

// POST /api/company-entities/:code/documents/:docId/read — read again (e.g. after an AI outage)
router.post('/:code/documents/:docId/read', requireAdmin, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const doc = db.prepare('SELECT * FROM company_entity_documents WHERE id = ? AND entity_code = ?').get(req.params.docId, code) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  await readAndStore(doc);
  db.saveToDisk();
  res.json(presentDoc(db.prepare('SELECT * FROM company_entity_documents WHERE id = ?').get(doc.id)));
});

router.delete('/:code/documents/:docId', requireAdmin, (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const doc = db.prepare('SELECT * FROM company_entity_documents WHERE id = ? AND entity_code = ?').get(req.params.docId, code) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  db.prepare('DELETE FROM company_entity_documents WHERE id = ?').run(doc.id);
  unlinkEntityFile(doc.file_path);
  db.saveToDisk();
  res.json({ ok: true });
});

router.post('/', requireAdmin, (req: Request, res: Response) => {
  const code = clean(req.body?.code).toUpperCase();
  const name = clean(req.body?.company_name);
  if (!ENTITY_CODE_PATTERN.test(code)) {
    res.status(400).json({ error: 'The code must be 2–4 letters, e.g. US' }); return;
  }
  if (!name) { res.status(400).json({ error: 'Company name is required' }); return; }
  if (byCode(code)) { res.status(409).json({ error: `Entity ${code} already exists` }); return; }

  db.prepare(`INSERT INTO company_entities (code, ${FIELDS.join(', ')}) VALUES (?, ${FIELDS.map(() => '?').join(', ')})`)
    .run(code, ...FIELDS.map(f => (f === 'company_name' ? name : clean(req.body?.[f]))));
  db.saveToDisk();

  notifyAdmin({ action: 'created', entity: 'TripleW Entity', label: `${name} (${code})`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.status(201).json(present(byCode(code)));
});

router.put('/:code', requireAdmin, (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const existing = byCode(code);
  if (!existing) { res.status(404).json({ error: 'Entity not found' }); return; }

  const next: Record<string, string> = Object.fromEntries(FIELDS.map(f => [f, req.body?.[f] !== undefined ? clean(req.body[f]) : existing[f]]));
  if (!next.company_name) { res.status(400).json({ error: 'Company name is required' }); return; }

  // Banks: the list as sent, or the stored one with this request's bank fields
  // applied to its default. Empty entries are dropped; the default bank is
  // copied into the bank columns, which is what documents print.
  const current = present(existing);
  const pick = (count: number): number | null => {
    const wanted = req.body?.default_bank !== undefined ? Number(req.body.default_bank) : current.default_bank;
    return Number.isInteger(wanted) && wanted >= 0 && wanted < count ? wanted : null;
  };
  let banks: Bank[];
  let chosen: Bank | undefined;
  if (Array.isArray(req.body?.banks)) {
    const sent: Bank[] = req.body.banks.map(cleanBank);
    chosen = sent[pick(sent.length) ?? 0];
    banks = sent.filter(b => b === chosen || BANK_FIELDS.some(f => b[f]));
  } else {
    banks = current.banks;
    const index = pick(banks.length) ?? current.default_bank;
    // A newly chosen default keeps its own details; otherwise the fields sent edit it
    if (index === current.default_bank) banks[index] = cleanBank(next);
    chosen = banks[index];
  }
  if (!chosen) { chosen = cleanBank({}); banks = [chosen]; }
  for (const f of BANK_FIELDS) next[f] = chosen[f];

  db.prepare(`UPDATE company_entities SET ${FIELDS.map(f => `${f} = ?`).join(', ')}, banks = ?, default_bank = ?, updated_at = datetime('now') WHERE code = ?`)
    .run(...FIELDS.map(f => next[f]), JSON.stringify(banks), banks.indexOf(chosen), code);

  if (req.body?.is_default === true) {
    db.prepare('UPDATE company_entities SET is_default = CASE WHEN code = ? THEN 1 ELSE 0 END').run(code);
  }
  db.saveToDisk();

  notifyAdmin({ action: 'updated', entity: 'TripleW Entity', label: `${next.company_name} (${code})`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json(present(byCode(code)));
});

router.delete('/:code', requireAdmin, (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const existing = byCode(code);
  if (!existing) { res.status(404).json({ error: 'Entity not found' }); return; }
  if (existing.is_default) { res.status(400).json({ error: 'Make another entity the default before deleting this one' }); return; }
  if (listEntities().length <= 1) { res.status(400).json({ error: 'At least one entity is required' }); return; }

  db.prepare('DELETE FROM company_entities WHERE code = ?').run(code);
  for (const d of db.prepare('SELECT file_path FROM company_entity_documents WHERE entity_code = ?').all(code) as any[]) unlinkEntityFile(d.file_path);
  db.prepare('DELETE FROM company_entity_documents WHERE entity_code = ?').run(code);
  db.saveToDisk();

  notifyAdmin({ action: 'deleted', entity: 'TripleW Entity', label: `${existing.company_name} (${code})`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: `Entity ${code} deleted` });
});

export default router;
