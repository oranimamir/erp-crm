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

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * How an operation's stored estimated_payment_date got there. A date the user
 * typed is never recomputed behind their back; an auto date is refreshed
 * whenever its inputs change (a new invoice date, a BL date arriving).
 */
export type EstimateSource = 'auto' | 'manual';

interface OperationDateRow {
  id: number;
  bl_date: string | null;
  estimated_payment_date: string | null;
  estimated_payment_date_source: EstimateSource | null;
  payment_terms: string | null;
  invoice_date: string | null;
}

/**
 * Recomputes and stores the auto estimate for one operation.
 *
 * Called whenever something the estimate depends on changes: an invoice is
 * created, edited or deleted, or a BL date is recorded. A `manual` date is left
 * exactly as the user set it — this returns without writing.
 *
 * The invoice date used is the earliest invoice on the operation: payment terms
 * run from when the customer was first billed, and a later corrective invoice
 * does not restart the clock.
 */
export function refreshEstimatedPaymentDate(db: any, operationId: number | null | undefined): void {
  if (!operationId) return;

  const row = db.prepare(`
    SELECT op.id, op.bl_date, op.estimated_payment_date, op.estimated_payment_date_source,
      o.payment_terms as payment_terms,
      (SELECT MIN(i.invoice_date) FROM invoices i
        WHERE i.operation_id = op.id AND i.type = 'customer'
          AND i.status NOT IN ('cancelled', 'draft')
          AND i.invoice_date IS NOT NULL) as invoice_date
    FROM operations op
    LEFT JOIN orders o ON o.id = op.order_id
    WHERE op.id = ?
  `).get(operationId) as OperationDateRow | undefined;

  if (!row) return;
  // A date the user set by hand outranks anything derived from the terms.
  if (row.estimated_payment_date_source === 'manual') return;

  const next = computeEstimatedPaymentDate({
    payment_terms: row.payment_terms,
    invoice_date: row.invoice_date,
    bl_date: row.bl_date,
  });

  const nextDate = next?.date ?? null;
  if (nextDate === row.estimated_payment_date) return;

  db.prepare(`
    UPDATE operations
    SET estimated_payment_date = ?, estimated_payment_date_source = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nextDate, nextDate ? 'auto' : null, row.id);
}

/**
 * One-time catch-up for operations that predate automatic estimates.
 *
 * Only fills operations with no stored date at all, so a manual entry is never
 * touched. Runs at startup and is cheap once there is nothing left to fill.
 * Returns how many rows were given a date, for the startup log.
 */
export function backfillEstimatedPaymentDates(db: any): number {
  const pending = db.prepare(`
    SELECT op.id FROM operations op
    WHERE op.estimated_payment_date IS NULL
      AND EXISTS (SELECT 1 FROM invoices i WHERE i.operation_id = op.id AND i.type = 'customer')
  `).all() as { id: number }[];

  let filled = 0;
  for (const { id } of pending) {
    refreshEstimatedPaymentDate(db, id);
    const row = db.prepare('SELECT estimated_payment_date FROM operations WHERE id = ?').get(id) as any;
    if (row?.estimated_payment_date) filled++;
  }
  return filled;
}
