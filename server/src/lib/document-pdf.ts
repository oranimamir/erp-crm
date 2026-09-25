/**
 * Order Confirmation / Commercial Invoice PDF — the TripleW company template.
 *
 * Geometry, palette and type sizes are taken from the Word masters
 * (SOBE20260124 OC FR LAVOLLEE LACLC90.docx and CIBE20260112 GR ASTRON …docx):
 * issuer block top-left with the logo anchored right, green title, meta and
 * client blocks, the line-item table with its merged detail panel, then
 * Terms & Conditions and the bank block. Column widths are the docx
 * `w:gridCol` values converted to points.
 *
 * Which rows appear, what they are called, which columns the table has and
 * where the HS code, lot and line notes print all come from an `InvoiceLayout`
 * — per customer for invoices (see lib/invoiceLayout.ts), fixed for the order
 * confirmation.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_LAYOUT,
  ORIGINAL_COLUMNS,
  normalizeLayout,
  type InvoiceLayout,
  type LayoutColumn,
} from './invoiceLayout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'triplew-logo.png');

// ── Template palette (docx w:fill / w:color values) ───────────────────────
const GREEN_TITLE = '#00CC66'; // title and section headings
const GREEN_HEAD = '#4EA72E'; // table header band
const GREEN_ROW = '#D0E1CD'; // line-item rows
const GREEN_PANEL = '#E9F1E8'; // merged detail cell
const BLACK = '#000000';

// ── Page geometry ─────────────────────────────────────────────────────────
const L = 28;
const R = 567.5;
const W = R - L;

const BODY = 11;
const META = 11.5;
const HEADING = 15;
const TITLE = 24;

// A4 height is 841.89pt; the page number sits at 812, so content stops above it.
const CONTENT_BOTTOM = 796;
const PAGE_TOP = 40;

/**
 * Starts a new page when `needed` points won't fit. Without this, pdfkit
 * silently paginates on every individual text call that lands past the bottom,
 * turning one overflowing block into a page per line.
 */
function ensureRoom(doc: any, y: number, needed: number): number {
  if (y + needed <= CONTENT_BOTTOM) return y;
  doc.addPage({ size: 'A4', margin: 0 });
  return PAGE_TOP;
}

export type DocumentKind = 'order_confirmation' | 'invoice' | 'purchase_order';

export interface DocLine {
  line?: number | null;
  reference?: string | null;
  commercial_name?: string | null;
  packaging?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
  unit_price?: number | null;
  currency?: string | null;
  hs_code?: string | null;
  description?: string | null;
  /** Printed under the commercial name. */
  lot?: string | null;
  /** An optional second lot of the same product, printed directly under the first. */
  lot2?: string | null;
  /** Free note under the line — "80 drums on 20 pallets", "2 pallets lot 01-2601-001". */
  note?: string | null;
}

export interface DocumentData {
  /** Order confirmation number, or invoice number when kind is 'invoice'. */
  doc_number?: string | null;
  // Issuer — entity constants, supplied from app settings
  company_name?: string | null;
  company_address1?: string | null;
  company_address2?: string | null;
  company_address3?: string | null;
  company_tel?: string | null;
  company_email?: string | null;
  company_vat?: string | null;
  company_kvk?: string | null;
  /** The entity's contact person, printed under its address. */
  company_contact?: string | null;
  /** Which TripleW entity issued this — lets the bank follow the currency. */
  entity_code?: string | null;
  /** Set when the bank came from the customer's profile, so it is never swapped. */
  bank_override?: boolean | null;
  // Document meta
  doc_date?: string | null; // YYYY-MM-DD
  sq_number?: string | null;
  our_ref?: string | null;
  po_number?: string | null; // "PO number" / "Your order#"
  operation_number?: string | null; // "Our order#" (invoice only)
  client_code?: string | null;
  attention?: string | null; // invoice only
  /** The product this invoice is about, printed as its own meta row. */
  product_reference?: string | null;
  // Client
  client_name?: string | null;
  billing_address?: string | null; // one line per row
  /** The customer's contact person, printed with their phone and email. */
  client_contact?: string | null;
  client_phone?: string | null;
  tax_id?: string | null;
  eori?: string | null; // invoice only
  /** Where the document gets emailed; the invoice also prints it under the contact. */
  contact_email?: string | null;
  // Items
  items?: DocLine[];
  // Delivery
  delivery?: string | null;
  delivery_address?: string | null;
  delivery_contact?: string | null;
  delivery_date_text?: string | null;
  /** Invoice extras that some customers' documents carry. */
  payment_terms?: string | null;
  incoterm?: string | null;
  remarks?: string | null;
  /** Free text printed under the table. */
  notes?: string | null;
  // Totals
  freight?: number | null;
  vat?: number | null;
  insurance?: number | null;
  // Origin — invoice only, opt-in
  manufacturer?: string | null;
  country_of_origin?: string | null;
  // Terms and bank — entity constants, supplied from app settings
  terms?: string | null;
  bank_name?: string | null;
  iban?: string | null;
  bic?: string | null;
  bank_address?: string | null;
  /** How this customer's invoice is laid out. Absent → the house default. */
  layout?: Partial<InvoiceLayout> | null;
}

