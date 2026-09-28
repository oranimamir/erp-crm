/**
 * Per-customer Packing List layout.
 *
 * Every packing list the company has issued has the same skeleton — per unit
 * Net / Gross weight, units per pallet, per pallet Net / Gross weight, the
 * pallet count — but each customer's differs in its heading ("Packaging List"
 * for La Mesta), header rows, whether it carries a Volume CBM column, whether
 * weights are in lb (Independent Chemical), and what sits under the table.
 * As with the invoice (see invoiceLayout.ts), that shape is data: saved on the
 * customer's document profile, seeded from the last PL they received.
 *
 * A layout only arranges; every figure comes from the packing rows.
 */
import db from '../database.js';
import type { DetailField, LayoutRow, MetaField } from './invoiceLayout.js';

/** Header rows a packing list can carry — the invoice's, plus the invoice number. */
export type PlMetaField = MetaField | 'invoice_number';

export type PlColumnKey =
  | 'line' | 'reference' | 'product' | 'lot' | 'packaging'
  | 'unit_net' | 'unit_gross' | 'units_per_pallet' | 'pallet_net' | 'pallet_gross'
  | 'volume_cbm' | 'pallets' | 'units' | 'net_total' | 'gross_total';

export interface PlColumn { key: PlColumnKey; label: string; width: number }

export interface PackingListLayout {
  /** "Packing List", "Packaging List". */
  title: string;
  meta: Array<LayoutRow<PlMetaField>>;
  labels: { to: string; contact: string; address: string; tax: string };
  columns: PlColumn[];
  /** 'lb': per-unit weights in lb, pallet and total weights in kg and lb. */
  weight_unit: 'kg' | 'lb';
  /** Where a line's HS code prints: under the product name, in the panel, or nowhere. */
  hs_code: 'line' | 'panel' | 'off';
  /** Lot number(s) under the product name. */
  show_lot: boolean;
  /** Long product description in the panel under the table. */
  show_description: boolean;
  /** Delivery rows in the panel under the table. */
  details: Array<LayoutRow<DetailField>>;
  /** Manufacturer / country of origin block. */
  origin: boolean;
  /** Terms & Conditions under the document. */
  show_terms: boolean;
}

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

const PRESET_WIDTHS: Record<PlColumnKey, number> = {
  line: 28, reference: 62, product: 96, lot: 56, packaging: 52,
  unit_net: 50, unit_gross: 50, units_per_pallet: 44, pallet_net: 56, pallet_gross: 56,
  volume_cbm: 40, pallets: 38, units: 38, net_total: 56, gross_total: 56,
};

const col = (key: PlColumnKey, label = PL_COLUMN_LABELS[key]): PlColumn => ({ key, label, width: PRESET_WIDTHS[key] });

