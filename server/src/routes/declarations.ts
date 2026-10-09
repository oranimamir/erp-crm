import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../database.js';
import { archiveStored, archiveFile, archiveBuffer, archivedBy, ownerOf, contextOf } from '../lib/archive.js';
import { notifyAdmin } from '../lib/notify.js';
import { uploadsBase, productDocsDir, listProductDocs, categoryIdByName } from '../lib/productDocs.js';
import {
  declarationFromFile, emptyDeclaration, emptyCoa, normalizeDeclaration, storeAsset, lastSignature, DeclarationData,
} from '../lib/declarationSource.js';
import { buildDeclarationPdf } from '../lib/declarationPdf.js';
import { saveDeclarationToLibrary, ownerProductIds, coaMatchesLots } from '../lib/documentSources.js';
import { DocOwner, getOwner, ownerFromRequest, insertOwnerDocument, ownerLots, ownerProductLots } from '../lib/docOwner.js';
import { dropNcoDocumentRow } from '../lib/ncoDocs.js';
import { todayISO } from '../lib/today.js';

/**
 * Declarations generated per operation or non-commercial operation (Shipping
 * documents → Declaration): started from a library declaration, an earlier
 * generated one or an uploaded file, edited with a live preview, then
 * generated as a PDF filed under its owner (category Declaration). Any number.
 *
 * The same generator makes Certificates of Analysis (`kind` 'coa', Shipping
 * documents → COA): started from a library COA (those naming the owner's lots
 * suggested), a batch COA (Inventory → Batches), an earlier one, an upload or
 * a blank COA laid out from the owner's products and lots; filed as COA.
 */

const router = Router();
const docsDir = path.join(uploadsBase, 'operation-docs');
const memory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });

function parseRecord(row: any) {
  if (!row) return row;
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const { data, draft_data, ...rest } = row;
  return { ...rest, data: parse(data) || emptyDeclaration(), draft: parse(draft_data) };
}

const getRow = (id: number) => db.prepare('SELECT * FROM declarations WHERE id = ?').get(id) as any;

type GenKind = 'declaration' | 'coa';
const kindOf = (v: unknown): GenKind => (v === 'coa' ? 'coa' : 'declaration');
const LABEL: Record<GenKind, string> = { declaration: 'Declaration', coa: 'Certificate of Analysis' };
const CATEGORY: Record<GenKind, string> = { declaration: 'Declaration', coa: 'COA' };
const ENTITY: Record<GenKind, string> = { declaration: 'Declaration', coa: 'COA' };

/** "<op#> - <title>.pdf", safe for a file name. */
function fileNameFor(operationNumber: string | null, title: string, kind: GenKind): string {
  const clean = (title || LABEL[kind]).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${operationNumber ? `${operationNumber} - ` : ''}${clean}.pdf`;
}

/** The operation or NCO a declaration belongs to. */
const ownerOfRow = (row: any): DocOwner | null =>
  row.nco_id ? getOwner('nco', row.nco_id) : getOwner('operation', row.operation_id);
/** The column holding the filed document's id for this owner. */
const docColumn = (owner: DocOwner) => (owner.kind === 'nco' ? 'nco_document_id' : 'document_id');

/** Renders the PDF and files it under the owner, replacing the previous one in place. */
async function renderAndFile(data: DeclarationData, existing: any): Promise<{ filePath: string; fileName: string; documentId: number; owner: DocOwner }> {
  const owner = ownerOfRow(existing);
  if (!owner) throw new Error('The operation is gone');
  const kind = kindOf(existing.kind);
  const pdf = await buildDeclarationPdf(data, kind);
  fs.mkdirSync(docsDir, { recursive: true });
  const stored = `${kind === 'coa' ? 'coa' : 'decl'}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, stored), pdf);
  const fileName = fileNameFor(owner.number, data.title, kind);

  if (existing.file_path && /^[a-zA-Z0-9._-]+$/.test(existing.file_path)) {
    const old = path.join(docsDir, existing.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }
  const categoryId = categoryIdByName(CATEGORY[kind]);
  const previous = existing[docColumn(owner)];
  const linked = previous ? db.prepare(`SELECT id FROM ${owner.table} WHERE id = ?`).get(previous) : null;
  let documentId: number;
  if (linked) {
    db.prepare(`UPDATE ${owner.table} SET category_id = ?, file_path = ?, file_name = ? WHERE id = ?`)
      .run(categoryId, stored, fileName, previous);
    documentId = previous;
  } else {
    documentId = insertOwnerDocument(owner, categoryId, stored, fileName, kind === 'coa' ? 'Generated COA' : 'Generated declaration');
  }
  return { filePath: stored, fileName, documentId, owner };
}

