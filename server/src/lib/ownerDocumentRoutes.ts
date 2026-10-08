import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../database.js';
import { notifyAdmin } from './notify.js';
import { uploadOperationDoc } from '../middleware/upload.js';
import { categoryIdByName, uploadsBase } from './productDocs.js';
import { readDocxParagraphs, writeDocxParagraphs } from './docxText.js';
import { documentSources, fileFromSources } from './documentSources.js';
import { OwnerKind, getOwner, ownerDocument, isGeneratedDocument } from './docOwner.js';

/**
 * The document routes operations and non-commercial operations share, mounted
 * on each router (`/api/operations/:id/…`, `/api/non-commercial-operations/:id/…`):
 *  - GET  /:id/document-sources?category=     documents in the app that could fill a category
 *  - POST /:id/documents/from-system          { category, items: [{ source, id }] }
 *  - PUT  /:id/documents/:docId               multipart: file_name, category_id, notes, optional new file
 *  - GET/PUT /:id/documents/:docId/text       the text of a Word document (declarations)
 */

const docsDir = path.join(uploadsBase, 'operation-docs');
const SAFE = /^[a-zA-Z0-9._-]+$/;
const ENTITY: Record<OwnerKind, string> = { operation: 'Operation', nco: 'Non-Commercial Operation' };
const who = (req: Request) => ({ performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });

export function mountOwnerDocumentRoutes(router: Router, kind: OwnerKind): void {
  const ownerOf = (req: Request) => getOwner(kind, Number(req.params.id));
  const notFound = (res: Response) => res.status(404).json({ error: kind === 'nco' ? 'Not found' : 'Operation not found' });

  router.get('/:id/document-sources', (req: Request, res: Response) => {
    const category = String(req.query.category || '').trim();
    if (!category) { res.status(400).json({ error: 'category is required' }); return; }
    const owner = ownerOf(req);
    if (!owner) { notFound(res); return; }
    res.json({ data: documentSources(owner, category) });
  });

  router.post('/:id/documents/from-system', (req: Request, res: Response) => {
    const owner = ownerOf(req);
    if (!owner) { notFound(res); return; }
    const category = String(req.body?.category || '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!category || !items.length) { res.status(400).json({ error: 'Choose at least one document' }); return; }
    const categoryId = categoryIdByName(category);
    if (!categoryId) { res.status(400).json({ error: 'Unknown category' }); return; }
    const result = fileFromSources(owner, categoryId, items);
    if (result.added) {
      notifyAdmin({
        action: 'updated', entity: ENTITY[kind], label: kind === 'operation' ? `Operation ${owner.number}` : owner.number,
        detail: `${result.added} document(s) filed as ${category}`, ...who(req),
      });
    }
    res.json(result);
  });

  // ── Text of a Word document ──────────────────────────────────────────────
  const wordDoc = (req: Request) => {
    const owner = ownerOf(req);
    const doc = owner ? ownerDocument(owner, Number(req.params.docId)) : null;
    return owner && doc && /\.docx$/i.test(doc.file_name) && SAFE.test(doc.file_path) ? { owner, doc } : null;
  };

  router.get('/:id/documents/:docId/text', async (req: Request, res: Response) => {
    const found = wordDoc(req);
    if (!found) { res.status(404).json({ error: 'Only Word (.docx) documents can be edited here' }); return; }
    const abs = path.join(docsDir, found.doc.file_path);
    if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found' }); return; }
    try {
      res.json({ file_name: found.doc.file_name, paragraphs: await readDocxParagraphs(fs.readFileSync(abs)) });
    } catch {
      res.status(400).json({ error: 'The Word file could not be read' });
    }
  });

  router.put('/:id/documents/:docId/text', async (req: Request, res: Response) => {
    const found = wordDoc(req);
    if (!found) { res.status(404).json({ error: 'Only Word (.docx) documents can be edited here' }); return; }
    const edits = req.body?.edits && typeof req.body.edits === 'object' ? req.body.edits : {};
    const abs = path.join(docsDir, found.doc.file_path);
    if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found' }); return; }
    try {
      const { buffer, changed } = await writeDocxParagraphs(fs.readFileSync(abs), edits);
      if (!changed) { res.json({ changed: 0 }); return; }
      const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.docx`;
      fs.writeFileSync(path.join(docsDir, stored), buffer);
      db.prepare(`UPDATE ${found.owner.table} SET file_path = ? WHERE id = ?`).run(stored, found.doc.id);
      try { fs.unlinkSync(abs); } catch { /* ignore */ }
      notifyAdmin({
        action: 'updated', entity: `${ENTITY[kind]} Document`, label: `${found.owner.number} — ${found.doc.file_name}`,
        detail: `text edited (${changed} paragraph${changed === 1 ? '' : 's'})`, ...who(req),
      });
      res.json({ changed });
    } catch {
      res.status(400).json({ error: 'The Word file could not be saved' });
    }
  });

  // ── Edit a document: name, category, notes, optional new file ────────────
  router.put('/:id/documents/:docId', uploadOperationDoc.single('file'), (req: Request, res: Response) => {
    const owner = ownerOf(req);
    const doc = owner ? ownerDocument(owner, Number(req.params.docId)) : null;
    const dropUpload = () => { if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } } };
    if (!owner || !doc) { dropUpload(); res.status(404).json({ error: 'Document not found' }); return; }
    if (req.file && isGeneratedDocument(owner, doc.id)) {
      dropUpload();
      res.status(400).json({ error: 'This PDF was generated — change it in its generator and regenerate' });
      return;
    }

    const ext = path.extname(req.file?.originalname || doc.file_name);
    let fileName = req.file ? req.file.originalname : doc.file_name;
    if (req.body?.file_name !== undefined) {
      const typed = String(req.body.file_name).replace(/[\\/:*?"<>|]+/g, '-').trim();
      if (!typed) { dropUpload(); res.status(400).json({ error: 'The name cannot be empty' }); return; }
      fileName = path.extname(typed).toLowerCase() === ext.toLowerCase() ? typed : `${typed}${ext}`;
    }
    const categoryId = req.body?.category_id === undefined ? doc.category_id : (Number(req.body.category_id) || null);
    const notes = req.body?.notes === undefined ? doc.notes : (String(req.body.notes).trim() || null);

    db.prepare(`UPDATE ${owner.table} SET file_path = ?, file_name = ?, category_id = ?, notes = ? WHERE id = ?`)
      .run(req.file?.filename ?? doc.file_path, fileName, categoryId, notes, doc.id);
    if (req.file && SAFE.test(doc.file_path)) {
      const old = path.join(docsDir, doc.file_path);
      if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* ignore */ } }
    }
    notifyAdmin({
      action: 'updated', entity: `${ENTITY[kind]} Document`, label: `${owner.number} — ${fileName}`,
      detail: req.file ? 'new version uploaded' : undefined, ...who(req),
    });
    res.json(ownerDocument(owner, doc.id));
  });
}