/** The columns every issued PL has, in their order. */
export const DEFAULT_PL_COLUMNS: PlColumn[] = [
  col('line'), col('reference'), col('product'),
  col('unit_net'), col('unit_gross'), col('units_per_pallet'),
  col('pallet_net'), col('pallet_gross'), col('volume_cbm'), col('pallets'),
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
  columns: DEFAULT_PL_COLUMNS,
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

// ── Seeds: one per customer, read off the packing lists they received ──────

export interface PlLayoutSeed {
  /** LIKE fragment against customers.name. */
  match: string;
  /** Which profile it belongs to, when the customer has several entities. */
  profile?: string;
  /** Which issued PL this was read from — shown in the layout editor. */
  source: string;
  layout: Partial<PackingListLayout>;
}

const STANDARD_META: PackingListLayout['meta'] = [
  { label: 'Date :', field: 'doc_date' },
  { label: 'Invoice# :', field: 'invoice_number' },
  { label: 'SQ :', field: 'sq_number' },
  { label: 'Your order# :', field: 'po_number' },
  { label: 'Our order# :', field: 'operation_number' },
  { label: 'Client :', field: 'client_code' },
  { label: 'Attention :', field: 'attention' },
];

const REF_META: PackingListLayout['meta'] = [
  { label: 'Date:', field: 'doc_date' },
  { label: 'Invoice #:', field: 'invoice_number' },
  { label: 'Operation#:', field: 'operation_number' },
  { label: 'SQ:', field: 'sq_number' },
  { label: 'Our ref:', field: 'our_ref' },
  { label: 'PO number:', field: 'po_number' },
  { label: 'Client:', field: 'client_code' },
];

/** The standard columns with the per-pallet count named the customer's way. */
function columnsWith(perPallet: string, opts: { cbm?: boolean; pallets?: string } = {}): PlColumn[] {
  return DEFAULT_PL_COLUMNS
    .filter(c => opts.cbm !== false || c.key !== 'volume_cbm')
    .map(c => c.key === 'units_per_pallet' ? { ...c, label: perPallet }
      : c.key === 'pallets' && opts.pallets ? { ...c, label: opts.pallets }
      : c);
}

const DELIVERY_DETAILS: PackingListLayout['details'] = [
  { label: 'Delivery :', field: 'delivery' },
  { label: 'Delivery address:', field: 'delivery_address' },
  { label: 'Delivery date :', field: 'delivery_date_text' },
];

export const PL_LAYOUT_SEEDS: PlLayoutSeed[] = [
  {
    match: 'La Mesta',
    source: 'SOBE20260112 PL — La Mesta Chimie Fine',
    layout: {
      title: 'Packaging List',
      meta: [
        { label: 'Commercial Invoice#:', field: 'invoice_number' },
        { label: 'Date:', field: 'doc_date' },
        { label: 'SQ:', field: 'sq_number' },
        { label: 'Our operation#:', field: 'operation_number' },
        { label: 'PO number:', field: 'po_number' },
        { label: 'Client:', field: 'client_code' },
        { label: 'Product reference:', field: 'product_reference' },
      ],
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'TAX ID :' },
      columns: columnsWith('Units per pallet', { cbm: false, pallets: 'Tote' }),
      hs_code: 'panel',
      show_description: true,
      details: DELIVERY_DETAILS,
      origin: true,
    },
  },
  {
    match: 'Independent Chemical',
    source: 'SOBE20260118 PL — Independent Chemical NJ LLC',
    layout: {
      meta: [
        { label: 'INVOICE:', field: 'invoice_number' },
        { label: 'Date:', field: 'doc_date' },
        { label: 'SQ:', field: 'sq_number' },
        { label: 'Our ref:', field: 'our_ref' },
        { label: 'PO number:', field: 'po_number' },
        { label: 'Client:', field: 'client_code' },
      ],
      labels: { to: 'CONSIGNEE:', contact: '', address: '', tax: 'Tax ID:' },
      columns: columnsWith('Drums per pallet', { cbm: false, pallets: 'Pallet' }),
      weight_unit: 'lb',
      hs_code: 'panel',
      show_description: true,
      details: [{ label: 'Delivery :', field: 'delivery' }, { label: 'Remarks :', field: 'remarks' }],
      origin: true,
    },
  },
  {
    match: 'Astron Chemicals',
    source: 'SOBE20260108 PL — Astron Chemicals SA',
    layout: {
      meta: STANDARD_META,
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'Tax ID:' },
      columns: columnsWith('Units per pallet'),
      hs_code: 'line',
      details: [
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
        { label: 'Incoterm :', field: 'incoterm' },
      ],
      origin: true,
    },
  },
  {
    match: 'Distribuidora del Caribe',
    profile: 'Costa Rica',
    source: 'SONL20260108 PL — Distribuidora del Caribe CR SA',
    layout: {
      meta: [
        { label: 'Date:', field: 'doc_date' },
        { label: 'Your order# :', field: 'po_number' },
        { label: 'Our order# :', field: 'operation_number' },
        { label: 'Client:', field: 'client_code' },
        { label: 'Ref:', field: 'our_ref' },
      ],
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'Tax Id:' },
      columns: columnsWith('Drums per pallet'),
      hs_code: 'panel',
      show_description: true,
      details: [{ label: 'Delivery :', field: 'delivery' }, { label: 'Remarks :', field: 'remarks' }],
      origin: false,
    },
  },
  {
    match: 'Distribuidora del Caribe',
    profile: 'Guatemala',
    source: 'SOBE20260121 PL — Distribuidora del Caribe de Guatemala SA',
    layout: {
      meta: [
        { label: 'Date:', field: 'doc_date' },
        { label: 'Invoice #:', field: 'invoice_number' },
        { label: 'Operation#:', field: 'operation_number' },
        { label: 'SQ:', field: 'sq_number' },
        { label: 'PO number:', field: 'po_number' },
        { label: 'Client:', field: 'client_code' },
      ],
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'NIT (TAX ID):' },
      columns: columnsWith('Pails/pallet'),
      hs_code: 'line',
      details: DELIVERY_DETAILS,
      origin: true,
    },
  },
  {
    match: 'Faravelli',
    source: 'SOBE20260115 PL — Giusto Faravelli SpA',
    layout: {
      meta: STANDARD_META,
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'Tax ID:' },
      columns: columnsWith('IBC per pallet'),
      hs_code: 'line',
      details: DELIVERY_DETAILS,
      origin: true,
    },
  },
  {
    match: 'Lavollee',
    source: 'SOBE20260124 PL — LAVOLLEE SAS',
    layout: {
      meta: REF_META,
      labels: { to: 'To:', contact: 'Attention :', address: 'Address:', tax: 'Tax Id :' },
      columns: columnsWith('Pails/pallet'),
      hs_code: 'line',
      details: DELIVERY_DETAILS,
      origin: true,
    },
  },
  {
    match: 'Cerrillos',
    source: 'SOBE250930CL002PL — Comercial Cerrillos SA',
    layout: {
      meta: [
        { label: 'Date:', field: 'doc_date' },
        { label: 'SQ:', field: 'sq_number' },
        { label: 'Our ref:', field: 'our_ref' },
        { label: 'PO number:', field: 'po_number' },
        { label: 'Client:', field: 'client_code' },
      ],
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'TAX ID:' },
      columns: columnsWith('Bags per pallet'),
      hs_code: 'panel',
      show_description: true,
      details: DELIVERY_DETAILS,
      origin: false,
      show_terms: false,
    },
  },
];