/** The order confirmation's shape, expressed in the same terms as an invoice layout. */
const OC_LAYOUT: InvoiceLayout = {
  ...DEFAULT_LAYOUT,
  title: 'Order Confirmation',
  meta: [
    { label: 'Date:', field: 'doc_date' },
    { label: 'SQ:', field: 'sq_number' },
    { label: 'Our ref:', field: 'our_ref' },
    { label: 'PO number:', field: 'po_number' },
    { label: 'Client:', field: 'client_code' },
  ],
  labels: { ...DEFAULT_LAYOUT.labels, to: '', contact: '', address: '', tax: 'Tax Id :' },
  // The confirmation keeps the docx master's seven columns
  columns: ORIGINAL_COLUMNS,
  hs_code: 'panel',
  // One account detail per line, as on the invoices
  bank_inline: false,
};

/** A supplier purchase order: the confirmation's shape, addressed to the supplier. */
const PO_LAYOUT: InvoiceLayout = {
  ...OC_LAYOUT,
  title: 'Purchase Order',
  meta: [
    { label: 'Date:', field: 'doc_date' },
    { label: 'Our ref:', field: 'our_ref' },
    { label: 'Your ref:', field: 'sq_number' },
    { label: 'Supplier:', field: 'client_code' },
  ],
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "2026-09-16" → "16 September 2026". Non-ISO input passes through unchanged —
 * delivery dates are free text ("Septiembre 2026") and AI extraction can return
 * an out-of-range month, which must never reach a document as "undefined".
 */
export function formatLongDate(iso?: string | null): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return String(iso);
  return `${day} ${month} ${m[1]}`;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function lineAmount(item: DocLine): number {
  return num(item.quantity) * num(item.unit_price);
}

/** Currency of the document — taken from the first priced line. */
export function docCurrency(items: DocLine[]): string {
  return (items.find(i => i.currency)?.currency || 'EUR').toUpperCase();
}

export function computeTotals(data: DocumentData) {
  const items = Array.isArray(data.items) ? data.items : [];
  const subtotal = items.reduce((sum, item) => sum + lineAmount(item), 0);
  const freight = num(data.freight);
  const vat = num(data.vat);
  const insurance = num(data.insurance);
  return {
    subtotal, freight, vat, insurance,
    total: subtotal + freight + vat + insurance,
    currency: docCurrency(items),
  };
}

/** The layout in force: the customer's for an invoice, the fixed one for a confirmation. */
function layoutFor(kind: DocumentKind, data: DocumentData): InvoiceLayout {
  if (kind === 'invoice') return normalizeLayout(data.layout);
  return kind === 'purchase_order' ? PO_LAYOUT : OC_LAYOUT;
}

/** Column widths are editable, so rescale them to fill exactly the page width. */
function fittedColumns(layout: InvoiceLayout): LayoutColumn[] {
  const total = layout.columns.reduce((sum, c) => sum + c.width, 0);
  if (!total) return layout.columns;
  const scale = W / total;
  return layout.columns.map(c => ({ ...c, width: c.width * scale }));
}

function metaValue(field: string, data: DocumentData): string {
  switch (field) {
    case 'doc_date': return formatLongDate(data.doc_date);
    case 'doc_number': return data.doc_number || '';
    case 'sq_number': return data.sq_number || '';
    case 'po_number': return data.po_number || '';
    case 'operation_number': return data.operation_number || '';
    case 'our_ref': return data.our_ref || '';
    case 'client_code': return data.client_code || '';
    case 'attention': return data.attention || '';
    case 'product_reference': return data.product_reference || '';
    default: return '';
  }
}

function detailValue(field: string, data: DocumentData): string {
  switch (field) {
    case 'delivery': return data.delivery || '';
    case 'delivery_address': return data.delivery_address || '';
    case 'delivery_contact': return data.delivery_contact || '';
    case 'delivery_date_text': return data.delivery_date_text || '';
    case 'payment_terms': return data.payment_terms || '';
    case 'incoterm': return data.incoterm || '';
    case 'remarks': return data.remarks || '';
    default: return '';
  }
}

function cellValues(item: DocLine, index: number, layout: InvoiceLayout): Record<string, string> {
  const currency = (item.currency || 'EUR').toUpperCase();
  const unit = (item.quantity_unit || '').toUpperCase();
  const qty = num(item.quantity);
  const price = num(item.unit_price);

  // The masters stack the lot, the HS code and any note under the product name.
  // Where the HS code goes, the note follows — customers whose HS code sits in
  // the panel (La Mesta, Distribuidora) have their packing note there too.
  // A detail with its own column is printed there instead.
  const has = (key: string) => layout.columns.some(c => c.key === key);
  const inRow = layout.hs_code === 'line';
  const nameParts = [item.commercial_name || ''];
  if (inRow && item.hs_code && !has('hs_code')) nameParts.push(`HS code: ${item.hs_code}`);
  const lots = [item.lot, item.lot2].map(l => String(l || '').trim()).filter(Boolean);
  if (layout.show_lot && lots.length && !has('lot')) nameParts.push(`Lot : ${lots.join('\n        ')}`);
  if (inRow && layout.show_line_note && item.note && !has('packing_note')) nameParts.push(item.note);

  return {
    line: String(item.line ?? index + 1),
    reference: item.reference || '',
    commercial_name: nameParts.filter(Boolean).join('\n'),
    packaging: item.packaging || '',
    packing_note: item.note || '',
    hs_code: item.hs_code || '',
    lot: lots.join('\n'),
    quantity: qty ? `${fmt(qty)}${unit ? ` ${unit}` : ''}` : '',
    unit_price: price ? `${fmt(price)} ${currency}${unit ? `/${unit}` : ''}` : '',
    amount: qty && price ? `${fmt(qty * price)} ${currency}` : '',
  };
}

/** Columns whose value is one figure or code and reads badly broken across lines. */
const NUMERIC_COLUMNS = new Set(['line', 'quantity', 'unit_price', 'amount', 'hs_code', 'lot']);

/**
 * The size a figure fits its column at. "16,320 USD" is 60pt at 11pt against a
 * 57pt cell, and wrapping "USD" onto its own line looks like a mistake — one
 * step down keeps it whole. Text columns still wrap normally.
 */
function fittedSize(doc: any, key: string, text: string, width: number, base = BODY): number {
  if (!NUMERIC_COLUMNS.has(key) || !text || text.includes('\n')) return base;
  for (const size of [base, base - 1, base - 2]) {
    doc.font('Helvetica').fontSize(size);
    if (doc.widthOfString(text) <= width) return size;
  }
  return base - 2;
}

/** Wide tables (the invoice's ten columns) are set smaller to fit A4. */
function tableSizes(kind: DocumentKind, cols: LayoutColumn[]): { cell: number; head: number } {
  if (kind === 'invoice' || cols.length > 7) return { cell: 8.5, head: 8 };
  return { cell: BODY, head: 9.5 };
}

/**
 * One size for every cell of the table: the largest at which each figure still
 * fits its column whole. Shrinking cells one by one left the columns in
 * different sizes.
 */
function uniformCellSize(doc: any, cols: LayoutColumn[], rows: Array<Record<string, string>>, base: number, pad: number): number {
  let size = base;
  for (const values of rows) {
    for (const col of cols) {
      const text = values[col.key] || '';
      if (!NUMERIC_COLUMNS.has(col.key) || !text) continue;
      doc.font('Helvetica');
      for (const line of text.split('\n')) {
        while (size > base - 2 && doc.fontSize(size).widthOfString(line) > col.width - pad * 2) size -= 0.5;
      }
    }
  }
  return size;
}

/** Renders the document and resolves with the finished PDF bytes. */
export async function buildDocumentPdf(kind: DocumentKind, data: DocumentData): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const layout = layoutFor(kind, data);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  let y = drawHeader(doc, data);
  y = kind === 'invoice'
    ? drawSplitTitleAndMeta(doc, layout, data, y)
    : drawStackedTitleAndMeta(doc, layout, data, y);
  y = drawTable(doc, kind, layout, data, y + 10);
  y = drawDetailPanel(doc, layout, data, y);
  y = drawNotes(doc, data, y);
  y = drawOriginBlock(doc, data, y);
  drawFooterBlocks(doc, layout, data, y + 16);
  stampPageNumbers(doc);

  doc.end();
  return done;
}

