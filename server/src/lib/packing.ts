/**
 * Packing list maths: which packaging a line ships in, and what it weighs.
 *
 * The packaging comes from Inventory → Packaging (`packaging` table). A line's
 * reference carries the packaging code ("CLNCG5H BU25" → BU25) and its product
 * name picks the row for that product ("Midas Circulac"), which gives the fill
 * per unit, units per pallet, and the empty unit and pallet weights.
 */
import db from '../database.js';

export interface PackagingRow {
  id: number;
  type: string;
  code: string;
  product: string | null;
  product_mass: number | null;
  units_per_pallet: number | null;
  weight_packaging: number | null;
  weight_pallet: number | null;
}

export interface PackingSource {
  reference?: string | null;
  commercial_name?: string | null;
  packaging?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
}

export interface PackingFigures {
  net_kg: number;
  units: number;
  units_per_pallet: number | null;
  pallets: number;
  empty_kg: number;
  pallet_kg: number;
  gross_kg: number;
}

export function listPackaging(): PackagingRow[] {
  try {
    return db.prepare('SELECT * FROM packaging ORDER BY type, code').all() as PackagingRow[];
  } catch {
    return [];
  }
}

export function packagingById(id: number | null | undefined): PackagingRow | null {
  if (!id) return null;
  return (db.prepare('SELECT * FROM packaging WHERE id = ?').get(id) as PackagingRow) ?? null;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How well a packaging row's product list names this line's product; 0 = not at all. */
function productScore(row: PackagingRow, name: string): number {
  const target = ` ${norm(name)} `;
  let best = 0;
  for (const part of String(row.product || '').split(',')) {
    const p = norm(part);
    if (!p) continue;
    if (p === 'all') { best = Math.max(best, 1); continue; }
    if (target.includes(` ${p} `)) best = Math.max(best, 10 + p.length);
  }
  return best;
}

/**
 * The packaging a line ships in. The code in the reference (or packaging text)
 * narrows the rows; the product name ranks them. Several rows can tie — the
 * same bag at 40 or 30 per pallet — so every contender is returned for the
 * user to switch between, the first one chosen.
 */
export function matchPackaging(line: PackingSource, rows = listPackaging()): { best: PackagingRow | null; candidates: PackagingRow[] } {
  const tokens = new Set(
    `${line.reference || ''} ${line.packaging || ''}`.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  );
  const name = line.commercial_name || '';

  const byCode = rows.filter(r => tokens.has(String(r.code || '').toUpperCase()));
  const pool = byCode.length ? byCode : rows;

  const scored = pool
    .map(row => ({ row, score: productScore(row, name) }))
    // Without a code only a real product match counts — never guess from 'ALL'
    .filter(s => byCode.length ? true : s.score > 1)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { best: null, candidates: [] };
  const top = scored[0].score;
  const candidates = scored.filter(s => s.score === top).map(s => s.row);
  // With a code but no product match, every row of that code is a candidate
  return { best: candidates[0] ?? null, candidates: top > 0 || byCode.length ? candidates : [] };
}

/** The line's quantity in kilograms. */
export function netKg(quantity: unknown, unit: unknown): number {
  const q = Number(quantity) || 0;
  const u = String(unit || '').trim().toLowerCase();
  if (['mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't'].includes(u)) return q * 1000;
  if (['lbs', 'lb', 'pound', 'pounds'].includes(u)) return q / 2.2046226218;
  return q;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Units, pallets and weights for one line. Gross = product + empty units +
 * pallets. Units and pallets typed by hand replace the computed counts.
 */
export function computePacking(
  net: number,
  pkg: PackagingRow | null,
  overrides: { units?: number | null; pallets?: number | null } = {}
): PackingFigures {
  const mass = Number(pkg?.product_mass) || 0;
  const perPallet = Number(pkg?.units_per_pallet) || 0;
  const computedUnits = mass > 0 ? Math.ceil(net / mass - 1e-9) : 0;
  const units = overrides.units != null && overrides.units >= 0 ? overrides.units : computedUnits;
  const computedPallets = perPallet > 0 ? Math.ceil(units / perPallet - 1e-9) : 0;
  const pallets = overrides.pallets != null && overrides.pallets >= 0 ? overrides.pallets : computedPallets;
  const empty = units * (Number(pkg?.weight_packaging) || 0);
  const palletKg = pallets * (Number(pkg?.weight_pallet) || 0);
  return {
    net_kg: round(net),
    units,
    units_per_pallet: perPallet || null,
    pallets,
    empty_kg: round(empty),
    pallet_kg: round(palletKg),
    gross_kg: round(net + empty + palletKg),
  };
}
