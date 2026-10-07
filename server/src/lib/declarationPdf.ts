import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { DeclarationData } from './declarationSource.js';
import { declarationAssetsDir } from './declarationSource.js';

/**
 * A declaration as a PDF in the TripleW layout of the Word originals: logo
 * top-left, title and "Department: …" at the right, the statement heading,
 * the body (paragraphs with **bold**, tables with a green header band), and
 * the closing "issued in … on … by", signature, name and role.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'triplew-logo.png');

const GREEN = '#00CC66';
const GREEN_HEAD = '#4EA72E';
const GREEN_ROW = '#EEF5EC';
const INK = '#1F2937';
const GREY = '#6B7280';
const RULE = '#D1D5DB';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const L = 56;
const R = PAGE_W - 56;
const W = R - L;
const TOP = 48;
const BOTTOM = PAGE_H - 60;
const BODY = 10.5;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (d: number) => {
  const s = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[d % 10] || 'th';
  return `${d}${s}`;
};
/** "2026-08-05" → "August 5th, 2026" (the declarations' own style); other text as is. */
export function declarationDate(iso: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${ordinal(Number(m[3]))}, ${m[1]}` : iso;
}

/** "**bold** rest" → runs */
function runs(text: string): Array<{ text: string; bold: boolean }> {
  const out: Array<{ text: string; bold: boolean }> = [];
  const parts = text.split('**');
  parts.forEach((t, i) => { if (t) out.push({ text: t, bold: i % 2 === 1 }); });
  return out.length ? out : [{ text: ' ', bold: false }];
}

export async function buildDeclarationPdf(data: DeclarationData): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // ── Header: logo left, title + department right ──────────────────────
  const logoW = 118;
  const logoH = logoW / 1.74;
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, L, TOP, { width: logoW });
  const tx = L + logoW + 24;
  const tw = R - tx;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(GREEN);
  const title = data.title || 'Declaration';
  const titleH = doc.heightOfString(title, { width: tw, align: 'right' });
  let hy = TOP + Math.max(0, (logoH - titleH - 16) / 2);
  doc.text(title, tx, hy, { width: tw, align: 'right' });
  hy += titleH + 4;
  if (data.department) {
    doc.font('Helvetica').fontSize(9).fillColor(GREY)
      .text(`Department: ${data.department}`, tx, hy, { width: tw, align: 'right' });
    hy += 12;
  }
  let y = Math.max(TOP + logoH, hy) + 14;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.2).strokeColor(GREEN).stroke();
  y += 26;

  const ensure = (h: number) => {
    if (y + h > BOTTOM) { doc.addPage(); y = TOP; }
  };

  // ── Addressee ────────────────────────────────────────────────────────
  if (data.addressee && (data.addressee.name || data.addressee.address)) {
    doc.font('Helvetica').fontSize(9).fillColor(GREY).text('To', L, y);
    y += 12;
    if (data.addressee.name) {
      doc.font('Helvetica-Bold').fontSize(BODY).fillColor(INK).text(data.addressee.name, L, y, { width: W / 2 });
      y = doc.y;
    }
    if (data.addressee.address) {
      doc.font('Helvetica').fontSize(BODY).fillColor(INK).text(data.addressee.address, L, y, { width: W / 2 });
      y = doc.y;
    }
    y += 18;
  }

  // ── Heading ──────────────────────────────────────────────────────────
  if (data.heading) {
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(data.heading, L, y, { width: W });
    y = doc.y + 12;
  }

  // ── Body ─────────────────────────────────────────────────────────────
  const BULLET = /^\s*[•\-–*]\s+/;
  const isBullet = (b: DeclarationData['blocks'][number] | undefined) => b?.type === 'paragraph' && BULLET.test(b.text) && !b.text.startsWith('**');
  data.blocks.forEach((block, bi) => {
    if (block.type === 'paragraph') {
      const bullet = isBullet(block);
      const text = (bullet ? block.text.replace(BULLET, '') : block.text).replace(/\r/g, '');
      if (!text.trim()) { y += 8; return; }
      // Leading spaces nest a list item one level per two spaces
      const level = bullet ? Math.floor((block.text.match(/^\s*/)![0].length) / 2) : 0;
      const x = bullet ? L + 16 + level * 16 : L;
      const w = R - x;
      const parts = runs(text);
      doc.fontSize(BODY);
      const h = doc.font('Helvetica').heightOfString(text.replace(/\*\*/g, ''), { width: w, lineGap: 2 });
      ensure(Math.min(h, 60));
      doc.fillColor(INK);
      if (bullet) doc.font('Helvetica').fontSize(BODY).text(level ? '–' : '•', x - 11, y, { lineBreak: false });
      parts.forEach((p, i) => {
        doc.font(p.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(BODY);
        const opts = { width: w, lineGap: bullet ? 1 : 2, continued: i < parts.length - 1 };
        if (i === 0) doc.text(p.text, x, y, opts); else doc.text(p.text, opts);
      });
      // List items sit close together; a list's last item and plain paragraphs get a full gap
      y = doc.y + (bullet && isBullet(data.blocks[bi + 1]) ? 1.5 : 9);
    } else {
      const rows = block.rows.filter(r => r.some(c => (c || '').trim()));
      if (!rows.length) return;
      const n = Math.max(...rows.map(r => r.length));
      const weights = Array.from({ length: n }, (_, i) => (i === 0 && n > 1 ? 1.6 : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map(w => (W * w) / total);
      // Long tables (nutritional values) go tighter so the statement stays on one page
      const long = rows.length > 12;
      const pad = long ? 3 : 6;
      const size = long ? BODY - 1.5 : BODY - 0.5;
      const rowHeight = (row: string[], bold: boolean) => Math.max(...widths.map((w, i) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
        return doc.heightOfString(row[i] || ' ', { width: w - pad * 2 });
      })) + pad * 2;
      const drawRow = (row: string[], head: boolean, shade: boolean) => {
        const h = rowHeight(row, head);
        if (head) doc.rect(L, y, W, h).fill(GREEN_HEAD);
        else if (shade) doc.rect(L, y, W, h).fill(GREEN_ROW);
        let x = L;
        widths.forEach((w, i) => {
          doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(head ? '#FFFFFF' : INK)
            .text(row[i] || '', x + pad, y + pad, { width: w - pad * 2 });
          x += w;
        });
        y += h;
        if (!head) doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(RULE).stroke();
      };
      const headRow = block.header ? rows[0] : null;
      const bodyRows = block.header ? rows.slice(1) : rows;
      y += 2;
      ensure(rowHeight(rows[0], !!headRow) + (bodyRows[0] ? rowHeight(bodyRows[0], false) : 0));
      if (headRow) drawRow(headRow, true, false);
      bodyRows.forEach((row, i) => {
        if (y + rowHeight(row, false) > BOTTOM) {
          doc.addPage(); y = TOP;
          if (headRow) drawRow(headRow, true, false);
        }
        drawRow(row, false, i % 2 === 1);
      });
      y += 14;
    }
  });

  // ── Closing: issued in … on … by, signature, name, role ──────────────
  const sigPath = data.signature_file ? path.join(declarationAssetsDir, data.signature_file) : null;
  const hasSig = !!sigPath && /^[a-zA-Z0-9._-]+$/.test(data.signature_file!) && fs.existsSync(sigPath);
  const closingH = 22 + (hasSig ? 74 : 30) + 34;
  y += 6;
  ensure(closingH);
  const issued = `This statement was issued${data.place ? ` in ${data.place}` : ''}${data.date ? ` on ${declarationDate(data.date)}` : ''} by`;
  doc.font('Helvetica').fontSize(BODY).fillColor(INK).text(issued, L, y, { width: W });
  y = doc.y + 6;
  if (hasSig) {
    try { doc.image(sigPath!, L, y, { fit: [150, 66] }); } catch { /* unreadable image */ }
    y += 70;
  } else {
    y += 26;
  }
  if (data.signatory) { doc.font('Helvetica-Bold').fontSize(BODY).fillColor(INK).text(data.signatory, L, y, { width: W }); y = doc.y + 2; }
  if (data.role) { doc.font('Helvetica').fontSize(BODY - 0.5).fillColor(GREY).text(data.role, L, y, { width: W }); y = doc.y; }

  // ── Page numbers when it runs over ───────────────────────────────────
  const range = doc.bufferedPageRange();
  if (range.count > 1) {
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(8).fillColor(GREY)
        .text(`Page ${i + 1} of ${range.count}`, L, PAGE_H - 36, { width: W, align: 'right', lineBreak: false });
    }
  }
  doc.end();
  return done;
}
