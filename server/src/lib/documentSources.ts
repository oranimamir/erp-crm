import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../database.js';
import { uploadsBase, listProductDocs, ProductDocKind, addDocumentProducts } from './productDocs.js';
import { parseLibraryFileName } from './productLibrary.js';
import { invoiceLines, suggestFor } from '../routes/product-documents.js';

/**
 * "Choose from the system" on the operation's shipping document tiles: the
 * documents already somewhere in the app that could fill a category —
 *  - library: Inventory → Documents (MSDS / spec sheets / declarations)
 *  - batch: Inventory → Batches documents (COAs), matched on the lots
 *  - this: this operation's documents with no category yet (filed in place)
 *  - other: the same category on other operations (e.g. a label reused)
 * The most suitable ones come back `suggested`. Choosing copies the file
 * under the operation (or, for `this`, just sets its category).
 */

export type SourceType = 'library' | 'batch' | 'this' | 'other';

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
  return null;
}

/** Most specific first: fewest products, then highest code, then newest. */
function best<T extends { products: any[]; doc_code: string | null; updated_at: string; created_at: string }>(docs: T[]): T | undefined {
  return [...docs].sort((a, b) =>
    a.products.length - b.products.length
    || String(b.doc_code || '').localeCompare(String(a.doc_code || ''))
    || String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)),
  )[0];
}

/** The lots printed on the operation's invoice lines (else none). */
function operationLots(operationId: number): Set<string> {
  const lots = new Set<string>();
  const rows = db.prepare('SELECT data FROM invoice_documents WHERE operation_id = ?').all(operationId) as any[];
  for (const row of rows) {
    let data: any;
    try { data = JSON.parse(row.data); } catch { continue; }
    for (const it of Array.isArray(data?.items) ? data.items : []) {
      const list = Array.isArray(it?.lots) ? it.lots : [it?.lot, it?.lot2, it?.lot3, it?.lot4];
      for (const l of list) if (l && String(l).trim()) lots.add(norm(l));
    }
  }
  return lots;
}

export function documentSources(operationId: number, category: string): SourceDoc[] {
  const op = db.prepare('SELECT id, order_id, customer_id FROM operations WHERE id = ?').get(operationId) as any;
  if (!op) return [];
  const out: SourceDoc[] = [];
  const kind = libraryKindOf(category);

  // Library documents of the matching kind; the best fit per product suggested
  if (kind) {
    const docs = listProductDocs('WHERE d.kind = ?', [kind]);
    const lines = invoiceLines(op.id) ?? (op.order_id
      ? db.prepare('SELECT description, client_product_name FROM order_items WHERE order_id = ? ORDER BY id').all(op.order_id) as any[]
      : []);
    const suggested = new Set<number>();
    for (const line of suggestFor(lines, docs)) {
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

  // Batch documents (COAs first); those of the operation's lots suggested for quality certificates
  const lots = operationLots(op.id);
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

  // This operation's documents with no category yet
  const own = db.prepare(`SELECT * FROM operation_documents WHERE operation_id = ? AND category_id IS NULL ORDER BY created_at DESC`).all(op.id) as any[];
  for (const d of own) {
    out.push({
      source: 'this', id: d.id, title: d.file_name, subtitle: 'Already on this operation, no category yet',
      file_name: d.file_name, file_path: d.file_path, subfolder: 'operation-docs', date: d.created_at, suggested: false,
    });
  }

  // The same category on other operations, the same customer's first
  const others = db.prepare(`
    SELECT od.*, o.operation_number, o.customer_id, c.name AS customer_name
    FROM operation_documents od
    JOIN document_categories dc ON dc.id = od.category_id
    JOIN operations o ON o.id = od.operation_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE lower(dc.name) = lower(?) AND od.operation_id != ?
    ORDER BY CASE WHEN o.customer_id = ? THEN 0 ELSE 1 END, od.created_at DESC
    LIMIT 100
  `).all(category, op.id, op.customer_id ?? -1) as any[];
  for (const d of others) {
    out.push({
      source: 'other', id: d.id, title: d.file_name,
      subtitle: `${d.operation_number}${d.customer_name ? ` · ${d.customer_name}` : ''}`,
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

/** Files the chosen sources under the operation in `categoryId`. */
export function fileFromSources(operationId: number, categoryId: number, items: Array<{ source: SourceType; id: number }>): { added: number; missing: string[] } {
  let added = 0;
  const missing: string[] = [];
  const insert = db.prepare('INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)');
  for (const item of items) {
    const id = Number(item?.id);
    if (!Number.isInteger(id)) continue;
    if (item.source === 'this') {
      const r = db.prepare('UPDATE operation_documents SET category_id = ? WHERE id = ? AND operation_id = ?').run(categoryId, id, operationId);
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
      row = db.prepare('SELECT od.file_path, od.file_name, o.operation_number FROM operation_documents od JOIN operations o ON o.id = od.operation_id WHERE od.id = ?').get(id);
      subfolder = 'operation-docs';
      notes = row ? `Copied from ${row.operation_number}` : null;
    }
    if (!row) continue;
    const stored = copyIn(subfolder, row.file_path);
    if (!stored) { missing.push(row.file_name); continue; }
    insert.run(operationId, categoryId, stored, row.file_name, notes);
    added++;
  }
  return { added, missing };
}

/** The catalogue products on the operation's invoice (else order). */
export function operationProductIds(operationId: number): number[] {
  const op = db.prepare('SELECT id, order_id FROM operations WHERE id = ?').get(operationId) as any;
  if (!op) return [];
  const lines = invoiceLines(op.id) ?? (op.order_id
    ? db.prepare('SELECT description, client_product_name FROM order_items WHERE order_id = ? ORDER BY id').all(op.order_id) as any[]
    : []);
  return [...new Set(suggestFor(lines, []).map(l => l.product?.id).filter((id): id is number => !!id))];
}

/**
 * A declaration uploaded on an operation also goes into the library
 * (Inventory → Documents → Declarations), linked to the operation's products,
 * so later operations can use it. The same file (by content) is kept once.
 * Returns the library document id.
 */
export function saveDeclarationToLibrary(buffer: Buffer, fileName: string, operationId: number, userId: number | null): number | null {
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
  const op = db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(operationId) as any;
  const r = db.prepare(`
    INSERT INTO product_documents (kind, title, doc_code, file_path, file_name, notes, sha256, uploaded_by)
    VALUES ('declaration', ?, ?, ?, ?, ?, ?, ?)
  `).run(title, code, stored, fileName, op ? `Uploaded on ${op.operation_number}` : null, sha, userId);
  const id = Number(r.lastInsertRowid);
  addDocumentProducts(id, operationProductIds(operationId));
  return id;
}
