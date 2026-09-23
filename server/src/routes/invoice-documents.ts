import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { entityFromOperationNumber, entityProfile, isEntityCode, type EntityCode } from '../lib/companyEntity.js';
import {
  carryForwardInvoiceText, deliveryTerms, listProfiles, originForItems, prefillLines,
  resolveInvoiceLayout,
} from '../lib/documentPrefill.js';
import { matchProfile } from '../lib/profileMatch.js';
import {
  buildDocumentPdf,
  computeTotals,
  formatLongDate,
  type DocumentData,
} from '../lib/document-pdf.js';
import { normalizeLayout } from '../lib/invoiceLayout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

/** `CIBE20260112.pdf` — the invoice number is the document's identity. */
function invoiceFileName(invoiceNumber: string | null): string {
  const stem = (invoiceNumber || 'commercial-invoice').trim();
  return `${stem.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
}

/** The series an invoice belongs to: CIBE… for Belgian, CINL… for Dutch. */
function invoiceSeriesPrefix(entity: EntityCode, dateIso?: string | null): string {
  const year = (dateIso || new Date().toISOString()).slice(0, 4);
  return `CI${entity}${year}`;
}

/** Every number already used in a series, from both generated and recorded invoices. */
function issuedInSeries(prefix: string): number[] {
  const pattern = new RegExp(`^${prefix}(\\d{4})$`);
  const used: number[] = [];

  // The historic series lives in `invoices` (the recorded/uploaded invoices);
  // only invoices generated here are in `invoice_documents`. Continuing the
  // real numbering means honouring both.
  for (const table of ['invoice_documents', 'invoices']) {
    try {
      const rows = db.prepare(
        `SELECT invoice_number AS n FROM ${table} WHERE invoice_number LIKE ?`
      ).all(`${prefix}%`) as Array<{ n: string }>;
      for (const row of rows) {
        const m = String(row.n ?? '').trim().match(pattern);
        if (m) used.push(parseInt(m[1], 10));
      }
    } catch { /* table may not exist on an older DB */ }
  }
  return used;
}

/**
 * Next number in the entity's own series, continuing from the last invoice
 * actually issued — so a Belgian (SOBE…) operation continues CIBE…, and a
 * Dutch (SONL…) one continues CINL…, each independently.
 *
 * The sequence is the four-digit form the company already uses
 * (CIBE20260101 … CIBE20260119), starting a new year at 0101.
 */
function nextInvoiceNumber(entity: EntityCode, dateIso?: string | null): string {
  const prefix = invoiceSeriesPrefix(entity, dateIso);
  const used = issuedInSeries(prefix);
  const next = used.length ? Math.max(...used) + 1 : 101;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function operationNumberFor(operationId: number | null): string | null {
  if (!operationId) return null;
  const row = db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(operationId) as any;
  return row?.operation_number ?? null;
}

function invoiceCategoryId(): number | null {
  const row = db.prepare(`SELECT id FROM document_categories WHERE name = 'Commercial Invoice'`).get() as any;
  return row?.id ?? null;
}

function parseRecord(row: any) {
  if (!row) return row;
  let data: DocumentData = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt rows surface as empty */ }
  return { ...row, data };
}

/**
 * Writes the PDF to operation-docs and keeps the operation_documents row in
 * sync, so the invoice always appears under the operation's documents.
 */
async function renderAndFile(
  data: DocumentData,
  opts: { operationId: number | null; existing?: any }
): Promise<{ filePath: string; fileName: string; documentId: number | null }> {
  const pdf = await buildDocumentPdf('invoice', data);

  fs.mkdirSync(docsDir, { recursive: true });
  const storedName = `ci-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, storedName), pdf);

  const displayName = invoiceFileName(data.doc_number ?? null);

  // Drop the superseded file once the new one is safely on disk
  if (opts.existing?.file_path) {
    const old = path.join(docsDir, opts.existing.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }

  let documentId: number | null = opts.existing?.document_id ?? null;
  if (opts.operationId) {
    const categoryId = invoiceCategoryId();
    const stillLinked = documentId
      ? db.prepare('SELECT id FROM operation_documents WHERE id = ?').get(documentId)
      : null;

    if (stillLinked) {
      db.prepare(
        'UPDATE operation_documents SET operation_id = ?, category_id = ?, file_path = ?, file_name = ? WHERE id = ?'
      ).run(opts.operationId, categoryId, storedName, displayName, documentId);
    } else {
      const result = db.prepare(
        'INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)'
      ).run(opts.operationId, categoryId, storedName, displayName, `Commercial Invoice ${data.doc_number || ''}`.trim());
      documentId = Number(result.lastInsertRowid);
    }
  } else if (documentId) {
    db.prepare('DELETE FROM operation_documents WHERE id = ?').run(documentId);
    documentId = null;
  }

  return { filePath: storedName, fileName: displayName, documentId };
}

