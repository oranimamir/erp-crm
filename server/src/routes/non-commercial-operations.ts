import { Router, Request, Response } from 'express';
import db from '../database.js';
import { entityProfile, isEntityCode } from '../lib/companyEntity.js';
import { sendDocumentsEmail, withSizes } from '../lib/documentMail.js';
import { notifyAdmin } from '../lib/notify.js';
import { uploadOperationDoc } from '../middleware/upload.js';
import { normalizeNcoLines, parseNcoLines, deleteNcoUpload } from '../lib/ncoDocs.js';
import { deleteOrderConfirmationRow } from './order-confirmations.js';
import { deleteInvoiceDocument } from './invoice-documents.js';
import { deletePackingListRow } from './packing-lists.js';
import { deletePurchaseOrderRow } from './purchase-orders.js';
import { deleteDeclaration } from './declarations.js';
import { mountOwnerDocumentRoutes } from '../lib/ownerDocumentRoutes.js';
import { saveDeclarationToLibrary } from '../lib/documentSources.js';
import { getOwner } from '../lib/docOwner.js';
import fs from 'fs';
import { todayISO } from '../lib/today.js';

/**
 * Non-commercial operations (NCO): samples sent to a customer, or shipping with
 * a raw-material supplier / blender / logistics supplier (from → to). Numbered NCO + entity + year + a 3-digit
 * running number per entity and year (NCOBE2026001). Kept in their own table,
 * so they never reach revenue, the dashboard, analytics or working capital.
 */

const router = Router();

type NcoType = 'samples' | 'shipping';
const TYPES: NcoType[] = ['samples', 'shipping'];
/** Shipping NCOs are with these supplier categories only. */
const SHIPPING_SUPPLIER_CATEGORIES = ['raw_materials', 'blenders', 'logistics'];
const TYPE_LABEL: Record<NcoType, string> = { samples: 'Samples', shipping: 'Shipping' };
/** Where an NCO stands — client lib/ncoStatus.ts has the labels. */
export const NCO_STATUSES = [
  'requested', 'samples_in_preparation', 'samples_available', 'shipment_in_preparation', 'shipped', 'delivered', 'cancelled',
] as const;
const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested', samples_in_preparation: 'Samples in preparation', samples_available: 'Samples available',
  shipment_in_preparation: 'Shipment in preparation', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};
const isStatus = (v: unknown): v is string => NCO_STATUSES.includes(v as any);

/** A shipping end's name as it is now (a renamed supplier / entity shows its new name); typed text as typed. */
const endLabel = (end: 'from' | 'to') => `CASE n.ship_${end}_kind
      WHEN 'supplier' THEN COALESCE(s_${end}.name, n.ship_${end})
      WHEN 'entity' THEN COALESCE(e_${end}.company_name || ' (' || e_${end}.code || ')', n.ship_${end})
      ELSE n.ship_${end} END`;

