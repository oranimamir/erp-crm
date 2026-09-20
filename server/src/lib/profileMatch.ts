/**
 * Works out which of a customer's legal entities an order belongs to.
 *
 * Customers like Distribuidora del Caribe trade as several entities with
 * different tax IDs and addresses, so drafting from the wrong one puts wrong
 * tax details in front of a client. Nothing here decides silently — the caller
 * surfaces `matchedBy` for the user to confirm, and `confident: false` means
 * "ask them outright".
 */
import db from '../database.js';
import { resolveCountry } from './portCountry.js';
import type { CustomerProfile } from './documentPrefill.js';

export interface ProfileMatch {
  profile: CustomerProfile | null;
  /** Human sentence explaining the pick, shown in the confirmation step. */
  matchedBy: string;
  /** False when nothing in the order identified the entity. */
  confident: boolean;
}

export interface MatchableOrder {
  destination?: string | null;
  inco_terms?: string | null;
  order_number?: string | null;
  notes?: string | null;
  description?: string | null;
  client_entity_name?: string | null;
  client_tax_id?: string | null;
}

const EMPTY_SECTIONS = { shared: {}, order_confirmation: {}, invoice: {}, packing_list: {}, match: {} };

function parseProfileRow(row: any): CustomerProfile {
  let data: any = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt row → empty sections */ }
  return {
    id: row.id,
    name: row.name,
    is_default: !!row.is_default,
    data: { ...EMPTY_SECTIONS, ...data, shared: data.shared || {} },
  };
}

function norm(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strips the corporate suffixes that differ between how a name is written. */
function nameKey(value: unknown): string {
  return norm(value).replace(/\b(s\s?a|sas|spa|bv|nv|ltd|limited|inc|gmbh|srl|sarl|co)\b/g, '').replace(/\s+/g, ' ').trim();
}

/** Digits only — tax IDs are written with spaces and dashes inconsistently. */
function taxKey(value: unknown): string {
  return String(value ?? '').replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

/** Whole-word containment, so "GT" doesn't match inside "GTIN". */
function hasToken(haystack: string, token: string): boolean {
  const t = norm(token);
  if (!t) return false;
  return new RegExp(`(^| )${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(norm(haystack));
}

/**
 * The country an order ships to. `operations.country` is a manual override and
 * wins when set; otherwise the destination, then the incoterm phrase (users
 * paste "CIF Puerto Quetzal GT" wholesale).
 */
export function orderCountry(order: MatchableOrder, operationCountry?: string | null): { country: string; from: string } {
  if (operationCountry?.trim()) return { country: operationCountry.trim(), from: 'the operation country' };

  const fromDestination = resolveCountry(order.destination);
  if (fromDestination) return { country: fromDestination, from: `destination ${order.destination}` };

  const fromIncoterms = resolveCountry(order.inco_terms);
  if (fromIncoterms) return { country: fromIncoterms, from: `delivery terms ${order.inco_terms}` };

  return { country: '', from: '' };
}

export function loadProfiles(customerId?: number | null): CustomerProfile[] {
  if (!customerId) return [];
  try {
    return (db.prepare(
      'SELECT * FROM customer_document_profiles WHERE customer_id = ? ORDER BY is_default DESC, id'
    ).all(customerId) as any[]).map(parseProfileRow);
  } catch {
    return [];
  }
}

/**
 * Scores every profile against the order and returns the best. An explicit
 * `profileId` (the user picking from the dropdown) short-circuits scoring.
 */
export function matchProfile(
  customerId: number | null | undefined,
  order: MatchableOrder,
  operationCountry?: string | null,
  explicitId?: number | null
): ProfileMatch {
  const profiles = loadProfiles(customerId);
  if (!profiles.length) return { profile: null, matchedBy: '', confident: false };

  if (explicitId) {
    const chosen = profiles.find(p => p.id === explicitId);
    // No reason caption — the user just picked it
    if (chosen) return { profile: chosen, matchedBy: '', confident: true };
  }

  // Nothing to disambiguate
  if (profiles.length === 1) {
    return { profile: profiles[0], matchedBy: '', confident: true };
  }

  const { country, from } = orderCountry(order, operationCountry);
  const haystack = [order.destination, order.inco_terms, order.order_number, order.notes, order.description]
    .filter(Boolean).join(' ');

  let best: { profile: CustomerProfile; score: number; reason: string } | null = null;

  for (const profile of profiles) {
    const shared = profile.data.shared || {};
    const match = (profile.data as any).match || {};
    let score = 0;
    let reason = '';

    const bump = (points: number, why: string) => {
      if (points > score) { score = points; reason = why; }
    };

    // The order document named the entity outright — strongest possible signal
    if (order.client_entity_name && shared.legal_name) {
      const a = nameKey(order.client_entity_name);
      const b = nameKey(shared.legal_name);
      if (a && b && (a === b || a.includes(b) || b.includes(a))) {
        bump(100, `the order names ${order.client_entity_name}`);
      }
    }
    if (order.client_tax_id && shared.tax_id && taxKey(order.client_tax_id) === taxKey(shared.tax_id)) {
      bump(100, `the order carries tax ID ${order.client_tax_id}`);
    }

    // Declared country for this entity vs where the order ships
    if (country && match.country && norm(match.country) === norm(country)) {
      bump(60, `${from} → ${country}`);
    }

    // Free-text hints the user added to the profile
    for (const keyword of String(match.keywords || '').split(',').map(k => k.trim()).filter(Boolean)) {
      if (norm(haystack).includes(norm(keyword))) bump(40, `the order mentions ${keyword}`);
    }

    // Client code / SQ suffix appearing in the order's own references
    if (shared.client_code && hasToken(haystack, shared.client_code)) {
      bump(30, `the order references ${shared.client_code}`);
    }
    const sqSuffix = (profile.data.order_confirmation || {}).sq_suffix;
    if (sqSuffix && hasToken(haystack, sqSuffix)) {
      bump(30, `the order references ${sqSuffix}`);
    }

    // Last resort: the entity's own address sits in the destination country
    if (country && shared.billing_address && norm(shared.billing_address).includes(norm(country))) {
      bump(20, `${from} → ${country}, where this entity is based`);
    }

    if (score > 0 && (!best || score > best.score)) best = { profile, score, reason };
  }

  if (best) return { profile: best.profile, matchedBy: best.reason, confident: true };

  // Nothing identified it — the caller must ask
  const fallback = profiles.find(p => p.is_default) || profiles[0];
  return { profile: fallback, matchedBy: '', confident: false };
}
