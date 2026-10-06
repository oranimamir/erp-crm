// Packing list figures for the editor's live view — the same maths as
// server/src/lib/packing.ts, which recomputes everything on save.

export interface PackagingOption {
  id: number;
  type: string;
  code: string;
  product: string | null;
  product_mass: number | null;
  units_per_pallet: number | null;
  weight_packaging: number | null;
  weight_pallet: number | null;
}

export interface PackingFigures {
  net_kg: number;
  units: number;
  computed_units: number;
  units_per_pallet: number | null;
  pallets: number;
  computed_pallets: number;
  /** Content of one unit. */
  unit_net_kg: number;
  /** Content + packaging of one unit. */
  unit_gross_kg: number;
  /** Units per pallet × unit net. */
  pallet_net_kg: number;
  /** Units per pallet × unit gross + the pallet. */
  pallet_gross_kg: number;
  pallet_weight_kg: number;
  empty_kg: number;
  pallet_kg: number;
  /** Empty units + pallets, as computed. */
  computed_packaging_kg: number;
  /** Gross − net: the computed packaging weight unless typed. */
  packaging_kg: number;
  gross_kg: number;
}

/** An empty pallet, unless the line says otherwise. */
export const DEFAULT_PALLET_KG = 20;

export function netKg(quantity: unknown, unit: unknown): number {
  const q = Number(quantity) || 0;
  const u = String(unit || '').trim().toLowerCase();
  if (['mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't'].includes(u)) return q * 1000;
  if (['lbs', 'lb', 'pound', 'pounds'].includes(u)) return q / 2.2046226218;
  return q;
}

const count = (v: unknown): number | null => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const weight = (v: unknown): number | null => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Unit net = content; unit gross = content + packaging; pallet net = units per
 * pallet × unit net; pallet gross = units per pallet × unit gross + pallet
 * (20 kg unless typed); line gross = net + packaging weight (empty units +
 * pallets unless typed). Counts and weights typed by hand win.
 */
export function computePacking(
  net: number,
  pkg: PackagingOption | null | undefined,
  overrides: { units?: unknown; pallets?: unknown; pallet_weight?: unknown; packaging_weight?: unknown } = {},
): PackingFigures {
  const mass = Number(pkg?.product_mass) || 0;
  const perPallet = Number(pkg?.units_per_pallet) || 0;
  const packagingKg = Number(pkg?.weight_packaging) || 0;
  const palletWeight = weight(overrides.pallet_weight) ?? DEFAULT_PALLET_KG;
  const computedUnits = mass > 0 ? Math.ceil(net / mass - 1e-9) : 0;
  const units = count(overrides.units) ?? computedUnits;
  const computedPallets = perPallet > 0 ? Math.ceil(units / perPallet - 1e-9) : 0;
  const pallets = count(overrides.pallets) ?? computedPallets;
  const unitGross = mass + packagingKg;
  const empty = units * packagingKg;
  const palletKg = pallets * palletWeight;
  const computedPackaging = empty + palletKg;
  const packaging = weight(overrides.packaging_weight) ?? computedPackaging;
  return {
    net_kg: net, units, computed_units: computedUnits, units_per_pallet: perPallet || null,
    pallets, computed_pallets: computedPallets,
    unit_net_kg: mass, unit_gross_kg: unitGross,
    pallet_net_kg: perPallet * mass, pallet_gross_kg: perPallet ? perPallet * unitGross + palletWeight : 0,
    pallet_weight_kg: palletWeight,
    empty_kg: empty, pallet_kg: palletKg,
    computed_packaging_kg: computedPackaging, packaging_kg: packaging, gross_kg: net + packaging,
  };
}

export const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

export function packagingLabel(p: PackagingOption): string {
  return [p.type, p.code, p.product, p.units_per_pallet ? `${p.units_per_pallet}/pallet` : '']
    .filter(Boolean).join(' · ');
}
