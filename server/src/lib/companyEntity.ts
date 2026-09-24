/**
 * Which TripleW legal entity issues a document.
 *
 * Operation numbers carry the entity in their prefix — `SOBE20260113` is
 * Belgian, `SONL20260101` Dutch — and each entity prints its own address,
 * VAT/KVK numbers and bank block. The entities live in `company_entities`,
 * edited on the TripleW Details page; each has a USD and a EUR account, and a
 * document prints the one matching its currency.
 */
import db from '../database.js';
import { docCurrency, type DocumentData } from './document-pdf.js';

export type EntityCode = string;

export interface EntityRow {
  code: string;
  company_name: string;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  tel: string | null;
  email: string | null;
  vat: string | null;
  kvk: string | null;
  contact_person: string | null;
  bank_name: string | null;
  bank_address: string | null;
  usd_account: string | null;
  usd_bic: string | null;
  eur_account: string | null;
  eur_bic: string | null;
  delivery_address: string | null;
  is_default: number;
}

/** The flat shape the document builder prints from. */
export interface EntityProfile {
  company_name: string;
  company_address1: string;
  company_address2: string;
  company_address3: string;
  company_tel: string;
  company_email: string;
  company_vat: string;
  company_kvk: string;
  company_contact: string;
  bank_name: string;
  iban: string;
  bic: string;
  bank_address: string;
  delivery_address: string;
  delivery_contact: string;
}

export const ENTITY_CODE_PATTERN = /^[A-Z]{2,4}$/;

export function listEntities(): EntityRow[] {
  try {
    return db.prepare('SELECT * FROM company_entities ORDER BY is_default DESC, code').all() as EntityRow[];
  } catch {
    return [];
  }
}

function entityRow(code: string): EntityRow | null {
  try {
    return (db.prepare('SELECT * FROM company_entities WHERE code = ?').get(code) as EntityRow) ?? null;
  } catch {
    return null;
  }
}

function defaultEntityCode(): EntityCode {
  return listEntities()[0]?.code || 'BE';
}

export function isEntityCode(value: unknown): value is EntityCode {
  return typeof value === 'string' && !!value && !!entityRow(value);
}

/**
 * Derives the issuing entity from an operation number. The code normally
 * follows a two-letter document prefix (SOBE…, CINL…); failing that, any
 * code the number contains, longest first; failing that, the default entity.
 */
export function entityFromOperationNumber(operationNumber?: string | null): EntityCode {
  const value = String(operationNumber || '').toUpperCase();
  const codes = listEntities().map(e => e.code).sort((a, b) => b.length - a.length);
  const prefixed = codes.find(code => value.slice(2).startsWith(code));
  if (prefixed) return prefixed;
  const contained = codes.find(code => value.includes(code));
  return contained || defaultEntityCode();
}

/** The account a document in `currency` is paid into; USD → USD, anything else → EUR. */
function accountFor(row: EntityRow, currency?: string | null): { iban: string; bic: string } {
  const usd = { iban: row.usd_account || '', bic: row.usd_bic || '' };
  const eur = { iban: row.eur_account || '', bic: row.eur_bic || '' };
  const [preferred, fallback] = String(currency || '').toUpperCase() === 'USD' ? [usd, eur] : [eur, usd];
  // Never print a document without payment details when only one account is set
  return preferred.iban ? preferred : fallback;
}

/** Entity details for a document, with the bank account for its currency. */
export function entityProfile(code: EntityCode, currency?: string | null): EntityProfile {
  const row = entityRow(code) || entityRow(defaultEntityCode());
  if (!row) {
    return {
      company_name: 'TripleW BV', company_address1: '', company_address2: '', company_address3: '',
      company_tel: '', company_email: '', company_vat: '', company_kvk: '', company_contact: '',
      bank_name: '', iban: '', bic: '', bank_address: '', delivery_address: '', delivery_contact: '',
    };
  }
  const account = accountFor(row, currency);
  return {
    company_name: row.company_name || '',
    company_address1: row.address1 || '',
    company_address2: row.address2 || '',
    company_address3: row.address3 || '',
    company_tel: row.tel || '',
    company_email: row.email || '',
    company_vat: row.vat || '',
    company_kvk: row.kvk || '',
    company_contact: row.contact_person || '',
    bank_name: row.bank_name || '',
    iban: account.iban,
    bic: account.bic,
    bank_address: row.bank_address || '',
    delivery_address: row.delivery_address || '',
    delivery_contact: '',
  };
}

/**
 * Re-applies the issuing entity's bank for the document's current currency,
 * so changing a line's currency in the form also changes the printed account.
 * Leaves alone documents without an entity (saved before entities were
 * editable) and invoices carrying a bank from the customer's profile.
 */
export function applyEntityBank<T extends DocumentData>(data: T): T {
  if (!data?.entity_code || data.bank_override) return data;
  const row = entityRow(data.entity_code);
  if (!row) return data;
  const account = accountFor(row, docCurrency(Array.isArray(data.items) ? data.items : []));
  return {
    ...data,
    bank_name: row.bank_name || '',
    bank_address: row.bank_address || '',
    iban: account.iban,
    bic: account.bic,
  };
}
