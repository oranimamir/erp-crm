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
] as const;

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();

/** Documents filed under a category, matched by name (case-insensitive). */
export function docsInCategory<T extends { category_name: string | null }>(docs: T[], category: string): T[] {
  return docs.filter(d => norm(d.category_name) === norm(category));
}

/** The required categories with nothing filed yet. */
export function missingRequired(docs: Array<{ category_name: string | null }>): string[] {
  return REQUIRED_OPERATION_DOCS.filter(c => docsInCategory(docs, c).length === 0);
}