// ── Order-confirmation compatibility layer ────────────────────────────────
// Confirmations were stored with `oc_number` / `oc_date` before the invoice
// shared this builder. Keeping the alias means no data migration.

export type OcLine = DocLine;

export interface OrderConfirmationData extends Omit<DocumentData, 'doc_number' | 'doc_date'> {
  oc_number?: string | null;
  oc_date?: string | null;
}

export function buildOrderConfirmationPdf(data: OrderConfirmationData): Promise<Buffer> {
  const { oc_number, oc_date, ...rest } = data;
  return buildDocumentPdf('order_confirmation', { ...rest, doc_number: oc_number, doc_date: oc_date });
}

export interface PurchaseOrderData extends Omit<DocumentData, 'doc_number' | 'doc_date'> {
  po_number?: string | null;
  po_date?: string | null;
}

export function buildPurchaseOrderPdf(data: PurchaseOrderData): Promise<Buffer> {
  const { po_number, po_date, ...rest } = data;
  return buildDocumentPdf('purchase_order', { ...rest, doc_number: po_number, doc_date: po_date });
}

/** Bold label with a regular value beside it; returns the height consumed. */
function labelled(
  doc: any, label: string, value: string, x: number, y: number, width: number,
  opts: { size?: number; boldValue?: boolean; lh?: number } = {}
): number {
  const size = opts.size ?? BODY;
  const lh = opts.lh ?? size * 1.3;

  doc.font('Helvetica-Bold').fontSize(size).fillColor(BLACK);
  const labelW = label ? doc.widthOfString(label) + 4 : 0;
  if (label) doc.text(label, x, y, { width: labelW, lineBreak: false });

  if (!value) return lh;

  const valueW = width - labelW;
  doc.font(opts.boldValue ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(BLACK);
  const h = doc.heightOfString(value, { width: valueW });
  doc.text(value, x + labelW, y, { width: valueW });
  return Math.max(lh, h);
}

/** Measures `labelled` without drawing, so a two-column block can be sized first. */
function labelledHeight(doc: any, label: string, value: string, width: number, size: number): number {
  const lh = size * 1.3;
  if (!value) return lh;
  doc.font('Helvetica-Bold').fontSize(size);
  const labelW = label ? doc.widthOfString(label) + 4 : 0;
  doc.font('Helvetica').fontSize(size);
  return Math.max(lh, doc.heightOfString(value, { width: width - labelW }));
}

// ── Issuer block (left) with the logo anchored right ──────────────────────
function drawHeader(doc: any, data: DocumentData): number {
  const logoW = 132;
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, R - logoW, 26, { width: logoW });
  }

  const lines: Array<[string, boolean]> = [
    [data.company_name || '', true],
    [data.company_address1 || '', false],
    [data.company_address2 || '', false],
    [data.company_address3 || '', false],
    [data.company_contact ? `Contact: ${data.company_contact}` : '', false],
    [data.company_tel ? `Tel: ${data.company_tel}` : '', false],
    [data.company_email ? `Email: ${data.company_email}` : '', false],
    [data.company_vat ? `VAT: ${data.company_vat}` : '', false],
    [data.company_kvk ? `KVK: ${data.company_kvk}` : '', false],
  ];

  let y = 32;
  for (const [text, bold] of lines) {
    if (!text) continue;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(BODY).fillColor(BLACK)
      .text(text, L, y, { width: W - logoW - 20, lineBreak: false });
    y += 15;
  }

  // Never let the title ride up under the logo
  return Math.max(y, 26 + logoW / 1.72 + 10);
}

