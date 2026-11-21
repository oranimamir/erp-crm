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
  /** The invoice quantity in kg (what net is unless typed). */
  computed_net_kg: number;
  units: number;
  computed_units: number;
  units_per_pallet: number | null;
  computed_units_per_pallet: number;
  pallets: number;
  computed_pallets: number;
  /** Content of one unit. */
  unit_net_kg: number;
  computed_unit_net_kg: number;
  /** Empty packaging of one unit. */
  unit_packaging_kg: number;
  computed_unit_packaging_kg: number;
  /** Content + packaging of one unit. */
  unit_gross_kg: number;
  /** Units per pallet × unit net. */
  pallet_net_kg: number;
  computed_pallet_net_kg: number;
  /** Units per pallet × unit gross + the pallet. */
  pallet_gross_kg: number;
  computed_pallet_gross_kg: number;
  pallet_weight_kg: number;
  empty_kg: number;
  pallet_kg: number;
  /** Empty units + pallets, as computed. */
  computed_packaging_kg: number;
  /** Gross − net: the computed packaging weight unless typed. */
  packaging_kg: number;
  gross_kg: number;
  /** Net + computed packaging — what gross is unless typed. */
  computed_gross_kg: number;
}

/** Every figure a line can be given by hand (blank / null = calculated). */
export interface PackingOverrides {
  net_weight?: unknown;
  unit_net?: unknown;
  unit_packaging?: unknown;
  units_per_pallet?: unknown;
  units?: unknown;
  pallets?: unknown;
  pallet_weight?: unknown;
  packaging_weight?: unknown;
  gross_weight?: unknown;
  pallet_net?: unknown;
  pallet_gross?: unknown;
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
 * pallets unless typed). Anything typed by hand wins, and the figures after it
 * follow from it: a typed net weight drives the units, a typed content per unit
 * or units per pallet drive units / pallets, a typed gross weight sets the
 * packaging weight (gross − net).
 */
export function computePacking(
  invoiceNet: number,
  pkg: PackagingOption | null | undefined,
  o: PackingOverrides = {},
): PackingFigures {
  const net = weight(o.net_weight) ?? invoiceNet;
  const catalogueMass = Number(pkg?.product_mass) || 0;
  const cataloguePerPallet = Number(pkg?.units_per_pallet) || 0;
  const cataloguePackaging = Number(pkg?.weight_packaging) || 0;
  const mass = weight(o.unit_net) ?? catalogueMass;
  const perPallet = count(o.units_per_pallet) ?? cataloguePerPallet;
  const packagingKg = weight(o.unit_packaging) ?? cataloguePackaging;
  const palletWeight = weight(o.pallet_weight) ?? DEFAULT_PALLET_KG;
  const computedUnits = mass > 0 ? Math.ceil(net / mass - 1e-9) : 0;
  const units = count(o.units) ?? computedUnits;
  const computedPallets = perPallet > 0 ? Math.ceil(units / perPallet - 1e-9) : 0;
  const pallets = count(o.pallets) ?? computedPallets;
  const unitGross = mass + packagingKg;
  const empty = units * packagingKg;
  const palletKg = pallets * palletWeight;
  const computedPackaging = empty + palletKg;
  const typedGross = weight(o.gross_weight);
  const packaging = typedGross != null ? Math.max(0, typedGross - net) : (weight(o.packaging_weight) ?? computedPackaging);
  const computedPalletNet = perPallet * mass;
  const computedPalletGross = perPallet ? perPallet * unitGross + palletWeight : 0;
  return {
    net_kg: net, computed_net_kg: invoiceNet,
    units, computed_units: computedUnits,
    units_per_pallet: perPallet || null, computed_units_per_pallet: cataloguePerPallet,
    pallets, computed_pallets: computedPallets,
    unit_net_kg: mass, computed_unit_net_kg: catalogueMass,
    unit_packaging_kg: packagingKg, computed_unit_packaging_kg: cataloguePackaging,
    unit_gross_kg: unitGross,
    pallet_net_kg: weight(o.pallet_net) ?? computedPalletNet, computed_pallet_net_kg: computedPalletNet,
    pallet_gross_kg: weight(o.pallet_gross) ?? computedPalletGross, computed_pallet_gross_kg: computedPalletGross,
    pallet_weight_kg: palletWeight,
    empty_kg: empty, pallet_kg: palletKg,
    computed_packaging_kg: computedPackaging, packaging_kg: packaging,
    gross_kg: typedGross ?? net + packaging, computed_gross_kg: net + (weight(o.packaging_weight) ?? computedPackaging),
  };
}

export const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

export function packagingLabel(p: PackagingOption): string {
  return [p.type, p.code, p.product, p.units_per_pallet ? `${p.units_per_pallet}/pallet` : '']
    .filter(Boolean).join(' · ');
}
