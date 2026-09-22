/**
 * Per-customer Commercial Invoice layout.
 *
 * Every customer receives a slightly different invoice: Faravelli's says
 * "Invoice#" and carries a lot number, La Mesta's says "Commercial Invoice#"
 * and a product reference, Astron's prints the HS code inside the line and
 * totals the quantity, Distribuidora's has an Insurance line, Independent
 * Chemical's columns are priced per lb. Rather than hard-code those, the shape
 * of the document is data: a layout saved on the customer's document profile,
 * seeded from the last invoice they actually received and editable afterwards.
 *
 * A layout only ever *arranges* — every value still comes from the invoice
 * record, so an unknown or partial layout degrades to DEFAULT_LAYOUT.
 */

/** A row in the meta column: a label, and which field fills it. */
export type MetaField =
  | 'doc_date' | 'doc_number' | 'sq_number' | 'po_number' | 'operation_number'
  | 'our_ref' | 'client_code' | 'attention' | 'product_reference';

/** A row in the detail panel under the table. */
export type DetailField =
  | 'delivery' | 'delivery_address' | 'delivery_contact' | 'delivery_date_text'
  | 'payment_terms' | 'incoterm' | 'remarks';

/** A row in the totals block. `total` is always subtotal + freight + insurance + vat. */
export type TotalField = 'subtotal' | 'freight' | 'insurance' | 'vat' | 'total';

export type ColumnKey =
  | 'line' | 'reference' | 'commercial_name' | 'packaging'
  | 'quantity' | 'unit_price' | 'amount';

export interface LayoutRow<F extends string> { label: string; field: F }
export interface LayoutColumn { key: ColumnKey; label: string; width: number }

export interface InvoiceLayout {
  /** Document heading beside the number — "Commercial Invoice", "Invoice", "Factura comercial". */
  title: string;
  /** Right-hand meta column, in print order. */
  meta: Array<LayoutRow<MetaField>>;
  /** Left-hand client block labels. */
  labels: { to: string; contact: string; address: string; tax: string; eori: string };
  /** The line-item table. Widths are points and are normalised to the page. */
  columns: LayoutColumn[];
  /** Where a line's HS code prints: inside its row, in the detail panel, or nowhere. */
  hs_code: 'line' | 'panel' | 'off';
  /** Lot number under the commercial name. */
  show_lot: boolean;
  /** The free note under a line ("80 drums on 20 pallets"). */
  show_line_note: boolean;
  /** Long product description in the detail panel. */
  show_description: boolean;
  /** A totals row across the table summing quantity and amount. */
  show_quantity_total: boolean;
  details: Array<LayoutRow<DetailField>>;
  totals: Array<LayoutRow<TotalField>>;
  /** Manufacturer / country of origin block. */
  origin: boolean;
  terms_heading: string;
  bank_heading: string;
  /**
   * Run IBAN, BIC and the bank address together on one line instead of one per
   * line. The order confirmation is set this way so its footer stays on the
   * first page; the invoices all list them separately.
   */
  bank_inline: boolean;
}

/** docx gridCol twips / 20 -> points (766, 1744, 2430, 1440, 1440, 1620, 1350). */
export const DEFAULT_COLUMNS: LayoutColumn[] = [
  { key: 'line', label: 'Line', width: 38.3 },
  { key: 'reference', label: 'Reference', width: 87.2 },
  { key: 'commercial_name', label: 'Commercial name', width: 121.5 },
  { key: 'packaging', label: 'Packaging', width: 72 },
  { key: 'quantity', label: 'Quantity', width: 72 },
  { key: 'unit_price', label: 'Unit price', width: 81 },
  { key: 'amount', label: 'Amount', width: 67.5 },
];

export const DEFAULT_LAYOUT: InvoiceLayout = {
  title: 'Commercial Invoice',
  meta: [
    { label: 'Date :', field: 'doc_date' },
    { label: 'Invoice# :', field: 'doc_number' },
    { label: 'SQ :', field: 'sq_number' },
    { label: 'Your order# :', field: 'po_number' },
    { label: 'Our order# :', field: 'operation_number' },
    { label: 'Client :', field: 'client_code' },
    { label: 'Attention :', field: 'attention' },
  ],
  labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'Tax ID:', eori: 'EORI# :' },
  columns: DEFAULT_COLUMNS,
  hs_code: 'line',
  show_lot: true,
  show_line_note: true,
  show_description: true,
  show_quantity_total: false,
  details: [
    { label: 'Delivery :', field: 'delivery' },
    { label: 'Delivery address:', field: 'delivery_address' },
    { label: 'Contact', field: 'delivery_contact' },
    { label: 'Delivery date :', field: 'delivery_date_text' },
  ],
  totals: [
    { label: 'Subtotal', field: 'subtotal' },
    { label: 'Freight', field: 'freight' },
    { label: 'Vat', field: 'vat' },
    { label: 'Total Order', field: 'total' },
  ],
  origin: false,
  terms_heading: 'Terms & Conditions',
  bank_heading: 'Bank Transfer',
  bank_inline: false,
};

