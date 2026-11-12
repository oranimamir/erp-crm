/**
 * Reads an uploaded customer invoice (one TripleW issued) with Claude. The
 * PDF / image itself is sent, not its text layer: on older invoices the
 * totals box (Subtotal / Freight / Insurance / Total) is a picture pasted
 * beside the table, so the text holds only the line amounts and the invoice
 * was recorded at its subtotal. Each file is read once — readings are kept in
 * party_extractions under "ci:<sha256>". Used by the invoice form's scan and
 * by Customer Invoices → Check amounts.
 */
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import db from '../database.js';
import { assertAiBudget } from './aiBudget.js';
import { MODELS, forcedToolOk, strictSchema, replyJson, logUsage, isPdf } from './supplierInvoiceReader.js';

export interface CustomerInvoiceReading {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  customer_name: string | null;
  po_number: string | null;
  notes: string | null;
  /** Sum of the product lines */
  subtotal: number | null;
  freight: number | null;
  insurance: number | null;
  vat: number | null;
  /** Any other charge (+) or discount (−) between the subtotal and the total */
  other_charges: number | null;
  /** The grand total as printed, null when the document prints none */
  printed_total: number | null;
  /** The amount due: the printed total, else the sum of the parts */
  total: number | null;
  /** How far the parts are from the printed total (0 = they add up), null when it can't be checked */
  parts_gap: number | null;
}

const SCHEMA = {
  type: 'object',
  required: ['invoice_number', 'invoice_date', 'due_date', 'currency', 'customer_name', 'po_number', 'notes',
    'subtotal', 'freight', 'insurance', 'vat', 'other_charges', 'printed_total'],
  properties: {
    invoice_number: { type: ['string', 'null'] },
    invoice_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, the date the invoice was issued' },
    due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, only when a due date is printed' },
    currency: { type: ['string', 'null'], description: '3-letter ISO code printed with the amounts' },
    customer_name: { type: ['string', 'null'], description: 'The company the invoice is addressed to' },
    po_number: { type: ['string', 'null'], description: "The customer's PO / order number" },
    notes: { type: ['string', 'null'], description: 'The products invoiced, in at most 200 characters' },
    subtotal: { type: ['number', 'null'], description: 'Sum of the product line amounts, before freight / insurance / tax' },
    freight: { type: ['number', 'null'], description: 'Freight / transport charge, null when none is printed' },
    insurance: { type: ['number', 'null'], description: 'Insurance charge, null when none is printed' },
    vat: { type: ['number', 'null'], description: 'VAT / tax amount, null when none is printed' },
    other_charges: { type: ['number', 'null'], description: 'Any other charge (positive) or discount (negative) added to the subtotal, null when none' },
    printed_total: { type: ['number', 'null'], description: 'The grand total / total due exactly as printed, null when the document prints no total' },
  },
};

const TOOL = { name: 'record_invoice', description: 'Record the figures read from the invoice', input_schema: SCHEMA };

const INSTRUCTIONS = `You read sales invoices issued by TripleW (TripleW BV / TripleW NL BV) to its customers. Record the invoice with the record_invoice tool.

Look at the whole page, not only the line table:
- The totals (Subtotal, Freight, Insurance, VAT, Total / Total Order / Total due) can sit anywhere — in a small box beside or below the table, at the bottom of the page, or as a picture pasted over the page. Find them wherever they are.
- printed_total is the final amount the customer must pay: it includes freight, insurance and tax. Never give the line amount or the subtotal as the total when a larger total is printed.
- Copy every amount exactly as printed. A charge that is not printed is null, not 0.
- European number format is common: "1.234,56" = 1234.56; "22,600" in a USD invoice is twenty-two thousand six hundred.
- currency: the one printed with the amounts.`;

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const date = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);

/** The amount due and whether the parts agree with the printed total. */
export function settleTotal(r: Pick<CustomerInvoiceReading, 'subtotal' | 'freight' | 'insurance' | 'vat' | 'other_charges' | 'printed_total'>): { total: number | null; parts_gap: number | null } {
  const parts = r.subtotal != null
    ? Math.round((r.subtotal + (r.freight || 0) + (r.insurance || 0) + (r.vat || 0) + (r.other_charges || 0)) * 100) / 100
    : null;
  if (r.printed_total != null) {
    return { total: r.printed_total, parts_gap: parts != null ? Math.round((r.printed_total - parts) * 100) / 100 : null };
  }
  return { total: parts, parts_gap: null };
}

function parse(message: any): CustomerInvoiceReading | null {
  if (message?.stop_reason === 'refusal') return null;
  const x = replyJson(message);
  if (!x || typeof x !== 'object') return null;
  const base = {
    invoice_number: str(x.invoice_number), invoice_date: date(x.invoice_date), due_date: date(x.due_date),
    currency: str(x.currency)?.toUpperCase().slice(0, 3) ?? null,
    customer_name: str(x.customer_name), po_number: str(x.po_number), notes: str(x.notes)?.slice(0, 200) ?? null,
    subtotal: num(x.subtotal), freight: num(x.freight), insurance: num(x.insurance), vat: num(x.vat),
    other_charges: num(x.other_charges), printed_total: num(x.printed_total),
  };
  return { ...base, ...settleTotal(base) };
}

function imageType(file: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const head = file.subarray(0, 12);
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export const fileSha256 = (file: Buffer): string => crypto.createHash('sha256').update(file).digest('hex');

export function cachedCustomerInvoiceReading(hash: string): CustomerInvoiceReading | null {
  try {
    const row = db.prepare('SELECT result FROM party_extractions WHERE source_key = ?').get(`ci:${hash}`) as any;
    return row ? JSON.parse(row.result) : null;
  } catch {
    return null;
  }
}

/**
 * Reads one customer invoice file (PDF or image) — the saved reading when the
 * same file was read before. Returns null when the file can't be sent or the
 * answer can't be used; throws on API / budget errors.
 */
export async function readCustomerInvoice(file: Buffer, opts: { force?: boolean } = {}): Promise<CustomerInvoiceReading | null> {
  const hash = fileSha256(file);
  if (!opts.force) {
    const hit = cachedCustomerInvoiceReading(hash);
    if (hit) return hit;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('NO_API_KEY');

  const data = file.toString('base64');
  const img = imageType(file);
  let content: any[];
  if (isPdf(file)) content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }];
  else if (img) content = [{ type: 'image', source: { type: 'base64', media_type: img, data } }];
  else return null;
  content.push({ type: 'text', text: 'Record this invoice.' });

  // The model that reads supplier invoice PDFs (chosen by the Oct 2026 test)
  const model = MODELS['sonnet-pdf'];
  const params: any = forcedToolOk(model)
    ? { model, max_tokens: 1500, system: INSTRUCTIONS, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name }, messages: [{ role: 'user', content }] }
    : {
        model, max_tokens: 1500,
        system: INSTRUCTIONS.replace('with the record_invoice tool', 'as JSON in the given schema'),
        output_config: { format: { type: 'json_schema', schema: strictSchema(SCHEMA) } },
        messages: [{ role: 'user', content }],
      };

  assertAiBudget(0.05);
  const res: any = await new Anthropic().messages.create(params);
  logUsage('customer invoice read', 'sonnet-pdf', res.usage, false);
  const result = parse(res);
  if (result) {
    db.prepare('INSERT OR REPLACE INTO party_extractions (source_key, result) VALUES (?, ?)').run(`ci:${hash}`, JSON.stringify(result));
  }
  return result;
}
