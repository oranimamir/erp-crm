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
  /** Content of one unit. */
  unit_net_kg: number;
  /** Empty packaging of one unit. */
  unit_packaging_kg: number;
  /** Content + packaging of one unit. */
  unit_gross_kg: number;
  /** Units per pallet × unit net weight. */
  pallet_net_kg: number;
  /** Units per pallet × unit gross weight + the pallet itself. */
  pallet_gross_kg: number;
  /** What one empty pallet weighs. */
  pallet_weight_kg: number;
  empty_kg: number;
  pallet_kg: number;
  /** Empty units + pallets, as computed. */
  computed_packaging_kg: number;
  /** Gross − net: the computed packaging weight unless typed by hand. */
  packaging_kg: number;
  gross_kg: number;
}

/** Every figure a packing-list line can be given by hand (null = calculated). */
export interface PackingOverrides {
  net_weight?: number | null;
  unit_net?: number | null;
  unit_packaging?: number | null;
  units_per_pallet?: number | null;
  units?: number | null;
  pallets?: number | null;
  pallet_weight?: number | null;
  packaging_weight?: number | null;
  gross_weight?: number | null;
  pallet_net?: number | null;
  pallet_gross?: number | null;
}

/** An empty pallet, unless the line says otherwise. */
export const DEFAULT_PALLET_KG = 20;

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

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Units, pallets and weights for one line.
 *   Net weight (unit)    = content
 *   Gross weight (unit)  = content + packaging
 *   Pallet net weight    = units per pallet × unit net
 *   Pallet gross weight  = units per pallet × unit gross + pallet (20 kg unless set)
 * The line's gross = net + packaging weight (empty units + pallets, unless
 * typed). Anything typed by hand wins and what follows from it is recomputed:
 * a typed net weight drives the units, a typed content per unit / units per
 * pallet drive units / pallets, a typed gross sets packaging = gross − net.
 * Same maths as client/src/lib/packing.ts.
 */
export function computePacking(net0: number, pkg: PackagingRow | null, o: PackingOverrides = {}): PackingFigures {
  const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v >= 0;
  const net = ok(o.net_weight) ? o.net_weight : net0;
  const mass = ok(o.unit_net) ? o.unit_net : (Number(pkg?.product_mass) || 0);
  const perPallet = ok(o.units_per_pallet) ? o.units_per_pallet : (Number(pkg?.units_per_pallet) || 0);
  const packagingKg = ok(o.unit_packaging) ? o.unit_packaging : (Number(pkg?.weight_packaging) || 0);
  const palletWeight = ok(o.pallet_weight) ? o.pallet_weight : DEFAULT_PALLET_KG;
  const computedUnits = mass > 0 ? Math.ceil(net / mass - 1e-9) : 0;
  const units = ok(o.units) ? o.units : computedUnits;
  const computedPallets = perPallet > 0 ? Math.ceil(units / perPallet - 1e-9) : 0;
  const pallets = ok(o.pallets) ? o.pallets : computedPallets;
  const unitGross = mass + packagingKg;
  const empty = units * packagingKg;
  const palletKg = pallets * palletWeight;
  const computedPackaging = empty + palletKg;
  const packaging = ok(o.gross_weight) ? Math.max(0, o.gross_weight - net)
    : ok(o.packaging_weight) ? o.packaging_weight : computedPackaging;
  return {
    net_kg: round(net),
    units,
    units_per_pallet: perPallet || null,
    pallets,
    unit_net_kg: round(mass),
    unit_packaging_kg: round(packagingKg),
    unit_gross_kg: round(unitGross),
    pallet_net_kg: round(ok(o.pallet_net) ? o.pallet_net : perPallet * mass),
    pallet_gross_kg: round(ok(o.pallet_gross) ? o.pallet_gross : (perPallet ? perPallet * unitGross + palletWeight : 0)),
    pallet_weight_kg: round(palletWeight),
    empty_kg: round(empty),
    pallet_kg: round(palletKg),
    computed_packaging_kg: round(computedPackaging),
    packaging_kg: round(packaging),
    gross_kg: round(ok(o.gross_weight) ? o.gross_weight : net + packaging),
  };
}
