import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import JSZip from 'jszip';
// @ts-ignore — import lib directly to avoid pdf-parse's debug-mode crash in ESM
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import db from '../database.js';
import { uploadsBase } from './productDocs.js';
import { todayISO } from './today.js';

/**
 * Declarations: the generator's data, and drafting it from a starting
 * document — a Word declaration (header title / department, body paragraphs
 * with bold kept as **…**, tables, the "issued in … on … by" line, signatory,
 * role, the signature image) or a PDF (its text, split into paragraphs).
 */

export type DeclarationBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][]; header: boolean };

export interface DeclarationData {
  title: string;
  department: string;
  heading: string;
  addressee?: { name: string; address: string } | null;
  blocks: DeclarationBlock[];
  place: string;
  /** ISO date (YYYY-MM-DD), or free text when it could not be read */
  date: string;
  signatory: string;
  role: string;
  /** Image in uploads/declaration-assets */
  signature_file: string | null;
}

export const declarationAssetsDir = path.join(uploadsBase, 'declaration-assets');
const SAFE = /^[a-zA-Z0-9._-]+$/;

const today = () => todayISO();

/** The signature used last, so a declaration started from a PDF is still signed. */
export function lastSignature(): string | null {
  const rows = db.prepare(`SELECT data FROM declarations ORDER BY updated_at DESC, id DESC LIMIT 20`).all() as any[];
  for (const r of rows) {
    try {
      const f = JSON.parse(r.data)?.signature_file;
      if (f && SAFE.test(f) && fs.existsSync(path.join(declarationAssetsDir, f))) return f;
    } catch { /* skip */ }
  }
  return null;
}

export function emptyDeclaration(): DeclarationData {
  return {
    title: '', department: 'Product Safety and Quality', heading: 'TripleW statement', addressee: null,
    blocks: [], place: 'Antwerp', date: today(), signatory: '', role: '', signature_file: lastSignature(),
  };
}

/**
 * A blank Certificate of Analysis: the products with their lots, production /
 * expiry dates, the results table to fill in and the conformity statement.
 */
export function emptyCoa(lines: Array<{ product: string; lots: string[] }>): DeclarationData {
  const products = lines.length ? lines : [{ product: '', lots: [] }];
  const blocks: DeclarationBlock[] = [];
  for (const l of products) {
    blocks.push({
      type: 'table', header: false,
      rows: [['Product', l.product], ['Batch / lot', l.lots.join(', ')], ['Production date', ''], ['Expiry date', '']],
    });
    blocks.push({
      type: 'table', header: true,
      rows: [['Parameter', 'Specification', 'Method', 'Result'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']],
    });
  }
  blocks.push({ type: 'paragraph', text: 'The product complies with the specification above.' });
  return {
    ...emptyDeclaration(), title: 'Certificate of Analysis', heading: 'Analysis results', blocks,
  };
}

/** Keeps an image (signature) once, by content. */
export function storeAsset(buf: Buffer, ext: string): string {
  fs.mkdirSync(declarationAssetsDir, { recursive: true });
  const clean = ext.toLowerCase().replace(/[^a-z.]/g, '');
  const name = `sig-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24)}${clean.startsWith('.') ? clean : `.${clean}`}`;
  const abs = path.join(declarationAssetsDir, name);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf);
  return name;
}

// ── Dates: "August 5th, 2026" / "5 August 2026" / "05/08/2026" → ISO ──────
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function parseDate(text: string): string | null {
  const t = text.toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const iso = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  let m = t.match(/^([a-z]+) (\d{1,2}) (\d{4})$/);
  if (m && MONTHS.indexOf(m[1]) >= 0) return iso(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  m = t.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m && MONTHS.indexOf(m[2]) >= 0) return iso(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

// ── Word XML helpers ───────────────────────────────────────────────────────
const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

const isBold = (rPr: string) => {
  const m = rPr.match(/<w:b(?:\s+w:val="([^"]*)")?\s*\/>/);
  return !!m && !['0', 'false', 'off'].includes((m[1] || '').toLowerCase());
};

/** A paragraph's text, bold runs wrapped in ** **. */
function paragraphText(p: string, withBold = true): string {
  const segs: Array<{ text: string; bold: boolean }> = [];
  for (const r of p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
    const body = r[1];
    const bold = withBold && isBold(body.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '');
    let text = '';
    for (const t of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)) {
      text += t[0].startsWith('<w:t') && !t[0].startsWith('<w:tab') ? decode(t[1] ?? '') : t[0].startsWith('<w:tab') ? ' ' : '\n';
    }
    if (!text) continue;
    const last = segs[segs.length - 1];
    if (last && last.bold === bold) last.text += text; else segs.push({ text, bold });
  }
  return segs.map(s => {
    if (!s.bold || !s.text.trim()) return s.text;
    const lead = s.text.match(/^\s*/)![0];
    const trail = s.text.match(/\s*$/)![0];
    return `${lead}**${s.text.trim()}**${trail}`;
  }).join('').replace(/[ \t]+\n/g, '\n');
}

const plain = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/** Body elements in order: paragraphs and (top-level) tables. */
function bodyElements(xml: string): Array<{ kind: 'p' | 'tbl'; xml: string }> {
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] || xml;
  const out: Array<{ kind: 'p' | 'tbl'; xml: string }> = [];
  let i = 0;
  while (i < body.length) {
    const nextP = body.slice(i).search(/<w:p\b(?!r)/);
    const nextT = body.indexOf('<w:tbl>', i);
    const pAt = nextP < 0 ? -1 : i + nextP;
    if (pAt < 0 && nextT < 0) break;
    if (nextT >= 0 && (pAt < 0 || nextT < pAt)) {
      // Matching </w:tbl>, allowing nested tables
      let depth = 0; let j = nextT;
      const re = /<w:tbl>|<\/w:tbl>/g; re.lastIndex = nextT;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) {
        depth += m[0] === '<w:tbl>' ? 1 : -1;
        if (depth === 0) { j = m.index + m[0].length; break; }
      }
      out.push({ kind: 'tbl', xml: body.slice(nextT, j) });
      i = j;
    } else {
      const self = body.slice(pAt).match(/^<w:p\b[^>]*\/>/);
      if (self) { i = pAt + self[0].length; continue; }
      const end = body.indexOf('</w:p>', pAt);
      if (end < 0) break;
      out.push({ kind: 'p', xml: body.slice(pAt, end + 6) });
      i = end + 6;
    }
  }
  return out;
}

