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
  /** Matched by the grade code inside the reference rather than by name (e.g. CLNCG5H → Calcium Naturlac CG5H). */
  by_code?: boolean;
}

/** Reference family letters → the word that names it in a product (to tell candidates apart). */
const FAMILY_WORD: Record<string, string> = {
  sl: 'sodium', pl: 'potassium', ml: 'midas', cl: 'calcium', fl: 'ferrous', zl: 'zinc', al: 'ammonium', el: 'ethyl', ll: 'lauryl',
};

/**
 * A reference is family (2 letters) + brand letter (C = Circulac, N = Naturlac)
 * + grade code: LAC·LA80, MLN·SL10, CLN·CG5H. The catalogue product with that
 * grade code and brand, when there is exactly one (the family word decides
 * between several).
 */
function byReference(sku: string, candidates: Array<{ id: number; name: string; sku: string | null }>) {
  const ref = sku.toLowerCase();
  const brand = ref[2] === 'c' ? 'circulac' : ref[2] === 'n' ? 'naturlac' : '';
  const grade = ref.slice(3);
  if (!brand || grade.length < 2) return null;
  let hits = candidates.filter(p => { const s = signature(p.name); return s.code === grade && s.brand === brand; });
  if (hits.length > 1) {
    const word = FAMILY_WORD[ref.slice(0, 2)];
    hits = word ? hits.filter(p => norm(p.name).split(' ').includes(word)) : hits.filter(p => !Object.values(FAMILY_WORD).some(w => norm(p.name).split(' ').includes(w)));
  }
  return hits.length === 1 ? hits[0] : null;
}

export interface SkuPreview {
  rows: SkuPreviewRow[];
  /** Catalogue products still without a SKU that no row of the file matched. */
  unfilled: Array<{ id: number; name: string }>;
}

export function previewSkus(pairs: Array<{ name: string; sku: string; sheet: string }>): SkuPreview {
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
    return { pair, product, byCode: false };
  });
  // Rows no name matched: by the grade code in their reference, among the products still unmatched
  const taken = new Set(matched.flatMap(m => (m.product ? [m.product.id] : [])));
  for (const m of matched) {
    if (m.product) continue;
    const hit = byReference(m.pair.sku, products.filter(p => !taken.has(p.id)));
    if (hit) { m.product = hit; m.byCode = true; taken.add(hit.id); }
  }
  // The SKU each product ends with after this import, so a code moving from one
  // product to another in the same file is not a conflict
  const after = new Map(products.map(p => [p.id, (p.sku || '').toUpperCase()]));
  for (const m of matched) if (m.product) after.set(m.product.id, m.pair.sku.toUpperCase());

  const rows = matched.map(({ pair, product, byCode }): SkuPreviewRow => {
    if (!product) return { ...pair, product: null, status: 'not_found' };
    const by_code = byCode || undefined;
    const holder = bySku.get(pair.sku.toUpperCase());
    if (holder && holder.id !== product.id && after.get(holder.id) === pair.sku.toUpperCase()) {
      return { ...pair, product, status: 'conflict', conflict_with: holder.name, by_code };
    }
    const status = !product.sku ? 'set' : product.sku.toUpperCase() === pair.sku.toUpperCase() ? 'same' : 'change';
    return { ...pair, product, status, by_code };
  });
  const unfilled = products
    .filter(p => !p.sku && !taken.has(p.id))
    .map(p => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, unfilled };
}
