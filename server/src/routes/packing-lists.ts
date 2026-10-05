import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { buildDocumentPdf, type DocumentData, type PackingRow } from '../lib/document-pdf.js';
import { computePacking, listPackaging, matchPackaging, netKg, packagingById, type PackagingRow } from '../lib/packing.js';
import { normalizePlLayout, resolvePlLayout } from '../lib/packingListLayout.js';
import { resolveProfile } from '../lib/documentPrefill.js';

/**
 * Packing lists: the goods of a generated invoice with their packaging, unit
 * and pallet counts and net / empty-packaging / gross weights. The packaging
 * is read from Inventory → Packaging; see lib/packing.ts.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

const router = Router();

/** A packing list line as edited: the invoice line it packs, the packaging chosen, any counts typed by hand. */
export interface PackingLineInput {
  reference?: string | null;
  commercial_name?: string | null;
  packaging?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
  lot?: string | null;
  lot2?: string | null;
  hs_code?: string | null;
  description?: string | null;
  packaging_id?: number | null;
  units_override?: number | null;
  pallets_override?: number | null;
  /** What one empty pallet weighs on this line; blank = 20 kg. */
  pallet_weight_override?: number | null;
  /** The line's whole packaging weight (gross − net); blank = computed. */
  packaging_weight_override?: number | null;
  /** Volume CBM as typed. */
  volume_cbm?: string | null;
}

