import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { uploadsBase, productDocsDir, listProductDocs, categoryIdByName } from '../lib/productDocs.js';
import {
  declarationFromFile, emptyDeclaration, normalizeDeclaration, storeAsset, lastSignature, DeclarationData,
} from '../lib/declarationSource.js';
import { buildDeclarationPdf } from '../lib/declarationPdf.js';
import { saveDeclarationToLibrary, operationProductIds } from '../lib/documentSources.js';

/**
 * Declarations generated per operation (Shipping documents → Declaration):
 * started from a library declaration, an earlier generated one or an uploaded
 * file, edited with a live preview, then generated as a PDF filed under the
 * operation (category Declaration). An operation can have any number.
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

/** "<op#> - <title>.pdf", safe for a file name. */
function fileNameFor(operationNumber: string | null, title: string): string {
  const clean = (title || 'Declaration').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${operationNumber ? `${operationNumber} - ` : ''}${clean}.pdf`;
}

/** Renders the PDF and files it under the operation, replacing the previous one in place. */
async function renderAndFile(data: DeclarationData, existing: any): Promise<{ filePath: string; fileName: string; documentId: number }> {
  const pdf = await buildDeclarationPdf(data);
  fs.mkdirSync(docsDir, { recursive: true });
  const stored = `decl-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, stored), pdf);
  const op = db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(existing.operation_id) as any;
  const fileName = fileNameFor(op?.operation_number ?? null, data.title);

  if (existing.file_path && /^[a-zA-Z0-9._-]+$/.test(existing.file_path)) {
    const old = path.join(docsDir, existing.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }
  const categoryId = categoryIdByName('Declaration');
  const linked = existing.document_id ? db.prepare('SELECT id FROM operation_documents WHERE id = ?').get(existing.document_id) : null;
  let documentId: number;
  if (linked) {
    db.prepare('UPDATE operation_documents SET category_id = ?, file_path = ?, file_name = ? WHERE id = ?')
      .run(categoryId, stored, fileName, existing.document_id);
    documentId = existing.document_id;
  } else {
    const r = db.prepare('INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)')
      .run(existing.operation_id, categoryId, stored, fileName, 'Generated declaration');
    documentId = Number(r.lastInsertRowid);
  }
  return { filePath: stored, fileName, documentId };
}

// ── Starting points ────────────────────────────────────────────────────────

/**
 * GET /api/declarations/sources?operation_id=
 * Library declarations (those for the operation's products `suggested`) and
 * declarations generated on other operations (same customer first).
 */
router.get('/sources', (req: Request, res: Response) => {
  const operationId = Number(req.query.operation_id);
  const op = db.prepare('SELECT id, customer_id FROM operations WHERE id = ?').get(operationId) as any;
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return; }
  const productIds = new Set(operationProductIds(op.id));
  const library = listProductDocs("WHERE d.kind = 'declaration'").map(d => ({
    ...d, suggested: d.products.some((p: any) => productIds.has(p.id)),
  }));
  const previous = db.prepare(`
    SELECT d.id, d.title, d.status, d.updated_at, o.operation_number, c.name AS customer_name
    FROM declarations d JOIN operations o ON o.id = d.operation_id LEFT JOIN customers c ON c.id = o.customer_id
    WHERE d.operation_id != ?
    ORDER BY CASE WHEN o.customer_id = ? THEN 0 ELSE 1 END, d.updated_at DESC
    LIMIT 100
  `).all(op.id, op.customer_id ?? -1);
  res.json({ library, previous });
});

/**
 * POST /api/declarations — a new draft for the operation, from
 *  - { operation_id, source_type: 'library' | 'declaration', source_id } (JSON or multipart), or
 *  - multipart { operation_id, file } — the file is also saved to the library, or
 *  - { operation_id } alone — a blank declaration.
 */
