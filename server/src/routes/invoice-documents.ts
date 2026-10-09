import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { archiveStored, archiveFile, archiveBuffer, archivedBy, ownerOf, contextOf } from '../lib/archive.js';
import { notifyAdmin } from '../lib/notify.js';
import { applyEntityBank, entityFromOperationNumber, entityProfile, isEntityCode, type EntityCode } from '../lib/companyEntity.js';
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
import { normalizeLayout, SAMPLE_INVOICE_LAYOUT, SAMPLE_INVOICE_TERMS } from '../lib/invoiceLayout.js';
import { getEurRate } from '../lib/fx.js';
import { refreshEstimatedPaymentDate } from '../lib/paymentTerms.js';
import { deletePackingListsForInvoice } from './packing-lists.js';
import {
  ncoSource, ncoProfile, ncoPartyFields, NCO_CURRENCY, nextSampleInvoiceNumber, ncoSampleLines, sampleQuantityText,
  fileUnderNco, dropNcoDocumentRow,
} from '../lib/ncoDocs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');
const invoicesDir = path.join(uploadsBase, 'invoices');

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
  // Edits saved as a draft on top of the generated document, if any
  let draft: any = null;
  if (row.draft_data) { try { draft = JSON.parse(row.draft_data); } catch { /* ignore a corrupt draft */ } }
  return { ...row, data, draft };
}

/**
 * Writes the PDF to operation-docs and keeps the operation_documents row in
 * sync, so the invoice always appears under the operation's documents.
 */
async function renderAndFile(
  data: DocumentData,
  opts: { operationId: number | null; ncoId?: number | null; existing?: any }
): Promise<Filed> {
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

  // An NCO's invoice is filed under the NCO instead
  const ncoDocumentId = opts.ncoId
    ? fileUnderNco(opts.ncoId, opts.existing?.nco_document_id, 'Sample invoice', storedName, displayName, `Sample invoice ${data.doc_number || ''}`.trim())
    : null;

  return { filePath: storedName, fileName: displayName, documentId, ncoDocumentId };
}

type Filed = { filePath: string; fileName: string; documentId: number | null; ncoDocumentId: number | null };

/** Undo a renderAndFile when the row it belongs to could not be written. */
function discardFiled(filed: Filed, keepDocumentId: number | null, keepNcoDocumentId: number | null = null) {
  const orphan = path.join(docsDir, filed.filePath);
  if (fs.existsSync(orphan)) { try { fs.unlinkSync(orphan); } catch { /* best effort */ } }
  if (filed.documentId && filed.documentId !== keepDocumentId) {
    try { db.prepare('DELETE FROM operation_documents WHERE id = ?').run(filed.documentId); } catch { /* best effort */ }
  }
  if (filed.ncoDocumentId && filed.ncoDocumentId !== keepNcoDocumentId) dropNcoDocumentRow(filed.ncoDocumentId);
}

function numberTaken(invoiceNumber: string, exceptId?: number, linkedInvoiceId?: number | null): boolean {
  const row = db.prepare('SELECT id FROM invoice_documents WHERE invoice_number = ?').get(invoiceNumber) as any;
  if (row && row.id !== exceptId) return true;

  // A number already on a recorded invoice must not be reused either — except
  // the one this generated invoice is itself filed as
  try {
    const recorded = db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(invoiceNumber) as any;
    if (recorded && recorded.id !== linkedInvoiceId) return true;
  } catch { /* table unavailable */ }

  return false;
}

