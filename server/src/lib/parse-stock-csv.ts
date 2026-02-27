import db from '../database.js';

interface StockMeta {
  filename?: string;
  uploadedBy: string;
  source: 'manual' | 'email';
}

/**
 * Parse a warehouse stock CSV string and replace all warehouse_stock rows.
 * Logs the upload to warehouse_stock_uploads.
 * Returns the number of rows inserted, or throws on validation error.
 */
export function parseAndInsertStockCsv(content: string, meta: StockMeta): number {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length < 2) throw new Error('File is empty or has no data rows');

  const headerLine = lines[0];
  const delimiter = headerLine.includes(';') ? ';' : ',';
  const headers = headerLine.split(delimiter).map(h => h.toLowerCase().trim());

  const idx = {
    whs:          headers.indexOf('whs'),
    location:     headers.indexOf('location'),
    principal:    headers.indexOf('principal'),
    article:      headers.indexOf('article'),
    searchname:   headers.indexOf('searchname'),
    description:  headers.indexOf('description'),
    stock:        headers.indexOf('stock'),
    pc:           headers.indexOf('pc'),
    gross_weight: headers.indexOf('gross weight'),
    nett_weight:  headers.indexOf('nett weight'),
  };

  if (idx.article === -1) throw new Error('CSV missing required column "article"');

  const now = new Date().toISOString();

  db.exec('DELETE FROM warehouse_stock');

  const insert = db.prepare(`
    INSERT INTO warehouse_stock (whs, location, principal, article, searchname, description, stock, pc, gross_weight, nett_weight, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter);
    if (cols.length < 2) continue;

    const article = cols[idx.article]?.trim();
    if (!article) continue;

    insert.run(
      idx.whs          >= 0 ? cols[idx.whs]?.trim()            || null : null,
      idx.location     >= 0 ? cols[idx.location]?.trim()        || null : null,
      idx.principal    >= 0 ? cols[idx.principal]?.trim()       || null : null,
      article,
      idx.searchname   >= 0 ? cols[idx.searchname]?.trim()      || null : null,
      idx.description  >= 0 ? cols[idx.description]?.trim()     || null : null,
      idx.stock        >= 0 ? parseInt(cols[idx.stock])          || 0   : 0,
      idx.pc           >= 0 ? cols[idx.pc]?.trim()               || null : null,
      idx.gross_weight >= 0 ? parseFloat(cols[idx.gross_weight]) || null : null,
      idx.nett_weight  >= 0 ? parseFloat(cols[idx.nett_weight])  || null : null,
      now,
    );
    inserted++;
  }

  db.prepare(`
    INSERT INTO warehouse_stock_uploads (uploaded_at, rows_imported, filename, uploaded_by, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(now, inserted, meta.filename || null, meta.uploadedBy, meta.source);

  return inserted;
}
