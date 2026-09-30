/**
 * Reads a supplier invoice with Claude, as cheaply as the document allows:
 *   1. the PDF's text layer, read by Haiku (the cheapest model, text only)
 *   2. only when there is no usable text (a scan) or that reading does not add
 *      up, the PDF itself, read by Sonnet
 * The same request builders serve single calls (uploads, re-read) and the
 * Message Batches API (the full check, half price — lib/invoiceCheck.ts).
 *
 * Each file is read once: results are kept in invoice_extractions keyed by the
 * file's sha256, so re-uploads, re-reads and re-runs cost nothing. Every call's
 * token use goes to ai_usage.
 */
import Anthropic from '@anthropic-ai/sdk';
// @ts-ignore — import lib directly to avoid pdf-parse's debug-mode crash in ESM
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import db from '../database.js';

export interface InvoiceExtraction {
  is_invoice: boolean;
  is_credit_note: boolean;
  invoice_number: string | null;
  issue_date: string | null;          // YYYY-MM-DD
  currency: string | null;            // ISO code
  supplier_name: string | null;
  supplier_vat_number: string | null;
  supplier_country: string | null;    // ISO 3166-1 alpha-2
  net_amount: number | null;          // excl. VAT, positive
  vat_amount: number | null;
  total_amount: number | null;        // incl. VAT
  vat_lines: { rate: number; base: number; vat: number }[];
  reverse_charge: boolean;
  matched_known_supplier: string | null;  // only on older readings
  suggested_domain: 'demo' | 'sales' | null;
  suggested_category: string | null;
  description: string | null;
  read_by?: ReadMode | 'opus-pdf';    // absent on readings made before the staged reader
}

export type ReadMode = 'haiku-text' | 'sonnet-pdf';

export const MODELS: Record<ReadMode, string> = {
  'haiku-text': 'claude-haiku-4-5-20251001',
  'sonnet-pdf': 'claude-sonnet-5-5',
};

/** Approximate list prices, USD per million tokens (batch = half). Used for estimates and the spend log. */
export const PRICES: Record<ReadMode, { input: number; output: number }> = {
  'haiku-text': { input: 1, output: 5 },
  'sonnet-pdf': { input: 3, output: 15 },
};

