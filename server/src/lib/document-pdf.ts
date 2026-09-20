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
 * Both documents share every block; only the title, the meta rows and a few
 * invoice-only extras (EORI, lot, manufacturer) differ — see `KINDS` below.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// docx gridCol twips ÷ 20 → points (766, 1744, 2430, 1440, 1440, 1620, 1350)
const COLS = [
  { key: 'line', label: 'Line', width: 38.3 },
  { key: 'reference', label: 'Reference', width: 87.2 },
  { key: 'commercial_name', label: 'Commercial name', width: 121.5 },
  { key: 'packaging', label: 'Packaging', width: 72 },
  { key: 'quantity', label: 'Quantity', width: 72 },
  { key: 'unit_price', label: 'Unit price', width: 81 },
  { key: 'amount', label: 'Amount', width: 67.5 },
];

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

export type DocumentKind = 'order_confirmation' | 'invoice';

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
  /** Invoice only — printed under the commercial name. */
  lot?: string | null;
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
  // Document meta
  doc_date?: string | null; // YYYY-MM-DD
  sq_number?: string | null;
  our_ref?: string | null;
  po_number?: string | null; // "PO number" / "Your order#"
  operation_number?: string | null; // "Our order#" (invoice only)
  client_code?: string | null;
  attention?: string | null; // invoice only
  // Client
  client_name?: string | null;
  billing_address?: string | null; // one line per row
  client_phone?: string | null;
  tax_id?: string | null;
  eori?: string | null; // invoice only
  /** Where the document gets emailed — carried on the record, never printed. */
  contact_email?: string | null;
  // Items
  items?: DocLine[];
  // Delivery
  delivery?: string | null;
  delivery_address?: string | null;
  delivery_contact?: string | null;
  delivery_date_text?: string | null;
  // Totals
  freight?: number | null;
  vat?: number | null;
  // Origin — invoice only, opt-in
  manufacturer?: string | null;
  country_of_origin?: string | null;
  // Terms and bank — entity constants, supplied from app settings
  terms?: string | null;
  bank_name?: string | null;
  iban?: string | null;
  bic?: string | null;
  bank_address?: string | null;
}

/** What separates the two documents. Everything else is shared. */
const KINDS: Record<DocumentKind, { title: string; metaRows: (d: DocumentData) => Array<[string, string]> }> = {
  order_confirmation: {
    title: 'Order Confirmation',
    metaRows: d => [
      ['Date:', formatLongDate(d.doc_date)],
      ['SQ:', d.sq_number || ''],
      ['Our ref:', d.our_ref || ''],
      ['PO number:', d.po_number || ''],
      ['Client:', d.client_code || ''],
    ],
  },
  invoice: {
    title: 'Commercial Invoice',
    metaRows: d => [
      ['Date :', formatLongDate(d.doc_date)],
      ['Invoice# :', d.doc_number || ''],
      ['SQ :', d.sq_number || ''],
      ['Your order# :', d.po_number || ''],
      ['Our order# :', d.operation_number || ''],
      ['Client :', d.client_code || ''],
      ['Attention :', d.attention || ''],
    ],
  },
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-09-16" → "16 September 2026". Non-ISO input passes through. */
export function formatLongDate(iso?: string | null): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
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
  return { subtotal, freight, vat, total: subtotal + freight + vat, currency: docCurrency(items) };
}

function cellValues(item: DocLine, index: number): Record<string, string> {
  const currency = (item.currency || 'EUR').toUpperCase();
  const unit = (item.quantity_unit || '').toUpperCase();
  const qty = num(item.quantity);
  const price = num(item.unit_price);

  return {
    line: String(item.line ?? index + 1),
    reference: item.reference || '',
    // The masters print the lot beneath the product name, inside the same cell
    commercial_name: [item.commercial_name || '', item.lot ? `Lot : ${item.lot}` : ''].filter(Boolean).join('\n'),
    packaging: item.packaging || '',
    quantity: qty ? `${fmt(qty)}${unit ? ` ${unit}` : ''}` : '',
    unit_price: price ? `${fmt(price)} ${currency}${unit ? ` /${unit}` : ''}` : '',
    amount: qty && price ? `${fmt(qty * price)} ${currency}` : '',
  };
}

