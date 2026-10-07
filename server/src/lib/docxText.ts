import JSZip from 'jszip';

/**
 * Text editing of Word (.docx) files — the declarations. Every paragraph that
 * holds text (body, tables, headers, footers) is offered as plain text; on
 * save only the characters that changed are rewritten, inside the run(s) they
 * sit in, so bold / fonts / layout around them stay as they were. A newline
 * becomes a line break inside the paragraph.
 */

export interface DocxParagraph { key: string; part: string; text: string }

const PART = /^word\/(document|header\d*|footer\d*)\.xml$/;
// Innermost paragraphs only (a text box's paragraphs sit inside another one)
const PARAGRAPH = /<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g;
// A text node or a line break, in document order
const TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g;

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text pieces of a paragraph: text nodes (editable) and breaks ("\n", fixed). */
interface Piece { start: number; end: number; text: string; isText: boolean }

function piecesOf(xml: string): Piece[] {
  const out: Piece[] = [];
  for (const m of xml.matchAll(TOKEN)) {
    const isText = m[0].startsWith('<w:t');
    out.push({ start: m.index!, end: m.index! + m[0].length, text: isText ? decode(m[1] ?? '') : '\n', isText });
  }
  return out;
}

const partLabel = (file: string) => {
  const m = file.match(PART);
  if (!m) return file;
  return m[1] === 'document' ? 'Body' : m[1].startsWith('header') ? 'Header' : 'Footer';
};

async function parts(zip: JSZip): Promise<Array<{ file: string; xml: string }>> {
  const files = Object.keys(zip.files).filter(f => PART.test(f))
    // header(s) first, then body, then footer(s)
    .sort((a, b) => (a.includes('header') ? 0 : a.includes('document') ? 1 : 2) - (b.includes('header') ? 0 : b.includes('document') ? 1 : 2) || a.localeCompare(b));
  return Promise.all(files.map(async file => ({ file, xml: await zip.file(file)!.async('string') })));
}

/** The editable paragraphs (those with text), keyed `<part file>#<paragraph index>`. */
export async function readDocxParagraphs(buffer: Buffer): Promise<DocxParagraph[]> {
  const zip = await JSZip.loadAsync(buffer);
  const out: DocxParagraph[] = [];
  for (const { file, xml } of await parts(zip)) {
    let i = 0;
    for (const m of xml.matchAll(PARAGRAPH)) {
      const index = i++;
      const pieces = piecesOf(m[0]);
      if (!pieces.some(p => p.isText)) continue;
      const text = pieces.map(p => p.text).join('');
      if (!text.trim()) continue;
      out.push({ key: `${file}#${index}`, part: partLabel(file), text });
    }
  }
  return out;
}

/**
 * Rewrites one paragraph so its text becomes `next`: the common start and end
 * are kept, the changed middle goes into the text node where the change
 * starts (later nodes it spanned are trimmed), so formatting elsewhere stays.
 */
function editParagraph(xml: string, next: string): string {
  const pieces = piecesOf(xml);
  const old = pieces.map(p => p.text).join('');
  next = next.replace(/\r\n?/g, '\n');
  if (old === next) return xml;

  let pre = 0;
  while (pre < old.length && pre < next.length && old[pre] === next[pre]) pre++;
  let suf = 0;
  while (suf < old.length - pre && suf < next.length - pre && old[old.length - 1 - suf] === next[next.length - 1 - suf]) suf++;
  const oldEnd = old.length - suf;
  const middle = next.slice(pre, next.length - suf);

  // Character offsets of each piece
  let pos = 0;
  const spans = pieces.map(p => { const s = { ...p, from: pos, to: pos + p.text.length }; pos += p.text.length; return s; });
  const texts = spans.filter(s => s.isText);
  // The text node the change starts in (an insertion at a boundary joins the node before it)
  const first = texts.find(s => pre >= s.from && (pre < s.to || (pre === s.to && middle))) ?? texts.find(s => s.from >= pre) ?? texts[texts.length - 1];

  const newText = new Map<Piece, string>();
  const dropBreaks = new Set<Piece>();
  for (const s of spans) {
    const overlaps = s.to > pre && s.from < oldEnd;
    if (!s.isText) { if (overlaps) dropBreaks.add(s); continue; }
    if (s === first) {
      const keepHead = s.text.slice(0, Math.max(0, pre - s.from));
      const keepTail = oldEnd < s.to ? s.text.slice(Math.max(0, oldEnd - s.from)) : '';
      newText.set(s, keepHead + middle + keepTail);
    } else if (overlaps) {
      // Only the part after the changed range survives
      newText.set(s, oldEnd < s.to ? s.text.slice(oldEnd - s.from) : '');
    }
  }

  // Rebuild from the end so offsets stay valid
  let out = xml;
  for (const s of [...spans].reverse()) {
    if (dropBreaks.has(s)) { out = out.slice(0, s.start) + out.slice(s.end); continue; }
    if (!newText.has(s)) continue;
    const lines = newText.get(s)!.split('\n');
    const xmlText = lines.map(l => `<w:t xml:space="preserve">${encode(l)}</w:t>`).join('<w:br/>');
    out = out.slice(0, s.start) + xmlText + out.slice(s.end);
  }
  return out;
}

/** Applies `{ key: newText }` edits and returns the new .docx. */
export async function writeDocxParagraphs(buffer: Buffer, edits: Record<string, string>): Promise<{ buffer: Buffer; changed: number }> {
  const zip = await JSZip.loadAsync(buffer);
  let changed = 0;
  for (const { file, xml } of await parts(zip)) {
    const wanted = Object.entries(edits).filter(([k]) => k.startsWith(`${file}#`));
    if (!wanted.length) continue;
    const byIndex = new Map(wanted.map(([k, v]) => [Number(k.slice(file.length + 1)), String(v ?? '')]));
    let i = 0;
    const next = xml.replace(PARAGRAPH, p => {
      const index = i++;
      if (!byIndex.has(index)) return p;
      const edited = editParagraph(p, byIndex.get(index)!);
      if (edited !== p) changed++;
      return edited;
    });
    if (next !== xml) zip.file(file, next);
  }
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), changed };
}