/** Metric tons on the invoice's lines; null when no line has a weight unit. */
function linesTonnage(items: DocumentData['items']): number | null {
  let total = 0;
  let known = false;
  for (const item of items || []) {
    const qty = Number(item.quantity) || 0;
    const unit = String(item.quantity_unit || '').trim().toLowerCase();
    if (['mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't'].includes(unit)) { total += qty; known = true; }
    else if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(unit)) { total += qty / 1000; known = true; }
    else if (['lbs', 'lb', 'pound', 'pounds'].includes(unit)) { total += qty / 2204.6226218; known = true; }
  }
  return known ? total : null;
}

/**
 * Files a generated invoice as a recorded invoice (`invoices` row), so it sits
 * in the operation's Invoices list, the quick view and every revenue figure
 * like an uploaded one. Re-saving the invoice keeps that row in step; its
 * status (and any wire transfers against it) is left alone.
 */
async function syncRecordedInvoice(docId: number): Promise<void> {
  const docRow = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(docId) as any;
  // An NCO (samples) invoice has no commercial value — never a recorded invoice, never revenue
  if (!docRow || docRow.nco_id) return;
  const data = parseRecord(docRow).data as DocumentData;
  const order = docRow.order_id
    ? db.prepare('SELECT id, type, customer_id, supplier_id FROM orders WHERE id = ?').get(docRow.order_id) as any
    : null;

  const isSupplier = order?.type === 'supplier';
  const customerId = isSupplier ? null : (order?.customer_id ?? null);
  const supplierId = isSupplier ? (order?.supplier_id ?? null) : null;
  // The invoices table insists on a counterparty for its type
  if (!customerId && !supplierId) return;

  const { total, currency } = computeTotals(data);
  const invoiceDate = data.doc_date || new Date().toISOString().slice(0, 10);
  let fxRate: number | null = null;
  let eurAmount: number | null = null;
  if (currency !== 'EUR') {
    try { fxRate = await getEurRate(currency, invoiceDate); eurAmount = total * fxRate; }
    catch { /* rate unavailable — aggregates fall back to the amount */ }
  }

  // A copy of the PDF where recorded invoices keep theirs
  let storedName: string | null = null;
  const source = docRow.file_path ? path.join(docsDir, docRow.file_path) : null;
  if (source && fs.existsSync(source)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
    storedName = `ci-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
    fs.copyFileSync(source, path.join(invoicesDir, storedName));
  }

  let linked = docRow.invoice_id
    ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(docRow.invoice_id) as any
    : null;
  // An invoice recorded earlier under the same number is this one
  if (!linked) linked = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(docRow.invoice_number) as any;

  const fields = [
    docRow.invoice_number, customerId, supplierId, isSupplier ? 'supplier' : 'customer',
    total, currency, invoiceDate, data.our_ref || null, data.po_number || null,
    docRow.operation_id ?? null, fxRate, eurAmount, linesTonnage(data.items),
  ];

  let invoiceId: number;
  if (linked) {
    if (storedName && linked.file_path) {
      const old = path.join(invoicesDir, linked.file_path);
      if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
    }
    db.prepare(`
      UPDATE invoices SET invoice_number = ?, customer_id = ?, supplier_id = ?, type = ?, amount = ?, currency = ?,
        invoice_date = ?, our_ref = ?, po_number = ?, operation_id = ?, fx_rate = ?, eur_amount = ?, quantity_mt = ?,
        file_path = COALESCE(?, file_path), file_name = COALESCE(?, file_name), updated_at = datetime('now')
      WHERE id = ?
    `).run(...fields, storedName, storedName ? docRow.file_name : null, linked.id);
    invoiceId = linked.id;
  } else {
    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, supplier_id, type, amount, currency, invoice_date, our_ref, po_number,
        operation_id, fx_rate, eur_amount, quantity_mt, status, file_path, file_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)
    `).run(...fields, storedName, storedName ? docRow.file_name : null);
    invoiceId = Number(result.lastInsertRowid);
    db.prepare(`INSERT INTO status_history (entity_type, entity_id, new_status, changed_by) VALUES ('invoice', ?, 'sent', ?)`)
      .run(invoiceId, docRow.created_by ?? null);
  }

  if (docRow.invoice_id !== invoiceId) {
    db.prepare('UPDATE invoice_documents SET invoice_id = ? WHERE id = ?').run(invoiceId, docId);
  }
  refreshEstimatedPaymentDate(db, docRow.operation_id ?? null);
}

/**
 * Removes a generated invoice: its PDF, its operation document, its packing
 * list and the row itself — which frees its number. The recorded copy goes
 * too unless `keepRecorded` (the caller deletes it) or money is matched to it.
 */
