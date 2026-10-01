/**
 * Full check of the stored supplier invoices, cheapest first:
 *   Stage 1 (free)  — the PDF's text is searched for the stored net, VAT, total,
 *                     currency, invoice number, date and supplier. All found
 *                     and consistent → confirmed, no AI.
 *   Stage 2 (Haiku) — the rest with a text layer: Haiku reads the text, sent
 *                     through the Message Batches API (half price).
 *   Stage 3 (Sonnet)— scans without text, and text readings that don't add up:
 *                     Sonnet reads the PDF itself, also as a batch.
 * Readings land in invoice_extractions (shared with uploads), so nothing is
 * paid for twice. The check never changes an invoice.
 */
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import db from '../database.js';
import {
  pdfText, hasUsableText, isPdf, buildReadParams, parseReadResponse, readingHolds, rememberExtraction,
  cachedInvoiceExtraction, costUsd, isCreditError, MODELS, type ReadMode,
} from './supplierInvoiceReader.js';
import { supplierTokens } from './supplierMatch.js';
import { aiBudgetLeft } from './aiBudget.js';

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 1 — free text check
// ═══════════════════════════════════════════════════════════════════════════════

export function invoiceSignature(r: any): string {
  return [r.amount, r.vat_amount, r.currency, r.invoice_id, r.issue_date, r.supplier].join('|');
}

/** Amount strings in European or English notation → cents. */
function toCents(raw: string): number | null {
  let s = raw.replace(/[\s ']/g, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  const decPos = Math.max(lastComma, lastDot);
  if (decPos >= 0 && s.length - decPos - 1 <= 2 && s.length - decPos - 1 >= 1) {
    s = s.slice(0, decPos).replace(/[.,]/g, '') + '.' + s.slice(decPos + 1);
  } else {
    s = s.replace(/[.,]/g, ''); // separators are thousands
  }
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n * 100) : null;
}

/** Every amount printed in the text, in cents. */
export function amountsIn(text: string): Set<number> {
  const out = new Set<number>();
  const patterns = [
    /\d{1,3}(?:[ ., ']\d{3})+(?:[.,]\d{1,2})?(?!\d)/g, // 1.234,56  1,234.56  1 234,56
    /\d+(?:[.,]\d{1,2})?(?!\d)/g,                           // 1234,56  12.5  300
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const c = toCents(m[0]);
      if (c != null) out.add(c);
    }
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, janvier: 1, janv: 1, januar: 1,
  feb: 2, februari: 2, february: 2, fevrier: 2, fev: 2, februar: 2,
  mrt: 3, maart: 3, mar: 3, march: 3, mars: 3, marz: 3,
  apr: 4, april: 4, avril: 4, avr: 4,
  mei: 5, may: 5, mai: 5,
  jun: 6, juni: 6, june: 6, juin: 6,
  jul: 7, juli: 7, july: 7, juillet: 7, juil: 7,
  aug: 8, augustus: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12, dez: 12, dezember: 12,
};

const iso = (y: number, m: number, d: number) =>
  y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Every date printed in the text, as YYYY-MM-DD (day-first notation). */
export function datesIn(text: string): Set<string> {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const out = new Set<string>();
  const add = (v: string | null) => { if (v) out.add(v); };
  // PDF text is often glued ("Factuurdatum16.03.2026", "25/03/26289712"): no word
  // boundaries, both the 4- and the 2-digit year reading kept, impossible dates drop out
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2})(\d{2})?/g)) {
    add(iso(year4(m[3]), +m[2], +m[1]));
    if (m[4]) add(iso(Number(m[3] + m[4]), +m[2], +m[1]));
  }
  for (const m of t.matchAll(/(?<!\d)(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g)) add(iso(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g)) add(iso(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})(?:st|nd|rd|th|er)?[\s.-]*([a-z]{3,9})\.?[\s,.-]*(\d{4})/g)) {
    const mo = MONTHS[m[2]]; if (mo) add(iso(+m[3], mo, +m[1]));
  }
  for (const m of t.matchAll(/([a-z]{3,9})\.?\s*(\d{1,2}),?\s+(\d{4})/g)) {
    const mo = MONTHS[m[1]]; if (mo) add(iso(+m[3], mo, +m[2]));
  }
  return out;
}

