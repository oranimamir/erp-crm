import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { buildDocumentPdf, type DocumentData, type PackingRow } from '../lib/document-pdf.js';
import { computePacking, listPackaging, matchPackaging, netKg, packagingById, type PackagingRow } from '../lib/packing.js';

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
  packaging_id?: number | null;
  units_override?: number | null;
  pallets_override?: number | null;
}

export interface PackingListData extends DocumentData {
  lines?: PackingLineInput[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fileNameFor(plNumber: string | null): string {
  const stem = (plNumber || 'packing-list').trim();
  return `${stem.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
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
    };
    // A packaging already chosen for this line survives a refresh from the invoice
    const packagingId = previous?.packaging_id && packagingById(previous.packaging_id)
      ? previous.packaging_id
      : matchPackaging(source, rows).best?.id ?? null;
    return { ...source, packaging_id: packagingId, units_override: null, pallets_override: null };
  });
}

/** The printed rows, always recomputed from the Packaging tab. */
function packingRows(lines: PackingLineInput[]): PackingRow[] {
  return lines.map(line => {
    const pkg = packagingById(line.packaging_id ?? null);
    const figures = computePacking(netKg(line.quantity, line.quantity_unit), pkg, {
      units: optionalCount(line.units_override),
      pallets: optionalCount(line.pallets_override),
    });
    return {
      reference: line.reference || '',
      product: line.commercial_name || '',
      lot: [line.lot, line.lot2].map(l => String(l || '').trim()).filter(Boolean).join('\n'),
      packaging_type: pkg ? pkg.type : (line.packaging || ''),
      units: pkg ? figures.units : null,
      units_per_pallet: figures.units_per_pallet,
      pallets: pkg ? figures.pallets : null,
      net_kg: figures.net_kg,
      empty_kg: figures.empty_kg,
      gross_kg: figures.gross_kg,
    };
  });
}

function withRows(data: PackingListData): PackingListData {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  return { ...data, lines, packing: packingRows(lines) };
}

/** Candidate packaging per line, for the editor's dropdown. */
function candidatesFor(lines: PackingLineInput[], rows: PackagingRow[]): number[][] {
  return lines.map(line => matchPackaging(line, rows).candidates.map(c => c.id));
}

async function renderAndFile(
  data: PackingListData,
  opts: { operationId: number | null; existing?: any }
): Promise<{ filePath: string; fileName: string; documentId: number | null }> {
  const pdf = await buildDocumentPdf('packing_list', data);

  fs.mkdirSync(docsDir, { recursive: true });
  const storedName = `pl-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, storedName), pdf);

  const displayName = fileNameFor(data.doc_number ?? null);

  if (opts.existing?.file_path) {
    const old = path.join(docsDir, opts.existing.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }

  let documentId: number | null = opts.existing?.document_id ?? null;
  if (opts.operationId) {
    const categoryId = packingCategoryId();
    const stillLinked = documentId
      ? db.prepare('SELECT id FROM operation_documents WHERE id = ?').get(documentId)
      : null;
    if (stillLinked) {
      db.prepare('UPDATE operation_documents SET operation_id = ?, category_id = ?, file_path = ?, file_name = ? WHERE id = ?')
        .run(opts.operationId, categoryId, storedName, displayName, documentId);
    } else {
      const result = db.prepare(
        'INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)'
      ).run(opts.operationId, categoryId, storedName, displayName, `Packing List ${data.doc_number || ''}`.trim());
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
  if (row.file_path) {
    const filePath = path.join(docsDir, row.file_path);
    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch { /* best effort */ } }
  }
  if (row.document_id) db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
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

  const rows = listPackaging();
  const existing = db.prepare(
    'SELECT * FROM packing_lists WHERE invoice_document_id = ? ORDER BY id DESC LIMIT 1'
  ).get(invoiceId) as any;
  if (existing) {
    const record = parseRecord(existing);
    res.json({ existing: record, candidates: candidatesFor(record.data.lines || [], rows) });
    return;
  }

  const inv = invoice.data as DocumentData;
  const operationNumber = inv.operation_number || '';
  const lines = linesFromInvoice(inv.items || [], rows);

  // The invoice's own header, minus everything about money
  const {
    items: _items, layout: _layout, terms: _terms, bank_name: _bn, iban: _iban, bic: _bic, bank_address: _ba,
    freight: _f, vat: _v, insurance: _i, manufacturer: _m, country_of_origin: _c, notes: _n,
    ...header
  } = inv;

  const draft: PackingListData = withRows({
    ...header,
    doc_number: `${operationNumber || invoice.invoice_number}PL`,
    doc_date: inv.doc_date || new Date().toISOString().slice(0, 10),
    invoice_number: invoice.invoice_number,
    notes: '',
    lines,
  });

  res.json({
    existing: null,
    draft,
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
  res.json({ ...record, candidates: candidatesFor(record.data.lines || [], listPackaging()) });
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
    filed = await renderAndFile(payload, { operationId: invoice.operation_id ?? null });
    const result = db.prepare(`
      INSERT INTO packing_lists (pl_number, invoice_document_id, order_id, operation_id, data, file_path, file_name, document_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.doc_number, invoice.id, invoice.order_id ?? null, invoice.operation_id ?? null,
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
    filed = await renderAndFile(payload, { operationId: existing.operation_id ?? null, existing });
    db.prepare(`
      UPDATE packing_lists SET pl_number = ?, data = ?, file_path = ?, file_name = ?, document_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(payload.doc_number, JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, existing.id);
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

// ── Download ──────────────────────────────────────────────────────────────

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM packing_lists WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row?.file_path) { res.status(404).json({ error: 'Packing list not found' }); return; }
  const filePath = path.join(docsDir, row.file_path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.file_name || 'packing-list.pdf'}"`);
  fs.createReadStream(filePath).pipe(res);
});

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

export default router;