/** The seeded layout for a customer, if one of the supplied PLs covers them. */
export function plLayoutSeedFor(customerName: string, profileName?: string): PlLayoutSeed | null {
  const name = String(customerName || '').toLowerCase();
  const candidates = PL_LAYOUT_SEEDS.filter(s => name.includes(s.match.toLowerCase()));
  if (!candidates.length) return null;
  return candidates.find(s => s.profile && profileName && profileName.includes(s.profile))
    || candidates.find(s => !s.profile)
    || candidates[0];
}

// ── Normalising whatever was saved ─────────────────────────────────────────

const META_FIELDS: PlMetaField[] = [
  'doc_date', 'doc_number', 'invoice_number', 'sq_number', 'po_number', 'operation_number',
  'our_ref', 'client_code', 'attention', 'product_reference',
];
const DETAIL_FIELDS: DetailField[] = [
  'delivery', 'delivery_address', 'delivery_contact', 'delivery_date_text',
  'payment_terms', 'incoterm', 'remarks',
];
export const PL_COLUMN_KEYS = Object.keys(PL_COLUMN_LABELS) as PlColumnKey[];

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function rows<F extends string>(value: unknown, allowed: F[], fallback: Array<LayoutRow<F>>): Array<LayoutRow<F>> {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((r: any) => r && allowed.includes(r.field))
    .map((r: any) => ({ label: String(r.label ?? ''), field: r.field as F }));
}

