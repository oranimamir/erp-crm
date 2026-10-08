import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../database.js';
import { uploadsBase, listProductDocs, ProductDocKind, addDocumentProducts } from './productDocs.js';
import { parseLibraryFileName } from './productLibrary.js';
import { suggestFor } from '../routes/product-documents.js';
import { DocOwner, ownerLines, ownerLots, insertOwnerDocument } from './docOwner.js';

/**
 * "Choose from the system" on the shipping document tiles (operation or
 * non-commercial operation): the documents already somewhere in the app that
 * could fill a category —
 *  - library: Inventory → Documents (MSDS / spec sheets / declarations)
 *  - batch: Inventory → Batches documents (COAs), matched on the lots
 *  - this: this owner's documents with no category yet (filed in place)
 *  - other / other_nco: the same category on other operations / NCOs
 *  - supplier: a supplier's documents (General document tile; listed per
 *    supplier by GET /api/suppliers/:id/documents, filed through here)
 * The most suitable ones come back `suggested`. Choosing copies the file
 * under the owner (or, for `this`, just sets its category).
 */

export type SourceType = 'library' | 'batch' | 'this' | 'other' | 'other_nco' | 'supplier';

export interface SourceDoc {
  source: SourceType;
  id: number;
  title: string;
  subtitle: string;
  file_name: string;
  file_path: string;
  subfolder: string;
  date: string | null;
  suggested: boolean;
}

const SAFE = /^[a-zA-Z0-9._-]+$/;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Library kind a category is filled from. */
export function libraryKindOf(category: string): ProductDocKind | null {
  const c = norm(category);
  if (c === 'msds') return 'msds';
  if (c === 'product specification sheet' || c === 'pds') return 'pds';
  if (c === 'declaration' || c === 'declarations') return 'declaration';
  if (c === 'coa') return 'coa';
  return null;
}

/** A library COA naming one of the lots (title, code, notes or file name). */
export function coaMatchesLots(doc: { title?: string | null; doc_code?: string | null; notes?: string | null; file_name?: string | null }, lots: Set<string>): boolean {
  if (!lots.size) return false;
  const text = norm([doc.title, doc.doc_code, doc.notes, doc.file_name].join(' '));
  return [...lots].some(lot => lot.length >= 3 && text.includes(lot));
}

/** Most specific first: fewest products, then highest code, then newest. */
function best<T extends { products: any[]; doc_code: string | null; updated_at: string; created_at: string }>(docs: T[]): T | undefined {
  return [...docs].sort((a, b) =>
    a.products.length - b.products.length
    || String(b.doc_code || '').localeCompare(String(a.doc_code || ''))
    || String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)),
  )[0];
}

export function documentSources(owner: DocOwner, category: string): SourceDoc[] {
  const out: SourceDoc[] = [];
  const kind = libraryKindOf(category);

  // Library documents of the matching kind; the best fit per product suggested
  // (COAs: those naming the owner's lots, else the best per product)
  const lots = ownerLots(owner);
  if (kind) {
    const docs = listProductDocs('WHERE d.kind = ?', [kind]);
    const suggested = new Set<number>();
    if (kind === 'coa') docs.filter(d => coaMatchesLots(d, lots)).forEach(d => suggested.add(d.id));
    if (!suggested.size) for (const line of suggestFor(ownerLines(owner).lines, docs)) {
      if (!line.product) continue;
      if (kind === 'declaration') line.documents.forEach((d: any) => suggested.add(d.id));
      else { const top = best(line.documents); if (top) suggested.add(top.id); }
    }
    for (const d of docs) {
      out.push({
        source: 'library', id: d.id, title: d.title || d.file_name,
        subtitle: [d.doc_code, d.products.length ? d.products.map((p: any) => p.name).join(', ') : 'General — all products'].filter(Boolean).join(' · '),
        file_name: d.file_name, file_path: d.file_path, subfolder: 'product-docs',
        date: d.updated_at || d.created_at, suggested: suggested.has(d.id),
      });
    }
  }

  // Batch documents (COAs first); those of the owner's lots suggested for quality certificates
  const quality = /quality|coa|analysis/.test(norm(category));
  const batchDocs = db.prepare(`
    SELECT bd.*, b.batch_number FROM batch_documents bd JOIN batches b ON b.id = bd.batch_id
    ORDER BY CASE WHEN bd.document_type = 'coa' THEN 0 ELSE 1 END, bd.created_at DESC
  `).all() as any[];
  for (const d of batchDocs) {
    out.push({
      source: 'batch', id: d.id,
      title: `${d.document_type === 'coa' ? 'COA' : (d.document_name || 'Document')} — batch ${d.batch_number}`,
      subtitle: d.file_name, file_name: d.file_name, file_path: d.file_path, subfolder: 'batch-documents',
      date: d.created_at, suggested: quality && d.document_type === 'coa' && lots.has(norm(d.batch_number)),
    });
  }

  // This owner's documents with no category yet
  const own = db.prepare(`SELECT * FROM ${owner.table} WHERE ${owner.fk} = ? AND category_id IS NULL ORDER BY created_at DESC`).all(owner.id) as any[];
  for (const d of own) {
    out.push({
      source: 'this', id: d.id, title: d.file_name, subtitle: 'Already here, no category yet',
      file_name: d.file_name, file_path: d.file_path, subfolder: 'operation-docs', date: d.created_at, suggested: false,
    });
  }

  // The same category on other operations and NCOs, the same customer's first
  const others = db.prepare(`
    SELECT * FROM (
    SELECT 'other' AS source, od.id, od.file_path, od.file_name, od.created_at, o.operation_number AS number, o.customer_id, c.name AS customer_name
    FROM operation_documents od
    JOIN document_categories dc ON dc.id = od.category_id
    JOIN operations o ON o.id = od.operation_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE lower(dc.name) = lower(?1) AND NOT (?2 = 'operation' AND od.operation_id = ?3)
    UNION ALL
    SELECT 'other_nco' AS source, nd.id, nd.file_path, nd.file_name, nd.created_at, n.nco_number AS number, n.customer_id, c.name AS customer_name
    FROM nco_documents nd
    JOIN document_categories dc ON dc.id = nd.category_id
    JOIN non_commercial_operations n ON n.id = nd.nco_id
    LEFT JOIN customers c ON c.id = n.customer_id
    WHERE lower(dc.name) = lower(?1) AND NOT (?2 = 'nco' AND nd.nco_id = ?3)
    )
    ORDER BY CASE WHEN customer_id = ?4 THEN 0 ELSE 1 END, created_at DESC
    LIMIT 100
  `).all(category, owner.kind, owner.id, owner.customerId ?? -1) as any[];
  for (const d of others) {
    out.push({
      source: d.source, id: d.id, title: d.file_name,
      subtitle: `${d.number}${d.customer_name ? ` · ${d.customer_name}` : ''}`,
      file_name: d.file_name, file_path: d.file_path, subfolder: 'operation-docs', date: d.created_at, suggested: false,
    });
  }
  return out;
}