export function costUsd(mode: ReadMode, inputTokens: number, outputTokens: number, batch: boolean): number {
  const p = PRICES[mode];
  return ((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * (batch ? 0.5 : 1);
}

const SCHEMA = {
  type: 'object',
  required: [
    'is_invoice', 'is_credit_note', 'invoice_number', 'issue_date', 'currency',
    'supplier_name', 'supplier_vat_number', 'supplier_country',
    'net_amount', 'vat_amount', 'total_amount', 'vat_lines', 'reverse_charge',
    'suggested_domain', 'suggested_category', 'description',
  ],
  properties: {
    is_invoice: { type: 'boolean', description: 'False when the document is not an invoice or credit note (a quote, statement, reminder, delivery note, payslip/tax filing)' },
    is_credit_note: { type: 'boolean' },
    invoice_number: { type: ['string', 'null'], description: 'The invoice / credit note number as printed, not an order, customer or VAT number' },
    issue_date: { type: ['string', 'null'], description: 'Invoice date (not the due, delivery or order date), as YYYY-MM-DD' },
    currency: { type: ['string', 'null'], description: 'ISO code of the invoice currency: EUR, USD, GBP…' },
    supplier_name: { type: ['string', 'null'], description: 'Legal name of the company that issued the invoice (the seller)' },
    supplier_vat_number: { type: ['string', 'null'], description: "The seller's VAT number with country prefix (BE0123456789, NL123456789B01) — never the buyer's" },
    supplier_country: { type: ['string', 'null'], description: "Seller's country, ISO 3166-1 alpha-2 (BE, NL, DE, FR, GB, CN…)" },
    net_amount: { type: ['number', 'null'], description: 'Invoice total excluding VAT, positive' },
    vat_amount: { type: ['number', 'null'], description: 'Total VAT charged, positive; 0 when none is charged' },
    total_amount: { type: ['number', 'null'], description: 'Total including VAT (before any prepayment deduction), positive' },
    vat_lines: {
      type: 'array',
      description: 'The VAT summary: one entry per VAT rate printed',
      items: {
        type: 'object',
        required: ['rate', 'base', 'vat'],
        properties: { rate: { type: 'number', description: 'Percent, e.g. 21' }, base: { type: 'number' }, vat: { type: 'number' } },
      },
    },
    reverse_charge: { type: 'boolean', description: 'True when VAT is shifted to the buyer (BTW verlegd, autoliquidation, reverse charge, intra-community supply, art. 196)' },
    suggested_domain: { type: 'string', enum: ['demo', 'sales'] },
    suggested_category: { type: ['string', 'null'], description: 'One of the categories listed for the suggested domain' },
    description: { type: ['string', 'null'], description: 'A few words on what was bought' },
  },
};

// A forced tool call gives JSON on every model and in batches
const TOOL = { name: 'record_invoice', description: 'Record the figures read from the invoice', input_schema: SCHEMA };

function instructions(categories: { demo: string[]; sales: string[] }): string {
  return `You read invoices received by TripleW, a Belgian company (TripleW BV; also TripleW NL BV). TripleW is always the BUYER — never give TripleW or its VAT number as the supplier.

Record the invoice with the record_invoice tool.
- Copy amounts exactly as printed in the invoice totals / VAT summary. If one of net / VAT / total is not printed, derive it from the other two.
- net_amount excludes VAT, total_amount includes it. All amounts positive, also on a credit note (set is_credit_note).
- No VAT charged (reverse charge, intra-community, export, exempt) → vat_amount 0.
- European number format is common: "1.234,56" = 1234.56.

Domains:
- "sales": TripleW's trading business — raw materials for customer orders, blenders/toll processing, logistics, freight, shipping, customs; often an operation number starting with SO. Categories: ${categories.sales.join(', ')}.
- "demo": the demo plant and company — salaries, cars, overhead, consumables, lab materials, utilities & maintenance, feedstock, consultants, regulatory, equipment, couriers. Categories: ${categories.demo.join(', ')}.`;
}

// ── PDF text ────────────────────────────────────────────────────────────────

export interface PdfText { text: string; pages: number }

export async function pdfText(file: Buffer): Promise<PdfText> {
  try {
    const r = await (pdfParse as any)(file);
    return { text: String(r.text || ''), pages: Number(r.numpages) || 1 };
  } catch {
    return { text: '', pages: 1 };
  }
}

/** Enough real text to read from (not a scan with a stray line). */
export function hasUsableText(t: string): boolean {
  const letters = (t.match(/[a-z]/gi) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  return letters >= 80 && digits >= 10;
}

const MAX_TEXT = 14000;
/** Long documents: keep the start (header) and the end (totals). */
function clipText(t: string): string {
  const clean = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length <= MAX_TEXT ? clean : clean.slice(0, 9000) + '\n[…]\n' + clean.slice(-5000);
}

// ── Requests ────────────────────────────────────────────────────────────────

export function isPdf(file: Buffer): boolean {
  return file.subarray(0, 4).toString('latin1') === '%PDF';
}

function imageType(file: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const head = file.subarray(0, 12);
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Message params for one invoice (single call or a batch request). */
export function buildReadParams(
  mode: ReadMode,
  input: { text?: string; file?: Buffer },
  categories: { demo: string[]; sales: string[] },
): any | null {
  let content: any[];
  if (mode === 'haiku-text') {
    if (!input.text) return null;
    content = [{ type: 'text', text: `Invoice text extracted from the PDF (the layout may be jumbled):\n\n${clipText(input.text)}` }];
  } else {
    if (!input.file) return null;
    const data = input.file.toString('base64');
    const img = imageType(input.file);
    if (isPdf(input.file)) content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }];
    else if (img) content = [{ type: 'image', source: { type: 'base64', media_type: img, data } }];
    else return null;
    content.push({ type: 'text', text: 'Record this invoice.' });
  }
  return {
    model: MODELS[mode],
    max_tokens: 1500,
    system: instructions(categories),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content }],
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Extraction from a model response (single call or a batch result). */
export function parseReadResponse(message: any, mode: ReadMode): InvoiceExtraction | null {
  const p = (message?.content || []).find((b: any) => b.type === 'tool_use')?.input;
  if (!p || typeof p !== 'object') return null;
  const issueDate = str(p.issue_date);
  return {
    is_invoice: p.is_invoice !== false,
    is_credit_note: !!p.is_credit_note,
    invoice_number: str(p.invoice_number),
    issue_date: issueDate && /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? issueDate : null,
    currency: str(p.currency)?.toUpperCase().slice(0, 3) ?? null,
    supplier_name: str(p.supplier_name),
    supplier_vat_number: str(p.supplier_vat_number),
    supplier_country: str(p.supplier_country)?.toUpperCase().slice(0, 2) ?? null,
    net_amount: num(p.net_amount) != null ? Math.abs(num(p.net_amount)!) : null,
    vat_amount: num(p.vat_amount) != null ? Math.abs(num(p.vat_amount)!) : null,
    total_amount: num(p.total_amount) != null ? Math.abs(num(p.total_amount)!) : null,
    vat_lines: Array.isArray(p.vat_lines)
      ? p.vat_lines.map((l: any) => ({ rate: num(l?.rate) ?? 0, base: Math.abs(num(l?.base) ?? 0), vat: Math.abs(num(l?.vat) ?? 0) }))
      : [],
    reverse_charge: !!p.reverse_charge,
    matched_known_supplier: null,
    suggested_domain: p.suggested_domain === 'sales' || p.suggested_domain === 'demo' ? p.suggested_domain : null,
    suggested_category: str(p.suggested_category),
    description: str(p.description),
    read_by: mode,
  };
}

/** A text reading good enough to keep; otherwise the PDF itself is read. */
export function readingHolds(x: InvoiceExtraction | null): boolean {
  if (!x || x.net_amount == null) return false;
  const c = checkAmounts({ net: x.net_amount, vat: x.vat_amount, total: x.total_amount, vatLines: x.vat_lines, country: x.supplier_country, reverseCharge: x.reverse_charge });
  return !c.warnings.includes('totals_mismatch');
}

// ── Cache and spend log ─────────────────────────────────────────────────────

function cached(fileHash: string): InvoiceExtraction | undefined {
  const row = db.prepare('SELECT result FROM invoice_extractions WHERE file_hash = ?').get(fileHash) as any;
  if (!row) return undefined;
  try { return JSON.parse(row.result); } catch { return undefined; }
}

export function rememberExtraction(fileHash: string, result: InvoiceExtraction) {
  db.prepare('INSERT OR REPLACE INTO invoice_extractions (file_hash, result) VALUES (?, ?)').run(fileHash, JSON.stringify(result));
}

export function cachedInvoiceExtraction(fileHash: string | null | undefined): InvoiceExtraction | null {
  return fileHash ? cached(fileHash) ?? null : null;
}

export function logUsage(purpose: string, mode: ReadMode, usage: any, batch: boolean) {
  const inp = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  const out = usage?.output_tokens || 0;
  try {
    db.prepare('INSERT INTO ai_usage (purpose, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)')
      .run(purpose, MODELS[mode], inp, out, costUsd(mode, inp, out, batch));
  } catch { /* logging only */ }
}

export function invoiceReaderConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** "Your credit balance is too low…" — no point sending more */
export function isCreditError(err: any): boolean {
  return /credit balance|billing|insufficient/i.test(String(err?.message || err?.error?.error?.message || ''));
}

// ── Single invoice (uploads, re-read) ───────────────────────────────────────

/**
 * Read one invoice now: text with Haiku, then the PDF with Sonnet when there
 * is no usable text or the text reading does not add up. Returns null when AI
 * reading is not configured or nothing could be read — the caller falls back
 * to the regex reader. `force` skips the cache.
 */
export async function readSupplierInvoice(opts: {
  fileHash: string;
  file: Buffer;
  categories: { demo: string[]; sales: string[] };
  text?: string;
  force?: boolean;
}): Promise<InvoiceExtraction | null> {
  if (!opts.force) {
    const hit = cached(opts.fileHash);
    if (hit) return hit;
  }
  if (!invoiceReaderConfigured()) return null;
  const client = new Anthropic();

  const text = opts.text ?? (isPdf(opts.file) ? (await pdfText(opts.file)).text : '');
  let result: InvoiceExtraction | null = null;
  if (hasUsableText(text)) {
    const res: any = await client.messages.create(buildReadParams('haiku-text', { text }, opts.categories));
    logUsage('invoice read', 'haiku-text', res.usage, false);
    result = parseReadResponse(res, 'haiku-text');
  }
  if (!readingHolds(result)) {
    const params = buildReadParams('sonnet-pdf', { file: opts.file }, opts.categories);
    if (params) {
      const res: any = await client.messages.create(params);
      logUsage('invoice read', 'sonnet-pdf', res.usage, false);
      result = parseReadResponse(res, 'sonnet-pdf') ?? result;
    }
  }
  if (result) rememberExtraction(opts.fileHash, result);
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════════
// CHECKS — arithmetic and VAT-rate sanity, whichever reader produced the figures
// ═══════════════════════════════════════════════════════════════════════════════

export const BE_VAT_RATES = [0, 6, 12, 21];

export interface AmountCheck {
  net: number;
  vat: number;
  vatRate: number | null;   // effective rate in %, rounded to a printed rate when close
  warnings: string[];
}

/**
 * Settle net / VAT from what was read and flag anything that does not add up.
 * Warnings (codes shown in the upload review):
 *   totals_mismatch   net + VAT ≠ total, or the VAT lines don't add up to the VAT
 *   vat_rate_unusual  a Belgian supplier at a rate other than 0/6/12/21 %
 *   foreign_vat       a non-Belgian supplier charging VAT without reverse charge
 */
export function checkAmounts(r: {
  net: number | null;
  vat: number | null;
  total: number | null;
  vatLines?: { rate: number; base: number; vat: number }[];
  country?: string | null;
  reverseCharge?: boolean;
}): AmountCheck {
  const warnings: string[] = [];
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.0005);
  let net = r.net;
  let vat = r.vat;
  const total = r.total;

  if (net == null && total != null && vat != null) net = Math.round((total - vat) * 100) / 100;
  if (vat == null && total != null && net != null) vat = Math.round((total - net) * 100) / 100;
  if (vat == null) vat = 0;
  if (net == null) net = total != null ? total - vat : 0;

  if (total != null && total > 0 && !close(net + vat, total)) warnings.push('totals_mismatch');
  const lines = (r.vatLines || []).filter(l => l.base || l.vat);
  if (lines.length && !close(lines.reduce((s, l) => s + l.vat, 0), vat)) {
    if (!warnings.includes('totals_mismatch')) warnings.push('totals_mismatch');
  }

  let vatRate: number | null = null;
  if (net > 0) {
    const eff = (vat / net) * 100;
    const printed = lines.length === 1 ? lines[0].rate : null;
    const nearest = [...BE_VAT_RATES, ...(printed != null ? [printed] : [])]
      .find(rate => Math.abs(rate - eff) < 0.3);
    vatRate = nearest ?? Math.round(eff * 100) / 100;
  }

  const country = (r.country || '').toUpperCase();
  if (country === 'BE') {
    if (vatRate != null && !BE_VAT_RATES.includes(vatRate) && lines.length <= 1) warnings.push('vat_rate_unusual');
  } else if (country && vat > 0 && !r.reverseCharge) {
    warnings.push('foreign_vat');
  }
  if (net > 0 && vat > net * 0.3) warnings.push('vat_rate_unusual');

  return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, vatRate, warnings: [...new Set(warnings)] };
}