/** Green heading with the document number beside it. */
function drawTitle(doc: any, layout: InvoiceLayout, data: DocumentData, top: number): number {
  const y = top + 14;
  doc.font('Helvetica-Bold').fontSize(TITLE).fillColor(GREEN_TITLE)
    .text(`${layout.title}  ${data.doc_number || ''}`.trimEnd(), L, y, { width: W, lineBreak: false });
  return y + TITLE * 1.5;
}

/** The client block's lines, in print order. */
function clientLines(layout: InvoiceLayout, data: DocumentData): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (data.client_name) out.push([layout.labels.to, data.client_name]);

  // Contact person, then their phone and email under the same label
  const contact = [data.client_contact, data.client_phone, data.contact_email]
    .map(v => String(v || '').trim()).filter(Boolean);
  contact.forEach((line, i) => out.push([i === 0 ? layout.labels.contact : '', line]));

  const address = String(data.billing_address || '').split('\n').map(s => s.trim()).filter(Boolean);
  address.forEach((line, i) => out.push([i === 0 ? layout.labels.address : '', line]));

  if (data.tax_id) out.push([layout.labels.tax, data.tax_id]);
  if (data.eori) out.push([layout.labels.eori, data.eori]);
  return out;
}

/**
 * Order confirmation: meta rows stacked under the title, client block beneath.
 */
