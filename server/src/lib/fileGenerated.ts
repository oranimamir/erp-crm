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
      const stem = String(op.operation_number || row[kind.numberField] || kind.suffix).replace(/[^A-Za-z0-9._-]+/g, '-');
      const fileName = `${stem}${kind.suffix}.pdf`;
      const r = db.prepare(`INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)`)
        .run(op.id, categoryId(kind.category), row.file_path, fileName, `${kind.note} ${row[kind.numberField] || ''}`.trim());
      db.prepare(`UPDATE ${kind.table} SET operation_id = ?, document_id = ?, file_name = ? WHERE id = ?`)
        .run(op.id, Number(r.lastInsertRowid), fileName, row.id);
      filed++;
    }
  }
  return filed;
}

/** Startup sweep over every operation with an order. */
export function fileAllUnfiledGenerated(): number {
  const ops = db.prepare('SELECT id FROM operations WHERE order_id IS NOT NULL').all() as any[];
  return ops.reduce((n, o) => n + fileGeneratedForOperation(o.id), 0);
}
