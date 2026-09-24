import { Router, Request, Response } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { ENTITY_CODE_PATTERN, listEntities } from '../lib/companyEntity.js';

/** The TripleW entities that issue documents — edited on the TripleW Details page. */
const router = Router();

const FIELDS = [
  'company_name', 'address1', 'address2', 'address3', 'tel', 'email', 'vat', 'kvk',
  'contact_person', 'bank_name', 'bank_address',
  'usd_account', 'usd_bic', 'eur_account', 'eur_bic', 'delivery_address',
] as const;

function clean(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function byCode(code: string): any {
  return db.prepare('SELECT * FROM company_entities WHERE code = ?').get(code);
}

router.get('/', (_req: Request, res: Response) => {
  res.json(listEntities());
});

router.post('/', (req: Request, res: Response) => {
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
  res.status(201).json(byCode(code));
});

router.put('/:code', (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const existing = byCode(code);
  if (!existing) { res.status(404).json({ error: 'Entity not found' }); return; }

  const next = Object.fromEntries(FIELDS.map(f => [f, req.body?.[f] !== undefined ? clean(req.body[f]) : existing[f]]));
  if (!next.company_name) { res.status(400).json({ error: 'Company name is required' }); return; }

  db.prepare(`UPDATE company_entities SET ${FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE code = ?`)
    .run(...FIELDS.map(f => next[f]), code);

  if (req.body?.is_default === true) {
    db.prepare('UPDATE company_entities SET is_default = CASE WHEN code = ? THEN 1 ELSE 0 END').run(code);
  }
  db.saveToDisk();

  notifyAdmin({ action: 'updated', entity: 'TripleW Entity', label: `${next.company_name} (${code})`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json(byCode(code));
});

router.delete('/:code', (req: Request, res: Response) => {
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
