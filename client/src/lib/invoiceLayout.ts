/**
 * The invoice layout as the generator edits it. Mirrors
 * server/src/lib/invoiceLayout.ts — the server normalises whatever arrives, so
 * this side only has to describe the choices the user can make.
 */

export type MetaField =
  | 'doc_date' | 'doc_number' | 'sq_number' | 'po_number' | 'operation_number'
  | 'our_ref' | 'client_code' | 'attention' | 'product_reference';

export type DetailField =
  | 'delivery' | 'delivery_address' | 'delivery_contact' | 'delivery_date_text'
  | 'payment_terms' | 'incoterm' | 'remarks';

export type TotalField = 'subtotal' | 'freight' | 'insurance' | 'vat' | 'total';

export type ColumnKey =
  | 'line' | 'reference' | 'commercial_name' | 'packaging' | 'packing_note'
  | 'hs_code' | 'lot' | 'quantity' | 'unit_price' | 'amount';

export interface LayoutRow<F extends string> { label: string; field: F }
export interface LayoutColumn { key: ColumnKey; label: string; width: number }

export interface InvoiceLayout {
  title: string;
  meta: Array<LayoutRow<MetaField>>;
  labels: { to: string; contact: string; address: string; tax: string; eori: string };
  columns: LayoutColumn[];
  hs_code: 'line' | 'panel' | 'off';
  show_lot: boolean;
  show_line_note: boolean;
  show_description: boolean;
  show_quantity_total: boolean;
  details: Array<LayoutRow<DetailField>>;
  totals: Array<LayoutRow<TotalField>>;
  origin: boolean;
  terms_heading: string;
  bank_heading: string;
  /** Run IBAN, BIC and the bank address together on one line. */
  bank_inline: boolean;
  /** Set by the server once the HS code, lot and packing columns exist. */
  columns_version?: number;
}

export const META_FIELDS: MetaField[] = [
  'doc_date', 'doc_number', 'sq_number', 'po_number', 'operation_number',
  'our_ref', 'client_code', 'attention', 'product_reference',
];

export const DETAIL_FIELDS: DetailField[] = [
  'delivery', 'delivery_address', 'delivery_contact', 'delivery_date_text',
  'payment_terms', 'incoterm', 'remarks',
];

export const TOTAL_FIELDS: TotalField[] = ['subtotal', 'freight', 'insurance', 'vat', 'total'];

export const COLUMN_KEYS: ColumnKey[] = [
  'line', 'reference', 'commercial_name', 'packaging', 'packing_note', 'hs_code', 'lot',
  'quantity', 'unit_price', 'amount',
];

export const FIELD_LABELS: Record<string, string> = {
  doc_date: 'Date', doc_number: 'Invoice number', sq_number: 'SQ',
  po_number: "Customer's order number", operation_number: 'Our operation number',
  our_ref: 'Our reference', client_code: 'Client code', attention: 'Attention',
  product_reference: 'Product reference',
  delivery: 'Delivery terms', delivery_address: 'Delivery address',
  delivery_contact: 'Delivery contact', delivery_date_text: 'Delivery date',
  payment_terms: 'Payment terms', incoterm: 'Incoterm and destination', remarks: 'Remarks',
  subtotal: 'Subtotal', freight: 'Freight', insurance: 'Insurance', vat: 'VAT', total: 'Total',
  line: 'Line', reference: 'Reference', commercial_name: 'Commercial name',
  packaging: 'Packaging', quantity: 'Quantity', unit_price: 'Unit price', amount: 'Amount',
  packing_note: 'Packing', hs_code: 'HS code', lot: 'Lot',
};

export const DEFAULT_COLUMNS: LayoutColumn[] = [
  { key: 'line', label: 'Line', width: 30 },
  { key: 'reference', label: 'Reference', width: 54 },
  { key: 'commercial_name', label: 'Commercial name', width: 80 },
  { key: 'packaging', label: 'Packaging', width: 58 },
  { key: 'packing_note', label: 'Packing', width: 60 },
  { key: 'hs_code', label: 'HS code', width: 52 },
  { key: 'lot', label: 'Lot', width: 58 },
  { key: 'quantity', label: 'Quantity', width: 50 },
  { key: 'unit_price', label: 'Unit price', width: 56 },
  { key: 'amount', label: 'Amount', width: 58 },
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
  columns_version: 2,
};

/** Fills in anything a saved layout is missing, so the editor never sees undefined. */
export function withDefaults(raw: Partial<InvoiceLayout> | null | undefined): InvoiceLayout {
  const l = raw || {};
  return {
    ...DEFAULT_LAYOUT,
    ...l,
    labels: { ...DEFAULT_LAYOUT.labels, ...(l.labels || {}) },
    meta: l.meta?.length ? l.meta : DEFAULT_LAYOUT.meta,
    columns: l.columns?.length ? l.columns : DEFAULT_LAYOUT.columns,
    details: l.details || DEFAULT_LAYOUT.details,
    totals: l.totals || DEFAULT_LAYOUT.totals,
  };
}