export interface PackingListData extends DocumentData {
  lines?: PackingLineInput[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

type PlStatus = 'draft' | 'final';

/** `SOBE20260112PL-DRAFT.pdf` while a draft, `SOBE20260112PL.pdf` once final. */
function fileNameFor(plNumber: string | null, status: PlStatus): string {
  const stem = (plNumber || 'packing-list').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${stem}${status === 'draft' ? '-DRAFT' : ''}.pdf`;
}

/** The operation a PL is filed under: the invoice's, else the one on the invoice's order. */
function resolveOperationId(invoice: { operation_id?: number | null; order_id?: number | null } | null): number | null {
  if (invoice?.operation_id) return invoice.operation_id;
  if (!invoice?.order_id) return null;
  const op = db.prepare('SELECT id FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(invoice.order_id) as any;
  return op?.id ?? null;
}

/**
 * The Bill of Lading among the operation's documents: one filed under the
 * "Bill of Lading" category, else one whose name or note says BL.
 */
export function findBillOfLading(operationId: number | null): { id: number; file_path: string; file_name: string } | null {
  if (!operationId) return null;
  const docs = db.prepare(`
    SELECT d.id, d.file_path, d.file_name, d.notes, c.name AS category
    FROM operation_documents d LEFT JOIN document_categories c ON d.category_id = c.id
    WHERE d.operation_id = ? ORDER BY d.id DESC
  `).all(operationId) as any[];
  const blPattern = /\bB\/?L\b|bill of lading/i;
  const hit = docs.find(d => /bill of lading/i.test(d.category || ''))
    || docs.find(d => !/packing/i.test(d.category || '') && (blPattern.test(d.file_name || '') || blPattern.test(d.notes || '')));
  return hit ? { id: hit.id, file_path: hit.file_path, file_name: hit.file_name } : null;
}

function packingCategoryId(): number | null {
  const row = db.prepare(`SELECT id FROM document_categories WHERE name = 'Packing list'`).get() as any;
  return row?.id ?? null;
}

function parseRecord(row: any) {
  if (!row) return row;
  let data: PackingListData = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt rows surface as empty */ }
  return { ...row, data };
}

function optionalCount(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function optionalWeight(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The invoice lines as packing-list lines, each with the packaging matched to it. */
function linesFromInvoice(items: any[], rows: PackagingRow[], keep: PackingLineInput[] = []): PackingLineInput[] {
  return (items || []).map((item: any, i: number) => {
    const previous = keep[i];
    const source = {
      reference: item.reference || '',
      commercial_name: item.commercial_name || '',
      packaging: item.packaging || '',
      quantity: Number(item.quantity) || 0,
      quantity_unit: item.quantity_unit || 'KG',
      lot: item.lot || '',
      lot2: item.lot2 || '',
      hs_code: item.hs_code || '',
      description: item.description || '',
    };
    // A packaging already chosen for this line survives a refresh from the invoice
    const packagingId = previous?.packaging_id && packagingById(previous.packaging_id)
      ? previous.packaging_id
      : matchPackaging(source, rows).best?.id ?? null;
    return {
      ...source, packaging_id: packagingId, units_override: null, pallets_override: null,
      // Follows the quantity, so it is computed again
      packaging_weight_override: null,
      // What was typed for the pallet and volume is not on the invoice, so it stays
      pallet_weight_override: previous?.pallet_weight_override ?? null,
      volume_cbm: previous?.volume_cbm ?? '',
    };
  });
}

/** The printed rows, always recomputed from the Packaging tab. */
function packingRows(lines: PackingLineInput[]): PackingRow[] {
  return lines.map(line => {
    const pkg = packagingById(line.packaging_id ?? null);
    const figures = computePacking(netKg(line.quantity, line.quantity_unit), pkg, {
      units: optionalCount(line.units_override),
      pallets: optionalCount(line.pallets_override),
      pallet_weight: optionalWeight(line.pallet_weight_override),
      packaging_weight: optionalWeight(line.packaging_weight_override),
    });
    return {
      reference: line.reference || '',
      product: line.commercial_name || '',
      lot: [line.lot, line.lot2].map(l => String(l || '').trim()).filter(Boolean).join('\n'),
      hs_code: line.hs_code || '',
      description: line.description || '',
      packaging_type: pkg ? pkg.type : (line.packaging || ''),
      units: pkg ? figures.units : null,
      units_per_pallet: figures.units_per_pallet,
      pallets: pkg ? figures.pallets : null,
      unit_net_kg: pkg ? figures.unit_net_kg : null,
      unit_gross_kg: pkg ? figures.unit_gross_kg : null,
      pallet_net_kg: pkg ? figures.pallet_net_kg : null,
      pallet_gross_kg: pkg ? figures.pallet_gross_kg : null,
      pallet_weight_kg: figures.pallet_weight_kg,
      volume_cbm: String(line.volume_cbm ?? '').trim() || null,
      net_kg: figures.net_kg,
      empty_kg: figures.empty_kg,
      gross_kg: figures.gross_kg,
    };
  });
}

function withRows(data: PackingListData): PackingListData {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  return { ...data, lines, packing: packingRows(lines), layout: normalizePlLayout(data.layout) as any };
}

/** The customer (and their profile) a packing list is for, read off its invoice. */
function customerFor(invoice: any): { customerId: number | null; customerName: string; profile: ReturnType<typeof resolveProfile> } {
  const order = invoice?.order_id
    ? db.prepare(`SELECT o.customer_id, c.name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`)
      .get(invoice.order_id) as any
    : null;
  const customerId = order?.customer_id ?? null;
  return { customerId, customerName: order?.customer_name || '', profile: resolveProfile(customerId, invoice?.profile_id ?? null) };
}

/** Candidate packaging per line, for the editor's dropdown. */
function candidatesFor(lines: PackingLineInput[], rows: PackagingRow[]): number[][] {
  return lines.map(line => matchPackaging(line, rows).candidates.map(c => c.id));
}

async function renderAndFile(
  data: PackingListData,
  opts: { operationId: number | null; existing?: any; status: PlStatus }
): Promise<{ filePath: string; fileName: string; documentId: number | null }> {
  // A draft carries a DRAFT watermark; the final one is clean. Each has its own
  // file and its own operation document, so finalizing never replaces the draft.
  const isFinal = opts.status === 'final';
  const pdf = await buildDocumentPdf('packing_list', { ...data, watermark: isFinal ? null : 'DRAFT' });
  const slot = {
    file_path: isFinal ? opts.existing?.final_file_path : opts.existing?.file_path,
    document_id: isFinal ? opts.existing?.final_document_id : opts.existing?.document_id,
  };

  fs.mkdirSync(docsDir, { recursive: true });
  const storedName = `pl-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, storedName), pdf);

  const displayName = fileNameFor(data.doc_number ?? null, opts.status);
  const note = `Packing List ${data.doc_number || ''} (${opts.status})`.trim();