function tableRows(tbl: string): string[][] {
  return [...tbl.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(tr =>
    [...tr[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(tc =>
      [...tc[1].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(p => plain(paragraphText(p[0], false))).filter(Boolean).join('\n')))
    .filter(r => r.some(c => c.trim()));
}

// "…issued in Antwerp on August 5th, 2026 by" (the name may follow "by"; some omit "by")
const ISSUED = /issued in\s+(.+?)\s+on\s+(.+?)(?:\s+by\b\s*(.*?))?\s*$/i;

/** Splits paragraphs into heading / body / issued line / signatory / role. */
function shape(items: DeclarationBlock[], header: { title: string; department: string } | null, signature: string | null): DeclarationData {
  const data = emptyDeclaration();
  if (header?.title) data.title = header.title;
  if (header?.department) data.department = header.department;
  if (signature) data.signature_file = signature;

  const blocks = [...items];
  // Heading: a short first line such as "TripleW statement"
  const first = blocks[0];
  if (first?.type === 'paragraph' && plain(first.text).length <= 60 && !/[.:]$/.test(plain(first.text))) {
    data.heading = plain(first.text);
    blocks.shift();
  }
  // "This statement was issued in Antwerp on August 5th, 2026 by" + signatory + role
  const at = blocks.findIndex(b => b.type === 'paragraph' && ISSUED.test(plain(b.text)));
  if (at >= 0) {
    const m = plain((blocks[at] as any).text).match(ISSUED)!;
    data.place = m[1].trim();
    const date = m[2].trim().replace(/[.,]$/, '');
    data.date = parseDate(date) ?? date;
    const after = (blocks.slice(at + 1).filter(b => b.type === 'paragraph') as Array<{ type: 'paragraph'; text: string }>).map(b => plain(b.text));
    if (m[3]?.trim()) after.unshift(m[3].trim());
    data.signatory = after[0] || '';
    data.role = after[1] || '';
    blocks.splice(at); // the closing lines are drawn from the fields
  }
  data.blocks = blocks;
  if (!data.title) data.title = '';
  return data;
}

/** Drafts generator data from a Word declaration. */
export async function declarationFromDocx(buffer: Buffer): Promise<DeclarationData> {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string') || '';

  // Header: title paragraphs, then "Department: …"
  let header: { title: string; department: string } | null = null;
  const headerFiles = Object.keys(zip.files).filter(f => /^word\/header\d*\.xml$/.test(f)).sort();
  for (const f of headerFiles) {
    const xml = await zip.file(f)!.async('string');
    const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(p => plain(paragraphText(p[0], false))).filter(Boolean);
    if (!paras.length) continue;
    const di = paras.findIndex(p => /^department\b/i.test(p));
    const title = (di >= 0 ? paras.slice(0, di) : paras).join(' ').replace(/\s+/g, ' ').trim();
    let department = '';
    if (di >= 0) department = paras[di].replace(/^department\s*:?\s*/i, '').trim() || (paras[di + 1] || '');
    header = { title, department };
    break;
  }

  // Body
  const items: DeclarationBlock[] = [];
  for (const el of bodyElements(docXml)) {
    if (el.kind === 'tbl') {
      const rows = tableRows(el.xml);
      if (rows.length) items.push({ type: 'table', rows, header: true });
    } else {
      const text = paragraphText(el.xml).replace(/[ \t]+/g, ' ').trim();
      // Word list items become "• " lines (printed as a compact bulleted list)
      // (sub-items, Word list level ≥ 1, are indented: "  – ")
      const bullet = /<w:numPr>/.test(el.xml) || /<w:pStyle w:val="List/i.test(el.xml);
      const level = Number(el.xml.match(/<w:ilvl w:val="(\d+)"/)?.[1] || 0);
      const mark = level > 0 ? `${'  '.repeat(level)}– ` : '• ';
      if (text.replace(/\*/g, '').trim()) items.push({ type: 'paragraph', text: bullet ? `${mark}${text}` : text });
    }
  }

  // Signature: an image placed in the body (the logo sits in the header)
  let signature: string | null = null;
  const embed = docXml.match(/r:embed="([^"]+)"/)?.[1];
  if (embed) {
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string') || '';
    const target = rels.match(new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`))?.[1]
      || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${embed}"`))?.[1];
    const file = target ? zip.file(`word/${target.replace(/^\.\//, '')}`) : null;
    if (file && /\.(png|jpe?g)$/i.test(target!)) signature = storeAsset(await file.async('nodebuffer'), path.extname(target!));
  }
  return shape(items, header, signature);
}

/** Drafts generator data from a PDF declaration (text only). */
export async function declarationFromPdf(buffer: Buffer): Promise<DeclarationData> {
  const { text } = await pdfParse(buffer);
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim());
  // Paragraphs: blank lines, or a line ending a sentence
  const paras: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (!line) { if (cur) { paras.push(cur); cur = ''; } continue; }
    cur = cur ? `${cur} ${line}` : line;
    if (/[.:!?]$/.test(line) || line.length < 45) { paras.push(cur); cur = ''; }
  }
  if (cur) paras.push(cur);
  const deptAt = paras.findIndex(p => /^department\b/i.test(p));
  let header: { title: string; department: string } | null = null;
  let body = paras;
  if (deptAt >= 0 && deptAt <= 3) {
    header = { title: paras.slice(0, deptAt).join(' '), department: paras[deptAt].replace(/^department\s*:?\s*/i, '') || paras[deptAt + 1] || '' };
    body = paras.slice(deptAt + (paras[deptAt].replace(/^department\s*:?\s*/i, '') ? 1 : 2));
  }
  return shape(body.map(text => ({ type: 'paragraph', text })), header, null);
}