const SELECT = `
  SELECT n.*, c.name AS customer_name, COALESCE(s.name, n.supplier_text) AS supplier_name, s.category AS supplier_category,
    ${endLabel('from')} AS ship_from_label, ${endLabel('to')} AS ship_to_label
  FROM non_commercial_operations n
  LEFT JOIN customers c ON c.id = n.customer_id
  LEFT JOIN suppliers s ON s.id = n.supplier_id
  LEFT JOIN suppliers s_from ON n.ship_from_kind = 'supplier' AND s_from.id = CAST(n.ship_from_ref AS INTEGER)
  LEFT JOIN suppliers s_to ON n.ship_to_kind = 'supplier' AND s_to.id = CAST(n.ship_to_ref AS INTEGER)
  LEFT JOIN company_entities e_from ON n.ship_from_kind = 'entity' AND e_from.code = n.ship_from_ref
  LEFT JOIN company_entities e_to ON n.ship_to_kind = 'entity' AND e_to.code = n.ship_to_ref
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

/** A number typed by the user instead of the series: letters, digits and - _ . / only. */
const CUSTOM_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._\-/]{1,39}$/;
function customNumberError(number: string, exceptId?: number): string | null {
  if (!CUSTOM_NUMBER.test(number)) return 'The number may use letters, digits and - _ . / only (2–40 characters)';
  const taken = db.prepare('SELECT id FROM non_commercial_operations WHERE lower(nco_number) = lower(?)').get(number) as any;
  return taken && taken.id !== exceptId ? `${number} is already used` : null;
}
/** The running number inside a typed number when it follows the series (NCOBE2026007 → 7), else 0. */
function seqOf(number: string, entity: string, year: number): number {
  const m = number.toUpperCase().match(new RegExp(`^NCO${entity}${year}(\\d{3,})$`));
  return m ? Number(m[1]) : 0;
}

/** One end of a shipping NCO: a supplier from the list, a TripleW entity, or a name typed freely. */
interface ShipEnd { kind: 'supplier' | 'entity' | 'text' | null; ref: string | null; label: string | null }
const NO_END: ShipEnd = { kind: null, ref: null, label: null };

function shipEnd(kind: unknown, ref: unknown, text: unknown, side: string): ShipEnd | { error: string } {
  if (kind === 'supplier') {
    const supplier = db.prepare('SELECT id, name, category FROM suppliers WHERE id = ?').get(Number(ref)) as any;
    if (!supplier) return { error: `${side}: choose a supplier from the list` };
    if (!SHIPPING_SUPPLIER_CATEGORIES.includes(supplier.category)) {
      return { error: `${side}: raw-material, blender or logistics suppliers only (or type a name)` };
    }
    return { kind, ref: String(supplier.id), label: supplier.name };
  }
  if (kind === 'entity') {
    const entity = db.prepare('SELECT code, company_name FROM company_entities WHERE code = ?').get(String(ref ?? '')) as any;
    if (!entity) return { error: `${side}: unknown TripleW entity` };
    return { kind, ref: entity.code, label: `${entity.company_name} (${entity.code})` };
  }
  const label = String(text ?? '').trim().slice(0, 300);
  return label ? { kind: 'text', ref: null, label } : NO_END;
}

type Party = { customer_id: number | null; supplier_id: number | null; supplier_text: string | null; from: ShipEnd; to: ShipEnd };

/** ship_from, ship_to, supplier_text, ship_from_kind, ship_from_ref, ship_to_kind, ship_to_ref — in the INSERT / UPDATE order */
const endValues = (p: Party) => [p.from.label, p.to.label, p.supplier_text, p.from.kind, p.from.ref, p.to.kind, p.to.ref];

/**
 * The parties the type asks for: a customer for samples; for shipping a From
 * and a To, each a raw-material / blender / logistics supplier, a TripleW
 * entity (BE / NL) or a typed name. The supplier on a From / To (From first)
 * is the NCO's supplier — the supplier PO is addressed to it.
 */
function partyFor(type: NcoType, customerId: unknown, from: [unknown, unknown, unknown], to: [unknown, unknown, unknown]):
  { error: string } | Party {
  if (type === 'samples') {
    const id = Number(customerId);
    if (!id || !db.prepare('SELECT id FROM customers WHERE id = ?').get(id)) return { error: 'Choose the customer the samples go to' };
    return { customer_id: id, supplier_id: null, supplier_text: null, from: NO_END, to: NO_END };
  }
  const f = shipEnd(...from, 'From');
  if ('error' in f) return f;
  const t = shipEnd(...to, 'To');
  if ('error' in t) return t;
  if (!f.kind || !t.kind) return { error: 'Choose where the shipment goes from and to' };
  const supplierEnd = [f, t].find(e => e.kind === 'supplier');
  return { customer_id: null, supplier_id: supplierEnd ? Number(supplierEnd.ref) : null, supplier_text: null, from: f, to: t };
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
  if (isStatus(req.query.status)) { conditions.push('n.status = ?'); params.push(req.query.status); }
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

const DOCS_SELECT = `
  SELECT d.*, c.name AS category_name
  FROM nco_documents d LEFT JOIN document_categories c ON c.id = d.category_id
