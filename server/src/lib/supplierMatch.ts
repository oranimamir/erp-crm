/**
 * Allocates a supplier invoice to an existing supplier, and through it to the
 * Demo or Sales domain and a category.
 *
 * Order (first hit wins):
 *   1. VAT number on the invoice vs. suppliers, remembered mappings, earlier invoices
 *   2. Name: exact once legal forms / punctuation are dropped, then whole-word
 *      containment, then near spelling ("Brentag" ~ "Brenntag") — checked against
 *      the user's remembered mappings, the Suppliers list (Sales), earlier
 *      invoices and the built-in demo list, in that order
 *   3. The supplier Claude picked from our list while reading the invoice
 * Short names ("ey", "gas", "kbc") only ever match as whole words.
 */
import db from '../database.js';

export const DEMO_SUPPLIER_MAP: { pattern: string; category: string }[] = [
  // Salaries — Acerta always first, highest priority
  { pattern: 'acerta', category: 'Salaries' },
  { pattern: 'dutch taxes', category: 'Salaries' },
  // Cars
  { pattern: 'directlease', category: 'Cars' },
  { pattern: 'ciac', category: 'Cars' },
  { pattern: 'gas', category: 'Cars' },
  { pattern: 'blossom', category: 'Cars' },
  { pattern: 'modalizzy', category: 'Cars' },
  // Overhead
  { pattern: 'fruitsnack', category: 'Overhead' },
  { pattern: 'clean shark', category: 'Overhead' },
  { pattern: 'supermarket', category: 'Overhead' },
  { pattern: 'katy corluy', category: 'Overhead' },
  { pattern: 'internet', category: 'Overhead' },
  { pattern: 'proximus', category: 'Overhead' },
  { pattern: 'afval alternatief', category: 'Overhead' },
  { pattern: 'kbc', category: 'Overhead' },
  { pattern: 'port of antwerp', category: 'Overhead' },
  { pattern: 'citymesh flex', category: 'Overhead' },
  { pattern: 'arivic', category: 'Overhead' },
  { pattern: 'spirax sarco', category: 'Overhead' },
  { pattern: 'toolmax', category: 'Overhead' },
  // Consumables
  { pattern: 'gemu', category: 'Consumables' },
  { pattern: 'roth', category: 'Consumables' },
  { pattern: 'avantor', category: 'Consumables' },
  { pattern: 'vwr', category: 'Consumables' },
  { pattern: 'endress hauser', category: 'Consumables' },
  { pattern: 'proforto', category: 'Consumables' },
  { pattern: 'merck', category: 'Consumables' },
  { pattern: 'bruco', category: 'Consumables' },
  { pattern: 'klium', category: 'Consumables' },
  // Materials
  { pattern: 'durme natie', category: 'Materials' },
  { pattern: 'lyphar', category: 'Materials' },
  { pattern: 'brentag', category: 'Materials' },
  { pattern: 'brenntag', category: 'Materials' },
  { pattern: 'azelis', category: 'Materials' },
  { pattern: 'altec', category: 'Materials' },
  { pattern: 'fisher scientific', category: 'Materials' },
  { pattern: 'imcd', category: 'Materials' },
  { pattern: 'ractem', category: 'Materials' },
  // Utilities and Maintenance
  { pattern: 'bbc', category: 'Utilities and Maintenance' },
  { pattern: 'bolt', category: 'Utilities and Maintenance' },
  { pattern: 'water link', category: 'Utilities and Maintenance' },
  { pattern: 'ecoson', category: 'Utilities and Maintenance' },
  { pattern: 'eriks', category: 'Utilities and Maintenance' },
  { pattern: 'gea', category: 'Utilities and Maintenance' },
  { pattern: 'cebeo', category: 'Utilities and Maintenance' },
  { pattern: 'fabory', category: 'Utilities and Maintenance' },
  { pattern: 'conrad', category: 'Utilities and Maintenance' },
  { pattern: 'renewi', category: 'Utilities and Maintenance' },
  { pattern: 'dewofire', category: 'Utilities and Maintenance' },
  { pattern: 'de smedt', category: 'Utilities and Maintenance' },
  // Feedstock
  { pattern: 'looop', category: 'Feedstock' },
  { pattern: 'vandemoortel', category: 'Feedstock' },
  // Subcontractors and Consultants
  { pattern: 'growth', category: 'Subcontractors and Consultants' },
  { pattern: 'bratavi', category: 'Subcontractors and Consultants' },
  { pattern: 'cerda', category: 'Subcontractors and Consultants' },
  { pattern: 'idewe', category: 'Subcontractors and Consultants' },
  { pattern: 'ey', category: 'Subcontractors and Consultants' },
  { pattern: '10am', category: 'Subcontractors and Consultants' },
  { pattern: 'one4finance', category: 'Subcontractors and Consultants' },
  { pattern: 'argo law', category: 'Subcontractors and Consultants' },
  { pattern: 'regionis', category: 'Subcontractors and Consultants' },
  { pattern: 'vta', category: 'Subcontractors and Consultants' },
  // Regulatory
  { pattern: 'apeiron', category: 'Regulatory' },
  { pattern: 'normec', category: 'Regulatory' },
  { pattern: 'profex', category: 'Regulatory' },
  { pattern: 'echa', category: 'Regulatory' },
  { pattern: 'corbion', category: 'Regulatory' },
  // Equipment
  { pattern: 'foeth', category: 'Equipment' },
  { pattern: 'rvs', category: 'Equipment' },
  { pattern: 'smolders', category: 'Equipment' },
  { pattern: 'thyssenkruyp', category: 'Equipment' },
  { pattern: 'thyssenkrupp', category: 'Equipment' },
  { pattern: 'denios', category: 'Equipment' },
  { pattern: 'eurodia', category: 'Equipment' },
  { pattern: 'agidens', category: 'Equipment' },
  // Couriers
  { pattern: 'dhl', category: 'Couriers' },
  { pattern: 'fedex', category: 'Couriers' },
  // Other
  { pattern: 'ais antwerp', category: 'Other' },
];