/** Undo a renderAndFile when the row it belongs to could not be written. */
function discardFiled(filed: { filePath: string; documentId: number | null }, keepDocumentId: number | null) {
  const orphan = path.join(docsDir, filed.filePath);
  if (fs.existsSync(orphan)) { try { fs.unlinkSync(orphan); } catch { /* best effort */ } }
  if (filed.documentId && filed.documentId !== keepDocumentId) {
    try { db.prepare('DELETE FROM operation_documents WHERE id = ?').run(filed.documentId); } catch { /* best effort */ }
  }
}

function numberTaken(invoiceNumber: string, exceptId?: number): boolean {
  const row = db.prepare('SELECT id FROM invoice_documents WHERE invoice_number = ?').get(invoiceNumber) as any;
  if (row && row.id !== exceptId) return true;

  // A number already on a recorded invoice must not be reused either
  try {
    const recorded = db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(invoiceNumber) as any;
    if (recorded) return true;
  } catch { /* table unavailable */ }

  return false;
}

// ── Prefill a draft from the order ────────────────────────────────────────

router.get('/prepare', (req: Request, res: Response) => {
  const orderId = parseInt(String(req.query.order_id || ''), 10);
  if (!Number.isInteger(orderId)) { res.status(400).json({ error: 'order_id is required' }); return; }

  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           c.address as customer_address,
           s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone,
           s.address as supplier_address
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id
    WHERE o.id = ?
  `).get(orderId) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  const existing = db.prepare(
    'SELECT * FROM invoice_documents WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;
  if (existing) { res.json({ existing: parseRecord(existing) }); return; }

  const operation = db.prepare(
    'SELECT id, operation_number, country FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as any[];

  const today = new Date().toISOString().slice(0, 10);
  const isSupplier = order.type === 'supplier';

  const requested = String(req.query.entity || '').toUpperCase();
  const entity: EntityCode = isEntityCode(requested)
    ? requested
    : entityFromOperationNumber(operation?.operation_number || order.order_number);
  const issuer = entityProfile(entity);

  // Which of the customer's legal entities this order belongs to. Never applied
  // silently — the client asks the user to confirm before generating.
  const requestedProfile = parseInt(String(req.query.profile_id || ''), 10);
  const match = matchProfile(
    isSupplier ? null : order.customer_id,
    order,
    operation?.country,
    Number.isInteger(requestedProfile) ? requestedProfile : null
  );
  const profile = match.profile;
  const shared = profile?.data.shared || {};
  const invDefaults = profile?.data.invoice || {};

  const origin = originForItems(items);

  // How this customer's invoices are laid out, and the wording the last one
  // used — an invoice is drafted from the previous one, not from a blank page.
  const customerId = isSupplier ? null : order.customer_id;
  const { layout, source: layoutSource } = resolveInvoiceLayout(customerId, profile, order.customer_name);
  const carried = carryForwardInvoiceText(customerId);

  // A bank account entered on the customer's profile replaces the issuing
  // entity's own. Blank fields keep the entity account, so customers who never
  // set one are unaffected.
  const profileBank = Object.fromEntries(
    (['bank_name', 'iban', 'bic', 'bank_address'] as const)
      .map(key => [key, String(invDefaults[key] ?? '').trim()])
      .filter(([, value]) => !!value)
  );

  const draft: DocumentData = {
    ...issuer,
    ...profileBank,
    doc_number: nextInvoiceNumber(entity, today),
    doc_date: today,
    sq_number: '',
    our_ref: items[0]?.description || order.description || '',
    po_number: order.order_number || '',
    operation_number: operation?.operation_number || '',
    client_code: shared.client_code || '',
    attention: shared.attention || '',
    client_name: shared.legal_name || (isSupplier ? order.supplier_name : order.customer_name) || '',
    billing_address: shared.billing_address || (isSupplier ? order.supplier_address : order.customer_address) || '',
    client_phone: shared.contact_phone || (isSupplier ? order.supplier_phone : order.customer_phone) || '',
    tax_id: shared.tax_id || '',
    eori: shared.eori || '',
    contact_email: shared.contact_email || (isSupplier ? order.supplier_email : order.customer_email) || '',
    items: prefillLines(items),
    ...carried,
    delivery: deliveryTerms(order) || invDefaults.delivery || carried.delivery || '',
    delivery_address: invDefaults.delivery_address || carried.delivery_address || '',
    delivery_date_text: order.delivery_date ? formatLongDate(order.delivery_date) : '',
    product_reference: carried.product_reference || items[0]?.description || '',
    freight: 0,
    vat: 0,
    insurance: 0,
    // Offered to the user behind a toggle rather than printed unasked
    manufacturer: origin.manufacturer,
    country_of_origin: origin.country_of_origin,
    terms: order.payment_terms || invDefaults.terms || carried.terms || '',
    layout,
  };

  res.json({
    existing: null,
    draft,
    entity,
    layout,
    layout_source: layoutSource,
    profiles: listProfiles(isSupplier ? null : order.customer_id),
    profile_id: profile?.id ?? null,
    profile_name: profile?.name ?? null,
    matched_by: match.matchedBy,
    match_confident: match.confident,
    order: {
      id: order.id,
      order_number: order.order_number,
      type: order.type,
      customer_id: customerId,
      customer_name: order.customer_name,
      supplier_name: order.supplier_name,
    },
    operation: operation || null,
  });
});

// ── Save a layout as the customer's own ───────────────────────────────────

/**
 * Makes the layout the user just edited this customer's standing format, so
 * every later invoice for them starts from it. Stored on the document profile
 * beside the rest of their defaults.
 */
router.put('/layout/:profileId', (req: Request, res: Response) => {
  const profileId = Number(req.params.profileId);
  const row = db.prepare('SELECT * FROM customer_document_profiles WHERE id = ?').get(profileId) as any;
  if (!row) { res.status(404).json({ error: 'Customer profile not found' }); return; }

  const layout = normalizeLayout(req.body?.layout);

  let data: any = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt row → start clean */ }
  data.invoice_layout = layout;

  db.prepare(`UPDATE customer_document_profiles SET data = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(data), profileId);

  res.json({ message: `Invoice format saved for ${row.name}`, layout });
});