  if (slot.file_path) {
    const old = path.join(docsDir, slot.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }

  let documentId: number | null = slot.document_id ?? null;
  if (opts.operationId) {
    const categoryId = packingCategoryId();
    const stillLinked = documentId
      ? db.prepare('SELECT id FROM operation_documents WHERE id = ?').get(documentId)
      : null;
    if (stillLinked) {
      db.prepare('UPDATE operation_documents SET operation_id = ?, category_id = ?, file_path = ?, file_name = ?, notes = ? WHERE id = ?')
        .run(opts.operationId, categoryId, storedName, displayName, note, documentId);
    } else {
      const result = db.prepare(
        'INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)'
      ).run(opts.operationId, categoryId, storedName, displayName, note);
      documentId = Number(result.lastInsertRowid);
    }
  } else if (documentId) {
    db.prepare('DELETE FROM operation_documents WHERE id = ?').run(documentId);
    documentId = null;
  }

  return { filePath: storedName, fileName: displayName, documentId };
}

function discardFiled(filed: { filePath: string; documentId: number | null }, keepDocumentId: number | null) {
  const orphan = path.join(docsDir, filed.filePath);
  if (fs.existsSync(orphan)) { try { fs.unlinkSync(orphan); } catch { /* best effort */ } }
  if (filed.documentId && filed.documentId !== keepDocumentId) {
    try { db.prepare('DELETE FROM operation_documents WHERE id = ?').run(filed.documentId); } catch { /* best effort */ }
  }
}

function numberTaken(plNumber: string, exceptId?: number): boolean {
  const row = db.prepare('SELECT id FROM packing_lists WHERE pl_number = ?').get(plNumber) as any;
  return !!row && row.id !== exceptId;
}

/** Removes a packing list and its filed PDF — used when its invoice is deleted. */
export function deletePackingListsForInvoice(invoiceDocumentId: number) {
  const rows = db.prepare('SELECT * FROM packing_lists WHERE invoice_document_id = ?').all(invoiceDocumentId) as any[];
  for (const row of rows) removeRow(row);
}

function removeRow(row: any) {
  for (const stored of [row.file_path, row.final_file_path]) {
    if (!stored) continue;
    const filePath = path.join(docsDir, stored);
    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch { /* best effort */ } }
  }
  for (const docId of [row.document_id, row.final_document_id]) {
    if (docId) db.prepare('DELETE FROM operation_documents WHERE id = ?').run(docId);
  }
  db.prepare('DELETE FROM packing_lists WHERE id = ?').run(row.id);
}

function invoiceDoc(id: number): any {
  const row = db.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(id) as any;
  if (!row) return null;
  let data: DocumentData = {};
  try { data = JSON.parse(row.data); } catch { /* empty */ }
  return { ...row, data };
}

// ── Packaging choices for the editor ──────────────────────────────────────

router.get('/packaging', (_req: Request, res: Response) => {
  res.json(listPackaging());
});

// ── Prefill a draft from the invoice ──────────────────────────────────────

router.get('/prepare', (req: Request, res: Response) => {
  const invoiceId = parseInt(String(req.query.invoice_document_id || ''), 10);
  if (!Number.isInteger(invoiceId)) { res.status(400).json({ error: 'invoice_document_id is required' }); return; }

  const invoice = invoiceDoc(invoiceId);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if (invoice.status === 'draft') { res.status(400).json({ error: 'Generate the invoice first — it is still a draft' }); return; }

  const rows = listPackaging();
  const existing = db.prepare(
    'SELECT * FROM packing_lists WHERE invoice_document_id = ? ORDER BY id DESC LIMIT 1'
  ).get(invoiceId) as any;
  if (existing) {
    const record = parseRecord(existing);
    const { profile } = customerFor(invoice);
    res.json({
      existing: record, candidates: candidatesFor(record.data.lines || [], rows),
      profile_id: profile?.id ?? null, profile_name: profile?.name ?? null,
    });
    return;
  }

  const inv = invoice.data as DocumentData;
  const operationNumber = inv.operation_number || '';
  const lines = linesFromInvoice(inv.items || [], rows);

  // The invoice's own header, minus everything about money
  // (terms and origin stay: the customer's PL format decides whether they print)
  const {
    items: _items, layout: _layout, bank_name: _bn, iban: _iban, bic: _bic, bank_address: _ba,
    freight: _f, vat: _v, insurance: _i, notes: _n,
    ...header
  } = inv;

  // Laid out the way this customer's packing lists are
  const { customerId, customerName, profile } = customerFor(invoice);
  const { layout, source } = resolvePlLayout(customerId, profile, customerName);

  const draft: PackingListData = withRows({
    ...header,
    doc_number: `${operationNumber || invoice.invoice_number}PL`,
    doc_date: inv.doc_date || new Date().toISOString().slice(0, 10),
    invoice_number: invoice.invoice_number,
    notes: '',
    lines,
    layout: layout as any,
  });

  res.json({
    existing: null,
    draft,
    layout_source: source,
    profile_id: profile?.id ?? null,
    profile_name: profile?.name ?? null,
    candidates: candidatesFor(lines, rows),
    invoice: { id: invoice.id, invoice_number: invoice.invoice_number, order_id: invoice.order_id, operation_id: invoice.operation_id },
  });
});

