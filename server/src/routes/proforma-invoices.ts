/**
 * Proforma invoices — issued on an operation BEFORE the customer's order is
 * placed (operation first, proforma, then the order arrives). Same format as
 * the order confirmation (`buildProformaInvoicePdf` = the OC layout titled
 * "Proforma Invoice"); products, prices, freight / insurance / VAT typed in or
 * taken from an earlier order confirmation (or proforma) of the same client.
 * `data` uses the confirmation's field names (oc_number / oc_date …) so the
 * OC form edits it unchanged. Filed under the operation as category
 * "Proforma Invoice", `<op#>PI.pdf` (`PI2`, `PI3`… for later ones).
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { archiveFile, ownerOf, contextOf } from '../lib/archive.js';
import { notifyAdmin } from '../lib/notify.js';
import { applyEntityBank, entityFromOperationNumber, entityProfile, isEntityCode, type EntityCode } from '../lib/companyEntity.js';
import { listProfiles } from '../lib/documentPrefill.js';
import { matchProfile } from '../lib/profileMatch.js';
import { buildProformaInvoicePdf, computeTotals, formatLongDate, type OrderConfirmationData } from '../lib/document-pdf.js';
import { todayISO } from '../lib/today.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

function parseRecord(row: any) {
  if (!row) return row;
  let data: any = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt rows surface as empty */ }
  let draft: any = null;
  if (row.draft_data) { try { draft = JSON.parse(row.draft_data); } catch { /* ignore */ } }
  return { ...row, data, draft };
}

function operationRow(id: number): any {
  return db.prepare(`
    SELECT op.id, op.operation_number, op.customer_id, op.country, op.order_id,
      c.name AS customer_name, c.company AS customer_company, c.email AS customer_email, c.phone AS customer_phone,
      c.address AS customer_address, c.vat_number AS customer_vat, c.contact_person AS customer_contact
    FROM operations op LEFT JOIN customers c ON c.id = op.customer_id WHERE op.id = ?
  `).get(id);
}

const safeStem = (s: string) => s.trim().replace(/[^A-Za-z0-9._-]+/g, '-');

/** `<op#>PI`, then `<op#>PI2`, `PI3`… — the first one no proforma uses. */
export function nextProformaNumber(operationNumber: string, exceptId?: number): string {
  const stem = `${operationNumber}PI`;
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? stem : `${stem}${n}`;
    const row = db.prepare('SELECT id FROM proforma_invoices WHERE pi_number = ? COLLATE NOCASE').get(candidate) as any;
    if (!row || row.id === exceptId) return candidate;
  }
  return `${stem}-${Date.now()}`;
}

function numberTaken(piNumber: string, exceptId?: number): boolean {
  const row = db.prepare('SELECT id FROM proforma_invoices WHERE pi_number = ? COLLATE NOCASE').get(piNumber) as any;
  return !!row && row.id !== exceptId;
}

function categoryId(): number | null {
  return (db.prepare(`SELECT id FROM document_categories WHERE name = 'Proforma Invoice'`).get() as any)?.id ?? null;
}