/** How an amount in cents can be printed: 1234,56 · 1.234,56 · 1,234.56 · 1 234,56 · 1234.56 */
function printedForms(cents: number): string[] {
  const int = Math.floor(cents / 100), dec = String(cents % 100).padStart(2, '0');
  const i = String(int);
  const group = (sep: string) => i.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const forms = new Set([`${i},${dec}`, `${i}.${dec}`]);
  if (int >= 1000) for (const [t, d] of [['.', ','], [',', '.'], [' ', ','], [' ', '.'], ["'", '.']]) forms.add(`${group(t)}${d}${dec}`);
  return [...forms];
}

const VAT_RATES = [0.06, 0.09, 0.12, 0.19, 0.2, 0.21];

export interface TriageResult { status: 'confirmed' | 'needs_ai' | 'no_text'; reasons: string[] }

/** Can the stored figures be found on the invoice as printed? */
export function triageInvoice(text: string, row: any): TriageResult {
  if (!hasUsableText(text)) return { status: 'no_text', reasons: ['scan'] };
  const reasons: string[] = [];
  const amounts = amountsIn(text);
  // Printed forms are also searched in the raw text: columns are often glued ("344,85344,85")
  const flat = text.replace(/[  ]/g, ' ');
  const printed = (c: number) => c > 0 && printedForms(c).some(f => flat.includes(f));
  const has = (c: number) => [c, c - 1, c + 1].some(v => amounts.has(v) || printed(v)); // 1-cent rounding
  const net = Math.round(Math.abs(row.amount || 0) * 100);
  const vat = Math.round(Math.abs(row.vat_amount || 0) * 100);

  if (net === 0) reasons.push('net_zero');
  else if (!has(net)) reasons.push('net_not_found');
  if (vat > 0) {
    if (!has(vat)) reasons.push('vat_not_found');
    if (!has(net + vat)) reasons.push('total_not_found');
  } else if (net > 0) {
    // No VAT stored but a VAT rate is printed (and no 0 % rate) → let the AI look
    if (/(?<![\d.,])(6|9|12|19|20|21)([.,]0{1,2})?\s?%/.test(text) && !/(?<![\d.,])0([.,]0{1,2})?\s?%/.test(text)) reasons.push('vat_rate_printed');
    // No VAT stored — make sure the invoice doesn't show VAT after all
    for (const r of VAT_RATES) {
      const v = Math.round(net * r);
      if (has(v) && has(net + v)) { reasons.push('vat_on_invoice'); break; }
    }
    // …or that the stored amount isn't a VAT-inclusive total (net + VAT printed)
    for (const a of amounts) {
      if (a <= 0 || a >= net) continue;
      const b = net - a;
      if (!has(b)) continue;
      if (VAT_RATES.some(r => Math.abs(b - a * r) <= Math.max(2, a * r * 0.005))) { reasons.push('amount_includes_vat'); break; }
    }
  }

  // Currency: the stored one must be the one printed
  const lower = text.toLowerCase();
  const mentions = {
    EUR: /\beur\b|€|euro/.test(lower),
    USD: /\busd\b|us\$|\$/.test(lower),
    GBP: /\bgbp\b|£/.test(lower),
  } as Record<string, boolean>;
  const cur = (row.currency || 'EUR').toUpperCase();
  if (cur === 'EUR' ? (!mentions.EUR && (mentions.USD || mentions.GBP)) : !mentions[cur]) reasons.push('currency');

  // Invoice number printed somewhere (ignoring spacing / punctuation / leading zeros)
  const compact = lower.replace(/[^a-z0-9]/g, '');
  const id = String(row.invoice_id || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^0+/, '');
  if (id.length < 3 || !compact.includes(id)) reasons.push('number_not_found');

  if (!row.issue_date || !datesIn(text).has(row.issue_date)) reasons.push('date_not_found');

  // Supplier: every word of the stored name appears in the text
  const words = new Set(lower.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' '));
  const tokens = supplierTokens(row.supplier || '').filter(w => w.length >= 3);
  if (tokens.length === 0 || !tokens.every(w => words.has(w) || compact.includes(w))) reasons.push('supplier_not_found');

  return { status: reasons.length ? 'needs_ai' : 'confirmed', reasons };
}