// ── List / read ───────────────────────────────────────────────────────────

router.get('/by-order/:orderId', (req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT * FROM invoice_documents WHERE order_id = ? ORDER BY id DESC'
  ).all(Number(req.params.orderId)) as any[];
  res.json(rows.map(parseRecord));
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Invoice not found' }); return; }
  res.json(parseRecord(row));
});

// ── Live preview (nothing is persisted) ───────────────────────────────────

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const pdf = await buildDocumentPdf('invoice', (req.body?.data || {}) as DocumentData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="invoice-preview.pdf"');
    res.send(pdf);
  } catch (err: any) {
    console.error('[invoice-documents] preview failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// ── Create ────────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { order_id, operation_id, profile_id, data } = req.body as {
    order_id?: number; operation_id?: number | null; profile_id?: number | null; data?: DocumentData;
  };

  if (!order_id) { res.status(400).json({ error: 'order_id is required' }); return; }
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const order = db.prepare('SELECT id, order_number FROM orders WHERE id = ?').get(order_id) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  let operationId: number | null = operation_id ?? null;
  if (operationId == null) {
    const linked = db.prepare('SELECT id FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order_id) as any;
    operationId = linked?.id ?? null;
  }

  const entity = entityFromOperationNumber(operationNumberFor(operationId) || order.order_number);
  const payload: DocumentData = {
    ...data,
    doc_number: (data.doc_number || '').trim() || nextInvoiceNumber(entity, data.doc_date),
    operation_number: data.operation_number || operationNumberFor(operationId) || '',
  };

  if (numberTaken(payload.doc_number!)) {
    res.status(409).json({ error: `Invoice ${payload.doc_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    filed = await renderAndFile(payload, { operationId });

    const result = db.prepare(`
      INSERT INTO invoice_documents (invoice_number, order_id, operation_id, profile_id, data, file_path, file_name, document_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.doc_number, order_id, operationId, profile_id ?? null,
      JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, req.user?.userId ?? null
    );

    const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(result.lastInsertRowid);
    notifyAdmin({
      action: 'created', entity: 'Commercial Invoice', label: payload.doc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.status(201).json(parseRecord(row));
  } catch (err: any) {
    if (filed) discardFiled(filed, null);
    if (err?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: `Invoice ${payload.doc_number} already exists` });
      return;
    }
    console.error('[invoice-documents] create failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to generate the invoice' });
  }
});

// ── Update ────────────────────────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { data, operation_id, profile_id } = req.body as { data?: DocumentData; operation_id?: number | null; profile_id?: number | null };
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const payload: DocumentData = {
    ...data,
    doc_number: (data.doc_number || '').trim() || existing.invoice_number,
  };
  const operationId = operation_id !== undefined ? operation_id : existing.operation_id;

  if (numberTaken(payload.doc_number!, existing.id)) {
    res.status(409).json({ error: `Invoice ${payload.doc_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    filed = await renderAndFile(payload, { operationId, existing });

    db.prepare(`
      UPDATE invoice_documents
      SET invoice_number = ?, operation_id = ?, profile_id = ?, data = ?, file_path = ?, file_name = ?, document_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(payload.doc_number, operationId, profile_id ?? existing.profile_id ?? null, JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, existing.id);

    const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(existing.id);
    notifyAdmin({
      action: 'updated', entity: 'Commercial Invoice', label: payload.doc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json(parseRecord(row));
  } catch (err: any) {
    if (filed) discardFiled(filed, existing.document_id);
    console.error('[invoice-documents] update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to regenerate the invoice' });
  }
});

// ── Download ──────────────────────────────────────────────────────────────

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row?.file_path) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const filePath = path.join(docsDir, row.file_path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.file_name || 'invoice.pdf'}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ── Email ─────────────────────────────────────────────────────────────────

router.post('/:id/email', async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(501).json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }); return; }

  const recipients = String(req.body?.to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if (!recipients.length) { res.status(400).json({ error: 'At least one recipient email is required' }); return; }

  const invalid = recipients.filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.join(', ')}` }); return; }

  const filePath = row.file_path ? path.join(docsDir, row.file_path) : null;
  if (!filePath || !fs.existsSync(filePath)) { res.status(404).json({ error: 'Generated PDF is missing — save the invoice again' }); return; }

  const data = parseRecord(row).data as DocumentData;
  const subject = String(req.body?.subject || '').trim()
    || `Commercial Invoice ${row.invoice_number}${data.client_name ? ` — ${data.client_name}` : ''}`;
  const bodyText = String(req.body?.message || '').trim();
  const { total, currency } = computeTotals(data);

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p style="font-size:15px;">Dear ${escapeHtml(data.client_name || 'Sir/Madam')},</p>
  ${bodyText
      ? `<p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>`
      : `<p style="font-size:14px;">Please find attached our commercial invoice <strong>${escapeHtml(row.invoice_number)}</strong>.</p>`}
  <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;margin-top:16px;">
    <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Invoice</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(row.invoice_number)}</td></tr>
    <tr><td style="padding:8px 12px;color:#6b7280;">Date</td><td style="padding:8px 12px;">${escapeHtml(formatLongDate(data.doc_date))}</td></tr>
    ${data.po_number ? `<tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Your order#</td><td style="padding:8px 12px;">${escapeHtml(data.po_number)}</td></tr>` : ''}
    <tr><td style="padding:8px 12px;color:#6b7280;">Total</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(`${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`)}</td></tr>
  </table>
  <p style="font-size:14px;margin-top:20px;">Kind regards,<br/>${escapeHtml(data.company_name || 'TripleW BV')}</p>
