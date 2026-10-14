/**
 * Supplier merges that stick.
 *
 * A merge used to rename the invoices and drop the mappings it could find by
 * name — but a mapping remembered at upload is keyed on the name as it was read
 * (often junk from the old regex reader, e.g. "one physical location" shown as
 * "Agilent "), so it survived, and the next upload under the old name brought
 * the duplicate back. Now every merged-away name is kept as an alias
 * (`supplier_aliases`, by normalized name): uploads match it to the kept name
 * (buildSupplierIndex), and `applySupplierAliases` renames any invoice or
 * mapping that still carries an old name (after every change and at startup).
 * "Not the same supplier" answers are kept in `supplier_not_duplicates`.
 */
import db from '../database.js';
import { normalizeSupplierName } from './supplierMatch.js';

/** The details a `suppliers` record carries for documents (purchase orders). */
export const SUPPLIER_DETAIL_FIELDS = ['email', 'phone', 'address', 'vat_number', 'contact_person', 'notes'] as const;

/** How many of a supplier record's details are filled in — the fuller record wins. */
export function detailCount(s: any): number {
  return SUPPLIER_DETAIL_FIELDS.filter(k => typeof s?.[k] === 'string' && s[k].trim()).length;
}

const docCount = (supplierId: number): number =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM supplier_documents WHERE supplier_id = ?').get(supplierId) as any)?.n) || 0;

/** The record to keep among duplicates: most details, then most documents, then `preferName`, then the oldest. */
export function pickKeptSupplier(rows: any[], preferName?: string): any {
  const exact = (s: any) => (preferName && (s.name || '').trim().toLowerCase() === preferName.trim().toLowerCase() ? 1 : 0);
  return [...rows].sort((a, b) => detailCount(b) - detailCount(a) || docCount(b.id) - docCount(a.id) || exact(b) - exact(a) || a.id - b.id)[0];
}

/**
 * Folds duplicate `suppliers` records into `keep`: its blank details filled
 * from the others, then their documents, orders, operations, POs… (every
 * column referencing suppliers(id), and NCO From / To ends) moved to it, and
 * the emptied records removed. Documents are moved first and a record still
 * holding any is never deleted — deleting it would cascade them away.
 */
export function combineSupplierRecords(rows: any[], keep: any): { movedDocuments: number; removed: number } {
  let movedDocuments = 0;
  let removed = 0;
  for (const f of SUPPLIER_DETAIL_FIELDS) {
    if (typeof keep[f] === 'string' && keep[f].trim()) continue;
    const donor = rows.find(s => s.id !== keep.id && typeof s[f] === 'string' && s[f].trim());
    if (donor) db.prepare(`UPDATE suppliers SET ${f} = ? WHERE id = ?`).run(donor[f], keep.id);
  }
  const refTables = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%REFERENCES suppliers%'").all() as any[])
    .map(t => ({ name: t.name as string, cols: [...String(t.sql).matchAll(/FOREIGN KEY \((\w+)\)\s+REFERENCES suppliers\s*\(id\)/g)].map(m => m[1]) }));
  for (const s of rows) {
    if (s.id === keep.id) continue;
    movedDocuments += (db.prepare('UPDATE supplier_documents SET supplier_id = ? WHERE supplier_id = ?').run(keep.id, s.id) as any).changes || 0;
    for (const t of refTables) for (const c of t.cols) {
      if (t.name === 'supplier_documents') continue;
      try { db.prepare(`UPDATE ${t.name} SET ${c} = ? WHERE ${c} = ?`).run(keep.id, s.id); } catch { /* unique clash — leave that row */ }
    }
    for (const side of ['from', 'to']) {
      try {
        db.prepare(`UPDATE non_commercial_operations SET ship_${side}_ref = ? WHERE ship_${side}_kind = 'supplier' AND ship_${side}_ref = ?`)
          .run(String(keep.id), String(s.id));
      } catch { /* table / columns not there yet */ }
    }
    if (docCount(s.id)) continue;
    try {
      db.prepare('DELETE FROM suppliers WHERE id = ?').run(s.id);
      removed++;
    } catch { /* still referenced: kept */ }
  }
  return { movedDocuments, removed };
}