// Sales Activities category labels to DB category values
export const SALES_CAT_DB_MAP: Record<string, string> = {
  logistics: 'Logistics',
  blenders: 'Blenders',
  raw_materials: 'Raw Materials',
  shipping: 'Shipping',
};


export interface SupplierMatch {
  /** Name to store: the existing supplier's name when one was found */
  supplierName: string;
  domain: 'demo' | 'sales';
  category: string;
  matchedBy: 'vat' | 'mapping' | 'supplier' | 'history' | 'builtin' | 'ai';
}

interface Candidate {
  source: 'mapping' | 'supplier' | 'history' | 'builtin';
  names: string[];           // every name / pattern this candidate answers to
  canonical: string | null;  // name to store; null keeps the invoice's own name
  vat: string | null;
  domain: 'demo' | 'sales';
  category: string;
}

export interface SupplierIndex { candidates: Candidate[] }

const LEGAL_FORMS = new Set([
  'bv', 'bvba', 'nv', 'sa', 'sarl', 'sprl', 'srl', 'ltd', 'limited', 'gmbh', 'inc', 'llc', 'spa', 'plc',
  'co', 'corp', 'corporation', 'company', 'ag', 'sas', 'cv', 'cvba', 'vof', 'commv', 'comm', 'kg', 'se', 'oy', 'ab',
]);

/** Lowercase words without accents, punctuation or legal forms ("B.V.", "S.A./N.V."). */
export function supplierTokens(s: string): string[] {
  const words = (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // join dotted abbreviations first so "B.V." → "bv", "N.V." → "nv"
    .replace(/\b([a-z])\.([a-z])\.?(?![a-z])/g, '$1$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const kept = words.filter(w => !LEGAL_FORMS.has(w));
  return kept.length ? kept : words;
}

export function normalizeSupplierName(s: string): string {
  return supplierTokens(s).join('');
}

export function normalizeVat(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Belgian numbers are often printed without the country code
  if (/^0\d{9}$/.test(n)) return 'BE' + n;
  return n.length >= 8 ? n : null;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** True when the words of `needle` appear side by side in `hay`. */
function containsWords(hay: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, k) => hay[i + k] === w)) return true;
  }
  // Also accept the words glued together ("water link" ↔ "waterlink")
  const glued = needle.join('');
  return needle.length > 1 && glued.length >= 5 && hay.some(w => w === glued);
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 0 : 1 - levenshtein(a, b) / max;
}

/** Snapshot of everything we can match against. Build once per upload. */
export function buildSupplierIndex(): SupplierIndex {
  const candidates: Candidate[] = [];

  const mappings = db.prepare('SELECT supplier_pattern, domain, category, display_name, vat_number FROM demo_supplier_mappings').all() as any[];
  for (const m of mappings) {
    candidates.push({
      source: 'mapping',
      names: [m.supplier_pattern, m.display_name].filter(Boolean),
      canonical: m.display_name || null,
      vat: normalizeVat(m.vat_number),
      domain: m.domain === 'sales' ? 'sales' : 'demo',
      category: m.category,
    });
  }

  const suppliers = db.prepare('SELECT name, category, vat_number FROM suppliers').all() as any[];
  for (const s of suppliers) {
    if (!s.name) continue;
    candidates.push({
      source: 'supplier',
      names: [s.name],
      canonical: s.name,
      vat: normalizeVat(s.vat_number),
      domain: 'sales',
      category: SALES_CAT_DB_MAP[s.category] || s.category,
    });
  }

  // Earlier invoices: each supplier name with the domain/category it was filed under most
  const history = db.prepare(`
    SELECT supplier, domain, category, COUNT(*) as cnt, MAX(supplier_vat) as vat
    FROM demo_invoices WHERE supplier IS NOT NULL AND supplier != '' AND supplier != 'Unknown'
    GROUP BY supplier, domain, category ORDER BY cnt DESC
  `).all() as any[];
  const seen = new Set<string>();
  for (const h of history) {
    const key = h.supplier.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      source: 'history',
      names: [h.supplier],
      canonical: h.supplier,
      vat: normalizeVat(h.vat),
      domain: h.domain === 'sales' ? 'sales' : 'demo',
      category: h.category,
    });
  }

  for (const { pattern, category } of DEMO_SUPPLIER_MAP) {
    candidates.push({ source: 'builtin', names: [pattern], canonical: null, vat: null, domain: 'demo', category });
  }
  return { candidates };
}

