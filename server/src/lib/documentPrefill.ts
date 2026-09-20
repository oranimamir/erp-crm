/**
 * Shared draft-building pieces for the Order Confirmation and Commercial
 * Invoice generators: the customer's saved defaults, and the per-product
 * details carried forward from whatever was last issued.
 */
import db from '../database.js';
import type { DocLine } from './document-pdf.js';

export interface ProfileSections {
  shared: Record<string, string>;
  order_confirmation: Record<string, string>;
  invoice: Record<string, string>;
  packing_list: Record<string, string>;
}

export interface CustomerProfile {
  id: number;
  name: string;
  is_default: boolean;
  data: ProfileSections;
}

const EMPTY: ProfileSections = {
  shared: {}, order_confirmation: {}, invoice: {}, packing_list: {},
};

/**
 * The profile to draft from: the one asked for, else the customer's default,
 * else their first. Returns null when the customer has no profiles yet.
 */
export function resolveProfile(customerId?: number | null, profileId?: number | null): CustomerProfile | null {
  if (!customerId) return null;
  try {
    const row = (profileId
      ? db.prepare('SELECT * FROM customer_document_profiles WHERE id = ? AND customer_id = ?').get(profileId, customerId)
      : db.prepare('SELECT * FROM customer_document_profiles WHERE customer_id = ? ORDER BY is_default DESC, id LIMIT 1').get(customerId)
    ) as any;
    if (!row) return null;

    let data: any = {};
    try { data = JSON.parse(row.data); } catch { /* corrupt row → empty sections */ }
    return {
      id: row.id,
      name: row.name,
      is_default: !!row.is_default,
      data: { ...EMPTY, ...data, shared: data.shared || {} },
    };
  } catch {
    return null;
  }
}

export function listProfiles(customerId?: number | null): Array<{ id: number; name: string; is_default: boolean }> {
  if (!customerId) return [];
  try {
    return (db.prepare(
      'SELECT id, name, is_default FROM customer_document_profiles WHERE customer_id = ? ORDER BY is_default DESC, id'
    ).all(customerId) as any[]).map(r => ({ id: r.id, name: r.name, is_default: !!r.is_default }));
  } catch {
    return [];
  }
}

export interface ProductDefaults {
  reference?: string;
  hs_code?: string;
  description?: string;
  manufacturer?: string;
  country_of_origin?: string;
}

/**
 * Details last used for each product, keyed by lower-cased commercial name.
 * Scans both document types so an invoice can reuse what a confirmation
 * established, and vice versa. Newest wins.
 */
export function carryForwardByProduct(): Record<string, ProductDefaults> {
  const known: Record<string, ProductDefaults> = {};

  const scan = (table: string) => {
    let rows: Array<{ data: string }> = [];
    try {
      rows = db.prepare(`SELECT data FROM ${table} ORDER BY id DESC LIMIT 50`).all() as any[];
    } catch { return; }

    for (const row of rows) {
      let parsed: any;
      try { parsed = JSON.parse(row.data); } catch { continue; }
      for (const line of parsed.items || []) {
        const key = String(line.commercial_name || '').trim().toLowerCase();
        if (!key) continue;
        const entry = known[key] || (known[key] = {});
        if (!entry.reference && line.reference) entry.reference = line.reference;
        if (!entry.hs_code && line.hs_code) entry.hs_code = line.hs_code;
        if (!entry.description && line.description) entry.description = line.description;
        if (!entry.manufacturer && parsed.manufacturer) entry.manufacturer = parsed.manufacturer;
        if (!entry.country_of_origin && parsed.country_of_origin) entry.country_of_origin = parsed.country_of_origin;
      }
    }
  };

  scan('order_confirmations');
  scan('invoice_documents');
  return known;
}

/** Catalogue SKUs, keyed by lower-cased product name — the document "Reference". */
export function skuByProductName(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    for (const row of db.prepare('SELECT name, sku FROM products').all() as any[]) {
      const key = String(row.name || '').trim().toLowerCase();
      if (key && row.sku) map[key] = row.sku;
    }
  } catch { /* products table unavailable */ }
  return map;
}

/** Order items → document lines, enriched from past documents and the catalogue. */
export function prefillLines(orderItems: any[]): DocLine[] {
  const known = carryForwardByProduct();
  const skus = skuByProductName();

  return orderItems.map((item, index) => {
    const key = String(item.description || '').trim().toLowerCase();
    const prior = known[key] || {};
    return {
      line: index + 1,
      reference: prior.reference || skus[key] || '',
      commercial_name: item.description || '',
      packaging: item.packaging || '',
      quantity: Number(item.quantity) || 0,
      quantity_unit: (item.unit || 'KG').toUpperCase(),
      unit_price: Number(item.unit_price) || 0,
      currency: (item.currency || 'EUR').toUpperCase(),
      hs_code: prior.hs_code || '',
      description: prior.description || '',
      lot: '',
    };
  });
}

/** Manufacturer/origin last recorded for any of these products, if any. */
export function originForItems(orderItems: any[]): { manufacturer: string; country_of_origin: string } {
  const known = carryForwardByProduct();
  for (const item of orderItems) {
    const prior = known[String(item.description || '').trim().toLowerCase()];
    if (prior?.manufacturer || prior?.country_of_origin) {
      return { manufacturer: prior.manufacturer || '', country_of_origin: prior.country_of_origin || '' };
    }
  }
  return { manufacturer: '', country_of_origin: '' };
}