export function deleteInvoiceDocument(row: any, opts: { keepRecorded?: boolean } = {}): void {
  if (row.file_path) {
    const owner = ownerOf(row.operation_id, row.nco_id);
    archiveFile(path.join(docsDir, row.file_path), {
      section: owner.section, context: contextOf(owner.number, `${row.nco_id ? 'Sample invoice' : 'Commercial invoice'} ${row.invoice_number || ''}`),
      fileName: row.file_name,
    });
  }
  if (row.document_id) db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
  dropNcoDocumentRow(row.nco_document_id);
  // The packing list packs this invoice's goods, so it goes with it
  deletePackingListsForInvoice(row.id);
  db.prepare('DELETE FROM invoice_documents WHERE id = ?').run(row.id);

  if (opts.keepRecorded || !row.invoice_id) return;
  const recorded = db.prepare('SELECT * FROM invoices WHERE id = ?').get(row.invoice_id) as any;
  const wires = db.prepare('SELECT COUNT(*) AS n FROM wire_transfers WHERE invoice_id = ?').get(row.invoice_id) as any;
  if (recorded && !wires?.n) {
    if (recorded.file_path) {
      const recordedFile = path.join(invoicesDir, recorded.file_path);
      if (fs.existsSync(recordedFile)) { try { fs.unlinkSync(recordedFile); } catch { /* best effort */ } }
    }
    try { db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(recorded.id); } catch { /* table unavailable */ }
    db.prepare(`DELETE FROM status_history WHERE entity_type = 'invoice' AND entity_id = ?`).run(recorded.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(recorded.id);
    refreshEstimatedPaymentDate(db, recorded.operation_id ?? null);
  }
}

/** Generated invoices made before they were filed as recorded invoices. */
export async function backfillRecordedInvoices(): Promise<void> {
  // A generated invoice whose recorded copy was deleted was deleted by the
  // user — left behind, it would keep its number taken
  try {
    const orphans = db.prepare(`
      SELECT d.* FROM invoice_documents d
      WHERE d.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = d.invoice_id)
    `).all() as any[];
    for (const orphan of orphans) {
      try {
        deleteInvoiceDocument(orphan, { keepRecorded: true });
        console.log(`[invoice-documents] removed ${orphan.invoice_number} — its recorded invoice was deleted`);
      } catch (err: any) { console.error('[invoice-documents] orphan cleanup failed for', orphan.id, err?.message || err); }
    }
  } catch { /* table unavailable */ }

  let rows: Array<{ id: number }> = [];
  try { rows = db.prepare(`SELECT id FROM invoice_documents WHERE invoice_id IS NULL AND status = 'final' AND nco_id IS NULL`).all() as any[]; }
  catch { return; }
  for (const row of rows) {
    try { await syncRecordedInvoice(row.id); }
    catch (err: any) { console.error('[invoice-documents] backfill failed for', row.id, err?.message || err); }
  }
}

// ── Prefill a draft from the order ────────────────────────────────────────

/** Fields the invoice takes from the order confirmation when it sets them. */
const OC_CARRIED_FIELDS = [
  'sq_number', 'po_number', 'client_code', 'attention', 'client_name', 'billing_address',
  'client_contact', 'client_phone', 'tax_id', 'eori', 'contact_email', 'delivery', 'delivery_address',
  'delivery_contact', 'delivery_date_text', 'payment_terms', 'incoterm', 'terms', 'remarks', 'freight',
] as const;

router.get('/prepare', (req: Request, res: Response) => {
  if (req.query.nco_id) { prepareFromNco(req, res); return; }
  const orderId = parseInt(String(req.query.order_id || ''), 10);
  if (!Number.isInteger(orderId)) { res.status(400).json({ error: 'order_id is required' }); return; }

  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           c.address as customer_address, c.company as customer_company,
           c.vat_number as customer_vat, c.contact_person as customer_contact,
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

  // The order confirmation is what was agreed with the customer — the invoice
  // is drafted from it, falling back to the order where it is silent
  const ocRow = db.prepare(
    'SELECT * FROM order_confirmations WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;
  let ocData: any = null;
  if (ocRow) { try { ocData = JSON.parse(ocRow.data); } catch { /* corrupt OC → order only */ } }

  const requested = String(req.query.entity || '').toUpperCase();
  const entity: EntityCode = isEntityCode(requested)
    ? requested
    : isEntityCode(ocData?.entity_code)
      ? ocData.entity_code
      : entityFromOperationNumber(operation?.operation_number || order.order_number);
  // The bank printed is the entity's account in the order's currency
  const ocItems: any[] = Array.isArray(ocData?.items) && ocData.items.length ? ocData.items : [];
  const orderCurrency = String(
    ocItems.find((i: any) => i?.currency)?.currency || items.find((i: any) => i.currency)?.currency || 'EUR'
  ).toUpperCase();
  const issuer = entityProfile(entity, orderCurrency);

  // Which of the customer's legal entities this order belongs to. Never applied
  // silently — the client asks the user to confirm before generating.
  // The invoice names the same entity the order confirmation was confirmed for
  const ocProfile = db.prepare(
    'SELECT profile_id FROM order_confirmations WHERE order_id = ? AND profile_id IS NOT NULL ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;
  const requestedProfile = parseInt(String(req.query.profile_id || ocProfile?.profile_id || ''), 10);
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
    entity_code: entity,
    // A bank from the customer's profile is theirs to keep, whatever the currency
    bank_override: Object.keys(profileBank).length > 0,
    doc_number: nextInvoiceNumber(entity, today),
    doc_date: today,
    sq_number: '',
    our_ref: items[0]?.description || order.description || '',
    po_number: order.order_number || '',
    operation_number: operation?.operation_number || '',
    client_code: shared.client_code || '',
    attention: shared.attention || '',
    client_name: shared.legal_name || (isSupplier ? order.supplier_name : (order.customer_company || order.customer_name)) || '',
    billing_address: shared.billing_address || (isSupplier ? order.supplier_address : order.customer_address) || '',
    client_contact: shared.contact_person || (isSupplier ? '' : order.customer_contact) || '',
    client_phone: shared.contact_phone || (isSupplier ? order.supplier_phone : order.customer_phone) || '',
    tax_id: shared.tax_id || (isSupplier ? '' : order.customer_vat) || '',
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

  // What the OC says wins over the order and the profile; blanks on it don't
  if (ocData) {
    for (const key of OC_CARRIED_FIELDS) {
      const value = ocData[key];
      if (value != null && String(value).trim() !== '') (draft as any)[key] = value;
    }
    if (ocItems.length) draft.items = ocItems;
  }
  // "Our ref" on the invoice is the operation number
  if (operation?.operation_number) draft.our_ref = operation.operation_number;

  res.json({
    existing: null,
    draft,
    oc: ocRow ? { id: ocRow.id, oc_number: ocRow.oc_number } : null,
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

/**
 * A samples NCO -> a Sample Invoice (TripleW's sample invoice layout): drafted
 * from its order confirmation when there is one, else from the NCO lines.
 * Numbered SI + entity + date + running number; "Sample without commercial
 * value" terms; no bank block. Never a recorded invoice.
 */
function prepareFromNco(req: Request, res: Response) {
  const nco = ncoSource(Number(req.query.nco_id));
  if (!nco) { res.status(404).json({ error: 'Non-commercial operation not found' }); return; }
  if (nco.type !== 'samples') { res.status(400).json({ error: 'Documents are generated for sample NCOs only' }); return; }

  const existing = db.prepare('SELECT * FROM invoice_documents WHERE nco_id = ? ORDER BY id DESC LIMIT 1').get(nco.id) as any;
  if (existing) { res.json({ existing: parseRecord(existing) }); return; }

  const ocRow = db.prepare('SELECT * FROM order_confirmations WHERE nco_id = ? ORDER BY id DESC LIMIT 1').get(nco.id) as any;
  let ocData: any = null;
  if (ocRow) { try { ocData = JSON.parse(ocRow.data); } catch { /* corrupt OC → NCO only */ } }
  const ocItems: any[] = Array.isArray(ocData?.items) && ocData.items.length ? ocData.items : [];

  const requested = String(req.query.entity || '').toUpperCase();
  const entity: EntityCode = isEntityCode(requested) ? requested : isEntityCode(ocData?.entity_code) ? ocData.entity_code : nco.entity;
  const currency = String(ocItems.find((i: any) => i?.currency)?.currency || NCO_CURRENCY(nco.lines)).toUpperCase();
  const issuer = entityProfile(entity, currency);

  const requestedProfile = parseInt(String(req.query.profile_id || ocRow?.profile_id || ''), 10);
  const { match, profiles } = ncoProfile(nco, Number.isInteger(requestedProfile) ? requestedProfile : null);
  const profile = match.profile;
  const invDefaults = profile?.data.invoice || {};
  // The customer's own sample-invoice format when one was saved, else the house one
  const savedSample = (profile?.data as any)?.sample_invoice_layout;
  const layout = normalizeLayout(savedSample && typeof savedSample === 'object' ? savedSample : SAMPLE_INVOICE_LAYOUT);
  const layoutSource = savedSample ? `sample format saved on ${profile!.name}` : 'the TripleW sample invoice';
  const today = new Date().toISOString().slice(0, 10);
  const party = ncoPartyFields(nco, profile);

  const draft: DocumentData = {
    ...issuer,
    entity_code: entity,
    doc_number: nextSampleInvoiceNumber(entity, today),
    doc_date: today,
    sq_number: '',
    our_ref: nco.nco_number,
    po_number: 'Sample',
    operation_number: nco.nco_number,
    ...party,
    client_code: party.client_code || 'Not applicable',
    items: ncoSampleLines(nco.lines),
    delivery: invDefaults.delivery || '',
    delivery_address: invDefaults.delivery_address || party.billing_address || '',
    delivery_date_text: '',
    remarks: 'Sample invoice, PSS, SDS, COA',
    product_reference: nco.lines[0]?.product || '',
    freight: 0,
    vat: 0,
    insurance: 0,
    terms: SAMPLE_INVOICE_TERMS,
    notes: '',
    layout,
  } as DocumentData;
  if (ocData) {
    for (const key of OC_CARRIED_FIELDS) {
      const value = ocData[key];
      if (value != null && String(value).trim() !== '') (draft as any)[key] = value;
    }
    if (ocItems.length) {
      draft.items = ocItems.map((it: any) => ({
        ...it,
        packaging: it.packaging || 'Sample bottle',
        note: it.note || sampleQuantityText(it.quantity, it.quantity_unit),
      }));
    }
    draft.layout = layout;
    draft.terms = draft.terms || SAMPLE_INVOICE_TERMS;
  }

  res.json({
    existing: null, draft,
    oc: ocRow ? { id: ocRow.id, oc_number: ocRow.oc_number } : null,
    entity, layout, layout_source: layoutSource, profiles,
    profile_id: profile?.id ?? null, profile_name: profile?.name ?? null,
    matched_by: match.matchedBy, match_confident: match.confident,
    order: null, operation: null,
    nco: { id: nco.id, nco_number: nco.nco_number, customer_id: nco.customer_id, customer_name: nco.customer_name },
  });
}

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
  // ?kind=sample keeps a customer's sample-invoice format apart from their commercial one
  if (req.query.kind === 'sample') data.sample_invoice_layout = layout; else data.invoice_layout = layout;

  db.prepare(`UPDATE customer_document_profiles SET data = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(data), profileId);

  res.json({ message: `Invoice format saved for ${row.name}`, layout });
});

// ── List / read ───────────────────────────────────────────────────────────

router.get('/by-nco/:ncoId', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM invoice_documents WHERE nco_id = ? ORDER BY id DESC').all(Number(req.params.ncoId)) as any[];
  res.json(rows.map(parseRecord));
});

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
    const pdf = await buildDocumentPdf('invoice', applyEntityBank((req.body?.data || {}) as DocumentData));
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
  const { order_id, operation_id, profile_id, data, nco_id } = req.body as {
    order_id?: number; operation_id?: number | null; profile_id?: number | null; data?: DocumentData; nco_id?: number | null;
  };
  const isDraft = req.body?.status === 'draft';

  // A samples NCO stands in for the order; its invoice is numbered as the NCO
  const nco = nco_id ? db.prepare('SELECT id, nco_number, type, entity FROM non_commercial_operations WHERE id = ?').get(nco_id) as any : null;
  if (nco_id && !nco) { res.status(404).json({ error: 'Non-commercial operation not found' }); return; }
  if (nco && nco.type !== 'samples') { res.status(400).json({ error: 'Documents are generated for sample NCOs only' }); return; }
  if (!order_id && !nco) { res.status(400).json({ error: 'order_id is required' }); return; }
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const order = order_id ? db.prepare('SELECT id, order_number FROM orders WHERE id = ?').get(order_id) as any : null;
  if (order_id && !order) { res.status(404).json({ error: 'Order not found' }); return; }

  if (nco) { await createForNco(req, res, nco, data, profile_id ?? null, isDraft); return; }

  let operationId: number | null = operation_id ?? null;
  if (operationId == null) {
    const linked = db.prepare('SELECT id FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order_id) as any;
    operationId = linked?.id ?? null;
  }

  const entity = isEntityCode(data.entity_code)
    ? data.entity_code
    : entityFromOperationNumber(operationNumberFor(operationId) || order.order_number);
  const payload: DocumentData = applyEntityBank({
    ...data,
    doc_number: (data.doc_number || '').trim() || nextInvoiceNumber(entity, data.doc_date),
    operation_number: data.operation_number || operationNumberFor(operationId) || '',
  });

  // A number already used goes on to the next free one in the series
  const renumberedFrom = numberTaken(payload.doc_number!) ? payload.doc_number! : null;
  if (renumberedFrom) payload.doc_number = nextInvoiceNumber(entity, payload.doc_date);

  let filed: Filed | null = null;
  try {
    // A draft is only the saved form: no PDF, not filed, not in revenue
    if (!isDraft) filed = await renderAndFile(payload, { operationId });

    const result = db.prepare(`
      INSERT INTO invoice_documents (invoice_number, order_id, operation_id, profile_id, data, file_path, file_name, document_id, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.doc_number, order_id, operationId, profile_id ?? null,
      JSON.stringify(payload), filed?.filePath ?? null, filed?.fileName ?? null, filed?.documentId ?? null,
      req.user?.userId ?? null, isDraft ? 'draft' : 'final'
    );

    if (!isDraft) {
      try { await syncRecordedInvoice(Number(result.lastInsertRowid)); }
      catch (err: any) { console.error('[invoice-documents] filing as recorded invoice failed:', err?.message || err); }
    }

    const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(result.lastInsertRowid);
    notifyAdmin({
      action: 'created', entity: isDraft ? 'Commercial Invoice draft' : 'Commercial Invoice', label: payload.doc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.status(201).json({ ...parseRecord(row), renumbered_from: renumberedFrom });
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

/** Create for a samples NCO: a sample invoice (SI... number), filed under the NCO, never a recorded invoice. */
async function createForNco(req: Request, res: Response, nco: any, data: DocumentData, profileId: number | null, isDraft: boolean) {
  const entity = isEntityCode(data.entity_code) ? data.entity_code : nco.entity;
  const payload: DocumentData = applyEntityBank({
    ...data,
    doc_number: (data.doc_number || '').trim() || nextSampleInvoiceNumber(entity, data.doc_date),
    operation_number: data.operation_number || nco.nco_number,
  });
  let renumberedFrom: string | null = null;
  if (numberTaken(payload.doc_number!)) {
    // Someone took this sample number meanwhile - take the next one of the day
    renumberedFrom = payload.doc_number!;
    payload.doc_number = nextSampleInvoiceNumber(entity, payload.doc_date);
  }

  let filed: Filed | null = null;
  try {
    if (!isDraft) filed = await renderAndFile(payload, { operationId: null, ncoId: nco.id });
    const result = db.prepare(`
      INSERT INTO invoice_documents (invoice_number, order_id, operation_id, profile_id, data, file_path, file_name, document_id, created_by, status, nco_id, nco_document_id)
      VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      payload.doc_number, profileId, JSON.stringify(payload), filed?.filePath ?? null, filed?.fileName ?? null,
      req.user?.userId ?? null, isDraft ? 'draft' : 'final', nco.id, filed?.ncoDocumentId ?? null
    );
    const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(result.lastInsertRowid);
    notifyAdmin({
      action: 'created', entity: isDraft ? 'Sample invoice draft' : 'Sample invoice', label: payload.doc_number!,
      detail: `${nco.nco_number} — no commercial value`,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.status(201).json({ ...parseRecord(row), renumbered_from: renumberedFrom });
  } catch (err: any) {
    if (filed) discardFiled(filed, null);
    if (err?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: `Invoice ${payload.doc_number} already exists` });
      return;
    }
    console.error('[invoice-documents] NCO create failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to generate the invoice' });
  }
}

// ── Update ────────────────────────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const { data, operation_id, profile_id } = req.body as { data?: DocumentData; operation_id?: number | null; profile_id?: number | null };
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const isDraft = req.body?.status === 'draft';
  const wasDraft = existing.status === 'draft';
  if (isDraft && !wasDraft) {
    // Already generated: keep the edits as a pending draft. The filed PDF (and,
    // for an invoice, the recorded amount) stays as generated until regenerated.
    db.prepare(`UPDATE invoice_documents SET draft_data = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(data), existing.id);
    res.json(parseRecord(db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(existing.id)));
    return;
  }

  const payload: DocumentData = applyEntityBank({
    ...data,
    doc_number: (data.doc_number || '').trim() || existing.invoice_number,
  });
  let operationId = existing.nco_id ? null : (operation_id !== undefined ? operation_id : existing.operation_id);
  // Saved first without an operation (e.g. before the order had one): file it under the order's operation now
  if (operationId == null && !existing.nco_id && existing.order_id) {
    operationId = (db.prepare('SELECT id FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(existing.order_id) as any)?.id ?? null;
  }

  let renumberedFrom: string | null = null;
  if (numberTaken(payload.doc_number!, existing.id, existing.invoice_id)) {
    if (!wasDraft) {
      res.status(409).json({ error: `Invoice ${payload.doc_number} already exists` });
      return;
    }
    // A draft has not been issued yet, so it simply takes the next free number
    const entity = isEntityCode(payload.entity_code)
      ? payload.entity_code
      : entityFromOperationNumber(operationNumberFor(operationId) || payload.operation_number || '');
    renumberedFrom = payload.doc_number!;
    // A sample invoice takes the next of its own SI series, never the commercial one
    payload.doc_number = existing.nco_id ? nextSampleInvoiceNumber(entity, payload.doc_date) : nextInvoiceNumber(entity, payload.doc_date);
  }

  let filed: Filed | null = null;
  try {
    if (!isDraft) filed = await renderAndFile(payload, { operationId, ncoId: existing.nco_id ?? null, existing });

    db.prepare(`
      UPDATE invoice_documents
      SET invoice_number = ?, operation_id = ?, profile_id = ?, data = ?, file_path = ?, file_name = ?, document_id = ?,
        nco_document_id = ?, status = ?, draft_data = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      payload.doc_number, operationId, profile_id ?? existing.profile_id ?? null, JSON.stringify(payload),
      filed?.filePath ?? null, filed?.fileName ?? null, filed?.documentId ?? null, filed?.ncoDocumentId ?? null,
      isDraft ? 'draft' : 'final', existing.id
    );

    if (!isDraft) {
      try { await syncRecordedInvoice(existing.id); }
      catch (err: any) { console.error('[invoice-documents] filing as recorded invoice failed:', err?.message || err); }
    }

    const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(existing.id);
    notifyAdmin({
      action: wasDraft && !isDraft ? 'created' : 'updated',
      entity: isDraft ? 'Commercial Invoice draft' : 'Commercial Invoice', label: payload.doc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json({ ...parseRecord(row), renumbered_from: renumberedFrom });
  } catch (err: any) {
    if (filed) discardFiled(filed, existing.document_id, existing.nco_document_id);
    console.error('[invoice-documents] update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to regenerate the invoice' });
  }
});

// ── Download ──────────────────────────────────────────────────────────────

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (row?.status === 'draft') { res.status(400).json({ error: 'Generate the invoice first' }); return; }
  if (!row?.file_path) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const filePath = path.join(docsDir, row.file_path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

  res.attachment(row.file_name || 'invoice.pdf');
  res.type('application/pdf');
  fs.createReadStream(filePath).pipe(res);
});

// ── Email ─────────────────────────────────────────────────────────────────

router.post('/:id/email', async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if (row.status === 'draft') { res.status(400).json({ error: 'Generate the invoice before sending it' }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(501).json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }); return; }

  const recipients = String(req.body?.to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if (!recipients.length) { res.status(400).json({ error: 'At least one recipient email is required' }); return; }

  const cc = String(req.body?.cc || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const invalid = [...recipients, ...cc].filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
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
      from, to: recipients, ...(cc.length ? { cc } : {}), subject, html,
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

  deleteInvoiceDocument(row);

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
