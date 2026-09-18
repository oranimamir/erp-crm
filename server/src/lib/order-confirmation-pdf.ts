/**
 * Order Confirmation PDF — reproduces the TripleW company template.
 *
 * Layout constants below were measured off the reference template
 * (A4, 595.28 × 841.89 pt): logo box, company block, green title, the
 * two-column client/meta block, the green line-item table, the pale-green
 * description panel and the outlined Terms & Conditions box.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'triplew-logo.png');

// ── Template palette (sampled from the reference PDF) ─────────────────────
const GREEN_TITLE = '#00CC66'; // title + Terms box border/heading
const GREEN_HEAD = '#4EA72E'; // table header band
const GREEN_ROW = '#D0E1CD'; // line-item rows
const GREEN_PANEL = '#E9F1E8'; // description panel
const LINK_BLUE = '#0563C1'; // e-mail address
const BLACK = '#000000';

// ── Page geometry ─────────────────────────────────────────────────────────
const L = 28;
const R = 567;
const W = R - L;

const COLS = [
  { key: 'line', label: 'Line', width: 40, align: 'left' as const },
  { key: 'reference', label: 'Reference', width: 102, align: 'left' as const },
  { key: 'commercial_name', label: 'Commercial names', width: 124, align: 'left' as const },
  { key: 'packaging', label: 'Packaging', width: 72, align: 'left' as const },
  { key: 'quantity', label: 'Quantity', width: 62, align: 'left' as const },
  { key: 'unit_price', label: 'Unit price', width: 72, align: 'left' as const },
  { key: 'amount', label: 'Amount', width: 67, align: 'left' as const },
];

export interface OcLine {
  line?: number | null;
  reference?: string | null;
  commercial_name?: string | null;
  packaging?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
  unit_price?: number | null;
  price_unit?: string | null;
  currency?: string | null;
  hs_code?: string | null;
  description?: string | null;
}

export interface OrderConfirmationData {
  oc_number?: string | null;
  // Issuer
  company_name?: string | null;
  company_address1?: string | null;
  company_address2?: string | null;
  company_country?: string | null;
  company_tel?: string | null;
  company_email?: string | null;
  company_vat?: string | null;
  company_kvk?: string | null;
  // Client
  client_name?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  client_phone?: string | null;
  billing_address?: string | null;
  tax_id?: string | null;
  client_code?: string | null;
  // Meta
  oc_date?: string | null; // YYYY-MM-DD
  sq_number?: string | null;
  our_ref?: string | null;
  po_number?: string | null;
  // Body
  items?: OcLine[];
  delivery?: string | null;
  delivery_date_text?: string | null;
  note?: string | null;
  terms?: string | null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-07-13" → "13 July 2026". Non-ISO input is passed through unchanged. */
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

/** Thousands separators, dropping a trailing ".00" the template doesn't show. */
function fmtAmount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function fmtPrice(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export function lineAmount(item: OcLine): number {
  return num(item.quantity) * num(item.unit_price);
}

/** Cell text for one line item, matching the template's two-line cells. */
function cellValues(item: OcLine, index: number): Record<string, string> {
  const currency = (item.currency || 'USD').toUpperCase();
  const qtyUnit = (item.quantity_unit || '').toUpperCase();
  const priceUnit = item.price_unit || item.quantity_unit || '';
  const qty = num(item.quantity);
  const price = num(item.unit_price);

  return {
    line: String(item.line ?? index + 1),
    reference: item.reference || '',
    commercial_name: item.commercial_name || '',
    packaging: item.packaging || '',
    quantity: qty ? `${fmtAmount(qty)}${qtyUnit ? ` ${qtyUnit}` : ''}` : '',
    unit_price: price ? `${fmtPrice(price)}\n${currency}${priceUnit ? `/${priceUnit.toUpperCase()}` : ''}` : '',
    amount: qty && price ? `${fmtAmount(qty * price)} ${currency}` : '',
  };
}

/** Renders the confirmation and resolves with the finished PDF bytes. */
export async function buildOrderConfirmationPdf(data: OrderConfirmationData): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  drawHeader(doc, data);
  const blockBottom = drawParties(doc, data);
  const tableBottom = drawTable(doc, data, Math.max(339.5, blockBottom + 18));
  const panelBottom = drawDetailPanel(doc, data, tableBottom + 2);
  drawTerms(doc, data, Math.max(630, panelBottom + 40));
  stampPageNumbers(doc);

  doc.end();
  return done;
}