/** Aliases keyed by an older normalization (dotted forms like "S.r.l.") are re-keyed from their name (startup). */
export function rekeyAliases() {
  for (const a of db.prepare('SELECT alias_key, alias_name, canonical FROM supplier_aliases').all() as any[]) {
    const k = supplierKey(a.alias_name);
    if (!k || k === a.alias_key) continue;
    db.prepare('DELETE FROM supplier_aliases WHERE alias_key = ?').run(a.alias_key);
    if (k !== supplierKey(a.canonical)) {
      db.prepare('INSERT OR IGNORE INTO supplier_aliases (alias_key, alias_name, canonical) VALUES (?, ?, ?)').run(k, a.alias_name, a.canonical);
    }
  }
}

/**
 * Several `suppliers` records for one company (same name once case, spacing,
 * punctuation and legal forms are ignored) split its details from its
 * documents — opening it showed one and not the other. Each such group is
 * folded into one record (at startup).
 */
export function consolidateDuplicateSuppliers(): { groups: number; movedDocuments: number } {
  const groups = new Map<string, any[]>();
  for (const s of db.prepare('SELECT * FROM suppliers').all() as any[]) {
    const k = supplierKey(s.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  let combined = 0;
  let movedDocuments = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const r = combineSupplierRecords(rows, pickKeptSupplier(rows));
    combined++;
    movedDocuments += r.movedDocuments;
  }
  return { groups: combined, movedDocuments };
}

export const supplierKey = (name: string | null | undefined): string => normalizeSupplierName((name || '').trim());

/** alias key → the name kept */
export function aliasMap(): Map<string, string> {
  const rows = db.prepare('SELECT alias_key, canonical FROM supplier_aliases').all() as { alias_key: string; canonical: string }[];
  return new Map(rows.map(r => [r.alias_key, r.canonical]));
}

/** Remember that `names` are now `canonical` (and re-point older aliases of those names). */
export function recordAliases(names: string[], canonical: string) {
  const canonKey = supplierKey(canonical);
  if (!canonKey) return;
  const merged = new Map<string, string>();
  for (const n of names) {
    const k = supplierKey(n);
    if (k && k !== canonKey && !merged.has(k)) merged.set(k, n.trim());
  }
  // The kept name is no longer an alias of anything
  db.prepare('DELETE FROM supplier_aliases WHERE alias_key = ?').run(canonKey);
  const upsert = db.prepare('INSERT OR REPLACE INTO supplier_aliases (alias_key, alias_name, canonical) VALUES (?, ?, ?)');
  for (const [k, n] of merged) upsert.run(k, n, canonical);
  // Earlier merges into a name merged away now → the new name
  const repoint = db.prepare('UPDATE supplier_aliases SET canonical = ? WHERE alias_key = ?');
  for (const a of db.prepare('SELECT alias_key, canonical FROM supplier_aliases').all() as any[]) {
    if (merged.has(supplierKey(a.canonical))) repoint.run(canonical, a.alias_key);
  }
  // Merged suppliers are the same: forget any "not the same" answer between them
  const keys = [canonKey, ...merged.keys()];
  const del = db.prepare('DELETE FROM supplier_not_duplicates WHERE key_a = ? AND key_b = ?');
  for (const a of keys) for (const b of keys) if (a < b) del.run(a, b);
}

/** Remember that these suppliers are different companies (every pair). */
export function recordNotDuplicates(names: string[]) {
  const keys = [...new Set(names.map(supplierKey).filter(Boolean))].sort();
  const ins = db.prepare('INSERT OR IGNORE INTO supplier_not_duplicates (key_a, key_b) VALUES (?, ?)');
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) ins.run(keys[i], keys[j]);
}