/** Copies a stored file into operation-docs under a fresh name. */
function copyIn(subfolder: string, filePath: string): string | null {
  if (!SAFE.test(filePath)) return null;
  const src = path.join(uploadsBase, subfolder, filePath);
  if (!fs.existsSync(src)) return null;
  const dir = path.join(uploadsBase, 'operation-docs');
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(filePath).toLowerCase()}`;
  fs.copyFileSync(src, path.join(dir, stored));
  return stored;
}

/** Files the chosen sources under the owner in `categoryId`. */
export function fileFromSources(owner: DocOwner, categoryId: number, items: Array<{ source: SourceType; id: number }>): { added: number; missing: string[] } {
  let added = 0;
  const missing: string[] = [];
  for (const item of items) {
    const id = Number(item?.id);
    if (!Number.isInteger(id)) continue;
    if (item.source === 'this') {
      const r = db.prepare(`UPDATE ${owner.table} SET category_id = ? WHERE id = ? AND ${owner.fk} = ?`).run(categoryId, id, owner.id);
      if (r.changes) added++;
      continue;
    }
    let row: any = null;
    let subfolder = '';
    let notes: string | null = null;
    if (item.source === 'library') {
      row = db.prepare('SELECT file_path, file_name, title FROM product_documents WHERE id = ?').get(id);
      subfolder = 'product-docs';
      notes = row ? `From the library — ${row.title || row.file_name}` : null;
    } else if (item.source === 'batch') {
      row = db.prepare('SELECT bd.file_path, bd.file_name, b.batch_number FROM batch_documents bd JOIN batches b ON b.id = bd.batch_id WHERE bd.id = ?').get(id);
      subfolder = 'batch-documents';
      notes = row ? `From batch ${row.batch_number}` : null;
    } else if (item.source === 'other') {
      row = db.prepare('SELECT od.file_path, od.file_name, o.operation_number AS number FROM operation_documents od JOIN operations o ON o.id = od.operation_id WHERE od.id = ?').get(id);
      subfolder = 'operation-docs';
      notes = row ? `Copied from ${row.number}` : null;
    } else if (item.source === 'other_nco') {
      row = db.prepare('SELECT nd.file_path, nd.file_name, n.nco_number AS number FROM nco_documents nd JOIN non_commercial_operations n ON n.id = nd.nco_id WHERE nd.id = ?').get(id);
      subfolder = 'operation-docs';
      notes = row ? `Copied from ${row.number}` : null;
    } else if (item.source === 'supplier') {
      row = db.prepare('SELECT sd.file_path, sd.file_name, s.name AS supplier_name FROM supplier_documents sd JOIN suppliers s ON s.id = sd.supplier_id WHERE sd.id = ?').get(id);
      subfolder = 'supplier-docs';
      notes = row ? `From supplier ${row.supplier_name}` : null;
    }
    if (!row) continue;
    const stored = copyIn(subfolder, row.file_path);
    if (!stored) { missing.push(row.file_name); continue; }
    insertOwnerDocument(owner, categoryId, stored, row.file_name, notes);
    added++;
  }
  return { added, missing };
}

/** The catalogue products on the owner's invoice (else its order / sample lines). */
export function ownerProductIds(owner: DocOwner): number[] {
  return [...new Set(suggestFor(ownerLines(owner).lines, []).map(l => l.product?.id).filter((id): id is number => !!id))];
}

/**
 * A declaration uploaded on an operation or NCO also goes into the library
 * (Inventory → Documents → Declarations), linked to the owner's products, so
 * later operations can use it. The same file (by content) is kept once.
 * Returns the library document id.
 */
export function saveDeclarationToLibrary(buffer: Buffer, fileName: string, owner: DocOwner, userId: number | null, kind: 'declaration' | 'coa' = 'declaration'): number | null {
  const ext = path.extname(fileName).toLowerCase();
  if (!['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return null;
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const same = db.prepare(`SELECT id FROM product_documents WHERE sha256 = ?`).get(sha) as any;
  if (same) return same.id;
  const dir = path.join(uploadsBase, 'product-docs');
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(dir, stored), buffer);
  const { code, title } = parseLibraryFileName(fileName);
  const r = db.prepare(`
    INSERT INTO product_documents (kind, title, doc_code, file_path, file_name, notes, sha256, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(kind, title, code, stored, fileName, `Uploaded on ${owner.number}`, sha, userId);
  const id = Number(r.lastInsertRowid);
  addDocumentProducts(id, ownerProductIds(owner));
  return id;
}
