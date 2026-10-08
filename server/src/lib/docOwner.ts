import db from '../database.js';
import { parseNcoLines } from './ncoDocs.js';

/**
 * The thing documents are filed under: an operation (`operation_documents`)
 * or a non-commercial operation (`nco_documents`). The document features —
 * shipping document tiles, choose from the system, library suggestions,
 * declarations, edit / text edit — work on either through this.
 */

export type OwnerKind = 'operation' | 'nco';

export interface DocOwner {
  kind: OwnerKind;
  id: number;
  number: string;
  customerId: number | null;
  orderId: number | null;
  /** operation_documents | nco_documents */
  table: 'operation_documents' | 'nco_documents';
  /** operation_id | nco_id — the owner column in `table` (and in declarations) */
  fk: 'operation_id' | 'nco_id';
}

export function getOwner(kind: OwnerKind, id: number): DocOwner | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (kind === 'operation') {
    const op = db.prepare('SELECT id, operation_number, customer_id, order_id FROM operations WHERE id = ?').get(id) as any;
    return op ? {
      kind, id: op.id, number: op.operation_number, customerId: op.customer_id ?? null, orderId: op.order_id ?? null,
      table: 'operation_documents', fk: 'operation_id',
    } : null;
  }
  const nco = db.prepare('SELECT id, nco_number, customer_id FROM non_commercial_operations WHERE id = ?').get(id) as any;
  return nco ? {
    kind, id: nco.id, number: nco.nco_number, customerId: nco.customer_id ?? null, orderId: null,
    table: 'nco_documents', fk: 'nco_id',
  } : null;
}

/** The owner a request names: `operation_id` or `nco_id` (body or query). */
export function ownerFromRequest(src: any): DocOwner | null {
  if (src?.nco_id) return getOwner('nco', Number(src.nco_id));
  if (src?.operation_id) return getOwner('operation', Number(src.operation_id));
  return null;
}

/** Lines of the owner's generated invoice (final over draft, newest), else null. */
function generatedInvoiceLines(owner: DocOwner): Array<{ description: string; client_product_name: string }> | null {
  const rows = db.prepare(`
    SELECT data FROM invoice_documents WHERE ${owner.fk} = ?
    ORDER BY CASE WHEN status = 'final' THEN 0 ELSE 1 END, updated_at DESC, id DESC
  `).all(owner.id) as any[];
  for (const row of rows) {
    let data: any;
    try { data = JSON.parse(row.data); } catch { continue; }
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.lines) ? data.lines : [];
    const lines = items
      .map((it: any) => ({
        description: [it.product, it.description, it.commercial_name, it.name].filter(Boolean).join(' '),
        client_product_name: [it.client_product_name, it.reference].filter(Boolean).join(' '),
      }))
      .filter((l: any) => l.description || l.client_product_name);
    if (lines.length) return lines;
  }
  return null;
}

/**
 * The owner's product lines, for matching catalogue products: its generated
 * invoice, else the order lines (operation) or the sample lines (NCO).
 */
export function ownerLines(owner: DocOwner): { source: 'invoice' | 'order' | 'lines'; lines: Array<{ description: string; client_product_name: string }> } {
  const fromInvoice = generatedInvoiceLines(owner);
  if (fromInvoice) return { source: 'invoice', lines: fromInvoice };
  if (owner.kind === 'operation') {
    const lines = owner.orderId
      ? db.prepare('SELECT description, client_product_name FROM order_items WHERE order_id = ? ORDER BY id').all(owner.orderId) as any[]
      : [];
    return { source: 'order', lines };
  }
  const nco = db.prepare('SELECT items FROM non_commercial_operations WHERE id = ?').get(owner.id) as any;
  return {
    source: 'lines',
    lines: parseNcoLines(nco?.items).map(l => ({ description: l.product || '', client_product_name: l.reference || '' })),
  };
}

/** Lot numbers on the owner's generated invoice lines. */
export function ownerLots(owner: DocOwner): Set<string> {
  const lots = new Set<string>();
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const rows = db.prepare(`SELECT data FROM invoice_documents WHERE ${owner.fk} = ?`).all(owner.id) as any[];
  for (const row of rows) {
    let data: any;
    try { data = JSON.parse(row.data); } catch { continue; }
    for (const it of Array.isArray(data?.items) ? data.items : []) {
      const list = Array.isArray(it?.lots) ? it.lots : [it?.lot, it?.lot2, it?.lot3, it?.lot4];
      for (const l of list) if (l && String(l).trim()) lots.add(norm(l));
    }
  }
  if (owner.kind === 'nco') {
    const nco = db.prepare('SELECT items FROM non_commercial_operations WHERE id = ?').get(owner.id) as any;
    for (const l of parseNcoLines(nco?.items)) for (const lot of l.lots || []) lots.add(norm(lot));
  }
  return lots;
}

/** One of the owner's documents, with its category name. */
export function ownerDocument(owner: DocOwner, docId: number): any | null {
  return db.prepare(`
    SELECT d.*, c.name AS category_name FROM ${owner.table} d
    LEFT JOIN document_categories c ON c.id = d.category_id
    WHERE d.id = ? AND d.${owner.fk} = ?
  `).get(docId, owner.id) ?? null;
}

/** Files a stored operation-docs file under the owner. Returns the new document id. */
export function insertOwnerDocument(owner: DocOwner, categoryId: number | null, filePath: string, fileName: string, notes: string | null): number {
  const r = db.prepare(`INSERT INTO ${owner.table} (${owner.fk}, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(owner.id, categoryId, filePath, fileName, notes);
  return Number(r.lastInsertRowid);
}

/** A PDF a generator filed under the owner (its file is replaced only by regenerating). */
export function isGeneratedDocument(owner: DocOwner, docId: number): boolean {
  if (owner.kind === 'operation') {
    return !!db.prepare(`
      SELECT 1 FROM order_confirmations WHERE document_id = ?1
      UNION SELECT 1 FROM purchase_orders WHERE document_id = ?1
      UNION SELECT 1 FROM invoice_documents WHERE document_id = ?1
      UNION SELECT 1 FROM packing_lists WHERE document_id = ?1 OR final_document_id = ?1
      UNION SELECT 1 FROM declarations WHERE document_id = ?1
    `).get(docId);
  }
  return !!db.prepare(`
    SELECT 1 FROM order_confirmations WHERE nco_document_id = ?1
    UNION SELECT 1 FROM purchase_orders WHERE nco_document_id = ?1
    UNION SELECT 1 FROM invoice_documents WHERE nco_document_id = ?1
    UNION SELECT 1 FROM packing_lists WHERE nco_document_id = ?1 OR final_nco_document_id = ?1
    UNION SELECT 1 FROM declarations WHERE nco_document_id = ?1
  `).get(docId);
}
