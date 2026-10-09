/**
 * Reads the bank details off an account ownership document (bank letter,
 * account confirmation, RIB, statement header…) with Claude, for TripleW
 * Details → Account ownership documents. The user reviews the reading and
 * applies it to one of the entity's banks; nothing is written here.
 *
 * Each file is read once: results are kept in party_extractions under
 * `bank:<sha256>`, so re-opening or re-uploading the same file costs nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import db from '../database.js';
import { assertAiBudget } from './aiBudget.js';
import { MODELS, logUsage, isPdf, strictSchema, forcedToolOk, replyJson } from './supplierInvoiceReader.js';

export interface BankAccountReading { currency: string | null; iban: string | null; bic: string | null }
export interface BankDetailsReading {
  bank_name: string | null;
  bank_address: string | null;
  account_holder: string | null;
  accounts: BankAccountReading[];
}

const TOOL = {
  name: 'record_bank_details',
  description: 'Record the bank account details printed on the document.',
  input_schema: {
    type: 'object',
    required: ['bank_name', 'bank_address', 'account_holder', 'accounts'],
    properties: {
      bank_name: { type: ['string', 'null'], description: 'Name of the bank (e.g. "ING Belgium SA/NV")' },
      bank_address: { type: ['string', 'null'], description: "The bank's postal address, one line per row" },
      account_holder: { type: ['string', 'null'], description: 'Name of the account holder / owner as printed' },
      accounts: {
        type: 'array',
        description: 'Each account on the document',
        items: {
          type: 'object',
          required: ['currency', 'iban', 'bic'],
          properties: {
            currency: { type: ['string', 'null'], description: 'ISO currency of the account (EUR, USD…), null when not printed' },
            iban: { type: ['string', 'null'], description: 'IBAN or account number exactly as printed' },
            bic: { type: ['string', 'null'], description: 'BIC / SWIFT code' },
          },
        },
      },
    },
  },
} as const;

const PROMPT =
  'This is a bank document proving who owns a bank account (account confirmation, bank letter, RIB, statement…). ' +
  'The holder is expected to be a TripleW company (TripleW BV, TripleW NL BV). ' +
  'Record the bank, its address, the account holder and every account with its currency, IBAN / account number and BIC. ' +
  'Copy values exactly as printed. Use null for anything not printed; never guess.';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function imageType(file: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (file[0] === 0xff && file[1] === 0xd8) return 'image/jpeg';
  if (file[0] === 0x89 && file[1] === 0x50) return 'image/png';
  if (file.slice(0, 4).toString() === 'RIFF' && file.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export function bankReaderConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** The reading of one file; null when the file holds nothing usable. Throws when AI is unavailable. */
export async function readBankDetails(file: Buffer): Promise<BankDetailsReading | null> {
  const key = `bank:${crypto.createHash('sha256').update(file).digest('hex')}`;
  const hit = db.prepare('SELECT result FROM party_extractions WHERE source_key = ?').get(key) as any;
  if (hit) { try { return JSON.parse(hit.result); } catch { /* read again */ } }

  if (!bankReaderConfigured()) throw new Error('AI reading is not set up (no API key)');
  const data = file.toString('base64');
  const img = imageType(file);
  const block = isPdf(file)
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : img ? { type: 'image', source: { type: 'base64', media_type: img, data } } : null;
  if (!block) return null;

  assertAiBudget(0.05);
  const client = new Anthropic();
  const model = MODELS['sonnet-pdf'];
  // Newer models refuse a forced tool call — they answer in the JSON schema instead
  const message: any = await client.messages.create((forcedToolOk(model)
    ? {
        model, max_tokens: 1500,
        tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
      }
    : {
        model, max_tokens: 1500,
        output_config: { format: { type: 'json_schema', schema: strictSchema(TOOL.input_schema) } },
        messages: [{ role: 'user', content: [block, { type: 'text', text: `${PROMPT} Answer as JSON in the given schema.` }] }],
      }) as any);
  logUsage('bank-details', 'sonnet-pdf', message.usage, false);

  const input = replyJson(message);
  if (!input) return null;
  const result: BankDetailsReading = {
    bank_name: str(input.bank_name),
    bank_address: str(input.bank_address),
    account_holder: str(input.account_holder),
    accounts: (Array.isArray(input.accounts) ? input.accounts : [])
      .map((a: any) => ({ currency: str(a?.currency)?.toUpperCase() ?? null, iban: str(a?.iban), bic: str(a?.bic) }))
      .filter((a: BankAccountReading) => a.iban || a.bic),
  };
  db.prepare('INSERT OR REPLACE INTO party_extractions (source_key, result) VALUES (?, ?)').run(key, JSON.stringify(result));
  return result;
}