`;

/** The NCO with its sample lines and documents (uploads and generated PDFs). */
function detail(id: number | string) {
  const row = db.prepare(`${SELECT} WHERE n.id = ?`).get(id) as any;
  if (!row) return null;
  const documents = db.prepare(`${DOCS_SELECT} WHERE d.nco_id = ? ORDER BY d.created_at DESC, d.id DESC`).all(row.id);
  return { ...row, items: parseNcoLines(row.items), documents: withSizes(documents as any[]) };
}

router.get('/:id', (req: Request, res: Response) => {
  const row = detail(req.params.id as string);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

// POST /api/non-commercial-operations/:id/documents — multipart: file, category_id, notes
router.post('/:id/documents', uploadOperationDoc.single('file'), (req: Request, res: Response) => {
  const nco = db.prepare('SELECT id, nco_number FROM non_commercial_operations WHERE id = ?').get(req.params.id) as any;
  if (!nco) {
    if (req.file) deleteNcoUpload({ id: -1, file_path: req.file.filename });
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (!req.file) { res.status(400).json({ error: 'File is required' }); return; }
  const categoryId = Number(req.body?.category_id) || null;
  const result = db.prepare('INSERT INTO nco_documents (nco_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)')
    .run(nco.id, categoryId, req.file.filename, req.file.originalname, String(req.body?.notes ?? '').trim() || null);
  // A declaration uploaded here also goes into the library for later operations
  const category = categoryId ? (db.prepare('SELECT name FROM document_categories WHERE id = ?').get(categoryId) as any)?.name : null;
  if (/^declarations?$/i.test(String(category || '').trim())) {
    try {
      saveDeclarationToLibrary(fs.readFileSync(req.file.path), req.file.originalname, getOwner('nco', nco.id)!, req.user?.userId ?? null);
    } catch (err: any) {
      console.error('[nco] could not save the declaration to the library:', err?.message || err);
    }
  }
  notifyAdmin({ action: 'created', entity: 'Non-Commercial Operation Document', label: `${nco.nco_number} — ${req.file.originalname}`, ...who(req) });
  res.status(201).json(db.prepare(`${DOCS_SELECT} WHERE d.id = ?`).get(result.lastInsertRowid));
});

// POST /api/non-commercial-operations/:id/documents/email — as on operations
router.post('/:id/documents/email', async (req: Request, res: Response) => {
  const nco = db.prepare(`${SELECT} WHERE n.id = ?`).get(req.params.id) as any;
  if (!nco) { res.status(404).json({ error: 'Not found' }); return; }
  const docs = db.prepare('SELECT id, file_path, file_name FROM nco_documents WHERE nco_id = ?').all(nco.id) as any[];
  const party = nco.customer_name || nco.supplier_name;
  const result = await sendDocumentsEmail(req.body || {}, docs, {
    subject: `${nco.nco_number} — documents${party ? ` — ${party}` : ''}`,
    reference: nco.nco_number,
    company: entityProfile(nco.entity).company_name || 'TripleW',
  });
  if (result.status === 200) {
    notifyAdmin({
      action: 'updated', entity: 'Non-Commercial Operation', label: nco.nco_number,
      detail: `${result.body.count} document(s) emailed to ${result.body.to.join(', ')}`, ...who(req),
    });
  }
  res.status(result.status).json(result.body);
});

/**
 * DELETE /api/non-commercial-operations/:id/documents/:docId — a generated
 * PDF's document deletes that generated document (as on operations).
 */
router.delete('/:id/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM nco_documents WHERE id = ? AND nco_id = ?').get(Number(req.params.docId), Number(req.params.id)) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const nco = db.prepare('SELECT nco_number FROM non_commercial_operations WHERE id = ?').get(doc.nco_id) as any;

  const oc = db.prepare('SELECT * FROM order_confirmations WHERE nco_document_id = ?').get(doc.id) as any;
  const inv = db.prepare('SELECT * FROM invoice_documents WHERE nco_document_id = ?').get(doc.id) as any;
  const pl = db.prepare('SELECT * FROM packing_lists WHERE nco_document_id = ? OR final_nco_document_id = ?').get(doc.id, doc.id) as any;
  const po = db.prepare('SELECT * FROM purchase_orders WHERE nco_document_id = ?').get(doc.id) as any;
  const declaration = db.prepare('SELECT * FROM declarations WHERE nco_document_id = ?').get(doc.id) as any;
  if (declaration) deleteDeclaration(declaration);
  else if (po) deletePurchaseOrderRow(po);
  else if (oc) deleteOrderConfirmationRow(oc);
  else if (inv) deleteInvoiceDocument(inv);
  else if (pl) deletePackingListRow(pl);
  else deleteNcoUpload(doc);

  notifyAdmin({ action: 'deleted', entity: 'Non-Commercial Operation Document', label: `${nco?.nco_number || ''} — ${doc.file_name}`, ...who(req) });
  res.json({ ok: true });
});

// POST /api/non-commercial-operations — the next number in the series, unless one is typed (nco_number)
router.post('/', (req: Request, res: Response) => {
  const { entity, type, customer_id, nco_date, notes, items } = req.body || {};
  const typed = String(req.body?.nco_number ?? '').trim();
  const status = req.body?.status === undefined || req.body?.status === '' ? 'requested' : req.body.status;
  if (!isStatus(status)) { res.status(400).json({ error: 'Unknown status' }); return; }
  if (!isEntityCode(entity)) { res.status(400).json({ error: 'Choose BE or NL' }); return; }
  if (!TYPES.includes(type)) { res.status(400).json({ error: 'Choose Samples or Shipping' }); return; }
  if (nco_date && !validDate(nco_date)) { res.status(400).json({ error: 'Invalid date' }); return; }
  const b = req.body || {};
  const party = partyFor(type, customer_id, [b.ship_from_kind, b.ship_from_ref, b.ship_from], [b.ship_to_kind, b.ship_to_ref, b.ship_to]);
  if ('error' in party) { res.status(400).json({ error: party.error }); return; }

  const date = nco_date || todayISO();
  const year = yearOf(date);
  if (typed) {
    const error = customNumberError(typed);
    if (error) { res.status(400).json({ error }); return; }
    const result = db.prepare(`
      INSERT INTO non_commercial_operations (nco_number, entity, year, seq, type, customer_id, supplier_id, nco_date, notes, created_by, items, status, ship_from, ship_to, supplier_text, ship_from_kind, ship_from_ref, ship_to_kind, ship_to_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(typed, entity, year, seqOf(typed, entity, year), type, party.customer_id, party.supplier_id, date,
      String(notes ?? '').trim() || null, req.user?.userId ?? null, JSON.stringify(normalizeNcoLines(items)), status, ...endValues(party));
    notifyAdmin({ action: 'created', entity: 'Non-Commercial Operation', label: typed, detail: TYPE_LABEL[type as NcoType], ...who(req) });
    res.status(201).json(detail(Number(result.lastInsertRowid)));
    return;
  }
  // Two people creating at once can pick the same number — the second takes the next one
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq = nextSeq(entity, year);
    const number = numberFor(entity, year, seq);
    try {
      const result = db.prepare(`
        INSERT INTO non_commercial_operations (nco_number, entity, year, seq, type, customer_id, supplier_id, nco_date, notes, created_by, items, status, ship_from, ship_to, supplier_text, ship_from_kind, ship_from_ref, ship_to_kind, ship_to_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(number, entity, year, seq, type, party.customer_id, party.supplier_id, date, String(notes ?? '').trim() || null,
        req.user?.userId ?? null, JSON.stringify(normalizeNcoLines(items)), status, ...endValues(party));
      const row = detail(Number(result.lastInsertRowid));
      notifyAdmin({ action: 'created', entity: 'Non-Commercial Operation', label: number, detail: TYPE_LABEL[type as NcoType], ...who(req) });
      res.status(201).json(row);
      return;
    } catch (err: any) {
      if (!/UNIQUE/i.test(String(err?.message))) throw err;
    }
  }
  res.status(409).json({ error: 'Could not assign a number — try again' });
});

// PUT /api/non-commercial-operations/:id — a field left out keeps its value; nco_number renumbers (documents already generated keep theirs)
router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM non_commercial_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  const body = req.body || {};
  const type: NcoType = body.type === undefined ? existing.type : body.type;
  if (!TYPES.includes(type)) { res.status(400).json({ error: 'Choose Samples or Shipping' }); return; }
  if (body.nco_date !== undefined && body.nco_date !== '' && body.nco_date !== null && !validDate(body.nco_date)) {
    res.status(400).json({ error: 'Invalid date' }); return;
  }
  // An end left out keeps its stored value
  const end = (side: 'from' | 'to'): [unknown, unknown, unknown] => (body[`ship_${side}_kind`] === undefined
    ? [existing[`ship_${side}_kind`], existing[`ship_${side}_ref`], existing[`ship_${side}`]]
    : [body[`ship_${side}_kind`], body[`ship_${side}_ref`], body[`ship_${side}`]]);
  const party = partyFor(type, body.customer_id === undefined ? existing.customer_id : body.customer_id, end('from'), end('to'));
  if ('error' in party) { res.status(400).json({ error: party.error }); return; }
  const date = body.nco_date === undefined ? existing.nco_date : (body.nco_date || null);
  const notes = body.notes === undefined ? existing.notes : (String(body.notes ?? '').trim() || null);
  const items = body.items === undefined ? existing.items : JSON.stringify(normalizeNcoLines(body.items));
  const status = body.status === undefined || body.status === '' ? existing.status : body.status;
  if (!isStatus(status)) { res.status(400).json({ error: 'Unknown status' }); return; }
  let number = existing.nco_number as string;
  if (body.nco_number !== undefined && String(body.nco_number).trim() && String(body.nco_number).trim() !== existing.nco_number) {
    number = String(body.nco_number).trim();
    const error = customNumberError(number, existing.id);
    if (error) { res.status(400).json({ error }); return; }
  }

  db.prepare(`
    UPDATE non_commercial_operations
    SET nco_number = ?, seq = ?, type = ?, customer_id = ?, supplier_id = ?, nco_date = ?, notes = ?, items = ?, status = ?,
        ship_from = ?, ship_to = ?, supplier_text = ?, ship_from_kind = ?, ship_from_ref = ?, ship_to_kind = ?, ship_to_ref = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(number, number === existing.nco_number ? existing.seq : seqOf(number, existing.entity, existing.year),
    type, party.customer_id, party.supplier_id, date, notes, items, status, ...endValues(party), existing.id);
  const changes = [
    number !== existing.nco_number ? `renumbered from ${existing.nco_number}` : '',
    status !== existing.status ? `status: ${STATUS_LABEL[existing.status] || existing.status} → ${STATUS_LABEL[status]}` : '',
    (party.from.label || '') !== (existing.ship_from || '') ? `from: ${party.from.label || '—'}` : '',
    (party.to.label || '') !== (existing.ship_to || '') ? `to: ${party.to.label || '—'}` : '',
  ].filter(Boolean);
  notifyAdmin({
    action: 'updated', entity: 'Non-Commercial Operation', label: number,
    detail: changes.length ? changes.join('; ') : undefined, ...who(req),
  });
  res.json(detail(existing.id));
});

