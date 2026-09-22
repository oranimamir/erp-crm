/**
 * Invoice layouts read off the invoices each customer has actually received.
 *
 * Each entry reproduces that customer's last issued Commercial Invoice —
 * its heading, the labels and order of its meta rows, whether the HS code sits
 * inside the line or in the panel below it, which totals it carries. They are
 * only a starting point: the generator saves whatever the user edits back onto
 * the customer's profile, and from then on the saved layout wins.
 *
 * Keys are matched against the customer name the same way the profile seeds
 * are, so a customer not in this list simply gets DEFAULT_LAYOUT.
 */
import { DEFAULT_LAYOUT, type InvoiceLayout } from './invoiceLayout.js';

export interface LayoutSeed {
  /** LIKE fragment against customers.name. */
  match: string;
  /** Which profile it belongs to, when the customer has several entities. */
  profile?: string;
  /** Which issued invoice this was read from — shown in the layout editor. */
  source: string;
  layout: Partial<InvoiceLayout>;
}

const STANDARD_META: InvoiceLayout['meta'] = [
  { label: 'Date :', field: 'doc_date' },
  { label: 'Invoice# :', field: 'doc_number' },
  { label: 'SQ :', field: 'sq_number' },
  { label: 'Your order# :', field: 'po_number' },
  { label: 'Our order# :', field: 'operation_number' },
  { label: 'Client :', field: 'client_code' },
  { label: 'Attention :', field: 'attention' },
];

/** The "Our ref / PO number" ordering used on the Distribuidora and Lavollée invoices. */
const REF_META: InvoiceLayout['meta'] = [
  { label: 'Date:', field: 'doc_date' },
  { label: 'Invoice #:', field: 'doc_number' },
  { label: 'Operation#:', field: 'operation_number' },
  { label: 'SQ :', field: 'sq_number' },
  { label: 'Our ref:', field: 'our_ref' },
  { label: 'PO number:', field: 'po_number' },
  { label: 'Client:', field: 'client_code' },
];