function drawStackedTitleAndMeta(doc: any, layout: InvoiceLayout, data: DocumentData, top: number): number {
  let y = drawTitle(doc, layout, data, top);

  for (const row of layout.meta) {
    const value = metaValue(row.field, data);
    if (!value) continue;
    y += labelled(doc, row.label, value, L, y, W * 0.6, { size: META });
  }

  // Client block — bold throughout, as in the master
  y += 8;
  const lines = [
    data.client_name || '',
    ...String(data.billing_address || '').split('\n').map(s => s.trim()).filter(Boolean),
    data.client_phone || '',
  ].filter(Boolean);

  for (const text of lines) {
    doc.font('Helvetica-Bold').fontSize(META).fillColor(BLACK).text(text, L, y, { width: W * 0.6 });
    y += Math.max(META * 1.3, doc.heightOfString(text, { width: W * 0.6 }));
  }
  if (data.tax_id) y += labelled(doc, layout.labels.tax, data.tax_id, L, y, W * 0.6, { size: META, boldValue: true });
  if (data.eori) y += labelled(doc, layout.labels.eori, data.eori, L, y, W * 0.6, { size: META, boldValue: true });

  return y;
}

/**
 * Invoice: client block on the left, document meta on the right, as every one
 * of the company's issued invoices is set.
 */
function drawSplitTitleAndMeta(doc: any, layout: InvoiceLayout, data: DocumentData, top: number): number {
  const y0 = drawTitle(doc, layout, data, top);

  const gap = 18;
  const leftW = (W - gap) * 0.56;
  const rightW = W - gap - leftW;
  const rightX = L + leftW + gap;

  let leftY = y0;
  for (const [label, value] of clientLines(layout, data)) {
    leftY += labelled(doc, label, value, L, leftY, leftW, { size: META, boldValue: true });
  }

  let rightY = y0;
  for (const row of layout.meta) {
    const value = metaValue(row.field, data);
    if (!value) continue;
    rightY += labelled(doc, row.label, value, rightX, rightY, rightW, { size: META });
  }

  return Math.max(leftY, rightY);
}

