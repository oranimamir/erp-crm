import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import JSZip from 'jszip';
import db from '../database.js';
import {
  ProductDocKind, productDocsDir, norm, addDocumentProducts, unlinkProductFile,
} from './productDocs.js';

/**
 * Bulk import of the document library (Inventory → Documents → Import ZIP).
 *
 * File names look like `HSE-00-REP-004 - Sodium Circulac and Naturlac liquid
 * Material Safety Data Sheet.pdf`: the code and the title are read off the
 * name. Which products a file covers comes from `DOC_PRODUCTS` (read off the
 * documents themselves — each MSDS lists its trade names), else a spec sheet's
 * title names its product, else any catalogue product named in the title,
 * else it is general. Products the library names that the catalogue lacks are
 * created (Circulac / Naturlac by name, SKU left for the user).
 */

export const LIBRARY_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'];

const both = (codes: string[], prefix = '') =>
  codes.flatMap(c => [`${prefix}Circulac ${c}`, `${prefix}Naturlac ${c}`]);
const midasBoth = (codes: string[]) => codes.flatMap(c => [`Midas Circulac ${c}`, `Midas Naturlac ${c}`]);

/**
 * Title (normalized, without the code) → products. A name ending in `*` is
 * every product whose name starts with it.
 */
const DOC_PRODUCTS: Record<string, string[]> = {
  // MSDS
  'circulac and naturlac lactic acid material safety data sheet': [
    ...both(['CH50', 'HS80', 'HS88', 'HS90', 'LA80', 'LC90', 'LD88', 'LF80', 'LF88', 'PG88', 'SD60']),
    'Circulac LA88', 'Circulac CS80', 'Naturlac HP90',
  ],
  'circulac pla material safety data sheet': ['Circulac PLA SG10'],
  'midas circulac and naturlac sodium lactate sodium diacetate material safety data sheet': midasBoth(['SL04', 'SL05', 'SL10']),
  'sodium circulac and naturlac liquid material safety data sheet': ['Sodium Circulac PI60', 'Sodium Circulac SL60', 'Sodium Naturlac SL60', 'Sodium Circulac TS60'],
  'potassium circulac and naturlac material safety data sheet': ['Potassium Circulac PL60', 'Potassium Naturlac PL60', 'Potassium Naturlac PL80', 'Potassium Circulac AG60', 'Potassium Circulac TP60'],
  'ethyl circulac material safety data sheet': ['Ethyl Circulac EA98', 'Ethyl Circulac EA99', 'Ethyl Circulac EF99', 'Ethyl Circulac*'],
  'sodium circulac and naturlac powder material safety data sheet': both(['S100'], 'Sodium '),
  'magnesium circulac material safety data sheet': both(['ML2H'], 'Magnesium '),
  'calcium naturlac material safety data sheet': ['Calcium Naturlac CG5H', 'Calcium Naturlac CF5H', 'Calcium Circulac CL5H'],
  'ferrous naturlac material safety data sheet': ['Ferrous Naturlac FL2H'],
  'midas naturlac sl38 material safety data sheet': ['Midas Naturlac SL38'],
  'midas naturlac sl50 material safety data sheet': ['Midas Naturlac SL50'],
  'midas naturlac sodium lactate and sodium acetate blends material safety data sheet': ['Midas Naturlac SA38', 'Midas Naturlac SL50'],
  'midas naturlac sodium lactate and sodium acetate powder blends material safety data sheet': ['Midas Naturlac SA38', 'Midas Naturlac SL50'],
  'ammonia naturlac material safety data sheet': both(['AL62'], 'Ammonium '),
  'midas circulac and naturlac potassium lactate sodium diacetate material safety data sheet': [...midasBoth(['PL04', 'PL05', 'PL10']), 'Midas Naturlac KL13'],
  'circulac and naturlac lactic acid powder material safety data sheet': both(['SD60']),
  'midas naturlac adk0 material safety data sheet': ['Midas Naturlac ADK0'],
  'midas naturlac sn30 material safety data sheet': ['Midas Naturlac SN30'],
  'midas circulac potassium lactate potassium acetate blends material safety data sheet': midasBoth(['PP06', 'PP11', 'PP18']),
  'circulac lactide material safety data sheet': ['Circulac Lactide'],
  'midas naturlac buffered vinegar material safety data sheet': ['Naturlac V100'],
  'buffered circulac and naturlac material safety data sheet': both(['BX60'], 'Buffered '),
  'midas naturlac sodium lactate and sodium acetate liquid blends material safety data sheet': ['Midas Naturlac SA10'],
  'naturlac buffered vinegar liquid material safety data sheet': ['Naturlac KV50'],
  'lauryl naturlac material safety data sheet': ['Lauryl Naturlac LL99', 'Lauryl Naturlac*'],
  // Spec-sheet folder documents that aren't a single product's sheet
  'midas circulac sl04 and sl10 external production requirements': ['Midas Circulac SL04', 'Midas Circulac SL10'],
  'ethyl circulac process flow chart': ['Ethyl Circulac*'],
  'external production liquids flow chart': [],
  'product packaging and labelling': [],
  'circulac and naturlac external production requirements': [],
  'circulac and naturlac process flow chart': [],
  'monovalent circulac and naturlac liquid salts process flow chart': [],
  // Declarations
  'lactic acid lf88 composition': ['Circulac LF88', 'Naturlac LF88'],
  'midas naturlac allergen statement': ['Midas Naturlac*'],
  'midas naturlac and midas circulac kl13 composition': midasBoth(['KL13']),
  'midas naturlac and midas circulac pl04 composition': midasBoth(['PL04']),
  'midas naturlac and midas circulac pl10 composition': midasBoth(['PL10']),
  'midas naturlac and midas circulac sl04 composition': midasBoth(['SL04']),
  'midas naturlac and midas circulac sl05 composition': midasBoth(['SL05']),
  'midas naturlac and midas circulac sl10 composition': midasBoth(['SL10']),
  'midas naturlac pl04 nutritional information': ['Midas Naturlac PL04'],
  'midas naturlac sa10 nutritional information': ['Midas Naturlac SA10'],
  'midas naturlac sl04 nutritional information': ['Midas Naturlac SL04'],
  'midas naturlac sl10 nutritional information': ['Midas Naturlac SL10'],
  'naturlac lf88 nutritional information': ['Naturlac LF88'],
  'pesticides statement': [],
  'residual solvents statement': [],
};

