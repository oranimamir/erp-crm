import ExcelJS from 'exceljs';
import db from '../database.js';

interface StockMeta {
  filename?: string;
  uploadedBy: string;
  source: 'manual' | 'email';
  /** The warehouse whose stock this file is; only its rows are replaced. */
  warehouseId: number;
}

interface InsertResult {
  inserted: number;
  missingBatches: string[]; // batch numbers in the file not in Batches (flagged, never created)
}

/** The warehouse the emailed stock CSV belongs to: NTG, else the first one. */
export function emailWarehouseId(): number | null {
  const row = (db.prepare(`SELECT id FROM warehouses WHERE name = 'NTG'`).get()
    ?? db.prepare('SELECT MIN(id) AS id FROM warehouses').get()) as any;
  return row?.id ?? null;
}

/** Batch numbers in the stock (one warehouse, or all) that are not in Batches. */
export function missingBatchesInStock(warehouseId?: number | null): Array<{ batch_number: string; description: string | null; warehouses: string }> {
  const where = warehouseId ? 'AND ws.warehouse_id = ?' : '';
  return db.prepare(`
    SELECT ws.batch_number, MAX(ws.description) AS description, GROUP_CONCAT(DISTINCT w.name) AS warehouses
    FROM warehouse_stock ws LEFT JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.batch_number IS NOT NULL AND TRIM(ws.batch_number) != '' ${where}
      AND NOT EXISTS (SELECT 1 FROM batches b WHERE UPPER(TRIM(b.batch_number)) = UPPER(TRIM(ws.batch_number)))
    GROUP BY UPPER(TRIM(ws.batch_number))
    ORDER BY ws.batch_number
  `).all(...(warehouseId ? [warehouseId] : [])) as any[];
}

/** The rows of a CSV (comma or semicolon) file. */
function csvRows(content: string): string[][] {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  return lines.map(l => l.split(delimiter).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
}

/** The rows of the first worksheet of an Excel file, as text. */
export async function excelRows(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, row => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v: any = cell.value;
      const text = v == null ? '' : typeof v === 'object'
        ? (v.result ?? v.text ?? (v.richText ? v.richText.map((r: any) => r.text).join('') : (v instanceof Date ? v.toISOString().slice(0, 10) : '')))
        : v;
      cells[col - 1] = String(text ?? '').trim();
    });
    rows.push(Array.from(cells, c => c ?? ''));
  });
  return rows;
}

/** CSV text in, rows of one warehouse replaced. */
export function parseAndInsertStockCsv(content: string, meta: StockMeta): InsertResult {
  return insertStockRows(csvRows(content), meta);
}

/**
 * Replaces one warehouse's stock with the rows of a file (header row first) and
 * logs the upload. Batches are never created or changed: batch numbers that
 * are not in Batches are only returned, to be flagged.
 */
export function insertStockRows(rows: string[][], meta: StockMeta): InsertResult {
  if (rows.length < 2) throw new Error('File is empty or has no data rows');
  if (!meta.warehouseId || !db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(meta.warehouseId)) {
    throw new Error('Choose the warehouse this stock belongs to');
  }

  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());

  // Find first matching header name (case-insensitive, already lowercased)
  const findCol = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const idx = {
    whs:          headers.indexOf('whs'),
    location:     headers.indexOf('location'),
    principal:    headers.indexOf('principal'),
    article:      findCol('article', 'article number', 'article no', 'item', 'item code'),
    searchname:   headers.indexOf('searchname'),
    description:  headers.indexOf('description'),
    stock:        findCol('stock', 'quantity', 'qty'),
    pc:           headers.indexOf('pc'),
    gross_weight: findCol('gross weight', 'grossweight', 'gross wt', 'grosswt'),
    nett_weight:  findCol('nett weight', 'nettweight', 'net weight', 'netweight', 'nett wt', 'net wt'),
    batch_number: findCol('batch', 'batch number', 'batchnumber', 'lot', 'lot number', 'lotnumber', 'lot no', 'batch no', 'lotnr', 'batchnr', 'batch nr', 'lot nr'),
  };

  if (idx.article === -1) throw new Error('File missing required column "article"');

  const now = new Date().toISOString();
  const cell = (cols: string[], i: number) => (i >= 0 ? String(cols[i] ?? '').trim() : '');
  const num = (v: string) => { const n = parseFloat(v.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.')); return Number.isFinite(n) ? n : null; };

  const insert = db.prepare(`
    INSERT INTO warehouse_stock (warehouse_id, whs, location, principal, article, searchname, description, stock, pc, gross_weight, nett_weight, batch_number, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Wrap DELETE + INSERT in a transaction so a failed upload never leaves the warehouse empty
  let inserted = 0;
  const batchNumbers = new Set<string>();
  const doImport = db.transaction(() => {
    db.prepare('DELETE FROM warehouse_stock WHERE warehouse_id = ?').run(meta.warehouseId);
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      if (!cols || cols.filter(Boolean).length < 2) continue;
      const article = cell(cols, idx.article);
      if (!article) continue;
      const batch = cell(cols, idx.batch_number);
      if (batch) batchNumbers.add(batch);
      insert.run(
        meta.warehouseId,
        cell(cols, idx.whs) || null,
        cell(cols, idx.location) || null,
        cell(cols, idx.principal) || null,
        article,
        cell(cols, idx.searchname) || null,
        cell(cols, idx.description) || null,
        Math.round(num(cell(cols, idx.stock)) ?? 0),
        cell(cols, idx.pc) || null,
        num(cell(cols, idx.gross_weight)),
        num(cell(cols, idx.nett_weight)),
        batch || null,
        now,
      );
      inserted++;
    }
    db.prepare(`
      INSERT INTO warehouse_stock_uploads (uploaded_at, rows_imported, filename, uploaded_by, source, warehouse_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(now, inserted, meta.filename || null, meta.uploadedBy, meta.source, meta.warehouseId);
  });
  doImport();

  // Batch numbers in the file that are not in Batches — flagged only
  const known = new Set((db.prepare('SELECT batch_number FROM batches').all() as any[]).map(b => String(b.batch_number).trim().toUpperCase()));
  const missingBatches = [...batchNumbers].filter(b => !known.has(b.toUpperCase())).sort();

  return { inserted, missingBatches };
}