/** Names Claude may pick from when reading an invoice (with VAT numbers where known). */
export function knownSupplierList(index: SupplierIndex): { name: string; vat: string | null }[] {
  const out = new Map<string, { name: string; vat: string | null }>();
  for (const c of index.candidates) {
    if (!c.canonical) continue;
    const key = c.canonical.toLowerCase();
    const cur = out.get(key);
    if (!cur) out.set(key, { name: c.canonical, vat: c.vat });
    else if (c.vat && !cur.vat) cur.vat = c.vat;
  }
  return [...out.values()];
}

function toMatch(c: Candidate, invoiceName: string, matchedBy: SupplierMatch['matchedBy']): SupplierMatch {
  return { supplierName: c.canonical || invoiceName, domain: c.domain, category: c.category, matchedBy };
}

export function matchSupplier(
  index: SupplierIndex,
  opts: { name: string; vat?: string | null; aiMatch?: string | null },
): SupplierMatch | null {
  const name = (opts.name || '').trim();
  // Acerta (payroll) always goes to Demo / Salaries
  if (/\bacerta\b/i.test(name)) return { supplierName: name, domain: 'demo', category: 'Salaries', matchedBy: 'builtin' };

  // 1. VAT number
  const vat = normalizeVat(opts.vat);
  if (vat) {
    const hit = index.candidates.find(c => c.vat && c.vat === vat);
    if (hit) return toMatch(hit, name, 'vat');
  }

  // Claude's pick from the list it was given (a known supplier with a stored name)
  const ai = opts.aiMatch?.toLowerCase().trim();
  const aiHit = ai ? index.candidates.find(c => c.canonical && c.canonical.toLowerCase().trim() === ai) : undefined;
  // A built-in keyword only gives a category, not a stored supplier: when Claude
  // recognised the exact existing supplier, file it under that one instead
  const nameMatch = (c: Candidate): SupplierMatch =>
    c.source === 'builtin' && aiHit ? toMatch(aiHit, name, 'ai') : toMatch(c, name, c.source);

  const invTokens = supplierTokens(name);
  const invCompact = invTokens.join('');

  if (invCompact.length >= 2) {
    // 2a. Same name once legal forms and punctuation are dropped
    for (const c of index.candidates) {
      if (c.names.some(n => normalizeSupplierName(n) === invCompact)) return nameMatch(c);
    }

    // 2b. Whole-word containment; the longest (most specific) name wins,
    //     ties go to the earlier source (mapping > supplier > history > built-in)
    let best: { c: Candidate; len: number } | null = null;
    for (const c of index.candidates) {
      for (const n of c.names) {
        const t = supplierTokens(n);
        const compact = t.join('');
        if (compact.length < 2) continue;
        // candidate inside the invoice name ("Brenntag" in "Brenntag Nederland")
        const candInInvoice = containsWords(invTokens, t);
        // invoice name inside the candidate — only for a meaningful invoice name
        const invoiceInCand = invCompact.length >= 5 && containsWords(t, invTokens);
        if ((candInInvoice || invoiceInCand) && (!best || compact.length > best.len)) best = { c, len: compact.length };
      }
    }
    if (best) return nameMatch(best.c);

    // 2c. Near spelling of the whole name (typos, a missing letter)
    if (invCompact.length >= 5) {
      let fuzzy: { c: Candidate; score: number } | null = null;
      for (const c of index.candidates) {
        for (const n of c.names) {
          const compact = normalizeSupplierName(n);
          if (compact.length < 5) continue;
          const score = similarity(invCompact, compact);
          if (score >= 0.85 && (!fuzzy || score > fuzzy.score)) fuzzy = { c, score };
        }
      }
      if (fuzzy) return nameMatch(fuzzy.c);
    }
  }

  // 3. Claude's pick from the list it was given
  if (aiHit) return toMatch(aiHit, name, 'ai');
  return null;
}