// ── Starting points ────────────────────────────────────────────────────────

/**
 * GET /api/declarations/sources?operation_id=&kind=declaration|coa
 * Library documents of the kind (those for the operation's products — COAs:
 * naming its lots, else its products — `suggested`), batch COAs (kind coa;
 * the lots' suggested) and ones generated on other operations (same customer first).
 */
router.get('/sources', (req: Request, res: Response) => {
  const owner = ownerFromRequest(req.query);
  if (!owner) { res.status(404).json({ error: 'Operation not found' }); return; }
  const kind = kindOf(req.query.kind);
  const productIds = new Set(ownerProductIds(owner));
  const lots = ownerLots(owner);
  const docs = listProductDocs('WHERE d.kind = ?', [kind]);
  const byLot = kind === 'coa' ? new Set(docs.filter(d => coaMatchesLots(d, lots)).map(d => d.id)) : new Set<number>();
  const library = docs.map(d => ({
    ...d, suggested: byLot.size ? byLot.has(d.id) : d.products.some((p: any) => productIds.has(p.id)),
  }));
  const batches = kind === 'coa'
    ? (db.prepare(`
        SELECT bd.id, bd.file_name, bd.document_name, bd.created_at, b.batch_number FROM batch_documents bd JOIN batches b ON b.id = bd.batch_id
        WHERE bd.document_type = 'coa' AND (lower(bd.file_name) LIKE '%.pdf' OR lower(bd.file_name) LIKE '%.docx')
        ORDER BY bd.created_at DESC LIMIT 200
      `).all() as any[]).map(b => ({ ...b, suggested: lots.has(String(b.batch_number || '').trim().toLowerCase()) }))
    : [];
  // Declarations generated on other operations / NCOs, the same customer's first
  const previous = db.prepare(`
    SELECT d.id, d.title, d.status, d.updated_at,
      COALESCE(o.operation_number, n.nco_number) AS operation_number,
      COALESCE(c1.name, c2.name) AS customer_name, COALESCE(o.customer_id, n.customer_id) AS customer_id
    FROM declarations d
    LEFT JOIN operations o ON o.id = d.operation_id LEFT JOIN customers c1 ON c1.id = o.customer_id
    LEFT JOIN non_commercial_operations n ON n.id = d.nco_id LEFT JOIN customers c2 ON c2.id = n.customer_id
    WHERE NOT (COALESCE(d.${owner.fk}, -1) = ?) AND COALESCE(d.kind, 'declaration') = ?
    ORDER BY CASE WHEN COALESCE(o.customer_id, n.customer_id) = ? THEN 0 ELSE 1 END, d.updated_at DESC
    LIMIT 100
  `).all(owner.id, kind, owner.customerId ?? -1);
  res.json({ library, batches, previous });
});

/**
 * POST /api/declarations — a new draft for the operation, from
 *  - { operation_id, source_type: 'library' | 'declaration', source_id } (JSON or multipart), or
 *  - multipart { operation_id, file } — the file is also saved to the library, or
 *  - { operation_id } alone — a blank declaration.
 */
