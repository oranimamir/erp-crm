import { Router, Request, Response } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { ENTITY_CODE_PATTERN, listEntities } from '../lib/companyEntity.js';
import { buildCompanyDetailsPdf } from '../lib/document-pdf.js';

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
  db.saveToDisk();

  notifyAdmin({ action: 'deleted', entity: 'TripleW Entity', label: `${existing.company_name} (${code})`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: `Entity ${code} deleted` });
});

export default router;