router.post('/', memory.single('file'), async (req: Request, res: Response) => {
  const operationId = Number(req.body?.operation_id);
  const op = db.prepare('SELECT id, operation_number FROM operations WHERE id = ?').get(operationId) as any;
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return; }

  let data: DeclarationData;
  let source: string | null = null;
  try {
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!['.docx', '.pdf'].includes(ext)) { res.status(400).json({ error: 'Upload a Word (.docx) or PDF declaration' }); return; }
      data = await declarationFromFile(req.file.buffer, req.file.originalname);
      const libraryId = saveDeclarationToLibrary(req.file.buffer, req.file.originalname, op.id, req.user?.userId ?? null);
      source = libraryId ? `library:${libraryId}` : 'upload';
    } else if (req.body?.source_type === 'library') {
      const doc = db.prepare(`SELECT * FROM product_documents WHERE id = ? AND kind = 'declaration'`).get(Number(req.body.source_id)) as any;
      if (!doc || !/^[a-zA-Z0-9._-]+$/.test(doc.file_path)) { res.status(404).json({ error: 'Library declaration not found' }); return; }
      const abs = path.join(productDocsDir, doc.file_path);
      if (!fs.existsSync(abs)) { res.status(404).json({ error: 'The library file is missing' }); return; }
      data = await declarationFromFile(fs.readFileSync(abs), doc.file_name);
      if (doc.title && !data.title) data.title = doc.title;
      source = `library:${doc.id}`;
    } else if (req.body?.source_type === 'declaration') {
      const prev = getRow(Number(req.body.source_id));
      if (!prev) { res.status(404).json({ error: 'Declaration not found' }); return; }
      data = { ...normalizeDeclaration(JSON.parse(prev.draft_data || prev.data)), date: new Date().toISOString().slice(0, 10) };
      source = `declaration:${prev.id}`;
    } else {
      data = emptyDeclaration();
    }
  } catch (err: any) {
    console.error('[declarations] could not read the source:', err?.message || err);
    res.status(400).json({ error: 'The document could not be read' });
    return;
  }
  if (!data.signature_file) data.signature_file = lastSignature();

  const r = db.prepare(`
    INSERT INTO declarations (operation_id, title, status, data, source, created_by) VALUES (?, ?, 'draft', ?, ?, ?)
  `).run(op.id, data.title || 'Declaration', JSON.stringify(data), source, req.user?.userId ?? null);
  notifyAdmin({ action: 'created', entity: 'Declaration draft', label: `${op.operation_number} — ${data.title || 'Declaration'}`, ...who(req) });
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
    SELECT id, title, status, file_path, file_name, document_id, draft_data IS NOT NULL AS has_draft, updated_at
    FROM declarations WHERE operation_id = ? ORDER BY id
  `).all(Number(req.params.operationId)));
});

router.get('/:id', (req: Request, res: Response) => {
  const row = getRow(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Declaration not found' }); return; }
  const op = db.prepare(`
    SELECT o.id, o.operation_number, c.name AS customer_name, c.address AS customer_address
    FROM operations o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?
  `).get(row.operation_id);
  res.json({ ...parseRecord(row), operation: op });
});

// ── Preview (nothing stored) ───────────────────────────────────────────────

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const pdf = await buildDeclarationPdf(normalizeDeclaration(req.body?.data || {}));
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
  const op = db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(existing.operation_id) as any;
  const label = `${op?.operation_number ?? ''} — ${data.title || 'Declaration'}`;

  if (isDraft) {
    if (existing.status === 'final') {
      // Generated already: keep the edits beside it until Confirm & regenerate
      db.prepare(`UPDATE declarations SET draft_data = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(data), existing.id);
    } else {
      db.prepare(`UPDATE declarations SET title = ?, data = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(data.title || 'Declaration', JSON.stringify(data), existing.id);
    }
    res.json(parseRecord(getRow(existing.id)));
    return;
  }

  try {
    const filed = await renderAndFile(data, existing);
    db.prepare(`
      UPDATE declarations SET title = ?, status = 'final', data = ?, draft_data = NULL, file_path = ?, file_name = ?, document_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(data.title || 'Declaration', JSON.stringify(data), filed.filePath, filed.fileName, filed.documentId, existing.id);
    notifyAdmin({ action: existing.status === 'final' ? 'updated' : 'created', entity: 'Declaration', label, ...who(req) });
    res.json(parseRecord(getRow(existing.id)));
  } catch (err: any) {
    console.error('[declarations] generate failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to generate the declaration' });
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

/** Deletes a declaration and the PDF it filed under the operation. */
export function deleteDeclaration(row: any): void {
  if (row.document_id) {
    const doc = db.prepare('SELECT file_path FROM operation_documents WHERE id = ?').get(row.document_id) as any;
    if (doc?.file_path && /^[a-zA-Z0-9._-]+$/.test(doc.file_path)) {
      const abs = path.join(docsDir, doc.file_path);
      if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch { /* best effort */ } }
    }
    db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
  }
  db.prepare('DELETE FROM declarations WHERE id = ?').run(row.id);
}

router.delete('/:id', (req: Request, res: Response) => {
  const row = getRow(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Declaration not found' }); return; }
  deleteDeclaration(row);
  const op = db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(row.operation_id) as any;
  notifyAdmin({ action: 'deleted', entity: 'Declaration', label: `${op?.operation_number ?? ''} — ${row.title}`, ...who(req) });
  res.json({ ok: true });
});

export default router;