/** Named only by a declaration, not a product of its own — linked when it exists, never created. */
const NEVER_CREATE = new Set(['midas circulac kl13']);

/** Every product name the library vouches for (created when the catalogue lacks it). */
const KNOWN_PRODUCTS: string[] = [...new Set(
  Object.values(DOC_PRODUCTS).flat().filter(n => !n.endsWith('*') && !NEVER_CREATE.has(norm(n))),
)];

const SHEET_SUFFIX = / product specification sheet$/i;

/** `HSE-00-REP-004 - Title.pdf` → { code, title } */
export function parseLibraryFileName(fileName: string): { code: string | null; title: string } {
  const base = path.basename(fileName).replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^([A-Z]{2,5}-\d{2}-[A-Z]{2,5}-\d{2,4})\s*-\s*(.+)$/i);
  return m ? { code: m[1].toUpperCase(), title: m[2].trim() } : { code: null, title: base };
}

const CODE_TOKEN = /^[a-z]{1,3}\d[0-9a-z]{0,3}$/;
const brandOf = (name: string, category?: string | null) => {
  const n = norm(name);
  if (/\bcirculac\b/.test(n)) return 'circulac';
  if (/\bnaturlac\b/.test(n)) return 'naturlac';
  return norm(category) || null;
};

interface CatalogueProduct { id: number; name: string; sku: string | null; category: string | null }

/**
 * The catalogue product a library name stands for: the same name, else one of
 * the same brand, Midas or not, carrying the same code (`SL10`, `CG5H`…).
 */