// ── Line-item table ───────────────────────────────────────────────────────
function drawTable(doc: any, kind: DocumentKind, layout: InvoiceLayout, data: DocumentData, top: number): number {
  const items = Array.isArray(data.items) ? data.items : [];
  const cols = fittedColumns(layout);
  const PAD = 5;
  const size = tableSizes(kind, cols);
  const rows = items.map((item, index) => cellValues(item, index, layout));
  const cellSize = uniformCellSize(doc, cols, rows, size.cell, PAD);

  // A heading may wrap between words, never inside one — a word too wide for
  // its column sets that heading smaller instead
  const headSizes = cols.map(c => {
    const inner = c.width - PAD * 2;
    let s = size.head;
    doc.font('Helvetica-Bold');
    while (s > 6.5 && c.label.split(/\s+/).some(w => doc.fontSize(s).widthOfString(w) > inner)) s -= 0.5;
    return s;
  });
  const headText = Math.max(...cols.map((c, i) =>
    doc.font('Helvetica-Bold').fontSize(headSizes[i]).heightOfString(c.label, { width: c.width - PAD * 2 })));
  const HEADER_H = Math.max(24, headText + 14);

  top = ensureRoom(doc, top, HEADER_H + 24);
  doc.rect(L, top, W, HEADER_H).fill(GREEN_HEAD);
  let x = L;
  for (const [i, col] of cols.entries()) {
    doc.font('Helvetica-Bold').fontSize(headSizes[i]).fillColor('#FFFFFF')
      .text(col.label, x + PAD, top + 7, { width: col.width - PAD * 2 });
    x += col.width;
  }

  let y = top + HEADER_H;
  rows.forEach(values => {
    let contentH = 0;
    doc.font('Helvetica').fontSize(cellSize);
    for (const col of cols) {
      contentH = Math.max(contentH, doc.heightOfString(values[col.key] || ' ', { width: col.width - PAD * 2 }));
    }
    const rowH = Math.max(24, contentH + 10);
    y = ensureRoom(doc, y, rowH);

    doc.rect(L, y, W, rowH).fill(GREEN_ROW);
    let cx = L;
    for (const col of cols) {
      doc.font('Helvetica').fontSize(cellSize).fillColor(BLACK)
        .text(values[col.key] || '', cx + PAD, y + 5, { width: col.width - PAD * 2 });
      cx += col.width;
    }
    y += rowH;
  });

  // A one-line table totals itself — the masters only add the row when there
  // is more than one line to add up.
  if (layout.show_quantity_total && items.length > 1) {
    y = drawQuantityTotalRow(doc, cols, items, y, cellSize);
  }

  return y;
}

/** Astron's invoices close the table with a TOTAL row over quantity and amount. */
function drawQuantityTotalRow(doc: any, cols: LayoutColumn[], items: DocLine[], y: number, size: number): number {
  const PAD = 5;
  const rowH = 24;
  y = ensureRoom(doc, y, rowH);

  const unit = (items.find(i => i.quantity_unit)?.quantity_unit || '').toUpperCase();
  const qty = items.reduce((sum, i) => sum + num(i.quantity), 0);
  const amount = items.reduce((sum, i) => sum + lineAmount(i), 0);
  const currency = docCurrency(items);

  const totals: Record<string, string> = {
    quantity: qty ? `${fmt(qty)}${unit ? ` ${unit}` : ''}` : '',
    amount: amount ? `${fmt(amount)} ${currency}` : '',
  };

  doc.rect(L, y, W, rowH).fill(GREEN_ROW);

  // "TOTAL" runs across everything left of the quantity column — the Line
  // column on its own is far too narrow to hold the word
  const labelEnd = cols.findIndex(c => totals[c.key] !== undefined);
  const labelW = cols.slice(0, labelEnd < 0 ? 1 : labelEnd).reduce((sum, c) => sum + c.width, 0);
  doc.font('Helvetica-Bold').fontSize(size).fillColor(BLACK)
    .text('TOTAL', L + PAD, y + 6, { width: Math.max(40, labelW - PAD * 2), lineBreak: false });

  let cx = L;
  for (const col of cols) {
    const text = totals[col.key];
    if (text) {
      doc.font('Helvetica-Bold').fontSize(fittedSize(doc, col.key, text, col.width - PAD * 2, size))
        .fillColor(BLACK)
        .text(text, cx + PAD, y + 6, { width: col.width - PAD * 2, lineBreak: false });
    }
    cx += col.width;
  }
  return y + rowH;
}

