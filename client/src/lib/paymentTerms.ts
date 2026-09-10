// Payment-terms parsing for display.
//
// Kept byte-for-byte in step with server/src/lib/paymentTerms.ts, which owns the
// stored estimated_payment_date. The two must agree: this file decides what the
// operations table and the BL dialog show, the server decides what the dashboard
// forecasts read, and a discrepancy between them is a bug the user sees as the
// screen disagreeing with itself.

/**
 * Estimated payment date for an operation.
 *
 * The date a customer is expected to pay is derived from the order's payment
 * terms, counted from whichever document the terms reference:
 *
 *   "NET 60 DAYS FROM B/L"   → bl_date + 60
 *   "Net 45 Days"            → invoice_date + 45
 *   "45 JOURS FIN DE MOIS"   → invoice_date + 45, then out to that month's end
 *
 * Terms that name the Bill of Lading cannot be resolved until the BL date is
 * known, so they return null rather than silently falling back to the invoice
 * date — a 60-day term measured from the wrong document is off by weeks, and a
 * blank cell is a question the user can answer while a wrong date is not.
 *
 * Terms are free text typed by whoever entered the order, so the parser is
 * built around the forms that actually appear on these orders rather than a
 * single tidy format.
 */

export type EstimateBasis = 'bl' | 'invoice';

export interface EstimateInput {
  payment_terms?: string | null;
  invoice_date?: string | null;
  bl_date?: string | null;
}

export interface EstimateResult {
  date: string;
  basis: EstimateBasis;
  days: number;
  endOfMonth: boolean;
}

/** True when the terms are counted from the Bill of Lading rather than the invoice. */
export function paymentTermsMentionsBL(terms?: string | null): boolean {
  if (!terms) return false;
  return /\b(bl|b\/l|bill of lading)\b/i.test(terms);
}

/**
 * True for "end of month" terms — the count lands the payment in a month, and
 * the payment is then made at that month's end. Common on French and Belgian
 * orders ("45 JOURS FIN DE MOIS").
 */
export function paymentTermsEndOfMonth(terms?: string | null): boolean {
  if (!terms) return false;
  return /\b(fin de mois|end of month|eom)\b/i.test(terms);
}

// A day count is a number attached to a day word, in any of the languages these
// orders arrive in. Anchoring to the word is what keeps "100% payable at 60
// days" from reading as 100 — the percentage is not the term.
const DAY_COUNT = /(\d+)\s*(?:days?|jours?|giorni|d[ií]as|dagen|tage)\b/i;

/** Day count in a payment-terms string ("NET 60 DAYS FROM B/L" → 60). */
export function paymentTermsDays(terms?: string | null): number | null {
  if (!terms) return null;
  const text = String(terms);

  const withWord = text.match(DAY_COUNT);
  if (withWord) return toDayCount(withWord[1]);

  // No day word: take the first bare number, ignoring percentages and any
  // number that is part of a longer token (a reference, a date).
  const bare = text.replace(/\d+(?:[.,]\d+)?\s*%/g, ' ').match(/(?:^|\s)(\d{1,3})(?:\s|$)/);
  return bare ? toDayCount(bare[1]) : null;
}

function toDayCount(raw: string): number | null {
  const n = parseInt(raw, 10);
  // Above a year the number is not a payment term — almost certainly a year or
  // a reference number that slipped through.
  return Number.isFinite(n) && n >= 0 && n <= 365 ? n : null;
}

/** ISO date `days` after `dateStr`. Noon avoids DST shifting the result a day. */
export function addDays(dateStr: string, days: number): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** Last day of the month `dateStr` falls in. */
export function endOfMonth(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  // Day 0 of the next month is the last day of this one.
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  return last.toISOString().split('T')[0];
}

/**
 * Computes the estimated payment date, or null when the inputs cannot support
 * one (no day count in the terms, or BL-based terms with no BL date yet).
 */
export function computeEstimatedPaymentDate(input: EstimateInput): EstimateResult | null {
  const days = paymentTermsDays(input.payment_terms);
  if (days == null) return null;

  const fromBL = paymentTermsMentionsBL(input.payment_terms);
  const anchor = fromBL ? input.bl_date : input.invoice_date;
  if (!anchor) return null;

  const counted = addDays(anchor, days);
  if (!counted) return null;

  const eom = paymentTermsEndOfMonth(input.payment_terms);
  const date = eom ? endOfMonth(counted) : counted;
  if (!date) return null;

  return { date, basis: fromBL ? 'bl' : 'invoice', days, endOfMonth: eom };
}
