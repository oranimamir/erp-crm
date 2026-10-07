/**
 * Shipping documents every operation needs — each a document category (seeded
 * in server `initializeDatabase()`). The checklist on the operation page and
 * the Send documents dialog read this list.
 */
export const REQUIRED_OPERATION_DOCS = [
  'Quality certificate',
  'Origin certificate',
  'Insurance certificate',
  'Sanitary certificate',
  'Phytosanitary certificate',
  'EUR1',
  'Label',
  'MSDS',
  'Product Specification Sheet',
  'Declaration',
] as const;

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();

/** Older category names that count for a checklist item. */
const ALIASES: Record<string, string[]> = {
  'product specification sheet': ['pds'],
  'declaration': ['declarations'],
};

/** Documents filed under a category (or one of its older names), matched case-insensitively. */
export function docsInCategory<T extends { category_name: string | null }>(docs: T[], category: string): T[] {
  const names = [norm(category), ...(ALIASES[norm(category)] || [])];
  return docs.filter(d => names.includes(norm(d.category_name)));
}

/** The required categories with nothing filed yet. */
export function missingRequired(docs: Array<{ category_name: string | null }>): string[] {
  return REQUIRED_OPERATION_DOCS.filter(c => docsInCategory(docs, c).length === 0);
}

/** Commercial documents first, then the shipping checklist in its order. */
const SENDING_ORDER = ['invoice', 'packing list', 'bill of lading', ...REQUIRED_OPERATION_DOCS.map(norm)];

/**
 * The order documents are listed, numbered and sent in: invoice, packing list,
 * BL, then the checklist (certificates, EUR1, label, MSDS, spec sheet,
 * declarations), then any other category A–Z, then uncategorized; superseded
 * DRAFT PDFs last. Oldest first within a category.
 */
export function sortForSending<T extends { category_name: string | null; file_name: string; created_at?: string; id: number }>(docs: T[]): T[] {
  const rank = (d: T) => {
    if (/-DRAFT\.pdf$/i.test(d.file_name)) return 10_000;
    const c = norm(d.category_name);
    const canonical = Object.entries(ALIASES).find(([, alts]) => alts.includes(c))?.[0] ?? c;
    const i = SENDING_ORDER.indexOf(canonical);
    if (i >= 0) return i;
    return c ? 1_000 : 5_000;
  };
  return [...docs].sort((a, b) =>
    rank(a) - rank(b)
    || norm(a.category_name).localeCompare(norm(b.category_name))
    || (a.created_at || '').localeCompare(b.created_at || '')
    || a.id - b.id);
}

/** "01", "02"… with at least two digits. */
export const docNumber = (i: number, total: number) => String(i + 1).padStart(Math.max(2, String(total).length), '0');