// ── Merged detail cell: HS code, description, delivery, totals ────────────
function drawDetailPanel(doc: any, layout: InvoiceLayout, data: DocumentData, top: number): number {
  const items = Array.isArray(data.items) ? data.items : [];
  const PAD = 7;
  const innerW = W - PAD * 2;
  const lh = BODY * 1.32;
  const totals = computeTotals(data);

  const has = (key: string) => layout.columns.some(c => c.key === key);
  const showHs = layout.hs_code === 'panel' && !has('hs_code');
  const showNote = layout.hs_code === 'panel' && layout.show_line_note && !has('packing_note');
  const detailed = items.filter(i =>
    (showNote && i.note) || (showHs && i.hs_code) || (layout.show_description && i.description));

  const rows = layout.details
    .map(row => [row.label, detailValue(row.field, data)] as [string, string])
    .filter(([, value]) => !!value);

  const totalRows = layout.totals.map(row => {
    const value = row.field === 'total' ? totals.total : (totals as any)[row.field] ?? 0;
    // A zero Freight/VAT line still prints — the masters show them as "0"
    const text = row.field === 'subtotal' || row.field === 'total' || value
      ? `${fmt(value)} ${totals.currency}`
      : '0';
    return [row.label, text] as [string, string];
  });

  if (!detailed.length && !rows.length && !totalRows.length) return top;

  // Measure first so the panel sits behind the full block
  doc.font('Helvetica').fontSize(BODY);
  let height = 10;
  for (const item of detailed) {
    if (showNote && item.note) height += doc.heightOfString(item.note, { width: innerW });
    if (showHs && item.hs_code) height += lh;
    if (layout.show_description && item.description) {
      height += lh + doc.heightOfString(item.description, { width: innerW }) + 4;
    }
  }
  for (const [label, value] of rows) {
    height += labelledHeight(doc, label, value, innerW, BODY);
  }
  height += (totalRows.length ? 6 + totalRows.length * lh : 0) + 6;

  top = ensureRoom(doc, top, height);
  doc.rect(L, top, W, height).fill(GREEN_PANEL);

  let y = top + 10;
  for (const item of detailed) {
    if (showNote && item.note) {
      doc.font('Helvetica').fontSize(BODY).fillColor(BLACK).text(item.note, L + PAD, y, { width: innerW });
      y += doc.heightOfString(item.note, { width: innerW });
    }
    if (showHs && item.hs_code) {
      doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
        .text(`HS code: ${item.hs_code}`, L + PAD, y, { width: innerW, lineBreak: false });
      y += lh;
    }
    if (layout.show_description && item.description) {
      doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
        .text('Description:', L + PAD, y, { width: innerW, lineBreak: false });
      y += lh;
      doc.font('Helvetica').fontSize(BODY).fillColor(BLACK)
        .text(item.description, L + PAD, y, { width: innerW });
      y += doc.heightOfString(item.description, { width: innerW }) + 4;
    }
  }

  for (const [label, value] of rows) {
    y += labelled(doc, label, value, L + PAD, y, innerW, { size: BODY, boldValue: true });
  }

  // Totals — labels left, figures right-aligned against the panel edge
  if (totalRows.length) {
    y += 6;
    for (const [label, value] of totalRows) {
      doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
        .text(label, L + PAD, y, { width: innerW * 0.6, lineBreak: false });
      doc.font('Helvetica').fontSize(BODY).fillColor(BLACK)
        .text(value, L + PAD, y, { width: innerW, align: 'right', lineBreak: false });
      y += lh;
    }
  }

  return top + height;
}

// ── Notes under the table ─────────────────────────────────────────────────
function drawNotes(doc: any, data: DocumentData, top: number): number {
  const notes = String(data.notes || '').trim();
  if (!notes) return top;

  doc.font('Helvetica').fontSize(BODY);
  const lh = BODY * 1.32;
  let y = ensureRoom(doc, top + 10, lh + doc.heightOfString(notes, { width: W }));
  doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK).text('Notes', L, y, { width: W, lineBreak: false });
  y += lh;
  doc.font('Helvetica').fontSize(BODY).fillColor(BLACK).text(notes, L, y, { width: W });
  return y + doc.heightOfString(notes, { width: W });
}

