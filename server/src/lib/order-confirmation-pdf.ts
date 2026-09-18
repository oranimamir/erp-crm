/**
 * Order Confirmation PDF — reproduces the TripleW company template.
 *
 * Geometry, palette and type sizes are taken from the Word master
 * (SOBE20260124 OC FR LAVOLLEE LACLC90.docx): issuer block top-left with the
 * logo anchored right, green title, meta and client blocks, the line-item
 * table with its merged detail panel, then Terms & Conditions and the bank
 * block. Column widths are the docx `w:gridCol` values converted to points.
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

export interface OcLine {
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
}

export interface OrderConfirmationData {
  oc_number?: string | null;
  // Issuer — company constants, supplied from app settings
  company_name?: string | null;
  company_address1?: string | null;
  company_address2?: string | null;
  company_tel?: string | null;
  company_email?: string | null;
  company_vat?: string | null;
  // Document meta
  oc_date?: string | null; // YYYY-MM-DD
  sq_number?: string | null;
  our_ref?: string | null;
  po_number?: string | null;
  client_code?: string | null;
  // Client
  client_name?: string | null;
  billing_address?: string | null; // one line per row
  client_phone?: string | null;
  tax_id?: string | null;
  /** Where the confirmation gets emailed — carried on the record, never printed. */
  contact_email?: string | null;
  // Items
  items?: OcLine[];
  // Delivery
  delivery?: string | null;
  delivery_address?: string | null;
  delivery_contact?: string | null;
  delivery_date_text?: string | null;
  // Totals
  freight?: number | null;
  vat?: number | null;
  // Terms and bank — company constants, supplied from app settings
  terms?: string | null;
  bank_name?: string | null;
  iban?: string | null;
  bic?: string | null;
  bank_address?: string | null;
}

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

export function lineAmount(item: OcLine): number {
  return num(item.quantity) * num(item.unit_price);
}

/** Currency of the confirmation — taken from the first priced line. */
export function docCurrency(items: OcLine[]): string {
  return (items.find(i => i.currency)?.currency || 'EUR').toUpperCase();
}

export function computeTotals(data: OrderConfirmationData) {
  const items = Array.isArray(data.items) ? data.items : [];
  const subtotal = items.reduce((sum, item) => sum + lineAmount(item), 0);
  const freight = num(data.freight);
  const vat = num(data.vat);
  return { subtotal, freight, vat, total: subtotal + freight + vat, currency: docCurrency(items) };
}

function cellValues(item: OcLine, index: number): Record<string, string> {
  const currency = (item.currency || 'EUR').toUpperCase();
  const unit = (item.quantity_unit || '').toUpperCase();
  const qty = num(item.quantity);
  const price = num(item.unit_price);

  return {
    line: String(item.line ?? index + 1),
    reference: item.reference || '',
    commercial_name: item.commercial_name || '',
    packaging: item.packaging || '',
    quantity: qty ? `${fmt(qty)}${unit ? ` ${unit}` : ''}` : '',
    unit_price: price ? `${fmt(price)} ${currency}${unit ? ` /${unit}` : ''}` : '',
    amount: qty && price ? `${fmt(qty * price)} ${currency}` : '',
  };
}

/** Renders the confirmation and resolves with the finished PDF bytes. */
export async function buildOrderConfirmationPdf(data: OrderConfirmationData): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  let y = drawHeader(doc, data);
  y = drawTitleAndMeta(doc, data, y);
  y = drawTable(doc, data, y + 14);
  y = drawDetailPanel(doc, data, y);
  drawFooterBlocks(doc, data, y + 22);
  stampPageNumbers(doc);

  doc.end();
  return done;
}