// ── Header: logo + issuer block ───────────────────────────────────────────
function drawHeader(doc: any, data: OrderConfirmationData) {
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 93.75, 31.75, { width: 155.38 });
  } else {
    doc.font('Helvetica-Bold').fontSize(24).fillColor(GREEN_TITLE)
      .text(data.company_name || 'TripleW', 93.75, 55, { lineBreak: false });
  }

  const lines: Array<[string, boolean]> = [
    [data.company_name || '', true],
    [data.company_address1 || '', false],
    [data.company_address2 || '', false],
    [data.company_country || '', false],
    [data.company_tel ? `Tel: ${data.company_tel}` : '', false],
    [data.company_email ? `Email: ${data.company_email}` : '', false],
    [data.company_vat ? `VAT: ${data.company_vat}` : '', false],
    [data.company_kvk ? `KVK: ${data.company_kvk}` : '', false],
  ];

  let y = 30;
  for (const [text, bold] of lines) {
    if (!text) continue;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(BLACK)
      .text(text, 378, y, { width: R - 378, lineBreak: false });
    y += 15.6;
  }

  // Title + hairline rule
  doc.font('Helvetica-Bold').fontSize(20).fillColor(GREEN_TITLE)
    .text(`Order Confirmation  ${data.oc_number || ''}`.trimEnd(), 47, 158, { width: W - 20, lineBreak: false });

  doc.save().moveTo(L, 190).lineTo(R, 190).lineWidth(0.5).strokeColor(BLACK).stroke().restore();
}

// ── Client (left) and document meta (right) ───────────────────────────────
function drawParties(doc: any, data: OrderConfirmationData): number {
  const SIZE = 10;
  const LH = 16.5;
  const leftX = 51;
  const rightX = 344;

  const leftW = rightX - leftX - 14;
  const rightW = R - rightX;

  /**
   * Bold label with the value flowing beside it, wrapping inside `width`.
   * Returns the vertical space consumed so long addresses push the table down
   * instead of colliding with the column beside them.
   */
  function labelled(label: string, value: string, x: number, y: number, width: number): number {
    doc.font('Helvetica-Bold').fontSize(SIZE).fillColor(BLACK);
    const labelW = label ? doc.widthOfString(label) + 4 : 0;
    if (label) doc.text(label, x, y, { width: labelW, lineBreak: false });

    if (!value) return LH;

    const valueW = width - labelW;
    doc.font('Helvetica').fontSize(SIZE).fillColor(BLACK);
    const h = doc.heightOfString(value, { width: valueW });
    doc.text(value, x + labelW, y, { width: valueW });
    return Math.max(LH, h);
  }

  let ly = 198;
  if (data.client_name) ly += labelled('To:', data.client_name, leftX, ly, leftW);

  if (data.contact_person) {
    const person = [data.contact_person, data.contact_phone].filter(Boolean).join('  ');
    ly += labelled('Contact Person:', person, leftX, ly, leftW);
  }

  if (data.contact_email) {
    doc.font('Helvetica').fontSize(SIZE).fillColor(LINK_BLUE)
      .text(data.contact_email, leftX, ly, { width: leftW, underline: true, lineBreak: false });
    doc.fillColor(BLACK);
    ly += LH;
  }

  if (data.client_phone) {
    doc.font('Helvetica').fontSize(SIZE).fillColor(BLACK)
      .text(data.client_phone, leftX, ly, { width: leftW, lineBreak: false });
    ly += LH;
  }

  if (data.billing_address) {
    const addressLines = String(data.billing_address).split('\n').map(s => s.trim()).filter(Boolean);
    addressLines.forEach((text, i) => {
      ly += labelled(i === 0 ? 'Address:' : '', text, leftX, ly, leftW);
    });
  }

  if (data.tax_id) {
    ly += 6;
    ly += labelled('Tax Id:', data.tax_id, leftX, ly, leftW);
  }

  let ry = 226;
  const meta: Array<[string, string]> = [
    ['Date:', formatLongDate(data.oc_date)],
    ['SQ:', data.sq_number || ''],
    ['Our ref:', data.our_ref || ''],
    ['PO number:', data.po_number || ''],
    ['Client:', data.client_code || ''],
  ];
  for (const [label, value] of meta) {
    if (!value) continue;
    ry += labelled(label, value, rightX, ry, rightW);
  }

  return Math.max(ly, ry);
}