export async function declarationFromFile(buffer: Buffer, fileName: string): Promise<DeclarationData> {
  const ext = path.extname(fileName).toLowerCase();
  const data = ext === '.docx' ? await declarationFromDocx(buffer)
    : ext === '.pdf' ? await declarationFromPdf(buffer)
      : emptyDeclaration();
  if (!data.title) data.title = path.basename(fileName, path.extname(fileName)).replace(/^[A-Z]{2,5}-\d{2}-[A-Z]{2,5}-\d{2,4}\s*-\s*/i, '');
  return data;
}

/** Cleans incoming generator data (from the form). */
export function normalizeDeclaration(input: any): DeclarationData {
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const blocks: DeclarationBlock[] = (Array.isArray(input?.blocks) ? input.blocks : []).map((b: any): DeclarationBlock | null => {
    if (b?.type === 'table') {
      const rows = (Array.isArray(b.rows) ? b.rows : []).map((r: any) => (Array.isArray(r) ? r : []).map(str));
      return { type: 'table', rows, header: b.header !== false };
    }
    if (b?.type === 'paragraph') return { type: 'paragraph', text: str(b.text) };
    return null;
  }).filter(Boolean) as DeclarationBlock[];
  const sig = str(input?.signature_file);
  return {
    title: str(input?.title).trim(),
    department: str(input?.department),
    heading: str(input?.heading),
    addressee: input?.addressee && (str(input.addressee.name) || str(input.addressee.address))
      ? { name: str(input.addressee.name), address: str(input.addressee.address) } : null,
    blocks,
    place: str(input?.place),
    date: str(input?.date),
    signatory: str(input?.signatory),
    role: str(input?.role),
    signature_file: sig && SAFE.test(sig) ? sig : null,
  };
}
