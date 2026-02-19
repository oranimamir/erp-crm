import { Router, Request, Response } from 'express';
import fs from 'fs';
import { templatePdfPath } from './invoice-template.js';

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────
interface LineItem {
  line?: number;
  reference?: string;
  commercial_name?: string;
  packaging?: string;
  quantity_lb?: number;
  price_per_lb?: number;
}

interface InvoiceData {
  use_template?: boolean;
  // Company (for from-scratch mode)
  company_name?: string;
  company_address1?: string;
  company_address2?: string;
  company_tel?: string;
  company_email?: string;
  company_vat?: string;
  // Invoice header
  invoice_number?: string;
  invoice_date?: string;
  sq_number?: string;
  ref_number?: string;
  po_number?: string;
  // Client
  client_name?: string;
  contact_person?: string;
  billing_address?: string;
  // Items
  items?: LineItem[];
  // Terms
  payment_terms?: string;
  description?: string;
  incoterm?: string;
  delivery?: string;
  requested_delivery_date?: string;
  remarks?: string;
  // Bank (for from-scratch mode)
  bank_name?: string;
  iban?: string;
  bic?: string;
  bank_address?: string;
}

// ── Color helper ─────────────────────────────────────────────────────────
function hexToRgbFraction(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// ── POST /  ──────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const data: InvoiceData = req.body;

  const templateExists = fs.existsSync(templatePdfPath);
  const useTemplate = data.use_template && templateExists;

  try {
    if (useTemplate) {
      await generateWithTemplate(req, res, data);
    } else {
      await generateFromScratch(req, res, data);
    }
  } catch (err: any) {
    console.error('PDF generation error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF: ' + (err.message || 'unknown error') });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// MODE A: template overlay via pdf-lib
// ══════════════════════════════════════════════════════════════════════════
async function generateWithTemplate(_req: Request, res: Response, data: InvoiceData) {
  // Lazy-load pdf-lib to avoid startup errors if package missing
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const templateBytes = fs.readFileSync(templatePdfPath);
  const pdfDoc = await PDFDocument.load(templateBytes);

  const pages = pdfDoc.getPages();
  const page1 = pages[0];
  const { width: W1, height: H1 } = page1.getSize();

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const [tr, tg, tb] = hexToRgbFraction('#00A651'); // teal
  const [dr, dg, db] = hexToRgbFraction('#333333'); // dark
  const [wr, wg, wb] = hexToRgbFraction('#FFFFFF'); // white

  // Helper: draw text relative to TOP-LEFT (pdf-lib uses bottom-left origin)
  function txt(
    page: typeof page1,
    text: string,
    xFromLeft: number,
    yFromTop: number,
    opts: { size?: number; bold?: boolean; r?: number; g?: number; b?: number } = {}
  ) {
    const pageH = page.getSize().height;
    page.drawText(String(text || ''), {
      x: xFromLeft,
      y: pageH - yFromTop,
      size: opts.size ?? 9,
      font: opts.bold ? fontBold : font,
      color: rgb(opts.r ?? dr, opts.g ?? dg, opts.b ?? db),
    });
  }

  // Derived scale factor (template may not be A4)
  const scaleX = W1 / 595;
  const scaleY = H1 / 842;
  const sx = (x: number) => x * scaleX;
  const sy = (y: number) => y * scaleY;

  // ── Page 1 overlays ──────────────────────────────────────────────────
  // Invoice number (large, placed below where "INVOICE" label would be)
  txt(page1, data.invoice_number || '', sx(45), sy(155), { size: 12, bold: true });

  // Info row values (Date, SQ#, Ref#, PO#)
  const infoColW = 125 * scaleX;
  const infoY    = sy(232);
  const infoVals = [data.invoice_date, data.sq_number, data.ref_number, data.po_number];
  infoVals.forEach((val, i) => {
    txt(page1, val || '', sx(43) + i * (infoColW + sx(8)), infoY, { size: 9 });
  });

  // Client section
  txt(page1, data.contact_person || '', sx(43), sy(296), { size: 10 });
  txt(page1, data.client_name    || '', sx(300), sy(296), { size: 10, bold: true });
  if (data.billing_address) {
    const lines = data.billing_address.split('\n');
    lines.forEach((l, i) => txt(page1, l, sx(300), sy(310 + i * 12), { size: 8.5 }));
  }

  // Table rows
  const items = Array.isArray(data.items) ? data.items : [];
  const tableStartY = sy(358);  // top of first data row (below header)
  const rowH        = sy(18);

  let grandTotal = 0;
  items.forEach((item, idx) => {
    const qty   = item.quantity_lb  ?? 0;
    const price = item.price_per_lb ?? 0;
    const total = qty * price;
    grandTotal += total;

    const rowY = tableStartY + idx * rowH + sy(5);

    txt(page1, String(item.line ?? idx + 1), sx(44), rowY, { size: 8 });
    txt(page1, item.reference       || '', sx(73),  rowY, { size: 8 });
    txt(page1, item.commercial_name || '', sx(145), rowY, { size: 8 });
    txt(page1, item.packaging       || '', sx(293), rowY, { size: 8 });
    txt(page1, qty   ? qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '', sx(360), rowY, { size: 8 });
    txt(page1, price ? price.toFixed(4) : '',                                                                              sx(416), rowY, { size: 8 });
    txt(page1, total ? total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',         sx(478), rowY, { size: 8 });
  });

  // Grand total – white text (drawn on top of teal total row in template)
  const totalRowY = tableStartY + items.length * rowH + sy(6);
  txt(page1, `USD ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    sx(470), totalRowY, { size: 9, bold: true, r: wr, g: wg, b: wb });

  // ── Page 2 overlays (if template has page 2) ─────────────────────────
  if (pages.length >= 2) {
    const page2 = pages[1];
    const { height: H2 } = page2.getSize();
    const scaleY2 = H2 / 842;
    const sy2 = (y: number) => y * scaleY2;

    // Terms values (placed to the right of each label row)
    const termValues = [
      data.payment_terms,
      data.description,
      data.incoterm,
      data.delivery,
      data.requested_delivery_date,
      data.remarks,
    ];
    termValues.forEach((val, i) => {
      txt(page2, val || '', sx(180), sy2(70 + i * 18), { size: 8.5 });
    });

    // Bank values
    const bankValues = [data.bank_name, data.iban, data.bic, data.bank_address];
    bankValues.forEach((val, i) => {
      txt(page2, val || '', sx(105), sy2(243 + i * 20), { size: 9, r: dr, g: dg, b: db });
    });
  }

  const pdfBytes = await pdfDoc.save();
  const filename  = `${(data.invoice_number || 'invoice').replace(/[^a-zA-Z0-9\-_.]/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(pdfBytes));
}

// ══════════════════════════════════════════════════════════════════════════
// MODE B: generate from scratch via pdfkit
// ══════════════════════════════════════════════════════════════════════════
const TEAL = '#00A651';
const DARK = '#333333';
const MID  = '#888888';

const COLS = [
  { label: 'Line',             width: 28,  align: 'center' as const },
  { label: 'Reference',        width: 72,  align: 'left'   as const },
  { label: 'Commercial names', width: 148, align: 'left'   as const },
  { label: 'Packaging',        width: 67,  align: 'left'   as const },
  { label: 'Qty (lb)',         width: 58,  align: 'right'  as const },
  { label: 'Price/lb USD',     width: 68,  align: 'right'  as const },
  { label: 'Total USD',        width: 74,  align: 'right'  as const },
];
const TABLE_W = COLS.reduce((s, c) => s + c.width, 0);

async function generateFromScratch(_req: Request, res: Response, data: InvoiceData) {
  const PDFDocument = (await import('pdfkit')).default;

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.on('end', () => {
    const pdf = Buffer.concat(chunks);
    const filename = `${(data.invoice_number || 'invoice').replace(/[^a-zA-Z0-9\-_.]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  });

  drawPage1Scratch(doc, data);
  doc.addPage({ size: 'A4', margin: 0 });
  drawPage2Scratch(doc, data);
  doc.end();
}

function hline(doc: any, x: number, y: number, w: number) {
  doc.save().moveTo(x, y).lineTo(x + w, y).strokeColor('#DDDDDD').lineWidth(0.5).stroke().restore();
}

function drawPage1Scratch(doc: any, data: InvoiceData) {
  const L = 40, R = 555, W = 515;
  let y = 40;

  // Company name / logo
  doc.font('Helvetica-Bold').fontSize(22).fillColor(TEAL)
    .text(data.company_name || 'TripleW BV', L, y, { lineBreak: false });

  const companyLines = [
    data.company_address1 || '',
    data.company_address2 || '',
    data.company_tel   ? `Tel: ${data.company_tel}`   : '',
    data.company_email ? `Email: ${data.company_email}` : '',
    data.company_vat   ? `VAT: ${data.company_vat}`   : '',
  ].filter(Boolean);

  doc.font('Helvetica').fontSize(8).fillColor(DARK);
  companyLines.forEach((line, i) => {
    doc.text(line, L, y + 2 + i * 11, { width: W, align: 'right', lineBreak: false });
  });

  y += Math.max(32, 2 + companyLines.length * 11) + 10;
  hline(doc, L, y, W); y += 14;

  // Invoice title
  doc.font('Helvetica-Bold').fontSize(28).fillColor(TEAL).text('INVOICE', L, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor(DARK).text(data.invoice_number || '', L, y + 34, { lineBreak: false });
  y += 58;

  hline(doc, L, y, W); y += 12;

  // Info row
  const infoColW = (W - 30) / 4;
  const infoItems = [
    { label: 'Date', value: data.invoice_date || '-' },
    { label: 'SQ#',  value: data.sq_number    || '-' },
    { label: 'Ref#', value: data.ref_number   || '-' },
    { label: 'PO#',  value: data.po_number    || '-' },
  ];
  infoItems.forEach((item, i) => {
    const x = L + i * (infoColW + 10);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MID).text(item.label, x, y, { width: infoColW, lineBreak: false });
    doc.font('Helvetica').fontSize(9.5).fillColor(DARK).text(item.value, x, y + 11, { width: infoColW, lineBreak: false });
  });
  y += 34;

  hline(doc, L, y, W); y += 12;

  // Client section
  const halfW = (W - 16) / 2;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TEAL).text('CONTACT PERSON', L, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor(DARK).text(data.contact_person || '-', L, y + 13, { width: halfW });

  const rCol = L + halfW + 16;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TEAL).text('BILLING TO', rCol, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor(DARK).text(data.client_name || '-', rCol, y + 13, { width: halfW });
  if (data.billing_address) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MID).text(data.billing_address, rCol, y + 27, { width: halfW });
  }
  y += 65;

  // Table header
  doc.rect(L, y, TABLE_W, 20).fill(TEAL);
  let cx = L + 4;
  COLS.forEach(col => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF')
      .text(col.label, cx, y + 6, { width: col.width - 6, align: col.align, lineBreak: false });
    cx += col.width;
  });
  y += 20;

  const items = Array.isArray(data.items) ? data.items : [];
  let grandTotal = 0;

  items.forEach((item, idx) => {
    const qty   = item.quantity_lb  ?? 0;
    const price = item.price_per_lb ?? 0;
    const total = qty * price;
    grandTotal += total;

    const rowH = 18;
    doc.rect(L, y, TABLE_W, rowH).fill(idx % 2 === 0 ? '#FFFFFF' : '#F7F7F7');

    const vals = [
      String(item.line ?? idx + 1),
      item.reference       || '',
      item.commercial_name || '',
      item.packaging       || '',
      qty   ? qty.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '',
      price ? price.toFixed(4) : '',
      total ? total.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '',
    ];

    cx = L + 4;
    COLS.forEach((col, ci) => {
      doc.font('Helvetica').fontSize(8).fillColor(DARK)
        .text(vals[ci], cx, y + 5, { width: col.width - 6, align: col.align, lineBreak: false });
      cx += col.width;
    });
    y += rowH;

    if (y > 780) {
      doc.addPage({ size: 'A4', margin: 0 });
      y = 40;
      doc.rect(L, y, TABLE_W, 20).fill(TEAL);
      cx = L + 4;
      COLS.forEach(col => {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF')
          .text(col.label, cx, y + 6, { width: col.width - 6, align: col.align, lineBreak: false });
        cx += col.width;
      });
      y += 20;
    }
  });

  // Total row
  doc.rect(L, y, TABLE_W, 22).fill(TEAL);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#FFFFFF')
    .text('TOTAL', L + 4, y + 6, { width: TABLE_W - 84, align: 'right', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#FFFFFF')
    .text(
      `USD ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      R - 78, y + 6, { width: 74, align: 'right', lineBreak: false }
    );
}

function drawPage2Scratch(doc: any, data: InvoiceData) {
  const L = 40, W = 515;
  let y = 40;

  const termFields = [
    { label: 'Payment terms',          value: data.payment_terms           || '' },
    { label: 'Description',            value: data.description             || '' },
    { label: 'Incoterm',               value: data.incoterm                || '' },
    { label: 'Delivery',               value: data.delivery                || '' },
    { label: 'Requested Delivery Date',value: data.requested_delivery_date || '' },
    { label: 'Remarks',                value: data.remarks                 || '' },
  ];

  const termsBoxH = 24 + termFields.length * 18 + 12;
  doc.rect(L, y, W, termsBoxH).fill('#F5F5F5');
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text('TERMS & REMARKS', L + 12, y + 10, { lineBreak: false });
  let ty = y + 28;
  termFields.forEach(row => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MID).text(row.label + ':', L + 12, ty, { width: 155, lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(row.value || '-', L + 170, ty, { width: W - 182, lineBreak: false });
    ty += 18;
  });
  y += termsBoxH + 24;

  const bankFields = [
    { label: 'Bank',    value: data.bank_name    || '' },
    { label: 'IBAN',    value: data.iban          || '' },
    { label: 'BIC',     value: data.bic           || '' },
    { label: 'Address', value: data.bank_address  || '' },
  ];
  const bankBoxH = 30 + bankFields.length * 20 + 12;
  doc.rect(L, y, W, bankBoxH).strokeColor(TEAL).lineWidth(1.5).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TEAL).text('PAYMENT DETAILS', L + 12, y + 10, { lineBreak: false });
  let by = y + 32;
  bankFields.forEach(row => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEAL).text(row.label + ':', L + 12, by, { width: 80, lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(DARK).text(row.value || '-', L + 96, by, { width: W - 108, lineBreak: false });
    by += 20;
  });

  // Footer
  doc.font('Helvetica').fontSize(7.5).fillColor(MID)
    .text(
      `${data.company_name || 'TripleW BV'} • ${data.company_address1 || ''} • ${data.company_address2 || ''}`,
      L, 810, { width: W, align: 'center', lineBreak: false }
    );
}

export default router;
