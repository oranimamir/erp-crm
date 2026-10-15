import path from 'path';
import fs from 'fs';
import db from '../database.js';
import { uploadsBase, categoryIdByName } from './productDocs.js';
import { pdfText } from './supplierInvoiceReader.js';
import { readDocxParagraphs } from './docxText.js';
import { DocOwner } from './docOwner.js';

/**
 * Which shipping-documents checklist box an uploaded document looks like
 * (operation / NCO page): by its file name, else by the title area of its
 * text (PDF / Word). Lets the page ask "file it as Label?" so the box is ticked.
 */

/** The checklist (client `REQUIRED_OPERATION_DOCS`) — category names, older names after. */
const CHECKLIST: Array<{ category: string; aliases?: string[]; name: RegExp; text: RegExp }> = [
  // Phytosanitary before sanitary: "phytosanitary certificate" contains "sanitary certificate"
  { category: 'Phytosanitary certificate', name: /phyto/i, text: /phyto[\s-]*sanitary\s+certificate|certificat\s+phytosanitaire|pflanzengesundheitszeugnis/i },
  { category: 'COA', name: /(^|[^a-z])(coa|c\.o\.a)([^a-z]|$)|certificate[\s_-]*of[\s_-]*analys[ie]s|analysis[\s_-]*cert/i, text: /certificate\s+of\s+analys[ie]s|analysis\s+certificate|certificat\s+d['’]analyse|analysen?zertifikat|certificado\s+de\s+an[aá]lisis|certificato\s+di\s+analisi/i },
  { category: 'Quality certificate', name: /quality[\s_-]*cert|(^|[^a-z])coq([^a-z]|$)|certificate[\s_-]*of[\s_-]*quality/i, text: /quality\s+certificate|certificate\s+of\s+quality|certificat\s+de\s+qualit[ée]|qualit[äa]tszertifikat/i },
  { category: 'Origin certificate', name: /(^|[^a-z])(origin|coo)([^a-z]|$)/i, text: /certificate\s+of\s+origin|origin\s+certificate|certificat\s+d['’]origine|ursprungszeugnis|certificado\s+de\s+origen/i },
  { category: 'Insurance certificate', name: /insurance|assurance|versicherung/i, text: /certificate\s+of\s+insurance|insurance\s+certificate|insurance\s+policy|certificat\s+d['’]assurance/i },
  { category: 'Sanitary certificate', name: /(^|[^a-z])sanitary/i, text: /(^|[^a-z])sanitary\s+certificate|certificat\s+sanitaire/i },
  { category: 'Health certificate', name: /health[\s_-]*cert/i, text: /health\s+certificate|veterinary\s+certificate|gesundheitszeugnis/i },
  { category: 'EUR1', name: /eur[\s._-]*1([^0-9]|$)/i, text: /eur\.?\s*1\s+movement\s+certificate|movement\s+certificate|warenverkehrsbescheinigung/i },
  { category: 'MSDS', name: /(^|[^a-z])(m?sds)([^a-z]|$)|safety[\s_-]*data/i, text: /safety\s+data\s+sheet|fiche\s+de\s+donn[ée]es\s+de\s+s[ée]curit[ée]|sicherheitsdatenblatt|veiligheidsinformatieblad|regulation\s*\(ec\)\s*no\.?\s*1907\/2006/i },
  { category: 'Product Specification Sheet', aliases: ['PDS'], name: /(^|[^a-z])(pds|tds)([^a-z]|$)|spec(ification)?[\s_-]*sheet|product[\s_-]*spec|technical[\s_-]*data/i, text: /product\s+specification|specification\s+sheet|technical\s+data\s+sheet|product\s+data\s+sheet|fiche\s+technique/i },
  { category: 'Label', name: /label|etiket|[ée]tiquette|etichett|etiqueta/i, text: /^\s*(product\s+)?label\s*$/im },
  { category: 'Declaration', aliases: ['Declarations'], name: /declaration|verklaring|erkl[äa]rung|dichiarazione/i, text: /^\s*[^\n]{0,40}declaration\b|we\s+hereby\s+declare|hereby\s+(confirm|certify)\s+that/im },
];

/** Commercial documents name certificates in their text ("Documents: COA, certificate of origin…") — never guessed from it. */
const COMMERCIAL = /(commercial\s+)?invoice|packing\s+list|bill\s+of\s+lading|proforma|order\s+confirmation|purchase\s+order/i;
const HEAD = 2500;

export interface ChecklistGuess { id: number; file_name: string; category: string; category_id: number; reason: string }

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const namesOf = (c: (typeof CHECKLIST)[number]) => [c.category, ...(c.aliases || [])].map(lower);

async function headText(abs: string, fileName: string): Promise<string> {
  try {
    if (/\.pdf$/i.test(fileName)) return (await pdfText(fs.readFileSync(abs))).text.slice(0, HEAD);
    if (/\.docx$/i.test(fileName)) return (await readDocxParagraphs(fs.readFileSync(abs))).map(p => p.text).join('\n').slice(0, HEAD);
  } catch { /* unreadable — name only */ }
  return '';
}

/** The checklist category a file looks like, and why — or null. */
export async function guessChecklistCategory(abs: string, fileName: string): Promise<{ category: string; reason: string } | null> {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, '');
  if (COMMERCIAL.test(stem.replace(/[_-]+/g, ' '))) return null;
  const byName = CHECKLIST.find(c => c.name.test(stem));
  if (byName) return { category: byName.category, reason: 'its file name' };
  const text = await headText(abs, fileName);
  if (!text) return null;
  // The opening lines say what the document is; an invoice / PL / BL title there → no guess
  if (COMMERCIAL.test(text.slice(0, 400))) return null;
  // The title nearest the top wins
  let best: { category: string; at: number; phrase: string } | null = null;
  for (const c of CHECKLIST) {
    const m = c.text.exec(text);
    if (m && (!best || m.index < best.at)) best = { category: c.category, at: m.index, phrase: m[0].trim() };
  }
  return best ? { category: best.category, reason: `“${best.phrase.replace(/\s+/g, ' ')}” on the document` } : null;
}

/**
 * Guesses for the owner's documents `ids`: only documents not already filed
 * under a checklist category, and only boxes the owner has not ticked yet.
 */
export async function checklistGuesses(owner: DocOwner, ids: number[]): Promise<ChecklistGuess[]> {
  const docs = db.prepare(`
    SELECT d.id, d.file_name, d.file_path, dc.name AS category_name
    FROM ${owner.table} d LEFT JOIN document_categories dc ON dc.id = d.category_id
    WHERE d.${owner.fk} = ?
  `).all(owner.id) as any[];
  const ticked = new Set(docs.map(d => lower(d.category_name)).filter(Boolean));
  const isChecklist = (name: string) => CHECKLIST.some(c => namesOf(c).includes(lower(name)));
  const wanted = new Set(ids.map(Number).filter(Number.isInteger));
  const out: ChecklistGuess[] = [];
  for (const d of docs) {
    if (!wanted.has(d.id) || isChecklist(d.category_name) || !/^[a-zA-Z0-9._-]+$/.test(d.file_path)) continue;
    const guess = await guessChecklistCategory(path.join(uploadsBase, 'operation-docs', d.file_path), d.file_name);
    if (!guess) continue;
    const entry = CHECKLIST.find(c => c.category === guess.category)!;
    if (namesOf(entry).some(n => ticked.has(n))) continue;
    const categoryId = categoryIdByName(guess.category);
    if (!categoryId) continue;
    out.push({ id: d.id, file_name: d.file_name, category: guess.category, category_id: categoryId, reason: guess.reason });
  }
  return out;
}