/** Renders the document and resolves with the finished PDF bytes. */
export async function buildDocumentPdf(kind: DocumentKind, data: DocumentData): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  let y = drawHeader(doc, data);
  y = drawTitleAndMeta(doc, kind, data, y);
  y = drawTable(doc, data, y + 10);
  y = drawDetailPanel(doc, data, y);
  y = drawOriginBlock(doc, data, y);
  drawFooterBlocks(doc, data, y + 16);
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

// ── Green title, document meta, client block ──────────────────────────────
function drawTitleAndMeta(doc: any, kind: DocumentKind, data: DocumentData, top: number): number {
  let y = top + 14;

  doc.font('Helvetica-Bold').fontSize(TITLE).fillColor(GREEN_TITLE)
    .text(`${KINDS[kind].title}  ${data.doc_number || ''}`.trimEnd(), L, y, { width: W, lineBreak: false });
  y += TITLE * 1.5;

  for (const [label, value] of KINDS[kind].metaRows(data)) {
    if (!value) continue;
    y += labelled(doc, label, value, L, y, W * 0.6, { size: META });
  }

  // Client block — bold throughout, as in the master
  y += 8;
  const clientLines = [
    data.client_name || '',
    ...String(data.billing_address || '').split('\n').map(s => s.trim()).filter(Boolean),
    data.client_phone || '',
  ].filter(Boolean);

  for (const text of clientLines) {
    doc.font('Helvetica-Bold').fontSize(META).fillColor(BLACK)
      .text(text, L, y, { width: W * 0.6 });
    y += Math.max(META * 1.3, doc.heightOfString(text, { width: W * 0.6 }));
  }
  if (data.tax_id) y += labelled(doc, 'Tax Id :', data.tax_id, L, y, W * 0.6, { size: META, boldValue: true });
  if (data.eori) y += labelled(doc, 'EORI# :', data.eori, L, y, W * 0.6, { size: META, boldValue: true });

  return y;
}

// ── Line-item table ───────────────────────────────────────────────────────
function drawTable(doc: any, data: DocumentData, top: number): number {
  const items = Array.isArray(data.items) ? data.items : [];
  const PAD = 5;
  const HEADER_H = 24;

  doc.rect(L, top, W, HEADER_H).fill(GREEN_HEAD);
  let x = L;
  for (const col of COLS) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#FFFFFF')
      .text(col.label, x + PAD, top + 7, { width: col.width - PAD * 2, lineBreak: false });
    x += col.width;
  }

  let y = top + HEADER_H;
  items.forEach((item, index) => {
    const values = cellValues(item, index);

    let contentH = 0;
    for (const col of COLS) {
      doc.font('Helvetica').fontSize(BODY);
      contentH = Math.max(contentH, doc.heightOfString(values[col.key] || ' ', { width: col.width - PAD * 2 }));
    }
    const rowH = Math.max(24, contentH + 10);
    y = ensureRoom(doc, y, rowH);

    doc.rect(L, y, W, rowH).fill(GREEN_ROW);
    let cx = L;
    for (const col of COLS) {
      doc.font('Helvetica').fontSize(BODY).fillColor(BLACK)
        .text(values[col.key] || '', cx + PAD, y + 5, { width: col.width - PAD * 2 });
      cx += col.width;
    }
    y += rowH;
  });

  return y;
}