export function findCatalogueProduct(name: string, catalogue: CatalogueProduct[]): CatalogueProduct | null {
  const key = norm(name);
  const exact = catalogue.find(p => norm(p.name) === key);
  if (exact) return exact;
  const tokens = key.split(' ');
  const code = [...tokens].reverse().find(t => CODE_TOKEN.test(t));
  if (!code) return null;
  const brand = brandOf(name);
  const midas = tokens.includes('midas');
  const candidates = catalogue.filter(p => {
    const pt = norm(p.name).split(' ');
    return pt.includes(code) && pt.includes('midas') === midas && brandOf(p.name, p.category) === brand;
  });
  if (candidates.length <= 1) return candidates[0] || null;
  // Several (e.g. "SL60" and "Sodium SL60"): the one sharing the most words
  const score = (p: CatalogueProduct) => norm(p.name).split(' ').filter(t => tokens.includes(t)).length;
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

export interface ImportResult {
  imported: number;
  replaced: number;
  skipped: number;
  productsCreated: string[];
  general: string[];
  ignored: string[];
}

/** Imports every document in a ZIP into the library under `kind`. */
export async function importLibraryZip(buffer: Buffer, kind: ProductDocKind, userId: number | null): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(buffer);
  const result: ImportResult = { imported: 0, replaced: 0, skipped: 0, productsCreated: [], general: [], ignored: [] };
  const catalogue = db.prepare('SELECT id, name, sku, category FROM products').all() as CatalogueProduct[];
  fs.mkdirSync(productDocsDir, { recursive: true });

  const resolve = (name: string, mayCreate: boolean): CatalogueProduct | null => {
    const found = findCatalogueProduct(name, catalogue);
    if (found || !mayCreate) return found;
    const clean = name.trim().replace(/\s+/g, ' ');
    const category = /circulac/i.test(clean) ? 'Circulac' : 'Naturlac';
    const r = db.prepare('INSERT INTO products (name, sku, category, unit, notes) VALUES (?, NULL, ?, ?, ?)')
      .run(clean, category, 'tons', 'Added from the document library — fill in the SKU');
    const created = { id: Number(r.lastInsertRowid), name: clean, sku: null, category };
    catalogue.push(created);
    result.productsCreated.push(clean);
    return created;
  };

  const productsFor = (title: string): number[] => {
    const key = norm(title);
    const mapped = DOC_PRODUCTS[key];
    if (mapped) {
      const ids: number[] = [];
      for (const entry of mapped) {
        if (entry.endsWith('*')) {
          const prefix = `${norm(entry.slice(0, -1))} `;
          for (const n of KNOWN_PRODUCTS) if (norm(n).startsWith(prefix)) resolve(n, true);
          for (const p of catalogue) if (norm(p.name).startsWith(prefix)) ids.push(p.id);
        } else {
          const p = resolve(entry, !NEVER_CREATE.has(norm(entry)));
          if (p) ids.push(p.id);
        }
      }
      return ids;
    }
    if (SHEET_SUFFIX.test(title)) {
      const p = resolve(title.replace(SHEET_SUFFIX, ''), true);
      return p ? [p.id] : [];
    }
    // Unknown document: any catalogue product named in its title
    const text = ` ${key} `;
    return catalogue.filter(p => norm(p.name).length > 3 && text.includes(` ${norm(p.name)} `)).map(p => p.id);
  };

  const entries = Object.values(zip.files)
    .filter(e => !e.dir && !e.name.startsWith('__MACOSX/') && !path.basename(e.name).startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fileName = path.basename(entry.name);
    const ext = path.extname(fileName).toLowerCase();
    if (!LIBRARY_EXTENSIONS.includes(ext)) { result.ignored.push(fileName); continue; }
    const buf = await entry.async('nodebuffer');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const { code, title } = parseLibraryFileName(fileName);

    // The same document again: same code + title (REP-013 has three files
    // under one code), else the same file name
    const existing = (code
      ? (db.prepare('SELECT * FROM product_documents WHERE kind = ? AND doc_code = ?').all(kind, code) as any[])
        .find(d => norm(d.title) === norm(title))
      : db.prepare('SELECT * FROM product_documents WHERE kind = ? AND lower(file_name) = lower(?)').get(kind, fileName)) as any;

    const productIds = productsFor(title);
    let docId: number;
    if (existing && existing.sha256 === sha) {
      result.skipped++;
      docId = existing.id;
    } else {
      const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(productDocsDir, stored), buf);
      if (existing) {
        db.prepare(`UPDATE product_documents SET file_path = ?, file_name = ?, sha256 = ?, uploaded_by = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(stored, fileName, sha, userId, existing.id);
        unlinkProductFile(existing.file_path);
        result.replaced++;
        docId = existing.id;
      } else {
        const r = db.prepare(`
          INSERT INTO product_documents (kind, title, doc_code, file_path, file_name, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(kind, title, code, stored, fileName, sha, userId);
        docId = Number(r.lastInsertRowid);
        result.imported++;
      }
    }
    // Links are only ever added, so links the user set by hand stay
    addDocumentProducts(docId, productIds);
    if (!productIds.length && !existing) result.general.push(title);
  }
  return result;
}