/** Bold label with a regular value beside it; returns the height consumed. */
function labelled(
  doc: any, label: string, value: string, x: number, y: number, width: number,
  opts: { size?: number; boldValue?: boolean; lh?: number } = {}
): number {
  const size = opts.size ?? BODY;
  const lh = opts.lh ?? size * 1.45;

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
function drawHeader(doc: any, data: OrderConfirmationData): number {
  const logoW = 132;
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, R - logoW, 26, { width: logoW });
  }

  const lines: Array<[string, boolean]> = [
    [data.company_name || '', true],
    [data.company_address1 || '', false],
    [data.company_address2 || '', false],
    [data.company_tel ? `Tel: ${data.company_tel}` : '', false],
    [data.company_email ? `Email: ${data.company_email}` : '', false],
    [data.company_vat ? `VAT: ${data.company_vat}` : '', false],
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
function drawTitleAndMeta(doc: any, data: OrderConfirmationData, top: number): number {
  let y = top + 14;

  doc.font('Helvetica-Bold').fontSize(TITLE).fillColor(GREEN_TITLE)
    .text(`Order Confirmation  ${data.oc_number || ''}`.trimEnd(), L, y, { width: W, lineBreak: false });
  y += TITLE * 1.5;

  const meta: Array<[string, string]> = [
    ['Date:', formatLongDate(data.oc_date)],
    ['SQ:', data.sq_number || ''],
    ['Our ref:', data.our_ref || ''],
    ['PO number:', data.po_number || ''],
    ['Client:', data.client_code || ''],
  ];
  for (const [label, value] of meta) {
    if (!value) continue;
    y += labelled(doc, label, value, L, y, W * 0.6, { size: META });
  }

  // Client block — bold throughout, as in the master
  y += 10;
  const clientLines = [
    data.client_name || '',
    ...String(data.billing_address || '').split('\n').map(s => s.trim()).filter(Boolean),
    data.client_phone || '',
  ].filter(Boolean);

  for (const text of clientLines) {
    doc.font('Helvetica-Bold').fontSize(META).fillColor(BLACK)
      .text(text, L, y, { width: W * 0.6 });
    y += Math.max(META * 1.45, doc.heightOfString(text, { width: W * 0.6 }));
  }
  if (data.tax_id) y += labelled(doc, 'Tax Id :', data.tax_id, L, y, W * 0.6, { size: META, boldValue: true });

  return y;
}

// ── Line-item table ───────────────────────────────────────────────────────
function drawTable(doc: any, data: OrderConfirmationData, top: number): number {
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
function drawDetailPanel(doc: any, data: OrderConfirmationData, top: number): number {
  const items = Array.isArray(data.items) ? data.items : [];
  const PAD = 7;
  const innerW = W - PAD * 2;
  const lh = BODY * 1.45;
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
  height += 8 + totalRows.length * lh + 8;

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
  y += 8;
  for (const [label, value] of totalRows) {
    doc.font('Helvetica-Bold').fontSize(BODY).fillColor(BLACK)
      .text(label, L + PAD, y, { width: innerW * 0.6, lineBreak: false });
    doc.font('Helvetica').fontSize(BODY).fillColor(BLACK)
      .text(value, L + PAD, y, { width: innerW, align: 'right', lineBreak: false });
    y += lh;
  }

  return top + height;
}

// ── Terms & Conditions, then the bank block ───────────────────────────────
function drawFooterBlocks(doc: any, data: OrderConfirmationData, top: number) {
  let y = top;

  doc.font('Helvetica-Bold').fontSize(HEADING).fillColor(GREEN_TITLE)
    .text('Terms & Conditions', L, y, { width: W, lineBreak: false });
  y += HEADING * 1.4;

  if (data.terms) {
    doc.font('Helvetica').fontSize(BODY).fillColor(BLACK).text(data.terms, L, y, { width: W });
    y += doc.heightOfString(data.terms, { width: W });
  }

  const bankParts = [
    data.iban ? `IBAN: ${data.iban}` : '',
    data.bic ? `BIC: ${data.bic}` : '',
    data.bank_address ? `Address: ${data.bank_address}` : '',
  ].filter(Boolean);

  if (!data.bank_name && !bankParts.length) return;

  y += 18;
  doc.font('Helvetica-Bold').fontSize(HEADING).fillColor(GREEN_TITLE)
    .text('Bank Transfer', L, y, { width: W, lineBreak: false });
  y += HEADING * 1.4;

  if (data.bank_name) y += labelled(doc, 'Bank:', data.bank_name, L, y, W, { size: BODY });
  for (const part of bankParts) {
    const [label, ...rest] = part.split(': ');
    y += labelled(doc, `${label}:`, rest.join(': '), L, y, W, { size: BODY });
  }
}

// ── "Page N of M" ─────────────────────────────────────────────────────────
function stampPageNumbers(doc: any) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(9.5).fillColor(BLACK)
      .text(`Page ${i + 1} of ${range.count}`, L, 800, { width: W, align: 'right', lineBreak: false });
  }
}