// ── Merged detail cell: HS code, description, delivery, totals ────────────
function drawDetailPanel(doc: any, data: DocumentData, top: number): number {
  const items = Array.isArray(data.items) ? data.items : [];
  const PAD = 7;
  const innerW = W - PAD * 2;
  const lh = BODY * 1.32;
  const { subtotal, freight, vat, total, currency } = computeTotals(data);

  const detailed = items.filter(i => i.hs_code || i.description);
  const rows: Array<[string, string]> = [
    ['Delivery :', data.delivery || ''],
    ['Delivery address:', data.delivery_address || ''],
    ['Contact', data.delivery_contact || ''],
    ['Delivery date :', data.delivery_date_text || ''],
  ].filter(([, v]) => !!v) as Array<[string, string]>;

  const totalRows: Array<[string, string]> = [
    ['Subtotal', `${fmt(subtotal)} ${currency}`],
    ['Freight', freight ? `${fmt(freight)} ${currency}` : '0'],
    ['Vat', vat ? `${fmt(vat)} ${currency}` : '0'],
    ['Total Order', `${fmt(total)} ${currency}`],
  ];

  // Measure first so the panel sits behind the full block
  doc.font('Helvetica').fontSize(BODY);
  let height = 10;
  for (const item of detailed) {
    if (item.hs_code) height += lh;
    if (item.description) height += lh + doc.heightOfString(item.description, { width: innerW }) + 4;
  }
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').fontSize(BODY);
    const labelW = doc.widthOfString(label) + 4;
    doc.font('Helvetica').fontSize(BODY);
    height += Math.max(lh, doc.heightOfString(value, { width: innerW - labelW }));
  }
  height += 6 + totalRows.length * lh + 6;

  top = ensureRoom(doc, top, height);
  doc.rect(L, top, W, height).fill(GREEN_PANEL);

  let y = top + 10;
  for (const item of detailed) {
    if (item.hs_code) {
      doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
        .text(`HS code: ${item.hs_code}`, L + PAD, y, { width: innerW, lineBreak: false });
      y += lh;
    }
    if (item.description) {
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
  y += 6;
  for (const [label, value] of totalRows) {
    doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
      .text(label, L + PAD, y, { width: innerW * 0.6, lineBreak: false });
    doc.font('Helvetica').fontSize(BODY).fillColor(BLACK)
      .text(value, L + PAD, y, { width: innerW, align: 'right', lineBreak: false });
    y += lh;
  }

  return top + height;
}

// ── Manufacturer / country of origin (invoice, opt-in) ────────────────────
function drawOriginBlock(doc: any, data: DocumentData, top: number): number {
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
function drawFooterBlocks(doc: any, data: DocumentData, top: number) {
  doc.font('Helvetica').fontSize(BODY);
  const termsH = HEADING * 1.4 + (data.terms ? doc.heightOfString(data.terms, { width: W }) : 0);
  let y = ensureRoom(doc, top, termsH);

  doc.font('Helvetica-Bold').fontSize(HEADING).fillColor(GREEN_TITLE)
    .text('Terms & Conditions', L, y, { width: W, lineBreak: false });
  y += HEADING * 1.4;

  if (data.terms) {
    doc.font('Helvetica').fontSize(BODY).fillColor(BLACK).text(data.terms, L, y, { width: W });
    y += doc.heightOfString(data.terms, { width: W });
  }

  // The master runs IBAN / BIC / Address together on a single line
  const accountParts: Array<[string, string]> = [
    ['IBAN: ', data.iban || ''],
    ['BIC: ', data.bic || ''],
    ['Address: ', data.bank_address || ''],
  ].filter(([, v]) => !!v) as Array<[string, string]>;

  if (!data.bank_name && !accountParts.length) return;

  const bankLines = (data.bank_name ? 1 : 0) + (accountParts.length ? 1 : 0);
  y = ensureRoom(doc, y + 10, HEADING * 1.4 + bankLines * BODY * 1.32);
  doc.font('Helvetica-Bold').fontSize(HEADING).fillColor(GREEN_TITLE)
    .text('Bank Transfer', L, y, { width: W, lineBreak: false });
  y += HEADING * 1.4;

  if (data.bank_name) y += labelled(doc, 'Bank:', data.bank_name, L, y, W, { size: BODY });

  if (accountParts.length) {
    doc.fillColor(BLACK).fontSize(BODY);
    accountParts.forEach(([label, value], i) => {
      doc.font('Helvetica-Bold').text(i === 0 ? label : `    ${label}`, i === 0 ? L : undefined, i === 0 ? y : undefined, { continued: true });
      doc.font('Helvetica').text(value, { continued: i < accountParts.length - 1 });
    });
    y += BODY * 1.32;
  }
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