const META_FIELDS: MetaField[] = [
  'doc_date', 'doc_number', 'sq_number', 'po_number', 'operation_number',
  'our_ref', 'client_code', 'attention', 'product_reference',
];
const DETAIL_FIELDS: DetailField[] = [
  'delivery', 'delivery_address', 'delivery_contact', 'delivery_date_text',
  'payment_terms', 'incoterm', 'remarks',
];
const TOTAL_FIELDS: TotalField[] = ['subtotal', 'freight', 'insurance', 'vat', 'total'];
const COLUMN_KEYS: ColumnKey[] = [
  'line', 'reference', 'commercial_name', 'packaging', 'quantity', 'unit_price', 'amount',
];

/** Friendly names for the layout editor - kept here so both ends agree. */
export const FIELD_LABELS: Record<string, string> = {
  doc_date: 'Date', doc_number: 'Invoice number', sq_number: 'SQ',
  po_number: "Customer's order number", operation_number: 'Our operation number',
  our_ref: 'Our reference', client_code: 'Client code', attention: 'Attention',
  product_reference: 'Product reference',
  delivery: 'Delivery terms', delivery_address: 'Delivery address',
  delivery_contact: 'Delivery contact', delivery_date_text: 'Delivery date',
  payment_terms: 'Payment terms', incoterm: 'Incoterm and destination', remarks: 'Remarks',
  subtotal: 'Subtotal', freight: 'Freight', insurance: 'Insurance', vat: 'VAT', total: 'Total',
};

function str(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Keeps only rows naming a field this build understands; drops the rest. */
function rows<F extends string>(value: unknown, allowed: F[], fallback: Array<LayoutRow<F>>): Array<LayoutRow<F>> {
  if (!Array.isArray(value)) return fallback;
  const kept = value
    .filter((r: any) => r && allowed.includes(r.field))
    .map((r: any) => ({ label: String(r.label ?? ''), field: r.field as F }));
  return kept.length ? kept : fallback;
}

function columns(value: unknown, fallback: LayoutColumn[]): LayoutColumn[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const kept: LayoutColumn[] = [];
  for (const col of value as any[]) {
    if (!col || !COLUMN_KEYS.includes(col.key) || seen.has(col.key)) continue;
    seen.add(col.key);
    const width = Number(col.width);
    const preset = DEFAULT_COLUMNS.find(c => c.key === col.key)!;
    kept.push({
      key: col.key,
      label: String(col.label ?? preset.label),
      width: Number.isFinite(width) && width > 10 ? width : preset.width,
    });
  }
  return kept.length ? kept : fallback;
}

/**
 * Anything saved on a profile, from an older build, or hand-edited becomes a
 * complete layout here — the renderer never has to defend itself.
 */
export function normalizeLayout(raw: unknown): InvoiceLayout {
  const l = (raw && typeof raw === 'object' ? raw : {}) as any;
  const d = DEFAULT_LAYOUT;
  const labels = (l.labels && typeof l.labels === 'object' ? l.labels : {}) as any;

  return {
    title: str(l.title, d.title),
    meta: rows<MetaField>(l.meta, META_FIELDS, d.meta),
    labels: {
      to: str(labels.to, d.labels.to),
      contact: str(labels.contact, d.labels.contact),
      address: str(labels.address, d.labels.address),
      tax: str(labels.tax, d.labels.tax),
      eori: str(labels.eori, d.labels.eori),
    },
    columns: columns(l.columns, d.columns),
    hs_code: ['line', 'panel', 'off'].includes(l.hs_code) ? l.hs_code : d.hs_code,
    show_lot: bool(l.show_lot, d.show_lot),
    show_line_note: bool(l.show_line_note, d.show_line_note),
    show_description: bool(l.show_description, d.show_description),
    show_quantity_total: bool(l.show_quantity_total, d.show_quantity_total),
    details: rows<DetailField>(l.details, DETAIL_FIELDS, d.details),
    totals: rows<TotalField>(l.totals, TOTAL_FIELDS, d.totals),
    origin: bool(l.origin, d.origin),
    terms_heading: str(l.terms_heading, d.terms_heading),
    bank_heading: str(l.bank_heading, d.bank_heading),
    bank_inline: bool(l.bank_inline, d.bank_inline),
  };
}