router.post('/', memory.single('file'), async (req: Request, res: Response) => {
  const owner = ownerFromRequest(req.body);
  if (!owner) { res.status(404).json({ error: 'Operation not found' }); return; }
  const kind = kindOf(req.body?.kind);

  let data: DeclarationData;
  let source: string | null = null;
  try {
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!['.docx', '.pdf'].includes(ext)) { res.status(400).json({ error: `Upload a Word (.docx) or PDF ${kind === 'coa' ? 'COA' : 'declaration'}` }); return; }
      data = await declarationFromFile(req.file.buffer, req.file.originalname);
      const libraryId = saveDeclarationToLibrary(req.file.buffer, req.file.originalname, owner, req.user?.userId ?? null, kind);
      source = libraryId ? `library:${libraryId}` : 'upload';
    } else if (req.body?.source_type === 'library') {
      const doc = db.prepare(`SELECT * FROM product_documents WHERE id = ? AND kind = ?`).get(Number(req.body.source_id), kind) as any;
      if (!doc || !/^[a-zA-Z0-9._-]+$/.test(doc.file_path)) { res.status(404).json({ error: 'Library document not found' }); return; }
      const abs = path.join(productDocsDir, doc.file_path);
      if (!fs.existsSync(abs)) { res.status(404).json({ error: 'The library file is missing' }); return; }
      data = await declarationFromFile(fs.readFileSync(abs), doc.file_name);
      if (doc.title && !data.title) data.title = doc.title;
      source = `library:${doc.id}`;
    } else if (req.body?.source_type === 'batch' && kind === 'coa') {
      const doc = db.prepare(`SELECT bd.*, b.batch_number FROM batch_documents bd JOIN batches b ON b.id = bd.batch_id WHERE bd.id = ?`).get(Number(req.body.source_id)) as any;
      if (!doc || !/^[a-zA-Z0-9._-]+$/.test(doc.file_path)) { res.status(404).json({ error: 'Batch document not found' }); return; }
      const abs = path.join(uploadsBase, 'batch-documents', doc.file_path);
      if (!fs.existsSync(abs)) { res.status(404).json({ error: 'The batch file is missing' }); return; }
      data = await declarationFromFile(fs.readFileSync(abs), doc.file_name);
      source = `batch:${doc.id}`;
    } else if (req.body?.source_type === 'declaration') {
      const prev = getRow(Number(req.body.source_id));
      if (!prev) { res.status(404).json({ error: 'Declaration not found' }); return; }
      data = { ...normalizeDeclaration(JSON.parse(prev.draft_data || prev.data)), date: todayISO() };
      source = `declaration:${prev.id}`;
    } else {
      data = kind === 'coa' ? emptyCoa(ownerProductLots(owner)) : emptyDeclaration();
    }
  } catch (err: any) {
    console.error('[declarations] could not read the source:', err?.message || err);
    res.status(400).json({ error: 'The document could not be read' });
    return;
  }
  if (!data.signature_file) data.signature_file = lastSignature();

  const r = db.prepare(`
    INSERT INTO declarations (${owner.fk}, kind, title, status, data, source, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?)
  `).run(owner.id, kind, data.title || LABEL[kind], JSON.stringify(data), source, req.user?.userId ?? null);
  notifyAdmin({ action: 'created', entity: `${ENTITY[kind]} draft`, label: `${owner.number} — ${data.title || LABEL[kind]}`, ...who(req) });
  res.status(201).json(parseRecord(getRow(Number(r.lastInsertRowid))));
});

// ── Signature image ────────────────────────────────────────────────────────

router.post('/signature', memory.single('file'), (req: Request, res: Response) => {
  const ext = path.extname(req.file?.originalname || '').toLowerCase();
  if (!req.file || !['.png', '.jpg', '.jpeg'].includes(ext)) { res.status(400).json({ error: 'Upload a PNG or JPEG image' }); return; }
  res.json({ file: storeAsset(req.file.buffer, ext) });
});

// ── Read ───────────────────────────────────────────────────────────────────

router.get('/by-operation/:operationId', (req: Request, res: Response) => {
  res.json(db.prepare(`
    SELECT id, kind, title, status, file_path, file_name, document_id, draft_data IS NOT NULL AS has_draft, updated_at
    FROM declarations WHERE operation_id = ? ORDER BY id
  `).all(Number(req.params.operationId)));
});

// An NCO's declarations; `document_id` is its nco_documents id here
router.get('/by-nco/:ncoId', (req: Request, res: Response) => {
  res.json(db.prepare(`
    SELECT id, kind, title, status, file_path, file_name, nco_document_id AS document_id, draft_data IS NOT NULL AS has_draft, updated_at
    FROM declarations WHERE nco_id = ? ORDER BY id
  `).all(Number(req.params.ncoId)));
});

router.get('/:id', (req: Request, res: Response) => {
  const row = getRow(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Declaration not found' }); return; }
  // The owner, in one shape for the page: number, customer, where "Back" goes
  const op = row.nco_id
    ? db.prepare(`
        SELECT n.id, n.nco_number AS operation_number, c.name AS customer_name, c.address AS customer_address, 'nco' AS kind
        FROM non_commercial_operations n LEFT JOIN customers c ON c.id = n.customer_id WHERE n.id = ?
      `).get(row.nco_id)
    : db.prepare(`
        SELECT o.id, o.operation_number, c.name AS customer_name, c.address AS customer_address, 'operation' AS kind
        FROM operations o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?
      `).get(row.operation_id);
  res.json({ ...parseRecord(row), operation: op });
});

// ── Preview (nothing stored) ───────────────────────────────────────────────

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const pdf = await buildDeclarationPdf(normalizeDeclaration(req.body?.data || {}), kindOf(req.body?.kind));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="declaration-preview.pdf"');
    res.send(pdf);
  } catch (err: any) {
    console.error('[declarations] preview failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to render the preview' });
  }
});