/** Writes the PDF and keeps its operation document in step (replaced in place on regenerate). */
async function renderAndFile(data: OrderConfirmationData, operationId: number, existing?: any): Promise<{ filePath: string; fileName: string; documentId: number }> {
  const pdf = await buildProformaInvoicePdf(data);
  fs.mkdirSync(docsDir, { recursive: true });
  const storedName = `pi-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, storedName), pdf);
  const fileName = `${safeStem(String(data.oc_number || 'proforma'))}.pdf`;

  // The superseded PDF of a regenerated proforma is replaced, as for the other generators
  if (existing?.file_path) {
    const old = path.join(docsDir, existing.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }
  let documentId: number | null = existing?.document_id ?? null;
  const linked = documentId ? db.prepare('SELECT id FROM operation_documents WHERE id = ?').get(documentId) : null;
  if (linked) {
    db.prepare('UPDATE operation_documents SET operation_id = ?, category_id = ?, file_path = ?, file_name = ? WHERE id = ?')
      .run(operationId, categoryId(), storedName, fileName, documentId);
  } else {
    const r = db.prepare('INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)')
      .run(operationId, categoryId(), storedName, fileName, `Proforma Invoice ${data.oc_number || ''}`.trim());
    documentId = Number(r.lastInsertRowid);
  }
  return { filePath: storedName, fileName, documentId: documentId! };
}

/** Fields carried from an earlier confirmation / proforma (never its number, date, PO or delivery date). */
const CARRIED = [
  'sq_number', 'client_code', 'client_name', 'billing_address', 'client_phone', 'tax_id', 'contact_email', 'client_contact',
  'delivery', 'delivery_address', 'delivery_contact', 'freight', 'insurance', 'vat', 'terms', 'notes', 'eori',
] as const;

/** Issuer, customer profile and customer row → a blank proforma for the operation. */
function baseDraft(op: any, entity: EntityCode, profileId: number | null, currency: string) {
  const issuer = entityProfile(entity, currency);
  const match = matchProfile(op.customer_id, {} as any, op.country, profileId);
  const profile = match.profile;
  const shared = profile?.data.shared || {};
  const ocDefaults = profile?.data.order_confirmation || {};
  const draft: OrderConfirmationData & Record<string, any> = {
    ...issuer,
    entity_code: entity,
    oc_number: nextProformaNumber(op.operation_number),
    oc_date: todayISO(),
    sq_number: '',
    our_ref: op.operation_number,
    po_number: '',
    client_code: shared.client_code || '',
    client_name: shared.legal_name || op.customer_company || op.customer_name || '',
    billing_address: shared.billing_address || op.customer_address || '',
    client_phone: shared.contact_phone || op.customer_phone || '',
    tax_id: shared.tax_id || op.customer_vat || '',
    contact_email: shared.contact_email || op.customer_email || '',
    items: [{ line: 1, reference: '', commercial_name: '', packaging: '', quantity: 0, quantity_unit: 'KG', unit_price: 0, currency, hs_code: '', description: '' }],
    delivery: ocDefaults.delivery || '',
    delivery_address: ocDefaults.delivery_address || issuer.delivery_address || '',
    delivery_contact: issuer.delivery_contact || '',
    delivery_date_text: '',
    freight: 0,
    insurance: 0,
    vat: 0,
    terms: ocDefaults.terms || '',
  };
  return { draft, match, profile };
}

/** A source document (an order confirmation or an earlier proforma) as stored. */
function sourceDoc(type: string, id: number): { data: any; profile_id: number | null; label: string } | null {
  if (type === 'oc') {
    const row = db.prepare(`SELECT oc_number, data, profile_id FROM order_confirmations WHERE id = ?`).get(id) as any;
    if (!row) return null;
    try { return { data: JSON.parse(row.data), profile_id: row.profile_id ?? null, label: `order confirmation ${row.oc_number}` }; } catch { return null; }
  }
  if (type === 'proforma') {
    const row = db.prepare(`SELECT pi_number, data, profile_id FROM proforma_invoices WHERE id = ?`).get(id) as any;
    if (!row) return null;
    try { return { data: JSON.parse(row.data), profile_id: row.profile_id ?? null, label: `proforma ${row.pi_number}` }; } catch { return null; }
  }
  return null;
}

function summary(data: any) {
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  let total = 0, currency = 'EUR';
  try { ({ total, currency } = computeTotals(data)); } catch { /* unreadable */ }
  return {
    client_name: data?.client_name || '',
    products: items.map(i => String(i.commercial_name || i.reference || '').trim()).filter(Boolean).slice(0, 4),
    lines: items.length,
    total: Math.round(total * 100) / 100,
    currency,
  };
}

// ── Lists ─────────────────────────────────────────────────────────────────

router.get('/by-operation/:operationId', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM proforma_invoices WHERE operation_id = ? ORDER BY id').all(Number(req.params.operationId)) as any[];
  res.json(rows.map(r => {
    const rec = parseRecord(r);
    return { ...rec, summary: summary(rec.draft || rec.data) };
  }));
});

/**
 * GET /sources?operation_id=&search=&all= — earlier order confirmations and
 * proformas to start from: this operation's client first (`same_client`),
 * newest first. Without a client (or `all=1`) every client's are listed.
 */
router.get('/sources', (req: Request, res: Response) => {
  const op = operationRow(Number(req.query.operation_id));
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return; }
  const search = String(req.query.search || '').trim().toLowerCase();
  const all = req.query.all === '1' || !op.customer_id;

  const ocs = db.prepare(`
    SELECT oc.id, oc.oc_number AS number, oc.data, oc.updated_at, oc.status,
      COALESCE(o.customer_id, sop.customer_id) AS customer_id, COALESCE(sop.operation_number, oop.operation_number) AS operation_number
    FROM order_confirmations oc
    LEFT JOIN orders o ON o.id = oc.order_id
    LEFT JOIN operations sop ON sop.id = oc.operation_id
    LEFT JOIN operations oop ON oop.order_id = oc.order_id
    WHERE oc.nco_id IS NULL
    ORDER BY oc.id DESC LIMIT 500
  `).all() as any[];
  const pis = db.prepare(`
    SELECT pi.id, pi.pi_number AS number, pi.data, pi.updated_at, pi.status, op.customer_id, op.operation_number
    FROM proforma_invoices pi JOIN operations op ON op.id = pi.operation_id
    WHERE pi.operation_id != ?
    ORDER BY pi.id DESC LIMIT 200
  `).all(op.id) as any[];

  const seen = new Set<string>();
  const out = [
    ...ocs.map(r => ({ ...r, type: 'oc' as const })),
    ...pis.map(r => ({ ...r, type: 'proforma' as const })),
  ].map(r => {
    let data: any = {};
    try { data = JSON.parse(r.data); } catch { /* skip */ }
    return {
      type: r.type, id: r.id, number: r.number, status: r.status, date: data.oc_date || String(r.updated_at || '').slice(0, 10),
      operation_number: r.operation_number || null,
      same_client: !!op.customer_id && Number(r.customer_id) === Number(op.customer_id),
      ...summary(data),
    };
  }).filter(r => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (!all && !r.same_client) return false;
    if (search) {
      const hay = [r.number, r.client_name, r.operation_number, ...r.products].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => (Number(b.same_client) - Number(a.same_client)) || String(b.date).localeCompare(String(a.date)) || b.id - a.id)
    .slice(0, 60);

  res.json({ client: op.customer_name || null, sources: out });
});

/**
 * GET /prepare?operation_id=&from_type=oc|proforma&from_id=&entity=&profile_id=
 * A new proforma for the operation: issuer + client details, and — from a
 * chosen earlier confirmation / proforma — its client details, lines with
 * their prices, delivery, freight / insurance / VAT, terms and notes.
 */
router.get('/prepare', (req: Request, res: Response) => {
  const op = operationRow(Number(req.query.operation_id));
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return; }
  const requested = String(req.query.entity || '').toUpperCase();
  const entity: EntityCode = isEntityCode(requested) ? requested : entityFromOperationNumber(op.operation_number);

  const from = req.query.from_type && req.query.from_id
    ? sourceDoc(String(req.query.from_type), Number(req.query.from_id)) : null;
  if (req.query.from_type && !from) { res.status(404).json({ error: 'That document was not found' }); return; }

  const fromItems: any[] = Array.isArray(from?.data?.items) ? from!.data.items : [];
  const currency = String(fromItems.find(i => i?.currency)?.currency || 'EUR').toUpperCase();
  const requestedProfile = parseInt(String(req.query.profile_id || ''), 10);
  const profileId = Number.isInteger(requestedProfile) ? requestedProfile : (from?.profile_id ?? null);
  const { draft, match, profile } = baseDraft(op, entity, profileId, currency);

  if (from) {
    for (const key of CARRIED) {
      const v = from.data[key];
      if (v !== undefined && v !== null && v !== '') (draft as any)[key] = v;
    }
    if (fromItems.length) {
      draft.items = fromItems.map((l: any, i: number) => ({ ...l, line: i + 1 }));
    }
  }

  res.json({
    draft,
    entity,
    source: from ? from.label : null,
    profiles: listProfiles(op.customer_id),
    profile_id: profile?.id ?? null,
    profile_name: profile?.name ?? null,
    matched_by: match.matchedBy,
    match_confident: match.confident,
    operation: { id: op.id, operation_number: op.operation_number, customer_name: op.customer_name, has_order: !!op.order_id },
  });
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare(`SELECT pi.*, op.operation_number FROM proforma_invoices pi LEFT JOIN operations op ON op.id = pi.operation_id WHERE pi.id = ?`).get(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Proforma invoice not found' }); return; }
  res.json(parseRecord(row));
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const pdf = await buildProformaInvoicePdf(applyEntityBank((req.body?.data || {}) as OrderConfirmationData));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="proforma-preview.pdf"');
    res.send(pdf);
  } catch (err: any) {
    console.error('[proforma-invoices] preview failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// ── Create / update ───────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { operation_id, profile_id, data, source } = req.body as { operation_id?: number; profile_id?: number | null; data?: any; source?: string | null };
  const op = operation_id ? operationRow(Number(operation_id)) : null;
  if (!op) { res.status(400).json({ error: 'operation_id is required' }); return; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { res.status(400).json({ error: 'data is required' }); return; }
  const isDraft = req.body?.status === 'draft';

  // A number taken meanwhile moves to the next free one of the operation
  let number = String(data.oc_number || '').trim() || nextProformaNumber(op.operation_number);
  const renumberedFrom = numberTaken(number) ? number : null;
  if (renumberedFrom) number = nextProformaNumber(op.operation_number);
  const payload = applyEntityBank({ ...data, oc_number: number });

  let filed: Awaited<ReturnType<typeof renderAndFile>> | null = null;
  try {
    if (!isDraft) filed = await renderAndFile(payload, op.id);
    const r = db.prepare(`
      INSERT INTO proforma_invoices (pi_number, operation_id, profile_id, status, data, source, file_path, file_name, document_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(number, op.id, profile_id ?? null, isDraft ? 'draft' : 'final', JSON.stringify(payload),
      typeof source === 'string' ? source.slice(0, 200) : null,
      filed?.filePath ?? null, filed?.fileName ?? null, filed?.documentId ?? null, req.user?.userId ?? null);
    notifyAdmin({
      action: 'created', entity: isDraft ? 'Proforma Invoice draft' : 'Proforma Invoice', label: number,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    const row = db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ ...parseRecord(row), renumbered_from: renumberedFrom });
  } catch (err: any) {
    if (filed) {
      try { fs.unlinkSync(path.join(docsDir, filed.filePath)); } catch { /* best effort */ }
      try { db.prepare('DELETE FROM operation_documents WHERE id = ?').run(filed.documentId); } catch { /* best effort */ }
    }
    console.error('[proforma-invoices] create failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to save the proforma invoice' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Proforma invoice not found' }); return; }
  const { data, profile_id } = req.body as { data?: any; profile_id?: number | null };
  if (!data || typeof data !== 'object' || Array.isArray(data)) { res.status(400).json({ error: 'data is required' }); return; }
  const isDraft = req.body?.status === 'draft';

  if (isDraft && existing.status !== 'draft') {
    // Generated already: edits wait as a draft, the filed PDF stays until regenerated
    db.prepare(`UPDATE proforma_invoices SET draft_data = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(data), existing.id);
    res.json(parseRecord(db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(existing.id)));
    return;
  }

  const number = String(data.oc_number || '').trim() || existing.pi_number;
  if (numberTaken(number, existing.id)) { res.status(409).json({ error: `Proforma invoice ${number} already exists` }); return; }
  const payload = applyEntityBank({ ...data, oc_number: number });

  let filed: Awaited<ReturnType<typeof renderAndFile>> | null = null;
  try {
    if (!isDraft) filed = await renderAndFile(payload, existing.operation_id, existing);
    db.prepare(`
      UPDATE proforma_invoices SET pi_number = ?, profile_id = ?, status = ?, data = ?, draft_data = NULL,
        file_path = ?, file_name = ?, document_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(number, profile_id ?? existing.profile_id ?? null, isDraft ? 'draft' : 'final', JSON.stringify(payload),
      filed?.filePath ?? existing.file_path ?? null, filed?.fileName ?? existing.file_name ?? null, filed?.documentId ?? existing.document_id ?? null,
      existing.id);
    notifyAdmin({
      action: existing.status === 'draft' && !isDraft ? 'created' : 'updated',
      entity: isDraft ? 'Proforma Invoice draft' : 'Proforma Invoice', label: number,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json(parseRecord(db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(existing.id)));
  } catch (err: any) {
    console.error('[proforma-invoices] update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to save the proforma invoice' });
  }
});

// ── Download / email / delete ─────────────────────────────────────────────

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(Number(req.params.id)) as any;
  if (row?.status === 'draft' || !row?.file_path) { res.status(404).json({ error: 'Generate the proforma invoice first' }); return; }
  const filePath = path.join(docsDir, row.file_path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
  res.attachment(row.file_name || 'proforma-invoice.pdf');
  res.type('application/pdf');
  fs.createReadStream(filePath).pipe(res);
});

const escapeHtml = (value: string) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

router.post('/:id/email', async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Proforma invoice not found' }); return; }
  if (row.status === 'draft' || !row.file_path) { res.status(400).json({ error: 'Generate the proforma invoice before sending it' }); return; }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(501).json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }); return; }

  const recipients = String(req.body?.to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if (!recipients.length) { res.status(400).json({ error: 'At least one recipient email is required' }); return; }
  const invalid = recipients.filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.join(', ')}` }); return; }
  const filePath = path.join(docsDir, row.file_path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'Generated PDF is missing — generate it again' }); return; }

  const data = parseRecord(row).data;
  const { total, currency } = computeTotals(data);
  const subject = String(req.body?.subject || '').trim() || `Proforma Invoice ${row.pi_number}${data.client_name ? ` — ${data.client_name}` : ''}`;
  const bodyText = String(req.body?.message || '').trim();
  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p style="font-size:15px;">Dear ${escapeHtml(data.client_name || 'Sir/Madam')},</p>
  ${bodyText ? `<p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>`
    : `<p style="font-size:14px;">Please find attached our proforma invoice <strong>${escapeHtml(row.pi_number)}</strong>.</p>`}
  <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;margin-top:16px;">
    <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Proforma</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(row.pi_number)}</td></tr>
    <tr><td style="padding:8px 12px;color:#6b7280;">Date</td><td style="padding:8px 12px;">${escapeHtml(formatLongDate(data.oc_date))}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Total</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(`${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`)}</td></tr>
  </table>
  <p style="font-size:14px;margin-top:20px;">Kind regards,<br/>${escapeHtml(data.company_name || 'TripleW BV')}</p>
</div>`;
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>',
      to: recipients, subject, html,
      attachments: [{ filename: row.file_name || 'proforma-invoice.pdf', content: fs.readFileSync(filePath).toString('base64') }],
    });
    if (error) throw new Error(error.message || 'Resend rejected the message');
    db.prepare(`UPDATE proforma_invoices SET sent_to = ?, sent_at = datetime('now') WHERE id = ?`).run(recipients.join(', '), row.id);
    notifyAdmin({ action: 'updated', entity: 'Proforma Invoice', label: row.pi_number, detail: `emailed to ${recipients.join(', ')}`,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
    res.json({ message: `Proforma invoice sent to ${recipients.join(', ')}`, proforma: parseRecord(db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(row.id)) });
  } catch (err: any) {
    console.error('[proforma-invoices] email failed:', err?.message || err);
    res.status(502).json({ error: `Failed to send email: ${err?.message || 'unknown error'}` });
  }
});

/** Removes a proforma: its PDF to the Archive, its operation document and the row. */
export function deleteProformaRow(row: any): void {
  if (row.file_path) {
    const owner = ownerOf(row.operation_id, null);
    archiveFile(path.join(docsDir, row.file_path), { section: owner.section, context: contextOf(owner.number, `Proforma invoice ${row.pi_number || ''}`), fileName: row.file_name });
  }
  if (row.document_id) db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
  db.prepare('DELETE FROM proforma_invoices WHERE id = ?').run(row.id);
}

router.delete('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM proforma_invoices WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Proforma invoice not found' }); return; }
  deleteProformaRow(row);
  notifyAdmin({ action: 'deleted', entity: 'Proforma Invoice', label: row.pi_number, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: 'Proforma invoice deleted' });
});

export default router;