export const triageJob = { running: false, total: 0, done: 0, startedAt: null as string | null, finishedAt: null as string | null };

/** Stage 1 over every invoice with a stored PDF. Skips invoices already checked with the same stored figures. */
export type Scope = 'demo' | 'sales' | null;  // null = all supplier invoices

export function scopeOf(v: unknown): Scope {
  return v === 'demo' || v === 'sales' ? v : null;
}

export async function runTriage(force = false, scope: Scope = null): Promise<void> {
  const rows = db.prepare(`
    SELECT i.id, i.invoice_id, i.issue_date, i.supplier, i.amount, i.vat_amount, i.currency, i.file_hash,
      t.signature as t_sig
    FROM demo_invoices i LEFT JOIN invoice_triage t ON t.invoice_id = i.id
    WHERE i.embedded_pdf IS NOT NULL AND i.embedded_pdf != ''${scope ? ' AND i.domain = ?' : ''}
    ORDER BY i.id
  `).all(...(scope ? [scope] : [])) as any[];
  const todo = force ? rows : rows.filter(r => r.t_sig !== invoiceSignature(r));
  Object.assign(triageJob, { running: true, total: todo.length, done: 0, startedAt: new Date().toISOString(), finishedAt: null });
  const upsert = db.prepare('INSERT OR REPLACE INTO invoice_triage (invoice_id, signature, file_hash, status, reasons, checked_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))');
  try {
    for (const r of todo) {
      try {
        const pdfRow = db.prepare('SELECT embedded_pdf FROM demo_invoices WHERE id = ?').get(r.id) as any;
        const file = Buffer.from(pdfRow?.embedded_pdf || '', 'base64');
        const hash = r.file_hash || sha256(file);
        let t = db.prepare('SELECT text, pages FROM invoice_texts WHERE file_hash = ?').get(hash) as any;
        if (!t) {
          const pt = isPdf(file) ? await pdfText(file) : { text: '', pages: 1 };
          t = { text: pt.text.slice(0, 60000), pages: pt.pages };
          db.prepare('INSERT OR REPLACE INTO invoice_texts (file_hash, text, pages) VALUES (?, ?, ?)').run(hash, t.text, t.pages);
        }
        const res = triageInvoice(t.text, r);
        upsert.run(r.id, invoiceSignature(r), hash, res.status, res.reasons.join(','));
      } catch (err: any) {
        upsert.run(r.id, invoiceSignature(r), r.file_hash, 'no_text', 'error');
        console.warn(`[invoice-check] text check failed for #${r.id}:`, err?.message || err);
      }
      triageJob.done++;
      // Let requests through between PDFs
      if (triageJob.done % 20 === 0) await new Promise(res => setImmediate(res));
    }
  } finally {
    triageJob.running = false;
    triageJob.finishedAt = new Date().toISOString();
    db.saveToDisk();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGES 2 + 3 — AI readings through the Message Batches API
// ═══════════════════════════════════════════════════════════════════════════════

const OUTPUT_TOKENS = 350;       // one filled-in record_invoice call
const PROMPT_TOKENS = 900;       // instructions + tool schema
const PDF_PAGE_TOKENS = 1800;    // a PDF page as image + text

function pendingHashes(): Set<string> {
  const out = new Set<string>();
  for (const b of db.prepare("SELECT items FROM invoice_read_batches WHERE status = 'in_progress'").all() as any[]) {
    try { for (const h of JSON.parse(b.items || '[]')) out.add(h); } catch { /* ignore */ }
  }
  return out;
}

export interface Candidate { invoiceId: number; hash: string; estTokens: number; estUsd: number }

/** Invoices that the given stage would send, with an estimated batch cost each. */
export function stageCandidates(mode: ReadMode, scope: Scope = null): Candidate[] {
  const pending = pendingHashes();
  const rows = db.prepare(`
    SELECT t.invoice_id, t.file_hash, t.status, x.text_len, x.pages
    FROM invoice_triage t
    JOIN demo_invoices i ON i.id = t.invoice_id
    LEFT JOIN (SELECT file_hash, LENGTH(text) as text_len, pages FROM invoice_texts) x ON x.file_hash = t.file_hash
    WHERE t.file_hash IS NOT NULL${scope ? ' AND i.domain = ?' : ''}
  `).all(...(scope ? [scope] : [])) as any[];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    if (seen.has(r.file_hash) || pending.has(r.file_hash)) continue;
    const x = cachedInvoiceExtraction(r.file_hash);
    let wanted = false;
    if (mode === 'haiku-text') {
      wanted = r.status === 'needs_ai' && !x;
    } else {
      // Scans, and text readings that don't add up; any PDF reading already made counts
      const pdfRead = x && x.read_by !== 'haiku-text';
      wanted = !pdfRead && ((r.status === 'no_text' && !x) || (x?.read_by === 'haiku-text' && !readingHolds(x)));
    }
    if (!wanted) continue;
    seen.add(r.file_hash);
    const estTokens = mode === 'haiku-text'
      ? PROMPT_TOKENS + Math.ceil(Math.min(r.text_len || 0, 14000) / 3.2)
      : PROMPT_TOKENS + (r.pages || 1) * PDF_PAGE_TOKENS;
    out.push({ invoiceId: r.invoice_id, hash: r.file_hash, estTokens, estUsd: costUsd(mode, estTokens, OUTPUT_TOKENS, true) });
  }
  return out;
}

export function invoiceCategoriesForAi(): { demo: string[]; sales: string[] } {
  const custom = db.prepare('SELECT name, domain FROM demo_custom_categories').all() as any[];
  const demo = ['Salaries', 'Cars', 'Overhead', 'Consumables', 'Materials', 'Utilities and Maintenance', 'Feedstock', 'Subcontractors and Consultants', 'Regulatory', 'Equipment', 'Couriers', 'Other'];
  const sales = ['Raw Materials', 'Logistics', 'Blenders', 'Shipping', 'Other'];
  return {
    demo: [...new Set([...demo, ...custom.filter(c => c.domain === 'demo').map(c => c.name)])],
    sales: [...new Set([...sales, ...custom.filter(c => c.domain === 'sales').map(c => c.name)])],
  };
}

const MAX_BATCH_BYTES = 80 * 1024 * 1024; // API limit is 256 MB per batch; stay well under

/** Send one stage as batch(es), up to `maxUsd` estimated (never more than the monthly budget left). */
async function sendStage(mode: ReadMode, maxUsd: number, scope: Scope, runId: number | null): Promise<{ sent: number; estimatedUsd: number; batches: string[]; skippedOverBudget: number }> {
  maxUsd = Math.min(maxUsd, aiBudgetLeft());
  const all = stageCandidates(mode, scope);
  const chosen: Candidate[] = [];
  let est = 0;
  for (const c of all) {
    if (est + c.estUsd > maxUsd) break;
    chosen.push(c); est += c.estUsd;
  }
  if (chosen.length === 0) return { sent: 0, estimatedUsd: 0, batches: [], skippedOverBudget: all.length };

  const categories = invoiceCategoriesForAi();
  const client = new Anthropic();
  const batchIds: string[] = [];
  let requests: any[] = [], items: string[] = [], bytes = 0, chunkEst = 0;

  const flush = async () => {
    if (requests.length === 0) return;
    const batch: any = await client.messages.batches.create({ requests });
    db.prepare('INSERT INTO invoice_read_batches (id, mode, request_count, estimated_usd, items, run_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(batch.id, mode, requests.length, Math.round(chunkEst * 100) / 100, JSON.stringify(items), runId);
    db.saveToDisk();
    batchIds.push(batch.id);
    requests = []; items = []; bytes = 0; chunkEst = 0;
  };

  try {
    for (const c of chosen) {
      let params: any = null;
      if (mode === 'haiku-text') {
        const t = db.prepare('SELECT text FROM invoice_texts WHERE file_hash = ?').get(c.hash) as any;
        params = buildReadParams(mode, { text: t?.text || '' }, categories);
      } else {
        const r = db.prepare('SELECT embedded_pdf FROM demo_invoices WHERE id = ?').get(c.invoiceId) as any;
        params = r?.embedded_pdf ? buildReadParams(mode, { file: Buffer.from(r.embedded_pdf, 'base64') }, categories) : null;
      }
      if (!params) continue;
      const size = JSON.stringify(params).length;
      if (bytes + size > MAX_BATCH_BYTES) await flush();
      // custom_id: letters, digits, _ and -, at most 64 chars
      requests.push({ custom_id: `h${c.hash.slice(0, 63)}`, params });
      items.push(c.hash); bytes += size; chunkEst += c.estUsd;
    }
    await flush();
  } catch (err: any) {
    if (isCreditError(err)) throw new Error('The Anthropic API credit is used up — top it up and send again');
    throw err;
  }
  return { sent: chosen.length, estimatedUsd: Math.round(est * 100) / 100, batches: batchIds, skippedOverBudget: all.length - chosen.length };
}

let polling = false;

/** Collect finished batches: store readings, record the actual cost. */
export async function pollBatches(): Promise<void> {
  if (polling || !process.env.ANTHROPIC_API_KEY) return;
  const open = db.prepare("SELECT id, mode, items FROM invoice_read_batches WHERE status = 'in_progress'").all() as any[];
  if (open.length === 0) return;
  polling = true;
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  try {
    for (const b of open) {
      const info: any = await client.messages.batches.retrieve(b.id);
      if (info.processing_status !== 'ended') continue;
      const mode = b.mode as ReadMode;
      const byPrefix = new Map<string, string>();
      for (const h of JSON.parse(b.items || '[]') as string[]) byPrefix.set(`h${h.slice(0, 63)}`, h);
      let ok = 0, failed = 0, inTok = 0, outTok = 0;
      for await (const r of await client.messages.batches.results(b.id) as any) {
        const hash = byPrefix.get(r.custom_id);
        if (r.result?.type === 'succeeded' && hash) {
          const msg = r.result.message;
          inTok += (msg.usage?.input_tokens || 0) + (msg.usage?.cache_read_input_tokens || 0) + (msg.usage?.cache_creation_input_tokens || 0);
          outTok += msg.usage?.output_tokens || 0;
          const x = parseReadResponse(msg, mode);
          if (x) {
            // A PDF reading replaces a text reading; never the other way round
            const prev = cachedInvoiceExtraction(hash);
            if (!(mode === 'haiku-text' && prev && prev.read_by !== 'haiku-text')) rememberExtraction(hash, x);
            ok++;
          } else failed++;
        } else failed++;
      }
      const cost = costUsd(mode, inTok, outTok, true);
      db.prepare("UPDATE invoice_read_batches SET status = 'ended', succeeded = ?, failed = ?, cost_usd = ?, ended_at = datetime('now') WHERE id = ?")
        .run(ok, failed, Math.round(cost * 10000) / 10000, b.id);
      db.prepare('INSERT INTO ai_usage (purpose, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)')
        .run(`full check batch ${b.id}`, MODELS[mode], inTok, outTok, cost);
      db.saveToDisk();
      console.log(`[invoice-check] batch ${b.id} (${mode}) ended: ${ok} read, ${failed} failed, ~$${cost.toFixed(3)}`);
    }
  } catch (err: any) {
    console.warn('[invoice-check] batch poll failed:', err?.message || err);
  } finally {
    polling = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE CHECK — one run moves through the stages by itself:
//   text  → free text check of every PDF in scope
//   ai_text → Haiku batch for what the text check could not confirm
//   ai_pdf  → Sonnet batch for scans and text readings that don't add up
//   done    → the user gets the result list (or 'stopped' with a reason)
// Kept in check_runs, so a server restart picks it up again.
// ═══════════════════════════════════════════════════════════════════════════════

export interface CheckRun {
  id: number; scope: string; status: 'text' | 'ai_text' | 'ai_pdf' | 'done' | 'stopped';
  started_by: string | null; started_at: string; finished_at: string | null; message: string | null;
}

export function currentRun(): CheckRun | null {
  return (db.prepare('SELECT * FROM check_runs ORDER BY id DESC LIMIT 1').get() as CheckRun) || null;
}

function activeRun(): CheckRun | null {
  const r = currentRun();
  return r && (r.status === 'text' || r.status === 'ai_text' || r.status === 'ai_pdf') ? r : null;
}

function runScope(r: CheckRun): Scope { return r.scope === 'demo' || r.scope === 'sales' ? r.scope : null; }

function setRun(id: number, status: CheckRun['status'], message?: string | null) {
  const done = status === 'done' || status === 'stopped';
  db.prepare(`UPDATE check_runs SET status = ?, message = COALESCE(?, message)${done ? ", finished_at = datetime('now')" : ''} WHERE id = ?`)
    .run(status, message ?? null, id);
  db.saveToDisk();
}


/** Invoices in scope whose stored figures have not been text-checked yet. */
function untriagedCount(scope: Scope): number {
  const rows = db.prepare(`
    SELECT i.amount, i.vat_amount, i.currency, i.invoice_id, i.issue_date, i.supplier, t.signature
    FROM demo_invoices i LEFT JOIN invoice_triage t ON t.invoice_id = i.id
    WHERE i.embedded_pdf IS NOT NULL AND i.embedded_pdf != ''${scope ? ' AND i.domain = ?' : ''}
  `).all(...(scope ? [scope] : [])) as any[];
  return rows.filter(r => r.signature !== invoiceSignature(r)).length;
}

export function startRun(scope: Scope, startedBy: string): CheckRun {
  const active = activeRun();
  if (active) throw new Error('A check is already running');
  const info = db.prepare("INSERT INTO check_runs (scope, status, started_by, started_at) VALUES (?, 'text', ?, datetime('now'))")
    .run(scope || 'all', startedBy);
  db.saveToDisk();
  runTriage(false, scope).catch(err => console.error('[invoice-check] text check error:', err))
    .finally(() => { advanceRun().catch(() => {}); });
  return db.prepare('SELECT * FROM check_runs WHERE id = ?').get(info.lastInsertRowid) as CheckRun;
}

let advancing = false;

/** Move the active run on to its next stage when the current one is finished. */
export async function advanceRun(): Promise<void> {
  if (advancing) return;
  advancing = true;
  try {
    for (let guard = 0; guard < 4; guard++) {
      const run = activeRun();
      if (!run) return;
      const scope = runScope(run);
      const openOfRun = (mode: ReadMode) =>
        (db.prepare("SELECT COUNT(*) as c FROM invoice_read_batches WHERE run_id = ? AND mode = ? AND status = 'in_progress'").get(run.id, mode) as any).c as number;

      if (run.status === 'text') {
        if (triageJob.running) return;
        // e.g. after a restart mid-way: finish the text check first
        if (untriagedCount(scope) > 0) {
          runTriage(false, scope).catch(() => {}).finally(() => { advanceRun().catch(() => {}); });
          return;
        }
        if (!(await sendForRun(run, 'haiku-text'))) return;
        setRun(run.id, 'ai_text');
        continue;
      }
      if (run.status === 'ai_text') {
        if (openOfRun('haiku-text') > 0) return;
        if (!(await sendForRun(run, 'sonnet-pdf'))) return;
        setRun(run.id, 'ai_pdf');
        continue;
      }
      if (run.status === 'ai_pdf') {
        if (openOfRun('sonnet-pdf') > 0) return;
        try { learnSupplierVats(); } catch { /* best effort */ }
        setRun(run.id, 'done');
        return;
      }
      return;
    }
  } finally {
    advancing = false;
  }
}

/** Send a stage for the run within the monthly budget. False = the run was stopped. */
async function sendForRun(run: CheckRun, mode: ReadMode): Promise<boolean> {
  const scope = runScope(run);
  if (stageCandidates(mode, scope).length === 0) return true;
  if (!process.env.ANTHROPIC_API_KEY) {
    setRun(run.id, 'stopped', 'AI reading is not set up on the server (ANTHROPIC_API_KEY) — only the free text check ran.');
    return false;
  }
  try {
    const r = await sendStage(mode, Number.POSITIVE_INFINITY, scope, run.id);
    if (r.skippedOverBudget > 0) {
      // One line for the whole run, however many stages hit the limit
      const prev = (db.prepare('SELECT message FROM check_runs WHERE id = ?').get(run.id) as any)?.message || '';
      const before = Number(prev.match(/Spending limit reached: (\d+)/)?.[1] || 0);
      const line = `Spending limit reached: ${before + r.skippedOverBudget} invoice(s) were not read by AI — raise the limit in Settings and check again.`;
      db.prepare('UPDATE check_runs SET message = ? WHERE id = ?').run(before ? prev.replace(/Spending limit reached: \d+ invoice\(s\) were not read by AI — raise the limit in Settings and check again\./, line) : [prev, line].filter(Boolean).join(' '), run.id);
    }
    return true;
  } catch (err: any) {
    const why = isCreditError(err) ? 'the Anthropic API credit is used up — top it up and run the check again' : (err?.message || 'the AI service did not respond');
    setRun(run.id, 'stopped', `Stopped: ${why}.`);
    return false;
  }
}

/**
 * Learn suppliers' VAT numbers from readings: when what is printed is the stored
 * supplier (same name words), keep its VAT number and country on the invoice.
 * Supplier details only — amounts are never touched. Uploads then recognise the
 * supplier by VAT number (and can skip AI when the text check confirms them).
 */
export function learnSupplierVats(): number {
  const rows = db.prepare(`
    SELECT i.id, i.supplier, COALESCE(i.file_hash, t.file_hash) as file_hash
    FROM demo_invoices i LEFT JOIN invoice_triage t ON t.invoice_id = i.id
    WHERE (i.supplier_vat IS NULL OR i.supplier_vat = '')
  `).all() as any[];
  const upd = db.prepare('UPDATE demo_invoices SET supplier_vat = ?, supplier_country = COALESCE(supplier_country, ?) WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const x = cachedInvoiceExtraction(r.file_hash);
    const vat = (x?.supplier_vat_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!x || vat.length < 8 || !x.supplier_name) continue;
    const stored = supplierTokens(r.supplier || '').filter(w => w.length >= 3);
    const printed = new Set(supplierTokens(x.supplier_name));
    if (stored.length === 0 || !stored.every(w => printed.has(w))) continue;
    upd.run(vat, x.supplier_country, r.id);
    n++;
  }
  if (n) db.saveToDisk();
  return n;
}

/** Collect batches and move runs on every 2 minutes; pick up a run left mid-way by a restart. */
export function startBatchPoller(): void {
  const tick = () => pollBatches().catch(() => {}).then(() => advanceRun()).catch(() => {});
  setInterval(tick, 120_000).unref?.();
  setTimeout(tick, 15_000).unref?.();
}