// ── Line-item table ───────────────────────────────────────────────────────
function drawTable(doc: any, data: OrderConfirmationData, top: number): number {
  const items = Array.isArray(data.items) ? data.items : [];
  const HEADER_H = 26;
  const PAD = 5;

  doc.rect(L, top, W, HEADER_H).fill(GREEN_HEAD);
  let x = L;
  for (const col of COLS) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#FFFFFF')
      .text(col.label, x + PAD, top + 8, { width: col.width - PAD * 2, align: col.align, lineBreak: false });
    x += col.width;
  }

  let y = top + HEADER_H;
  items.forEach((item, index) => {
    const values = cellValues(item, index);

    // Measure first so the row band covers every wrapped cell.
    let contentH = 0;
    let cx = L;
    for (const col of COLS) {
      doc.font('Helvetica').fontSize(9.5);
      const h = doc.heightOfString(values[col.key] || ' ', { width: col.width - PAD * 2 });
      contentH = Math.max(contentH, h);
      cx += col.width;
    }
    const rowH = Math.max(26, contentH + 12);

    doc.rect(L, y, W, rowH).fill(GREEN_ROW);
    cx = L;
    for (const col of COLS) {
      doc.font('Helvetica').fontSize(9.5).fillColor(BLACK)
        .text(values[col.key] || '', cx + PAD, y + 6, { width: col.width - PAD * 2, align: col.align });
      cx += col.width;
    }
    y += rowH;
  });

  return y;
}

// ── Pale-green panel: HS code / description / delivery / note ─────────────
function drawDetailPanel(doc: any, data: OrderConfirmationData, top: number): number {
  const items = Array.isArray(data.items) ? data.items : [];
  const PAD_X = 7;
  const SIZE = 10;
  const LH = 16.5;
  const innerW = W - PAD_X * 2;

  // Pass 1 — measure, so the panel is drawn behind the text at the right height.
  let height = 8;
  const withDetail = items.filter(i => i.hs_code || i.description);
  for (const item of withDetail) {
    if (item.hs_code) height += LH;
    if (item.description) {
      height += LH; // "Description:" label
      doc.font('Helvetica').fontSize(SIZE);
      height += doc.heightOfString(item.description, { width: innerW }) + 5;
    }
  }
  const footRows: Array<[string, string]> = [
    ['Delivery :', data.delivery || ''],
    ['Delivery date :', data.delivery_date_text || ''],
    ['Note :', data.note || ''],
  ].filter(([, v]) => !!v) as Array<[string, string]>;
  height += footRows.length * LH + 8;

  if (height <= 16) return top;

  doc.rect(L, top, W, height).fill(GREEN_PANEL);

  let y = top + 8;
  for (const item of withDetail) {
    if (item.hs_code) {
      doc.font('Helvetica-Bold').fontSize(SIZE).fillColor(BLACK)
        .text(`HS code: ${item.hs_code}`, L + PAD_X, y, { width: innerW, lineBreak: false });
      y += LH;
    }
    if (item.description) {
      doc.font('Helvetica-Bold').fontSize(SIZE).fillColor(BLACK)
        .text('Description:', L + PAD_X, y, { width: innerW, lineBreak: false });
      y += LH;
      doc.font('Helvetica').fontSize(SIZE).fillColor(BLACK)
        .text(item.description, L + PAD_X, y, { width: innerW });
      y += doc.heightOfString(item.description, { width: innerW }) + 5;
    }
  }

  for (const [label, value] of footRows) {
    doc.font('Helvetica-Bold').fontSize(SIZE).fillColor(BLACK)
      .text(label, L + PAD_X, y, { width: innerW, continued: true, lineBreak: false });
    doc.font('Helvetica').fontSize(SIZE).fillColor(BLACK).text(` ${value}`, { lineBreak: false });
    y += LH;
  }

  return top + height;
}

// ── Terms & Conditions box ────────────────────────────────────────────────
function drawTerms(doc: any, data: OrderConfirmationData, top: number) {
  const boxL = 41;
  const boxW = R - boxL;
  const textX = boxL + 162;
  const textW = boxW - 162 - 12;

  doc.font('Helvetica').fontSize(10);
  const textH = data.terms ? doc.heightOfString(data.terms, { width: textW }) : 0;
  const height = Math.max(68, textH + 30);

  doc.save().rect(boxL, top, boxW, height).lineWidth(1).strokeColor(GREEN_TITLE).stroke().restore();

  doc.font('Helvetica-Bold').fontSize(14).fillColor(GREEN_TITLE)
    .text('Terms & Conditions', boxL + 13, top + 13, { lineBreak: false });

  if (data.terms) {
    doc.font('Helvetica').fontSize(10).fillColor(BLACK)
      .text(data.terms, textX, top + 16, { width: textW });
  }
}

// ── "Page N of M" ─────────────────────────────────────────────────────────
function stampPageNumbers(doc: any) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(9.5).fillColor(BLACK)
      .text(`Page ${i + 1} of ${range.count}`, L, 793, { width: W - 27, align: 'right', lineBreak: false });
  }
}
