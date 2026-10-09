import fs from 'fs';
import path from 'path';
import db from '../database.js';
import { uploadsBase } from './productDocs.js';

/**
 * Generated order confirmations and supplier POs are filed under the order's
 * operation when they are generated. One generated before the order had an
 * operation (e.g. from the order page) has its PDF but no operation document,
 * and linking the operation later does not file it. This files those: a final
 * document of the operation's order with no filed row (and no other operation)
 * gets one, named `<op#>OC.pdf` / `<op#>PO.pdf`.
 */

const KINDS = [
  { table: 'order_confirmations', category: 'Order Confirmation', suffix: 'OC', numberField: 'oc_number', note: 'Order Confirmation' },
  { table: 'purchase_orders', category: 'Purchase Order', suffix: 'PO', numberField: 'po_number', note: 'Purchase order' },
  // An invoice is named after its own number (CIBE…pdf), as when generated
  { table: 'invoice_documents', category: 'Commercial Invoice', suffix: '', numberField: 'invoice_number', note: 'Commercial Invoice' },
] as const;

const SAFE = /^[a-zA-Z0-9._-]+$/;
const docsDir = path.join(uploadsBase, 'operation-docs');

function categoryId(name: string): number | null {
  db.prepare('INSERT OR IGNORE INTO document_categories (name) VALUES (?)').run(name);
  return (db.prepare('SELECT id FROM document_categories WHERE name = ?').get(name) as any)?.id ?? null;
}

/** Files the operation's unfiled generated OC / PO; returns how many were filed. */
export function fileGeneratedForOperation(operationId: number): number {
  const op = db.prepare('SELECT id, operation_number, order_id FROM operations WHERE id = ?').get(operationId) as any;
  if (!op?.order_id) return 0;
  let filed = 0;
  for (const kind of KINDS) {
    const rows = db.prepare(`
      SELECT * FROM ${kind.table}
      WHERE order_id = ? AND nco_id IS NULL AND status = 'final' AND file_path IS NOT NULL
        AND (operation_id IS NULL OR operation_id = ?)
    `).all(op.order_id, op.id) as any[];
    for (const row of rows) {
      const doc = row.document_id ? db.prepare('SELECT id FROM operation_documents WHERE id = ?').get(row.document_id) : null;
      if (doc) continue;
      if (!SAFE.test(row.file_path) || !fs.existsSync(path.join(docsDir, row.file_path))) continue;
      const stem = String((kind.suffix ? op.operation_number : null) || row[kind.numberField] || kind.suffix).replace(/[^A-Za-z0-9._-]+/g, '-');
      const fileName = `${stem}${kind.suffix}.pdf`;
      const r = db.prepare(`INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)`)
        .run(op.id, categoryId(kind.category), row.file_path, fileName, `${kind.note} ${row[kind.numberField] || ''}`.trim());
      db.prepare(`UPDATE ${kind.table} SET operation_id = ?, document_id = ?, file_name = ? WHERE id = ?`)
        .run(op.id, Number(r.lastInsertRowid), fileName, row.id);
      // The recorded invoice moves with it, so it shows in the operation's Invoices
      if (kind.table === 'invoice_documents' && row.invoice_id) {
        db.prepare('UPDATE invoices SET operation_id = ? WHERE id = ? AND operation_id IS NULL').run(op.id, row.invoice_id);
      }
      filed++;
    }
  }
  return filed;
}

/**
 * Documents being prepared for the operation that are not generated yet
 * (OC / supplier PO / invoice / declaration / COA saved as draft): no PDF, so
 * not in the documents list — listed beside it so they aren't missed.
 */
export function draftsForOperation(operationId: number): Array<{ kind: string; id: number; label: string; number: string | null; updated_at: string | null; path: string }> {
  const op = db.prepare('SELECT id, order_id FROM operations WHERE id = ?').get(operationId) as any;
  if (!op) return [];
  const out: Array<{ kind: string; id: number; label: string; number: string | null; updated_at: string | null; path: string }> = [];
  const ofOrder = (table: string, numberField: string, label: string, kind: string, path: string) => {
    const rows = db.prepare(`
      SELECT id, ${numberField} AS number, updated_at FROM ${table}
      WHERE status = 'draft' AND nco_id IS NULL
        AND (operation_id = ? OR (operation_id IS NULL AND order_id IS NOT NULL AND order_id = ?))
      ORDER BY id
    `).all(op.id, op.order_id ?? -1) as any[];
    for (const r of rows) out.push({ kind, id: r.id, label, number: r.number || null, updated_at: r.updated_at || null, path: `${path}/${r.id}` });
  };
  ofOrder('order_confirmations', 'oc_number', 'Order Confirmation', 'oc', '/order-confirmations');
  ofOrder('purchase_orders', 'po_number', 'Purchase Order', 'po', '/purchase-orders');
  ofOrder('invoice_documents', 'invoice_number', 'Commercial Invoice', 'invoice', '/invoices/documents');
  const decls = db.prepare(`SELECT id, title, kind, updated_at FROM declarations WHERE operation_id = ? AND status = 'draft' ORDER BY id`).all(op.id) as any[];
  for (const d of decls) {
    out.push({ kind: d.kind === 'coa' ? 'coa' : 'declaration', id: d.id, label: d.kind === 'coa' ? 'COA' : 'Declaration',
      number: d.title || null, updated_at: d.updated_at || null, path: `/declarations/${d.id}` });
  }
  return out;
}

/** Startup sweep over every operation with an order. */
export function fileAllUnfiledGenerated(): number {
  const ops = db.prepare('SELECT id FROM operations WHERE order_id IS NOT NULL').all() as any[];
  return ops.reduce((n, o) => n + fileGeneratedForOperation(o.id), 0);
}