// ── Save draft / Confirm & generate ────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  const existing = getRow(Number(req.params.id));
  if (!existing) { res.status(404).json({ error: 'Declaration not found' }); return; }
  if (!req.body?.data || typeof req.body.data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }
  const data = normalizeDeclaration(req.body.data);
  const isDraft = req.body?.status === 'draft';
  const kind = kindOf(existing.kind);
  const label = `${ownerOfRow(existing)?.number ?? ''} — ${data.title || LABEL[kind]}`;

  if (isDraft) {
    if (existing.status === 'final') {
      // Generated already: keep the edits beside it until Confirm & regenerate
      db.prepare(`UPDATE declarations SET draft_data = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(data), existing.id);
    } else {
      db.prepare(`UPDATE declarations SET title = ?, data = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(data.title || LABEL[kind], JSON.stringify(data), existing.id);
    }
    res.json(parseRecord(getRow(existing.id)));
    return;
  }

  try {
    const filed = await renderAndFile(data, existing);
    db.prepare(`
      UPDATE declarations SET title = ?, status = 'final', data = ?, draft_data = NULL, file_path = ?, file_name = ?, ${docColumn(filed.owner)} = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(data.title || LABEL[kind], JSON.stringify(data), filed.filePath, filed.fileName, filed.documentId, existing.id);
    notifyAdmin({ action: existing.status === 'final' ? 'updated' : 'created', entity: ENTITY[kind], label, ...who(req) });
    res.json(parseRecord(getRow(existing.id)));
  } catch (err: any) {
    console.error('[declarations] generate failed:', err?.message || err);
    res.status(500).json({ error: `Failed to generate the ${kind === 'coa' ? 'COA' : 'declaration'}` });
  }
});

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = getRow(Number(req.params.id));
  if (!row?.file_path || row.status !== 'final') { res.status(404).json({ error: 'Generate the declaration first' }); return; }
  const abs = path.join(docsDir, row.file_path);
  if (!/^[a-zA-Z0-9._-]+$/.test(row.file_path) || !fs.existsSync(abs)) { res.status(404).json({ error: 'File not found' }); return; }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.file_name || 'declaration.pdf')}"`);
  res.sendFile(abs);
});

/** Deletes a declaration and the PDF it filed under its operation / NCO. */
export function deleteDeclaration(row: any): void {
  const label = row.kind === 'coa' ? 'COA' : 'Declaration';
  if (row.nco_document_id) {
    if (row.file_path && /^[a-zA-Z0-9._-]+$/.test(row.file_path)) {
      const owner = ownerOf(null, row.nco_id);
      archiveFile(path.join(docsDir, row.file_path), { section: owner.section, context: contextOf(owner.number, `${label} ${row.title || ''}`), fileName: row.file_name });
    }
    dropNcoDocumentRow(row.nco_document_id);
  }
  if (row.document_id) {
    const doc = db.prepare('SELECT file_path, file_name, operation_id FROM operation_documents WHERE id = ?').get(row.document_id) as any;
    if (doc?.file_path && /^[a-zA-Z0-9._-]+$/.test(doc.file_path)) {
      const owner = ownerOf(doc.operation_id);
      archiveFile(path.join(docsDir, doc.file_path), { section: owner.section, context: contextOf(owner.number, `${label} ${row.title || ''}`), fileName: doc.file_name });
    }
    db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
  }
  db.prepare('DELETE FROM declarations WHERE id = ?').run(row.id);
}

router.delete('/:id', (req: Request, res: Response) => {
  const row = getRow(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Declaration not found' }); return; }
  const owner = ownerOfRow(row);
  deleteDeclaration(row);
  notifyAdmin({ action: 'deleted', entity: ENTITY[kindOf(row.kind)], label: `${owner?.number ?? ''} — ${row.title}`, ...who(req) });
  res.json({ ok: true });
});

export default router;
