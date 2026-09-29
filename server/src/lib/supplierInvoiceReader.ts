/**
 * Reads a supplier invoice (PDF or image) with Claude: invoice number, date,
 * supplier name + VAT number + country, net / VAT / total per VAT rate, and
 * which of our known suppliers it is. The regex reader in demo-expenses.ts is
 * the fallback when this is not configured or fails.
 *
 * Each file is read once: results are kept in invoice_extractions keyed by the
 * file's sha256, so re-uploads and re-reads cost nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
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
  matched_known_supplier: string | null;
  suggested_domain: 'demo' | 'sales' | null;
  suggested_category: string | null;
  description: string | null;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_invoice', 'is_credit_note', 'invoice_number', 'issue_date', 'currency',
    'supplier_name', 'supplier_vat_number', 'supplier_country',
    'net_amount', 'vat_amount', 'total_amount', 'vat_lines', 'reverse_charge',
    'matched_known_supplier', 'suggested_domain', 'suggested_category', 'description',
  ],
  properties: {
    is_invoice: { type: 'boolean', description: 'False when the document is not an invoice or credit note (e.g. a quote, a statement, a delivery note)' },
    is_credit_note: { type: 'boolean' },
    invoice_number: { type: ['string', 'null'], description: 'The invoice / credit note number as printed, not an order, customer or VAT number' },
    issue_date: { type: ['string', 'null'], description: 'Invoice date (not the due date or delivery date), as YYYY-MM-DD' },
    currency: { type: ['string', 'null'], description: 'ISO code of the invoice currency, e.g. EUR, USD, GBP' },
    supplier_name: { type: ['string', 'null'], description: 'Legal name of the company that issued the invoice (the seller)' },
    supplier_vat_number: { type: ['string', 'null'], description: "The seller's VAT number with country prefix, e.g. BE0123456789, NL123456789B01 — never the buyer's" },
    supplier_country: { type: ['string', 'null'], description: "Seller's country as ISO 3166-1 alpha-2 code (BE, NL, DE, FR, GB, CN…), from its address or VAT prefix" },
    net_amount: { type: ['number', 'null'], description: 'Total excluding VAT for the whole invoice, as a positive number' },
    vat_amount: { type: ['number', 'null'], description: 'Total VAT charged for the whole invoice, as a positive number; 0 when none is charged' },
    total_amount: { type: ['number', 'null'], description: 'Total including VAT (amount payable before any prepayment deduction), positive' },
    vat_lines: {
      type: 'array',
      description: 'The VAT summary: one entry per VAT rate printed on the invoice',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rate', 'base', 'vat'],
        properties: {
          rate: { type: 'number', description: 'VAT rate in percent, e.g. 21' },
          base: { type: 'number', description: 'Taxable base at that rate' },
          vat: { type: 'number', description: 'VAT at that rate' },
        },
      },
    },
    reverse_charge: { type: 'boolean', description: 'True when the invoice states VAT is reverse-charged / shifted to the buyer (BTW verlegd, autoliquidation, intra-community supply, art. 196, "Reverse charge")' },
    matched_known_supplier: { type: ['string', 'null'], description: 'Exact name from the known-supplier list that is this seller, or null when none is' },
    suggested_domain: { type: 'string', enum: ['demo', 'sales'] },
    suggested_category: { type: ['string', 'null'], description: 'One of the categories listed for the suggested domain' },
    description: { type: ['string', 'null'], description: 'A few words on what was bought' },
  },
} as const;

function cached(fileHash: string): InvoiceExtraction | undefined {
  const row = db.prepare('SELECT result FROM invoice_extractions WHERE file_hash = ?').get(fileHash) as any;
  if (!row) return undefined;
  try { return JSON.parse(row.result); } catch { return undefined; }
}

function remember(fileHash: string, result: InvoiceExtraction) {
  db.prepare('INSERT OR REPLACE INTO invoice_extractions (file_hash, result) VALUES (?, ?)').run(fileHash, JSON.stringify(result));
}

export function cachedInvoiceExtraction(fileHash: string | null | undefined): InvoiceExtraction | null {
  return fileHash ? cached(fileHash) ?? null : null;
}

function mediaTypeOf(fileName: string, file: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | null {
  // Content first: PDFs embedded in UBL often carry a name without an extension
  const head = file.subarray(0, 12);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return null;
}

export function invoiceReaderConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Read one invoice. Returns null when AI reading is not configured, the file
 * type is not readable, or the model declines — the caller falls back to the
 * regex reader. `force` skips the cache (used by "Re-read with AI").
 */
