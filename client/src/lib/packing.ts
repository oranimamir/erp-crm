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
  empty_kg: number;
  pallet_kg: number;
  gross_kg: number;
}

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

/** Gross = product + empty units + pallets. Counts typed by hand win. */
export function computePacking(
  net: number,
  pkg: PackagingOption | null | undefined,
  overrides: { units?: unknown; pallets?: unknown } = {},
): PackingFigures {
  const mass = Number(pkg?.product_mass) || 0;
  const perPallet = Number(pkg?.units_per_pallet) || 0;
  const computedUnits = mass > 0 ? Math.ceil(net / mass - 1e-9) : 0;
  const units = count(overrides.units) ?? computedUnits;
  const computedPallets = perPallet > 0 ? Math.ceil(units / perPallet - 1e-9) : 0;
  const pallets = count(overrides.pallets) ?? computedPallets;
  const empty = units * (Number(pkg?.weight_packaging) || 0);
  const palletKg = pallets * (Number(pkg?.weight_pallet) || 0);
  return {
    net_kg: net, units, computed_units: computedUnits, units_per_pallet: perPallet || null,
    pallets, computed_pallets: computedPallets, empty_kg: empty, pallet_kg: palletKg,
    gross_kg: net + empty + palletKg,
  };
}

export const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function packagingLabel(p: PackagingOption): string {
  return [p.type, p.code, p.product, p.units_per_pallet ? `${p.units_per_pallet}/pallet` : '']
    .filter(Boolean).join(' · ');
}