function columns(value: unknown, fallback: PlColumn[]): PlColumn[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const kept: PlColumn[] = [];
  for (const c of value as any[]) {
    if (!c || !PL_COLUMN_KEYS.includes(c.key) || seen.has(c.key)) continue;
    seen.add(c.key);
    const width = Number(c.width);
    kept.push({
      key: c.key,
      label: String(c.label ?? PL_COLUMN_LABELS[c.key as PlColumnKey]),
      width: Number.isFinite(width) && width > 10 ? width : PRESET_WIDTHS[c.key as PlColumnKey],
    });
  }
  return kept.length >= 2 ? kept : fallback;
}

/** Anything saved, seeded or hand-edited becomes a complete layout here. */
export function normalizePlLayout(raw: unknown): PackingListLayout {
  const l = (raw && typeof raw === 'object' ? raw : {}) as any;
  const d = DEFAULT_PL_LAYOUT;
  const labels = (l.labels && typeof l.labels === 'object' ? l.labels : {}) as any;
  const title = typeof l.title === 'string' && l.title.trim() ? l.title.trim() : d.title;
  return {
    title,
    meta: rows<PlMetaField>(l.meta, META_FIELDS, d.meta),
    labels: {
      to: str(labels.to, d.labels.to),
      contact: str(labels.contact, d.labels.contact),
      address: str(labels.address, d.labels.address),
      tax: str(labels.tax, d.labels.tax),
    },
    columns: columns(l.columns, d.columns),
    weight_unit: l.weight_unit === 'lb' ? 'lb' : 'kg',
    hs_code: ['line', 'panel', 'off'].includes(l.hs_code) ? l.hs_code : d.hs_code,
    show_lot: bool(l.show_lot, d.show_lot),
    show_description: bool(l.show_description, d.show_description),
    details: rows<DetailField>(l.details, DETAIL_FIELDS, d.details),
    origin: bool(l.origin, d.origin),
    show_terms: bool(l.show_terms, d.show_terms),
  };
}

// ── Which layout a new packing list starts from ────────────────────────────

/** The layout of the last packing list sent to this customer. */
function lastPlLayout(customerId: number | null | undefined): { layout: unknown; pl_number: string } | null {
  if (!customerId) return null;
  try {
    const rows = db.prepare(`
      SELECT p.pl_number, p.data FROM packing_lists p
      JOIN orders o ON o.id = p.order_id
      WHERE o.customer_id = ? ORDER BY p.id DESC LIMIT 5
    `).all(customerId) as any[];
    for (const row of rows) {
      let data: any = {};
      try { data = JSON.parse(row.data); } catch { continue; }
      if (data?.layout && typeof data.layout === 'object') return { layout: data.layout, pl_number: row.pl_number };
    }
  } catch { /* table unavailable */ }
  return null;
}

/**
 * The customer's saved PL format → the last PL they received → the PL seeded
 * from the company's issued packing lists → the house default.
 */
export function resolvePlLayout(
  customerId: number | null | undefined,
  profile: { name: string; data: any } | null,
  customerName?: string | null,
): { layout: PackingListLayout; source: string } {
  const saved = profile?.data?.packing_list_layout;
  if (saved && typeof saved === 'object') {
    return { layout: normalizePlLayout(saved), source: `saved on ${profile!.name}` };
  }
  const previous = lastPlLayout(customerId);
  if (previous) {
    return { layout: normalizePlLayout(previous.layout), source: `the last packing list sent to this customer (${previous.pl_number})` };
  }
  const seed = plLayoutSeedFor(customerName || '', profile?.name);
  if (seed) return { layout: normalizePlLayout({ ...DEFAULT_PL_LAYOUT, ...seed.layout }), source: seed.source };
  return { layout: DEFAULT_PL_LAYOUT, source: 'the standard packing list template' };
}
