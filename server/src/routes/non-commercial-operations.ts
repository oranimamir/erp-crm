import { Router, Request, Response } from 'express';
import db from '../database.js';
import { isEntityCode } from '../lib/companyEntity.js';
import { notifyAdmin } from '../lib/notify.js';

/**
 * Non-commercial operations (NCO): samples sent to a customer, or shipping with
 * a raw-material supplier / blender. Numbered NCO + entity + year + a 3-digit
 * running number per entity and year (NCOBE2026001). Kept in their own table,
 * so they never reach revenue, the dashboard, analytics or working capital.
 */

const router = Router();

type NcoType = 'samples' | 'shipping';
const TYPES: NcoType[] = ['samples', 'shipping'];
/** Shipping NCOs are with these supplier categories only. */
const SHIPPING_SUPPLIER_CATEGORIES = ['raw_materials', 'blenders'];
const TYPE_LABEL: Record<NcoType, string> = { samples: 'Samples', shipping: 'Shipping' };

const SELECT = `
  SELECT n.*, c.name AS customer_name, s.name AS supplier_name, s.category AS supplier_category
  FROM non_commercial_operations n
  LEFT JOIN customers c ON c.id = n.customer_id
  LEFT JOIN suppliers s ON s.id = n.supplier_id
`;

function yearOf(date: string | null | undefined): number {
  const m = String(date || '').match(/^(\d{4})-\d{2}-\d{2}$/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function nextSeq(entity: string, year: number): number {
  const row = db.prepare('SELECT MAX(seq) AS max FROM non_commercial_operations WHERE entity = ? AND year = ?').get(entity, year) as any;
  return (Number(row?.max) || 0) + 1;
}

const numberFor = (entity: string, year: number, seq: number) => `NCO${entity}${year}${String(seq).padStart(3, '0')}`;

const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The party the type asks for: a customer for samples, a raw-material /
 * blender supplier for shipping. Returns an error message, or the ids to store.
 */
function partyFor(type: NcoType, customerId: unknown, supplierId: unknown):
  { error: string } | { customer_id: number | null; supplier_id: number | null } {
  if (type === 'samples') {
    const id = Number(customerId);
    if (!id || !db.prepare('SELECT id FROM customers WHERE id = ?').get(id)) return { error: 'Choose the customer the samples go to' };
    return { customer_id: id, supplier_id: null };
  }
  const id = Number(supplierId);
  const supplier = id ? db.prepare('SELECT id, category FROM suppliers WHERE id = ?').get(id) as any : null;
  if (!supplier) return { error: 'Choose the supplier (raw materials or blenders)' };
  if (!SHIPPING_SUPPLIER_CATEGORIES.includes(supplier.category)) {
    return { error: 'Shipping NCOs are with raw-material suppliers or blenders only' };
  }
  return { customer_id: null, supplier_id: id };
}

const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });

// GET /api/non-commercial-operations?entity=BE&type=samples
router.get('/', (req: Request, res: Response) => {
  const conditions: string[] = [];
  const params: any[] = [];
  const entity = String(req.query.entity || '');
  const type = String(req.query.type || '');
  if (isEntityCode(entity)) { conditions.push('n.entity = ?'); params.push(entity); }
  if (TYPES.includes(type as NcoType)) { conditions.push('n.type = ?'); params.push(type); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  res.json({ data: db.prepare(`${SELECT} ${where} ORDER BY n.year DESC, n.entity, n.seq DESC`).all(...params) });
});

// GET /api/non-commercial-operations/next-number?entity=BE&date=2026-10-05 — preview only
router.get('/next-number', (req: Request, res: Response) => {
  const entity = String(req.query.entity || '');
  if (!isEntityCode(entity)) { res.status(400).json({ error: 'Choose BE or NL' }); return; }
  const year = yearOf(req.query.date as string);
  res.json({ nco_number: numberFor(entity, year, nextSeq(entity, year)) });
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare(`${SELECT} WHERE n.id = ?`).get(req.params.id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

// POST /api/non-commercial-operations — the number is given here, never typed
router.post('/', (req: Request, res: Response) => {
  const { entity, type, customer_id, supplier_id, nco_date, notes } = req.body || {};
  if (!isEntityCode(entity)) { res.status(400).json({ error: 'Choose BE or NL' }); return; }
  if (!TYPES.includes(type)) { res.status(400).json({ error: 'Choose Samples or Shipping' }); return; }
  if (nco_date && !validDate(nco_date)) { res.status(400).json({ error: 'Invalid date' }); return; }
  const party = partyFor(type, customer_id, supplier_id);
  if ('error' in party) { res.status(400).json({ error: party.error }); return; }

  const date = nco_date || new Date().toISOString().slice(0, 10);
  const year = yearOf(date);
  // Two people creating at once can pick the same number — the second takes the next one
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq = nextSeq(entity, year);
    const number = numberFor(entity, year, seq);
    try {
      const result = db.prepare(`
        INSERT INTO non_commercial_operations (nco_number, entity, year, seq, type, customer_id, supplier_id, nco_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(number, entity, year, seq, type, party.customer_id, party.supplier_id, date, String(notes ?? '').trim() || null, req.user?.userId ?? null);
      const row = db.prepare(`${SELECT} WHERE n.id = ?`).get(result.lastInsertRowid) as any;
      notifyAdmin({ action: 'created', entity: 'Non-Commercial Operation', label: number, detail: TYPE_LABEL[type as NcoType], ...who(req) });
      res.status(201).json(row);
      return;
    } catch (err: any) {
      if (!/UNIQUE/i.test(String(err?.message))) throw err;
    }
  }
  res.status(409).json({ error: 'Could not assign a number — try again' });
});

// PUT /api/non-commercial-operations/:id — a field left out keeps its value; the number never changes
router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM non_commercial_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  const body = req.body || {};
  const type: NcoType = body.type === undefined ? existing.type : body.type;
  if (!TYPES.includes(type)) { res.status(400).json({ error: 'Choose Samples or Shipping' }); return; }
  if (body.nco_date !== undefined && body.nco_date !== '' && body.nco_date !== null && !validDate(body.nco_date)) {
    res.status(400).json({ error: 'Invalid date' }); return;
  }
  const party = partyFor(
    type,
    body.customer_id === undefined ? existing.customer_id : body.customer_id,
    body.supplier_id === undefined ? existing.supplier_id : body.supplier_id,
  );
  if ('error' in party) { res.status(400).json({ error: party.error }); return; }
  const date = body.nco_date === undefined ? existing.nco_date : (body.nco_date || null);
  const notes = body.notes === undefined ? existing.notes : (String(body.notes ?? '').trim() || null);

  db.prepare(`
    UPDATE non_commercial_operations
    SET type = ?, customer_id = ?, supplier_id = ?, nco_date = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(type, party.customer_id, party.supplier_id, date, notes, existing.id);
  notifyAdmin({ action: 'updated', entity: 'Non-Commercial Operation', label: existing.nco_number, ...who(req) });
  res.json(db.prepare(`${SELECT} WHERE n.id = ?`).get(existing.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id, nco_number FROM non_commercial_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  db.prepare('DELETE FROM non_commercial_operations WHERE id = ?').run(existing.id);
  notifyAdmin({ action: 'deleted', entity: 'Non-Commercial Operation', label: existing.nco_number, ...who(req) });
  res.json({ ok: true });
});

export default router;