export async function readSupplierInvoice(opts: {
  fileHash: string;
  file: Buffer;
  fileName: string;
  knownSuppliers: { name: string; vat: string | null }[];
  categories: { demo: string[]; sales: string[] };
  force?: boolean;
}): Promise<InvoiceExtraction | null> {
  if (!opts.force) {
    const hit = cached(opts.fileHash);
    if (hit) return hit;
  }
  if (!invoiceReaderConfigured()) return null;
  const mediaType = mediaTypeOf(opts.fileName, opts.file);
  if (!mediaType) return null;

  const data = opts.file.toString('base64');
  const fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

  const supplierList = opts.knownSuppliers
    .map(s => `- ${s.name}${s.vat ? ` (VAT ${s.vat})` : ''}`)
    .join('\n');

  const prompt =
`This is an invoice received by TripleW, a Belgian company (TripleW BV, BE VAT; also TripleW NL BV). TripleW is always the BUYER — never return TripleW as the supplier, and never return TripleW's VAT number as the supplier's.

Read the invoice and fill in every field.
- Copy amounts exactly as printed on the invoice's totals / VAT summary. Do not compute a figure that is printed; if one of net / VAT / total is not printed, derive it from the other two.
- net_amount excludes VAT; total_amount includes it. Give all amounts as positive numbers, also on a credit note (set is_credit_note instead).
- When no VAT is charged (reverse charge, intra-community, export, exempt), vat_amount is 0 and vat_lines may be empty.
- Numbers are often in European format: "1.234,56" means 1234.56.
- issue_date is the invoice date, not the due, delivery or order date.

Known suppliers (pick the one that is this seller for matched_known_supplier — same company even if the name is written differently or the VAT number matches; null if none is):
${supplierList || '(none)'}

Domains:
- "sales": costs of TripleW's trading business — raw materials bought for customer orders, blenders/toll processing, logistics, freight, shipping, customs, containers, surveys; often mentions an operation / order number starting with SO or a customer shipment. Categories: ${opts.categories.sales.join(', ')}.
- "demo": costs of running TripleW's demo plant and company — salaries, cars, overhead, consumables, lab materials, utilities & maintenance, feedstock for the plant, consultants, regulatory, equipment, couriers. Categories: ${opts.categories.demo.join(', ')}.
When the seller matches a known supplier, still suggest the domain and category that fit this invoice.`;

  const client = new Anthropic();
  // `fallbacks` is newer than this SDK's types, hence the cast: if the model
  // declines, the API re-runs the request on a fallback model in the same call.
  const response: any = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 3000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
  } as any);

  if (response.stop_reason === 'refusal') return null;
  const text = (response.content || []).find((b: any) => b.type === 'text')?.text;
  if (!text) return null;

  let p: any;
  try { p = JSON.parse(text); } catch { return null; }
  const domain = p.suggested_domain === 'sales' || p.suggested_domain === 'demo' ? p.suggested_domain : null;
  const issueDate = str(p.issue_date);
  const result: InvoiceExtraction = {
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
      ? p.vat_lines
          .map((l: any) => ({ rate: num(l?.rate) ?? 0, base: Math.abs(num(l?.base) ?? 0), vat: Math.abs(num(l?.vat) ?? 0) }))
      : [],
    reverse_charge: !!p.reverse_charge,
    matched_known_supplier: str(p.matched_known_supplier),
    suggested_domain: domain,
    suggested_category: str(p.suggested_category),
    description: str(p.description),
  };
  remember(opts.fileHash, result);
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