/** Lines re-read from the invoice (after it was edited), keeping the packaging chosen. */
router.post('/refresh-lines', (req: Request, res: Response) => {
  const invoice = invoiceDoc(Number(req.body?.invoice_document_id));
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  const rows = listPackaging();
  const lines = linesFromInvoice((invoice.data as DocumentData).items || [], rows, req.body?.lines || []);
  res.json({ lines, packing: packingRows(lines), candidates: candidatesFor(lines, rows) });
});

// ── List / read ───────────────────────────────────────────────────────────

router.get('/by-invoice/:invoiceDocId', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM packing_lists WHERE invoice_document_id = ? ORDER BY id DESC')
    .all(Number(req.params.invoiceDocId)) as any[];
  res.json(rows.map(parseRecord));
});

router.get('/by-order/:orderId', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM packing_lists WHERE order_id = ? ORDER BY id DESC')
    .all(Number(req.params.orderId)) as any[];
  res.json(rows.map(parseRecord));
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Packing list not found' }); return; }
  const record = parseRecord(row);
  const { profile } = customerFor(invoiceDoc(record.invoice_document_id));
  res.json({
    ...record, candidates: candidatesFor(record.data.lines || [], listPackaging()),
    profile_id: profile?.id ?? null, profile_name: profile?.name ?? null,
  });
});

// ── Save a layout as the customer's own ───────────────────────────────────

