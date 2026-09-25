/**
 * Reads a counterparty's details (legal name, address, VAT number, contact)
 * off a document with Claude. Used to fill in customer and supplier records
 * from the orders and invoices already on file.
 *
 * Each document is read once: results are kept in party_extractions keyed by
 * the document, so reopening the review screen costs nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import db from '../database.js';

export interface PartyDetails {
  legal_name: string | null;
  address: string | null;
  vat_number: string | null;
  email: string | null;
  phone: string | null;
  contact_person: string | null;
}

export type PartyRole = 'issuer' | 'recipient';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legal_name', 'address', 'vat_number', 'email', 'phone', 'contact_person'],
  properties: {
    legal_name: { type: ['string', 'null'], description: 'Registered company name' },
    address: { type: ['string', 'null'], description: 'Postal address, one line per row (street, postcode + city, country)' },
    vat_number: { type: ['string', 'null'], description: 'VAT / tax ID number itself, without a label such as "VAT:" (e.g. GB123456789, BE0725717772)' },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    contact_person: { type: ['string', 'null'], description: 'Named contact person, if one is printed' },
  },
} as const;

function cached(key: string): PartyDetails | null | undefined {
  const row = db.prepare('SELECT result FROM party_extractions WHERE source_key = ?').get(key) as any;
  if (!row) return undefined;
  try { return JSON.parse(row.result); } catch { return undefined; }
}

function remember(key: string, result: PartyDetails | null) {
  db.prepare('INSERT OR REPLACE INTO party_extractions (source_key, result) VALUES (?, ?)').run(key, JSON.stringify(result));
}

function mediaTypeOf(fileName: string): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return null;
}

/**
 * Details of one party on a document. `role` says which side we want: the
 * issuer (a supplier's invoice, a customer's own order) or the recipient
 * (an invoice we issued to a customer). Returns null when nothing usable is
 * found or AI reading is not configured.
 */
export async function extractParty(opts: {
  sourceKey: string;
  file: Buffer;
  fileName: string;
  role: PartyRole;
  expectedName: string;
}): Promise<PartyDetails | null> {
  const hit = cached(opts.sourceKey);
  if (hit !== undefined) return hit;

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('NO_API_KEY');
  const mediaType = mediaTypeOf(opts.fileName);
  if (!mediaType) { remember(opts.sourceKey, null); return null; }

  const data = opts.file.toString('base64');
  const fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

  const party = opts.role === 'issuer'
    ? 'the company that ISSUED this document (the seller / sender)'
    : 'the company this document is ADDRESSED TO (the buyer / bill-to party)';

  const prompt =
    `From this business document, extract the details of ${party}. ` +
    `We expect it to be "${opts.expectedName}". ` +
    `TripleW (TripleW BV, TripleW NL BV) is our own company — never return TripleW's details. ` +
    `Copy values exactly as printed. Use null for anything not printed on the document; do not guess.`;

  const client = new Anthropic();
  // `fallbacks` is newer than this SDK's types, hence the cast: if the model
  // declines, the API re-runs the request on a fallback model in the same call.
  const response: any = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
  } as any);

  if (response.stop_reason === 'refusal') { remember(opts.sourceKey, null); return null; }
  const text = (response.content || []).find((b: any) => b.type === 'text')?.text;
  if (!text) return null;

  let parsed: PartyDetails;
  try { parsed = JSON.parse(text); } catch { return null; }
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const result: PartyDetails = {
    legal_name: clean(parsed.legal_name),
    address: clean(parsed.address),
    vat_number: clean(parsed.vat_number),
    email: clean(parsed.email),
    phone: clean(parsed.phone),
    contact_person: clean(parsed.contact_person),
  };
  remember(opts.sourceKey, result);
  return result;
}