// ── Manufacturer / country of origin (invoice, opt-in) ────────────────────
function drawOriginBlock(doc: any, data: DocumentData, top: number): number {
  // `layout.origin` only decides whether the generator *offers* the block; the
  // values reaching here are what the user chose to declare.
  if (!data.manufacturer && !data.country_of_origin) return top;

  doc.font('Helvetica').fontSize(BODY);
  const needed = 10
    + (data.manufacturer ? BODY * 1.32 + doc.heightOfString(data.manufacturer, { width: W }) + 2 : 0)
    + (data.country_of_origin ? BODY * 2.64 : 0);

  let y = ensureRoom(doc, top + 10, needed);
  if (data.manufacturer) {
    doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
      .text('Manufacturer', L, y, { width: W, lineBreak: false });
    y += BODY * 1.32;
    doc.font('Helvetica').fontSize(BODY).fillColor(BLACK).text(data.manufacturer, L, y, { width: W });
    y += doc.heightOfString(data.manufacturer, { width: W }) + 2;
  }
  if (data.country_of_origin) {
    doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
      .text('Country of origin', L, y, { width: W, lineBreak: false });
    y += BODY * 1.32;
    doc.font('Helvetica').fontSize(BODY).fillColor(BLACK)
      .text(data.country_of_origin, L, y, { width: W, lineBreak: false });
    y += BODY * 1.32;
  }
  return y;
}

// ── Terms & Conditions, then the bank block ───────────────────────────────
function drawFooterBlocks(doc: any, layout: InvoiceLayout, data: DocumentData, top: number) {
  doc.font('Helvetica').fontSize(BODY);
  const termsH = HEADING * 1.4 + (data.terms ? doc.heightOfString(data.terms, { width: W }) : 0);
  let y = ensureRoom(doc, top, termsH);

  doc.font('Helvetica-Bold').fontSize(HEADING).fillColor(GREEN_TITLE)
    .text(layout.terms_heading, L, y, { width: W, lineBreak: false });
  y += HEADING * 1.4;

  if (data.terms) {
    doc.font('Helvetica').fontSize(BODY).fillColor(BLACK).text(data.terms, L, y, { width: W });
    y += doc.heightOfString(data.terms, { width: W });
  }

  // One account detail per line, as every issued invoice sets them
  const accountParts: Array<[string, string]> = [
    ['Bank:', data.bank_name || ''],
    ['IBAN :', data.iban || ''],
    ['BIC :', data.bic || ''],
    ['Address :', data.bank_address || ''],
  ].filter(([, v]) => !!v) as Array<[string, string]>;

  if (!accountParts.length) return;

  const lines = layout.bank_inline ? Math.min(2, accountParts.length) : accountParts.length;
  y = ensureRoom(doc, y + 10, HEADING * 1.4 + lines * BODY * 1.32);
  doc.font('Helvetica-Bold').fontSize(HEADING).fillColor(GREEN_TITLE)
    .text(layout.bank_heading, L, y, { width: W, lineBreak: false });
  y += HEADING * 1.4;

  if (!layout.bank_inline) {
    for (const [label, value] of accountParts) {
      y += labelled(doc, label, value, L, y, W, { size: BODY });
    }
    return;
  }

  // Compact form: the bank on its own line, the account details run together
  const [bank, ...account] = accountParts;
  if (bank[0] === 'Bank:') y += labelled(doc, bank[0], bank[1], L, y, W, { size: BODY });
  const rest = bank[0] === 'Bank:' ? account : accountParts;
  if (!rest.length) return;

  doc.fillColor(BLACK).fontSize(BODY);
  rest.forEach(([label, value], i) => {
    doc.font('Helvetica-Bold')
      .text(i === 0 ? `${label} ` : `    ${label} `, i === 0 ? L : undefined, i === 0 ? y : undefined, { continued: true });
    doc.font('Helvetica').text(value, { continued: i < rest.length - 1 });
  });
}

// ── "Page N of M" ─────────────────────────────────────────────────────────
function stampPageNumbers(doc: any) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(9.5).fillColor(BLACK)
      .text(`Page ${i + 1} of ${range.count}`, L, 812, { width: W, align: 'right', lineBreak: false });
  }
}
