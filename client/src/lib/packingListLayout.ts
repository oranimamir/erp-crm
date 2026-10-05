/**
 * The packing list layout as the PL page edits it. Mirrors
 * server/src/lib/packingListLayout.ts — the server normalises whatever
 * arrives, so this side only describes the choices.
 */
import type { DetailField, LayoutRow, MetaField } from './invoiceLayout';

export type PlMetaField = MetaField | 'invoice_number';

export type PlColumnKey =
  | 'line' | 'reference' | 'product' | 'lot' | 'packaging'
  | 'unit_net' | 'unit_gross' | 'units_per_pallet' | 'pallet_net' | 'pallet_gross'
  | 'volume_cbm' | 'pallets' | 'units' | 'net_total' | 'gross_total';

export interface PlColumn { key: PlColumnKey; label: string; width: number }

export interface PackingListLayout {
  title: string;
  meta: Array<LayoutRow<PlMetaField>>;
  labels: { to: string; contact: string; address: string; tax: string };
  columns: PlColumn[];
  weight_unit: 'kg' | 'lb';
  hs_code: 'line' | 'panel' | 'off';
  show_lot: boolean;
  show_description: boolean;
  details: Array<LayoutRow<DetailField>>;
  origin: boolean;
  show_terms: boolean;
}

export const PL_META_FIELDS: PlMetaField[] = [
  'doc_date', 'doc_number', 'invoice_number', 'sq_number', 'po_number', 'operation_number',
  'our_ref', 'client_code', 'attention', 'product_reference',
];

export const PL_COLUMN_LABELS: Record<PlColumnKey, string> = {
  line: 'Line',
  reference: 'Reference',
  product: 'Commercial name',
  lot: 'Lot',
  packaging: 'Packaging',
  unit_net: 'Net weight',
  unit_gross: 'Gross weight',
  units_per_pallet: 'Units per pallet',
  pallet_net: 'Pallet net weight',
  pallet_gross: 'Pallet gross weight',
  volume_cbm: 'Volume CBM',
  pallets: 'Pallets',
  units: 'Units',
  net_total: 'Total net weight',
  gross_total: 'Total gross weight',
};

/** What each column holds, for the editor. */
export const PL_COLUMN_HINTS: Partial<Record<PlColumnKey, string>> = {
  unit_net: 'content of one unit',
  unit_gross: 'content + packaging',
  pallet_net: 'units/pallet × unit net',
  pallet_gross: 'units/pallet × unit gross + pallet',
  net_total: "the line's net",
  gross_total: "the line's gross",
};

export const PL_COLUMN_KEYS = Object.keys(PL_COLUMN_LABELS) as PlColumnKey[];

const DEFAULT_COLUMNS: PlColumn[] = [
  { key: 'line', label: 'Line', width: 28 },
  { key: 'reference', label: 'Reference', width: 62 },
  { key: 'product', label: 'Commercial name', width: 96 },
  { key: 'lot', label: 'Lot', width: 72 },
  { key: 'unit_net', label: 'Net weight', width: 50 },
  { key: 'unit_gross', label: 'Gross weight', width: 50 },
  { key: 'units_per_pallet', label: 'Units per pallet', width: 44 },
  { key: 'pallet_net', label: 'Pallet net weight', width: 56 },
  { key: 'pallet_gross', label: 'Pallet gross weight', width: 56 },
  { key: 'volume_cbm', label: 'Volume CBM', width: 40 },
  { key: 'pallets', label: 'Pallets', width: 38 },
];

export const DEFAULT_PL_LAYOUT: PackingListLayout = {
  title: 'Packing List',
  meta: [
    { label: 'Date :', field: 'doc_date' },
    { label: 'Invoice# :', field: 'invoice_number' },
    { label: 'SQ :', field: 'sq_number' },
    { label: 'Your order# :', field: 'po_number' },
    { label: 'Our order# :', field: 'operation_number' },
    { label: 'Client :', field: 'client_code' },
  ],
  labels: { to: 'Consignee:', contact: 'Contact Person:', address: 'Address:', tax: 'Tax ID:' },
  columns: DEFAULT_COLUMNS,
  weight_unit: 'kg',
  hs_code: 'line',
  show_lot: true,
  show_description: false,
  details: [
    { label: 'Delivery :', field: 'delivery' },
    { label: 'Delivery address:', field: 'delivery_address' },
    { label: 'Delivery date :', field: 'delivery_date_text' },
  ],
  origin: true,
  show_terms: true,
};

/** Every PL carries the invoice's lot number(s) in a column right after the commercial name. */
function withLotColumn(cols: PlColumn[]): PlColumn[] {
  if (cols.some(c => c.key === 'lot')) return cols;
  const at = cols.findIndex(c => c.key === 'product');
  const out = [...cols];
  out.splice(at >= 0 ? at + 1 : out.length, 0, { key: 'lot', label: 'Lot', width: 72 });
  return out;
}

/** Fills in anything a saved layout is missing, so the editor never sees undefined. */
export function plWithDefaults(raw: Partial<PackingListLayout> | null | undefined): PackingListLayout {
  const l = raw || {};
  return {
    ...DEFAULT_PL_LAYOUT,
    ...l,
    labels: { ...DEFAULT_PL_LAYOUT.labels, ...(l.labels || {}) },
    meta: l.meta || DEFAULT_PL_LAYOUT.meta,
    columns: withLotColumn(l.columns?.length ? l.columns : DEFAULT_PL_LAYOUT.columns),
    details: l.details || DEFAULT_PL_LAYOUT.details,
  };
}