/** Makes this PL layout the customer's standing format, like the invoice's. */
router.put('/layout/:profileId', (req: Request, res: Response) => {
  const profileId = Number(req.params.profileId);
  const row = db.prepare('SELECT * FROM customer_document_profiles WHERE id = ?').get(profileId) as any;
  if (!row) { res.status(404).json({ error: 'Customer profile not found' }); return; }

  const layout = normalizePlLayout(req.body?.layout);
  let data: any = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt row → start clean */ }
  data.packing_list_layout = layout;
  db.prepare(`UPDATE customer_document_profiles SET data = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(data), profileId);

  res.json({ message: `Packing list format saved for ${row.name}`, layout });
});

// ── Live preview (nothing is persisted) ───────────────────────────────────

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const pdf = await buildDocumentPdf('packing_list', withRows((req.body?.data || {}) as PackingListData));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="packing-list-preview.pdf"');
    res.send(pdf);
  } catch (err: any) {
    console.error('[packing-lists] preview failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// ── Create ────────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { invoice_document_id, data } = req.body as { invoice_document_id?: number; data?: PackingListData };
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const invoice = invoice_document_id ? invoiceDoc(Number(invoice_document_id)) : null;
  if (!invoice) { res.status(400).json({ error: 'The invoice this packing list belongs to is required' }); return; }
  if (invoice.status === 'draft') { res.status(400).json({ error: 'Generate the invoice first — it is still a draft' }); return; }

  const payload = withRows({
    ...data,
    doc_number: (data.doc_number || '').trim() || `${invoice.data.operation_number || invoice.invoice_number}PL`,
  });

  if (numberTaken(payload.doc_number!)) {
    res.status(409).json({ error: `Packing list ${payload.doc_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    const operationId = resolveOperationId(invoice);
    filed = await renderAndFile(payload, { operationId, status: 'draft' });
    const result = db.prepare(`
      INSERT INTO packing_lists (pl_number, invoice_document_id, order_id, operation_id, data, file_path, file_name, document_id, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      payload.doc_number, invoice.id, invoice.order_id ?? null, operationId,
      JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, req.user?.userId ?? null
    );
    const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(result.lastInsertRowid);
    notifyAdmin({
      action: 'created', entity: 'Packing List', label: payload.doc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.status(201).json(parseRecord(row));
  } catch (err: any) {
    if (filed) discardFiled(filed, null);
    if (err?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: `Packing list ${payload.doc_number} already exists` });
      return;
    }
    console.error('[packing-lists] create failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to generate the packing list' });
  }
});

// ── Update ────────────────────────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Packing list not found' }); return; }

  const data = req.body?.data as PackingListData | undefined;
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const payload = withRows({ ...data, doc_number: (data.doc_number || '').trim() || existing.pl_number });
  if (numberTaken(payload.doc_number!, existing.id)) {
    res.status(409).json({ error: `Packing list ${payload.doc_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    // Saving an edit makes it a draft again — a changed PL is never labelled final by accident
    const operationId = existing.operation_id ?? resolveOperationId(invoiceDoc(existing.invoice_document_id));
    filed = await renderAndFile(payload, { operationId, existing, status: 'draft' });
    db.prepare(`
      UPDATE packing_lists SET pl_number = ?, operation_id = ?, data = ?, file_path = ?, file_name = ?, document_id = ?,
        status = 'draft', finalized_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(payload.doc_number, operationId, JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, existing.id);
    const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(existing.id);
    notifyAdmin({
      action: 'updated', entity: 'Packing List', label: payload.doc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json(parseRecord(row));
  } catch (err: any) {
    if (filed) discardFiled(filed, existing.document_id);
    console.error('[packing-lists] update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to regenerate the packing list' });
  }
});

// ── Draft → final ─────────────────────────────────────────────────────────

/** Finalizes the PL (normally once the BL is in); allowed without one, the reply says so. */
router.post('/:id/finalize', async (req: Request, res: Response) => {
  await setStatus(req, res, 'final');
});

router.post('/:id/reopen', async (req: Request, res: Response) => {
  await setStatus(req, res, 'draft');
});

async function setStatus(req: Request, res: Response, status: PlStatus) {
  const existing = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Packing list not found' }); return; }

  const record = parseRecord(existing);
  const operationId = existing.operation_id ?? resolveOperationId(invoiceDoc(existing.invoice_document_id));
  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    if (status === 'final') {
      // The final PL is the saved draft, without the watermark, filed beside it
      filed = await renderAndFile(withRows(record.data), { operationId, existing, status });
      db.prepare(`
        UPDATE packing_lists SET status = 'final', finalized_at = datetime('now'), operation_id = ?,
          final_file_path = ?, final_file_name = ?, final_document_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(operationId, filed.filePath, filed.fileName, filed.documentId, existing.id);
    } else {
      // Reopening keeps the finalized PDF; a draft is (re)made only if there is none
      if (!existing.file_path) {
        filed = await renderAndFile(withRows(record.data), { operationId, existing, status });
        db.prepare('UPDATE packing_lists SET file_path = ?, file_name = ?, document_id = ? WHERE id = ?')
          .run(filed.filePath, filed.fileName, filed.documentId, existing.id);
      }
      db.prepare(`
        UPDATE packing_lists SET status = 'draft', finalized_at = NULL, operation_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(operationId, existing.id);
    }
    const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(existing.id);
    notifyAdmin({
      action: 'updated', entity: 'Packing List', label: existing.pl_number,
      detail: status === 'final' ? 'finalized' : 'reopened as draft',
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json({ record: parseRecord(row), bl_found: !!findBillOfLading(operationId) });
  } catch (err: any) {
    if (filed) discardFiled(filed, status === 'final' ? existing.final_document_id : existing.document_id);
    console.error('[packing-lists] status change failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update the packing list' });
  }
}

// ── The operation's Bill of Lading, for "Compare with BL" ─────────────────

router.get('/:id/bl', (req: Request, res: Response) => {
  const row = db.prepare('SELECT operation_id, invoice_document_id FROM packing_lists WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Packing list not found' }); return; }
  res.json(findBillOfLading(row.operation_id ?? resolveOperationId(invoiceDoc(row.invoice_document_id))));
});

router.get('/bl-for-invoice/:invoiceDocId', (req: Request, res: Response) => {
  res.json(findBillOfLading(resolveOperationId(invoiceDoc(Number(req.params.invoiceDocId)))));
});

// ── Download ──────────────────────────────────────────────────────────────

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Packing list not found' }); return; }
  // ?version=draft|final; by default the final one once there is one
  const wantFinal = req.query.version === 'final'
    || (req.query.version !== 'draft' && row.status === 'final' && !!row.final_file_path);
  const stored = wantFinal ? row.final_file_path : row.file_path;
  if (!stored) { res.status(404).json({ error: `No ${wantFinal ? 'final' : 'draft'} PDF for this packing list` }); return; }
  const filePath = path.join(docsDir, stored);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
  res.attachment((wantFinal ? row.final_file_name : row.file_name) || 'packing-list.pdf');
  res.type('application/pdf');
  fs.createReadStream(filePath).pipe(res);
});

// ── Email ─────────────────────────────────────────────────────────────────

/** Sends the final PL, or the draft when it is not finalized yet (the email says so). */
router.post('/:id/email', async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Packing list not found' }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(501).json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }); return; }

  const split = (v: unknown) => String(v || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const recipients = split(req.body?.to);
  const cc = split(req.body?.cc);
  if (!recipients.length) { res.status(400).json({ error: 'At least one recipient email is required' }); return; }
  const invalid = [...recipients, ...cc].filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.join(', ')}` }); return; }

  const isFinal = !!row.final_file_path;
  const stored = isFinal ? row.final_file_path : row.file_path;
  const fileName = (isFinal ? row.final_file_name : row.file_name) || 'packing-list.pdf';
  const filePath = stored ? path.join(docsDir, stored) : null;
  if (!filePath || !fs.existsSync(filePath)) { res.status(404).json({ error: 'The packing list PDF is missing — save it again' }); return; }

  const data = parseRecord(row).data as PackingListData;
  const subject = String(req.body?.subject || '').trim()
    || `Packing List ${row.pl_number}${isFinal ? '' : ' (draft)'}${data.client_name ? ` — ${data.client_name}` : ''}`;
  const bodyText = String(req.body?.message || '').trim();

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p style="font-size:15px;">Dear ${escapeHtml(data.client_name || 'Sir/Madam')},</p>
  ${bodyText
      ? `<p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>`
      : `<p style="font-size:14px;">Please find attached our ${isFinal ? '' : '<strong>draft</strong> '}packing list <strong>${escapeHtml(row.pl_number)}</strong>${data.invoice_number ? ` for invoice ${escapeHtml(data.invoice_number)}` : ''}.</p>`}
  <p style="font-size:14px;margin-top:20px;">Kind regards,<br/>${escapeHtml(data.company_name || 'TripleW BV')}</p>
</div>`;

  try {
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const { error } = await resend.emails.send({
      from, to: recipients, ...(cc.length ? { cc } : {}), subject, html,
      attachments: [{ filename: fileName, content: fs.readFileSync(filePath).toString('base64') }],
    });
    if (error) throw new Error(error.message || 'Resend rejected the message');
    notifyAdmin({
      action: 'updated', entity: 'Packing List', label: row.pl_number,
      detail: `emailed to ${recipients.join(', ')}`,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json({ message: `${fileName} sent to ${recipients.join(', ')}` });
  } catch (err: any) {
    console.error('[packing-lists] email failed:', err?.message || err);
    res.status(502).json({ error: `Failed to send email: ${err?.message || 'unknown error'}` });
  }
});

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Delete ────────────────────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Packing list not found' }); return; }
  removeRow(row);
  notifyAdmin({
    action: 'deleted', entity: 'Packing List', label: row.pl_number,
    performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
  });
  res.json({ message: 'Packing list deleted' });
});

/** PLs saved before they were always filed under their operation's documents. */
export async function backfillPackingListFiling(): Promise<void> {
  let rows: any[] = [];
  try { rows = db.prepare('SELECT * FROM packing_lists WHERE operation_id IS NULL OR document_id IS NULL').all() as any[]; }
  catch { return; }
  for (const row of rows) {
    try {
      const operationId = row.operation_id ?? resolveOperationId(invoiceDoc(row.invoice_document_id));
      if (!operationId || !row.file_path) continue;
      const result = db.prepare(
        'INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)'
      ).run(operationId, packingCategoryId(), row.file_path, fileNameFor(row.pl_number, row.status === 'final' ? 'final' : 'draft'),
        `Packing List ${row.pl_number} (${row.status || 'draft'})`);
      db.prepare('UPDATE packing_lists SET operation_id = ?, document_id = ? WHERE id = ?')
        .run(operationId, Number(result.lastInsertRowid), row.id);
    } catch (err: any) {
      console.error('[packing-lists] filing backfill failed for', row.id, err?.message || err);
    }
  }
}

export default router;
