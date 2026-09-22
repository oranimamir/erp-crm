/**
 * Shared draft-building pieces for the Order Confirmation and Commercial
 * Invoice generators: the customer's saved defaults, and the per-product
 * details carried forward from whatever was last issued.
 */
import db from '../database.js';
import type { DocLine, DocumentData } from './document-pdf.js';
import { DEFAULT_LAYOUT, normalizeLayout, type InvoiceLayout } from './invoiceLayout.js';
import { layoutSeedFor } from './invoiceLayoutSeeds.js';

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

/**
 * "CIF Piraeus Greece" — the incoterm with the destination appended, unless the
 * user already wrote the destination into the incoterm field, which would
 * otherwise print the country twice.
 */
export function deliveryTerms(order: { inco_terms?: string | null; destination?: string | null }): string {
  const inco = String(order.inco_terms || '').trim();
  const dest = String(order.destination || '').trim();
  if (!dest) return inco;
  if (!inco) return dest;
  return inco.toLowerCase().includes(dest.toLowerCase()) ? inco : `${inco} ${dest}`;
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
      note: '',
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

// ── Per-customer invoice shape and carried-forward wording ────────────────

/**
 * The most recent Commercial Invoice generated for this customer, whichever
 * order it belonged to. This is what "base it on the previous invoice" means:
 * the last document they received is the template for the next one.
 */
export function lastInvoiceForCustomer(customerId?: number | null): DocumentData | null {
  if (!customerId) return null;
  try {
    const row = db.prepare(`
      SELECT d.data FROM invoice_documents d
      JOIN orders o ON d.order_id = o.id
      WHERE o.customer_id = ?
      ORDER BY d.id DESC LIMIT 1
    `).get(customerId) as any;
    if (!row?.data) return null;
    return JSON.parse(row.data) as DocumentData;
  } catch {
    return null;
  }
}

export interface ResolvedLayout {
  layout: InvoiceLayout;
  /** Where it came from, shown in the generator so the choice is never silent. */
  source: string;
}

/**
 * The invoice layout to draft with, in order of authority: what the user saved
 * on this customer's profile, then the layout of the last invoice they were
 * actually sent, then the shape read off the invoices supplied as masters,
 * then the house default.
 */
export function resolveInvoiceLayout(
  customerId: number | null | undefined,
  profile: CustomerProfile | null,
  customerName?: string | null
): ResolvedLayout {
  const saved = (profile?.data as any)?.invoice_layout;
  if (saved && typeof saved === 'object') {
    return { layout: normalizeLayout(saved), source: `saved on ${profile!.name}` };
  }

  const previous = lastInvoiceForCustomer(customerId);
  if (previous?.layout) {
    return {
      layout: normalizeLayout(previous.layout),
      source: `the last invoice sent to this customer${previous.doc_number ? ` (${previous.doc_number})` : ''}`,
    };
  }

  const seed = layoutSeedFor(customerName || '', profile?.name);
  if (seed) {
    return { layout: normalizeLayout(seed.layout), source: seed.source };
  }

  return { layout: DEFAULT_LAYOUT, source: 'the standard company template' };
}

/** Wording the last invoice used, so a new one starts where the old one left off. */
export function carryForwardInvoiceText(customerId?: number | null): Partial<DocumentData> {
  const previous = lastInvoiceForCustomer(customerId);
  if (!previous) return {};
  const keep: Array<keyof DocumentData> = [
    'payment_terms', 'incoterm', 'remarks', 'product_reference',
    'delivery', 'delivery_address', 'delivery_contact', 'terms',
  ];
  const out: Partial<DocumentData> = {};
  for (const key of keep) {
    const value = previous[key];
    if (typeof value === 'string' && value.trim()) (out as any)[key] = value;
  }
  return out;
}