</div>`;

  try {
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const { error } = await resend.emails.send({
      from, to: recipients, subject, html,
      attachments: [{ filename: row.file_name || 'invoice.pdf', content: fs.readFileSync(filePath).toString('base64') }],
    });
    if (error) throw new Error(error.message || 'Resend rejected the message');

    db.prepare(`UPDATE invoice_documents SET sent_to = ?, sent_at = datetime('now') WHERE id = ?`)
      .run(recipients.join(', '), row.id);

    notifyAdmin({
      action: 'updated', entity: 'Commercial Invoice', label: row.invoice_number,
      detail: `emailed to ${recipients.join(', ')}`,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });

    const updated = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(row.id);
    res.json({ message: `Invoice sent to ${recipients.join(', ')}`, invoice: parseRecord(updated) });
  } catch (err: any) {
    console.error('[invoice-documents] email failed:', err?.message || err);
    res.status(502).json({ error: `Failed to send email: ${err?.message || 'unknown error'}` });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Invoice not found' }); return; }

  if (row.file_path) {
    const filePath = path.join(docsDir, row.file_path);
    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch { /* best effort */ } }
  }
  if (row.document_id) db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
  db.prepare('DELETE FROM invoice_documents WHERE id = ?').run(row.id);

  notifyAdmin({
    action: 'deleted', entity: 'Commercial Invoice', label: row.invoice_number,
    performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
  });
  res.json({ message: 'Invoice deleted' });
});

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default router;