export const LAYOUT_SEEDS: LayoutSeed[] = [
  {
    match: 'La Mesta',
    source: 'CIBE20260123 — La Mesta Chimie Fine',
    layout: {
      title: 'Commercial Invoice',
      meta: [
        { label: 'Commercial Invoice# :', field: 'doc_number' },
        { label: 'Date:', field: 'doc_date' },
        { label: 'SQ :', field: 'sq_number' },
        { label: 'Our operation#:', field: 'operation_number' },
        { label: 'PO number:', field: 'po_number' },
        { label: 'Client:', field: 'client_code' },
        { label: 'Product reference:', field: 'product_reference' },
      ],
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'TAX ID :', eori: 'EORI# :' },
      hs_code: 'panel',
      show_lot: false,
      show_description: true,
      details: [
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery address:', field: 'delivery_address' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
      ],
    },
  },
  {
    match: 'Faravelli',
    source: 'CIBE20260124 — Giusto Faravelli SpA',
    layout: {
      title: 'Commercial Invoice',
      meta: STANDARD_META,
      // The HS code and lot print inside the product cell on this one
      hs_code: 'line',
      show_lot: true,
      show_description: false,
      details: [
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery address:', field: 'delivery_address' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
      ],
      // Faravelli's invoices declare where the goods were made
      origin: true,
    },
  },
  {
    match: 'Astron Chemicals',
    source: 'CIBE20260116 — Astron Chemicals SA',
    layout: {
      title: 'Commercial Invoice',
      meta: STANDARD_META,
      hs_code: 'line',
      show_lot: true,
      show_description: false,
      // Multi-line Astron invoices close the table with a TOTAL row
      show_quantity_total: true,
      details: [
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
      ],
    },
  },
  {
    match: 'Distribuidora del Caribe',
    profile: 'Costa Rica',
    source: 'CINL20260103 — Distribuidora del Caribe CR SA',
    layout: {
      title: 'Invoice',
      meta: REF_META,
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'Tax Id:', eori: 'EORI# :' },
      hs_code: 'panel',
      show_lot: false,
      show_line_note: true,
      show_description: true,
      details: [
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
      ],
      // The Costa Rica invoices are CIF, so they carry insurance rather than VAT
      totals: [
        { label: 'Subtotal', field: 'subtotal' },
        { label: 'Freight', field: 'freight' },
        { label: 'Insurance', field: 'insurance' },
        { label: 'Total', field: 'total' },
      ],
    },
  },
  {
    match: 'Distribuidora del Caribe',
    profile: 'Guatemala',
    source: 'SOBE20260113 — Distribuidora del Caribe de Guatemala SA',
    layout: {
      title: 'Invoice',
      meta: [
        { label: 'Date:', field: 'doc_date' },
        { label: 'Invoice #:', field: 'doc_number' },
        { label: 'SQ :', field: 'sq_number' },
        { label: 'Our ref:', field: 'our_ref' },
        { label: 'PO number :', field: 'po_number' },
        { label: 'Client:', field: 'client_code' },
      ],
      labels: { to: 'To:', contact: 'Contact Person:', address: 'Address:', tax: 'NIT (TAX ID):', eori: 'EORI# :' },
      hs_code: 'panel',
      show_lot: false,
      show_line_note: true,
      show_description: true,
      details: [
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
      ],
    },
  },
  {
    match: 'Lavollee',
    source: 'CI202504BE0013 — LAVOLLEE SAS',
    layout: {
      title: 'Invoice',
      meta: [
        { label: 'Date:', field: 'doc_date' },
        { label: 'SQ :', field: 'sq_number' },
        { label: 'Our ref:', field: 'our_ref' },
        { label: 'PO number :', field: 'po_number' },
        { label: 'Client:', field: 'client_code' },
      ],
      // No "To:" label on this one — the client name simply heads the block
      labels: { to: '', contact: '', address: '', tax: 'Tax Id :', eori: 'EORI# :' },
      hs_code: 'off',
      show_lot: false,
      show_description: true,
      details: [
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
      ],
      totals: [
        { label: 'Subtotal', field: 'subtotal' },
        { label: 'Freight', field: 'freight' },
        { label: 'Vat', field: 'vat' },
        { label: 'Total due', field: 'total' },
      ],
    },
  },
  {
    match: 'Nopa Nordic',
    source: 'CIBE20260102 — Nopa Nordic A/S',
    layout: {
      title: 'Commercial Invoice',
      meta: [
        { label: 'Date :', field: 'doc_date' },
        { label: 'Invoice nr :', field: 'doc_number' },
        { label: 'SQ :', field: 'sq_number' },
        { label: 'Order ref :', field: 'operation_number' },
        { label: 'PO number :', field: 'po_number' },
        { label: 'Client :', field: 'client_code' },
      ],
      labels: { to: 'Client :', contact: 'Contact Person :', address: 'Billing address :', tax: 'Tax Id :', eori: 'EORI# :' },
      columns: [
        ...DEFAULT_LAYOUT.columns.slice(0, 5),
        { key: 'unit_price', label: 'Price/kg', width: 81 },
        { key: 'amount', label: 'Total', width: 67.5 },
      ],
      hs_code: 'off',
      show_lot: false,
      show_description: true,
      details: [
        { label: 'Payment terms :', field: 'payment_terms' },
        { label: 'Incoterm and destination :', field: 'incoterm' },
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Delivery date :', field: 'delivery_date_text' },
      ],
      // This one states the value in the lines only
      totals: [],
    },
  },
  {
    match: 'Independent Chemical',
    source: 'CIBE20260101 — Independent Chemical Corporation',
    layout: {
      title: 'Invoice',
      meta: [
        { label: 'Date :', field: 'doc_date' },
        { label: 'SQ :', field: 'sq_number' },
        { label: 'Our ref :', field: 'operation_number' },
        { label: 'PO number :', field: 'po_number' },
        { label: 'Client :', field: 'client_code' },
      ],
      labels: { to: 'Client :', contact: 'Contact Person :', address: 'Billing address :', tax: 'Tax Id :', eori: 'EORI# :' },
      columns: [
        ...DEFAULT_LAYOUT.columns.slice(0, 4),
        { key: 'quantity', label: 'Quantity lb', width: 72 },
        { key: 'unit_price', label: 'Price/lb USD', width: 81 },
        { key: 'amount', label: 'Total USD', width: 67.5 },
      ],
      hs_code: 'off',
      show_lot: false,
      show_description: true,
      details: [
        { label: 'Payment terms :', field: 'payment_terms' },
        { label: 'Incoterm and destination :', field: 'incoterm' },
        { label: 'Delivery :', field: 'delivery' },
        { label: 'Requested Delivery date :', field: 'delivery_date_text' },
        { label: 'Remarks :', field: 'remarks' },
      ],
      totals: [],
      origin: true,
    },
  },
];

/** The seeded layout for a customer, if one of the supplied invoices covers them. */
export function layoutSeedFor(customerName: string, profileName?: string): LayoutSeed | null {
  const name = String(customerName || '').toLowerCase();
  const candidates = LAYOUT_SEEDS.filter(s => name.includes(s.match.toLowerCase()));
  if (!candidates.length) return null;
  return candidates.find(s => s.profile && s.profile === profileName)
    || candidates.find(s => !s.profile)
    || null;
}
