import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import db from '../database.js';

/**
 * Inventory → Documents: MSDS and product specification sheets, one library
 * per product. An operation takes a COPY of a library file, so replacing it in
 * the library later never changes what an operation already holds or sent.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
export const productDocsDir = path.join(uploadsBase, 'product-docs');
const operationDocsDir = path.join(uploadsBase, 'operation-docs');

export type ProductDocKind = 'msds' | 'pds';
export const PRODUCT_DOC_KINDS: ProductDocKind[] = ['msds', 'pds'];
/** The operation document category each kind is filed under. */
export const KIND_CATEGORY: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Product Specification Sheet' };

export const SELECT_PRODUCT_DOCS = `
  SELECT d.*, p.name AS product_name, p.sku AS product_sku, u.display_name AS uploaded_by_name
  FROM product_documents d
  JOIN products p ON p.id = d.product_id
  LEFT JOIN users u ON u.id = d.uploaded_by
`;

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

export function unlinkProductFile(filePath: string | null | undefined): void {
  if (!filePath || !SAFE_NAME.test(filePath)) return;
  const abs = path.join(productDocsDir, filePath);
  if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch { /* best effort */ } }
}

/** Removes the stored files of a product's documents (the rows cascade with the product). */
export function removeProductDocumentFiles(productId: number): void {
  const rows = db.prepare('SELECT file_path FROM product_documents WHERE product_id = ?').all(productId) as any[];
  for (const r of rows) unlinkProductFile(r.file_path);
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The catalogue product an order line is about: the longest product name (or
 * SKU) found as whole words in the line's description / client product name.
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
