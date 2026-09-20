/**
 * Which TripleW legal entity issues a document.
 *
 * Operation numbers carry the entity in their prefix — `SOBE20260113` is
 * Belgian, `SONL20260101` Dutch — and the two entities print different
 * addresses, VAT/KVK numbers and bank blocks.
 */
import db from '../database.js';

export type EntityCode = 'NL' | 'BE';

export interface EntityProfile {
  company_name: string;
  company_address1: string;
  company_address2: string;
  company_address3: string;
  company_tel: string;
  company_email: string;
  company_vat: string;
  company_kvk: string;
  bank_name: string;
  iban: string;
  bic: string;
  bank_address: string;
  delivery_address: string;
  delivery_contact: string;
}

/** Fallbacks used only if the app_settings rows are missing. */
const BUILT_IN: Record<EntityCode, EntityProfile> = {
  BE: {
    company_name: 'TripleW BV',
    company_address1: 'Innovatiestraat 1',
    company_address2: '2030 Antwerpen, Belgium',
    company_address3: '',
    company_tel: '+1 414 467 7341',
    company_email: 'denis@triplew.co',
    company_vat: 'BE0725717772',
    company_kvk: '',
    bank_name: 'ING Belgium NV/SA',
    iban: 'BE53 3631 9783 2853',
    bic: 'BBRUBEBB',
    bank_address: 'Marnixlaan 25, 1000 Brussels, Belgium',
    delivery_address: 'TRIPLEW, Innovatiestraat 1, 2030 Antwerp, Belgium',
    delivery_contact: '',
  },
  NL: {
    company_name: 'TripleW NL BV',
    company_address1: 'Kalmoesberg 3',
    company_address2: '4708KN Roosendaal',
    company_address3: 'Netherlands',
    company_tel: '+1 414 467 7341',
    company_email: 'denis@triplew.co',
    company_vat: '866836974B01',
    company_kvk: '94614342',
    // The Dutch masters carry no bank block
    bank_name: '',
    iban: '',
    bic: '',
    bank_address: '',
    delivery_address: '',
    delivery_contact: '',
  },
};

export const ENTITY_CODES: EntityCode[] = ['NL', 'BE'];

export function isEntityCode(value: unknown): value is EntityCode {
  return value === 'NL' || value === 'BE';
}

/**
 * Derives the issuing entity from an operation number. NL is checked first so
 * that a number containing both tokens resolves deterministically; anything
 * unrecognised falls back to BE, the main trading entity.
 */
export function entityFromOperationNumber(operationNumber?: string | null): EntityCode {
  const value = String(operationNumber || '').toUpperCase();
  if (value.includes('NL')) return 'NL';
  if (value.includes('BE')) return 'BE';
  return 'BE';
}

/** Entity constants, from app_settings where present. */
export function entityProfile(code: EntityCode): EntityProfile {
  const fallback = BUILT_IN[code] ?? BUILT_IN.BE;
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`company_entity_${code}`) as any;
    if (row?.value) return { ...fallback, ...JSON.parse(row.value) };
  } catch { /* fall through to the built-in profile */ }
  return fallback;
}

export { BUILT_IN as BUILT_IN_ENTITIES };