// Choose from the system, edit a document, edit a Word document's text (shared with operations)
mountOwnerDocumentRoutes(router, 'nco');

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id, nco_number FROM non_commercial_operations WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  // Generated documents (with their PDFs) and uploaded files go with it
  for (const pl of db.prepare('SELECT * FROM packing_lists WHERE nco_id = ?').all(existing.id) as any[]) deletePackingListRow(pl);
  for (const inv of db.prepare('SELECT * FROM invoice_documents WHERE nco_id = ?').all(existing.id) as any[]) deleteInvoiceDocument(inv);
  for (const oc of db.prepare('SELECT * FROM order_confirmations WHERE nco_id = ?').all(existing.id) as any[]) deleteOrderConfirmationRow(oc);
  for (const po of db.prepare('SELECT * FROM purchase_orders WHERE nco_id = ?').all(existing.id) as any[]) deletePurchaseOrderRow(po);
  for (const d of db.prepare('SELECT * FROM declarations WHERE nco_id = ?').all(existing.id) as any[]) deleteDeclaration(d);
  for (const doc of db.prepare('SELECT * FROM nco_documents WHERE nco_id = ?').all(existing.id) as any[]) deleteNcoUpload(doc);
  db.prepare('DELETE FROM non_commercial_operations WHERE id = ?').run(existing.id);
  notifyAdmin({ action: 'deleted', entity: 'Non-Commercial Operation', label: existing.nco_number, ...who(req) });
  res.json({ ok: true });
});

export default router;
