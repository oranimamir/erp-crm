import ExcelJS from 'exceljs';
import db from '../database.js';
import { cellText } from './excel-helpers.js';

/**
 * Products → Import SKUs: reads every "commercial name | reference" pair off
 * a workbook (TripleW's packaging list: "Products and codes" — blocks of
 * `Commercial names | Reference | <packaging codes>` side by side), then
 * matches each name to a catalogue product. Only SKUs are filled or changed;
 * products are never created or removed here.
 */

/** A product reference: LACLA80, VBNV100, CLNCL5H — never a packaging code (PU25) or "LACLA80 PU25". */
const REFERENCE = /^[A-Z]{3,6}[A-Z0-9]{2,4}$/;
const PACKAGING = /^[A-Z]{2}\d{2}$/;
const HEADER = /^(reference|commercial names?|packaging( type)?|product family)$/i;

export function readSkuPairs(rows: string[][]): Array<{ name: string; sku: string }> {
  const out = new Map<string, string>();
  for (const cells of rows) {
    for (let i = 0; i < cells.length - 1; i++) {
      const name = (cells[i] || '').replace(/\s+/g, ' ').trim();
      const sku = (cells[i + 1] || '').trim();
      if (!name || !sku || !name.includes(' ') || HEADER.test(name) || /^packaging/i.test(name)) continue;
      if (!REFERENCE.test(sku) || PACKAGING.test(sku) || REFERENCE.test(name.replace(/\s+/g, ''))) continue;
      if (!out.has(name)) out.set(name, sku);
    }
  }
  return [...out].map(([name, sku]) => ({ name, sku }));
}

export async function readWorkbookPairs(buffer: Buffer): Promise<Array<{ name: string; sku: string; sheet: string }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const seen = new Set<string>();
  const out: Array<{ name: string; sku: string; sheet: string }> = [];
  // The "Products and codes" sheet first when there is one, then the others
  const sheets = [...wb.worksheets].sort((a, b) => Number(/product.*code/i.test(b.name)) - Number(/product.*code/i.test(a.name)));
  for (const ws of sheets) {
    if (/obsolete/i.test(ws.name)) continue;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    });
    for (const p of readSkuPairs(rows)) {
      const key = p.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...p, sheet: ws.name });
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** "Naturlac CH-50" and "Naturlac CH50" alike. */
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const BRANDS = ['circulac', 'naturlac'];

/** Brand + the grade code + the other words, for matching "Midas Naturlac SL10" whatever the spacing. */
function signature(name: string) {
  const words = norm(name).split(' ').filter(Boolean);
  const brand = words.find(w => BRANDS.includes(w)) || '';
  const code = words.find(w => /\d/.test(w)) || '';
  const rest = words.filter(w => w !== brand && w !== code).sort().join(' ');
  return { brand, code, rest };
}

export interface SkuPreviewRow {
  name: string;
  sku: string;
  sheet: string;
  product: { id: number; name: string; sku: string | null } | null;
  /** set: product has no SKU · change: a different SKU · same: already this · not_found · conflict: SKU used by another product */
  status: 'set' | 'change' | 'same' | 'not_found' | 'conflict';
  conflict_with?: string;
}

export function previewSkus(pairs: Array<{ name: string; sku: string; sheet: string }>): SkuPreviewRow[] {
  const products = db.prepare('SELECT id, name, sku FROM products').all() as Array<{ id: number; name: string; sku: string | null }>;
  const byName = new Map(products.map(p => [norm(p.name), p]));
  const byCompact = new Map(products.map(p => [compact(p.name), p]));
  const bySku = new Map(products.filter(p => p.sku).map(p => [p.sku!.toUpperCase(), p]));

  const matched = pairs.map(pair => {
    let product = byName.get(norm(pair.name)) ?? byCompact.get(compact(pair.name)) ?? null;
    if (!product) {
      const want = signature(pair.name);
      const hits = products.filter(p => {
        const s = signature(p.name);
        return want.code && s.code === want.code && s.brand === want.brand && s.rest === want.rest;
      });
      product = hits.length === 1 ? hits[0] : null;
    }
    return { pair, product };
  });
  // The SKU each product ends with after this import, so a code moving from one
  // product to another in the same file is not a conflict
  const after = new Map(products.map(p => [p.id, (p.sku || '').toUpperCase()]));
  for (const m of matched) if (m.product) after.set(m.product.id, m.pair.sku.toUpperCase());

  return matched.map(({ pair, product }): SkuPreviewRow => {
    if (!product) return { ...pair, product: null, status: 'not_found' };
    const holder = bySku.get(pair.sku.toUpperCase());
    if (holder && holder.id !== product.id && after.get(holder.id) === pair.sku.toUpperCase()) {
      return { ...pair, product, status: 'conflict', conflict_with: holder.name };
    }
    const status = !product.sku ? 'set' : product.sku.toUpperCase() === pair.sku.toUpperCase() ? 'same' : 'change';
    return { ...pair, product, status };
  });
}