export function notDuplicatePairs(): Set<string> {
  const rows = db.prepare('SELECT key_a, key_b FROM supplier_not_duplicates').all() as any[];
  return new Set(rows.map(r => `${r.key_a}|${r.key_b}`));
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Put every invoice / mapping still carrying a merged-away name under the kept
 * one. Cheap (one pass over the distinct names); returns the invoices renamed.
 */
export function applySupplierAliases(): number {
  const aliases = aliasMap();
  if (aliases.size === 0) return 0;
  let renamed = 0;
  const names = db.prepare("SELECT DISTINCT supplier FROM demo_invoices WHERE supplier IS NOT NULL AND supplier != ''").all() as { supplier: string }[];
  const upd = db.prepare('UPDATE demo_invoices SET supplier = ? WHERE supplier = ?');
  for (const { supplier } of names) {
    const canonical = aliases.get(supplierKey(supplier));
    if (canonical && canonical !== supplier) renamed += (upd.run(canonical, supplier) as any).changes || 0;
  }
  // Mappings shown under an old name: drop them when the kept name has its own, else rename
  const maps = db.prepare('SELECT id, supplier_pattern, display_name FROM demo_supplier_mappings').all() as any[];
  const shown = (m: any) => (m.display_name || '').trim() || m.supplier_pattern;
  const keptKeys = new Set(maps.map(m => supplierKey(shown(m))).filter(k => k && !aliases.has(k)));
  for (const m of maps) {
    const canonical = aliases.get(supplierKey(shown(m)));
    if (!canonical) continue;
    if (keptKeys.has(supplierKey(canonical))) db.prepare('DELETE FROM demo_supplier_mappings WHERE id = ?').run(m.id);
    else {
      db.prepare('UPDATE demo_supplier_mappings SET display_name = ? WHERE id = ?').run(canonical, m.id);
      keptKeys.add(supplierKey(canonical));
    }
  }
  return renamed;
}

/**
 * Mappings whose shown name differs from an invoice's supplier name only in
 * spacing / case / punctuation ("Agilent " vs "Agilent") take the invoice's
 * spelling, so they never show up as a duplicate of it.
 */
export function tidyMappingNames() {
  const spelled = new Map<string, string>();
  for (const r of db.prepare("SELECT supplier, COUNT(*) as n FROM demo_invoices WHERE supplier IS NOT NULL AND supplier != '' GROUP BY supplier ORDER BY n DESC").all() as any[]) {
    const k = supplierKey(r.supplier);
    if (k && !spelled.has(k)) spelled.set(k, r.supplier);
  }
  const upd = db.prepare('UPDATE demo_supplier_mappings SET display_name = ? WHERE id = ?');
  for (const m of db.prepare("SELECT id, display_name FROM demo_supplier_mappings WHERE display_name IS NOT NULL AND display_name != ''").all() as any[]) {
    const s = spelled.get(supplierKey(m.display_name));
    if (s && s !== m.display_name && s.toLowerCase().replace(/\s+/g, ' ') === m.display_name.trim().toLowerCase().replace(/\s+/g, ' ')) upd.run(s, m.id);
  }
  // One mapping per supplier as shown: several (one per name it was read as) listed
  // the same supplier several times. Keep the one named after it, else the oldest
  const byShown = new Map<string, any[]>();
  for (const m of db.prepare('SELECT id, supplier_pattern, display_name, vat_number FROM demo_supplier_mappings WHERE is_user_defined = 1 ORDER BY id').all() as any[]) {
    const k = supplierKey((m.display_name || '').trim() || m.supplier_pattern);
    if (!k) continue;
    if (!byShown.has(k)) byShown.set(k, []);
    byShown.get(k)!.push(m);
  }
  const del = db.prepare('DELETE FROM demo_supplier_mappings WHERE id = ?');
  for (const [k, maps] of byShown) {
    if (maps.length < 2) continue;
    const keep = maps.find(m => supplierKey(m.supplier_pattern) === k) || maps[0];
    const vat = keep.vat_number || maps.find(m => m.vat_number)?.vat_number;
    if (vat && !keep.vat_number) db.prepare('UPDATE demo_supplier_mappings SET vat_number = ? WHERE id = ?').run(vat, keep.id);
    for (const m of maps) if (m.id !== keep.id) del.run(m.id);
  }
}
