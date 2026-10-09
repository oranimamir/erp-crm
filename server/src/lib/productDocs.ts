import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { archiveStored, archiveFile, ownerOf, contextOf } from './archive.js';

/**
 * Inventory → Documents: MSDS, product specification sheets, declarations and COAs.
 * A document is linked to any number of products (`product_document_products`);
 * one with no product is general (applies to every product). An operation
 * takes a COPY of a library file, so replacing it in the library later never
 * changes what an operation already holds or sent.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
export const productDocsDir = path.join(uploadsBase, 'product-docs');
const operationDocsDir = path.join(uploadsBase, 'operation-docs');

export type ProductDocKind = 'msds' | 'pds' | 'declaration' | 'coa';
export const PRODUCT_DOC_KINDS: ProductDocKind[] = ['msds', 'pds', 'declaration', 'coa'];
export const KIND_LABEL: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Product Specification Sheet', declaration: 'Declaration', coa: 'COA' };
/** The operation document category each kind is filed under. */
export const KIND_CATEGORY: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Product Specification Sheet', declaration: 'Declaration', coa: 'COA' };

export interface LinkedProduct { id: number; name: string; sku: string | null }

const SELECT_DOCS = `
  SELECT d.*, u.display_name AS uploaded_by_name
  FROM product_documents d
  LEFT JOIN users u ON u.id = d.uploaded_by
`;

/** Library documents, each with its linked `products` (empty = general). */
export function listProductDocs(where = '', params: any[] = [], order = 'ORDER BY d.kind, d.doc_code, d.title COLLATE NOCASE, d.created_at DESC'): any[] {
  const docs = db.prepare(`${SELECT_DOCS} ${where} ${order}`).all(...params) as any[];
  if (!docs.length) return docs;
  const links = db.prepare(`
    SELECT l.document_id, p.id, p.name, p.sku
    FROM product_document_products l JOIN products p ON p.id = l.product_id
    ORDER BY p.name COLLATE NOCASE
  `).all() as any[];
  const byDoc = new Map<number, LinkedProduct[]>();
  for (const l of links) {
    if (!byDoc.has(l.document_id)) byDoc.set(l.document_id, []);
    byDoc.get(l.document_id)!.push({ id: l.id, name: l.name, sku: l.sku });
  }
  return docs.map(d => ({ ...d, products: byDoc.get(d.id) || [] }));
}

export function getProductDoc(id: number): any | null {
  return listProductDocs('WHERE d.id = ?', [id])[0] || null;
}

/** A short label for notifications / copied documents: the title, else the file name. */
export function docLabel(doc: { title?: string | null; file_name: string }): string {
  return doc.title || doc.file_name;
}

/** Replaces a document's product links. */
export function setDocumentProducts(documentId: number, productIds: number[]): void {
  db.prepare('DELETE FROM product_document_products WHERE document_id = ?').run(documentId);
  addDocumentProducts(documentId, productIds);
}

/** Adds product links (never removes any). */
export function addDocumentProducts(documentId: number, productIds: number[]): void {
  const ins = db.prepare('INSERT OR IGNORE INTO product_document_products (document_id, product_id) SELECT ?, id FROM products WHERE id = ?');
  for (const pid of new Set(productIds)) ins.run(documentId, pid);
}

/** Parses a `product_ids` field (JSON array string, array, or comma list) into ids. */
export function parseProductIds(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  let raw: unknown = value;
  if (typeof value === 'string') {
    try { raw = JSON.parse(value); } catch { raw = value.split(','); }
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(Number).filter(n => Number.isInteger(n) && n > 0);
}

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

/** Moves a library document's file to the Archive (deleted, or replaced by a new version). */
export function archiveProductFile(doc: { file_path: string | null; file_name?: string | null; title?: string | null; kind?: string | null }, reason: 'deleted' | 'replaced' = 'deleted'): void {
  if (!doc.file_path || !SAFE_NAME.test(doc.file_path)) return;
  const kind = ({ msds: 'MSDS', pds: 'Product Specification Sheet', declaration: 'Declaration', coa: 'COA' } as Record<string, string>)[doc.kind || ''] || 'Library';
  archiveFile(path.join(productDocsDir, doc.file_path), {
    section: 'Inventory documents', context: contextOf(kind, doc.title, reason === 'replaced' ? 'replaced by a new version' : null),
    fileName: doc.file_name, reason,
  });
}

export function unlinkProductFile(filePath: string | null | undefined): void {
  if (!filePath || !SAFE_NAME.test(filePath)) return;
  const abs = path.join(productDocsDir, filePath);
  if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch { /* best effort */ } }
}

/**
 * Before a product is deleted: removes the documents that belong to it alone
 * (row + file). Documents shared with other products just lose the link
 * (cascade); general documents are untouched.
 */
export function removeProductDocumentFiles(productId: number): void {
  const rows = db.prepare(`
    SELECT d.id, d.file_path, d.file_name, d.title, d.kind FROM product_documents d
    JOIN product_document_products l ON l.document_id = d.id AND l.product_id = ?
    WHERE (SELECT COUNT(*) FROM product_document_products x WHERE x.document_id = d.id) = 1
  `).all(productId) as any[];
  for (const r of rows) {
    db.prepare('DELETE FROM product_documents WHERE id = ?').run(r.id);
    archiveProductFile(r);
  }
}

export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The catalogue product an order / invoice line is about: the longest product
 * name (or SKU) found as whole words in the line's description / product name.
 */
export function matchProduct(
  line: { description?: string | null; client_product_name?: string | null },
  products: Array<{ id: number; name: string; sku: string | null }>,
): { id: number; name: string } | null {
  const text = ` ${norm(line.description)} ${norm(line.client_product_name)} `;
  if (!text.trim()) return null;
  let best: { id: number; name: string } | null = null;
  let bestLen = 0;
  for (const p of products) {
    for (const key of [norm(p.name), norm(p.sku)]) {
      if (key.length < 2 || !text.includes(` ${key} `)) continue;
      if (key.length > bestLen) { best = { id: p.id, name: p.name }; bestLen = key.length; }
    }
  }
  return best;
}

/** Copies a library file into operation-docs under a fresh stored name. */
export function copyToOperationDocs(doc: { file_path: string; file_name: string }): string | null {
  if (!SAFE_NAME.test(doc.file_path)) return null;
  const src = path.join(productDocsDir, doc.file_path);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(operationDocsDir, { recursive: true });
  const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(doc.file_path).toLowerCase()}`;
  fs.copyFileSync(src, path.join(operationDocsDir, stored));
  return stored;
}

export function categoryIdByName(name: string): number | null {
  db.prepare('INSERT OR IGNORE INTO document_categories (name) VALUES (?)').run(name);
  const row = db.prepare('SELECT id FROM document_categories WHERE name = ?').get(name) as any;
  return row?.id ?? null;
}
