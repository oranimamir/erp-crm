/**
 * Estimated payment date for an operation.
 *
 * The date a customer is expected to pay is derived from the payment terms
 * printed on the invoice (its "Payment terms" line, else its Terms &
 * Conditions; an uploaded invoice with no terms stored falls back to the
 * order's terms), counted from whichever document the terms reference:
 *
 *   "NET 60 DAYS FROM B/L"   → bl_date + 60
 *   "Net 45 Days"            → invoice_date + 45
 *   "45 JOURS FIN DE MOIS"   → invoice_date + 45, then out to that month's end
 *
 * Terms that name the Bill of Lading count from the BL date, else the shipment
 * date the user confirmed; with neither they return null rather than silently
 * falling back to the invoice date — a 60-day term measured from the wrong document is off by weeks, and a
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

/** ISO date `days` after `dateStr`. Counted in UTC so neither DST nor the server's time zone shifts it a day. */
export function addDays(dateStr: string, days: number): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** Last day of the month `dateStr` falls in. */
export function endOfMonth(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
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

// ── The invoice's terms ──────────────────────────────────────────────────────

export interface InvoiceTerms { terms: string; source: 'invoice' | 'order' }

/**
 * The payment terms an invoice states: a generated invoice's "Payment terms"
 * line, else its Terms & Conditions (whichever names a day count first). An
 * uploaded invoice has none stored, so the order's terms stand in. Null when
 * nothing names a day count.
 */
export function termsForInvoice(db: any, invoiceId: number, orderTerms?: string | null): InvoiceTerms | null {
  const docs = db.prepare(`
    SELECT data FROM invoice_documents WHERE invoice_id = ?
    ORDER BY CASE WHEN status = 'final' THEN 0 ELSE 1 END, updated_at DESC, id DESC
  `).all(invoiceId) as any[];
  for (const doc of docs) {
    let data: any;
    try { data = JSON.parse(doc.data); } catch { continue; }
    for (const text of [data?.payment_terms, data?.terms]) {
      if (text && paymentTermsDays(text) != null) return { terms: String(text).trim(), source: 'invoice' };
    }
  }
  if (orderTerms && paymentTermsDays(orderTerms) != null) return { terms: orderTerms.trim(), source: 'order' };
  return null;
}

/** An invoice's due date from its own terms (BL terms: the BL date, else the shipment date). */
export function dueDateForInvoice(db: any, invoice: { id: number; invoice_date: string | null }, op: { bl_date?: string | null; ship_date?: string | null; order_terms?: string | null }):
  { terms: InvoiceTerms | null; estimate: EstimateResult | null } {
  const terms = termsForInvoice(db, invoice.id, op.order_terms);
  const estimate = terms ? computeEstimatedPaymentDate({
    payment_terms: terms.terms,
    invoice_date: invoice.invoice_date,
    bl_date: op.bl_date || op.ship_date || null,
  }) : null;
  return { terms, estimate };
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
  ship_date: string | null;
  estimated_payment_date: string | null;
  estimated_payment_date_source: EstimateSource | null;
  payment_terms: string | null;
}

/**
 * Recomputes and stores the auto estimate for one operation.
 *
 * Called whenever something the estimate depends on changes: an invoice is
 * created, edited or deleted, or a BL date is recorded. A `manual` date is left
 * exactly as the user set it — this returns without writing.
 *
 * The invoice used is the earliest on the operation (its date and its terms):
 * payment terms run from when the customer was first billed, and a later
 * corrective invoice does not restart the clock.
 */
export function refreshEstimatedPaymentDate(db: any, operationId: number | null | undefined): void {
  if (!operationId) return;

  const row = db.prepare(`
    SELECT op.id, op.bl_date, op.ship_date, op.estimated_payment_date, op.estimated_payment_date_source,
      o.payment_terms as payment_terms
    FROM operations op
    LEFT JOIN orders o ON o.id = op.order_id
    WHERE op.id = ?
  `).get(operationId) as OperationDateRow | undefined;

  if (!row) return;
  // A date the user set by hand outranks anything derived from the terms.
  if (row.estimated_payment_date_source === 'manual') return;

  const first = db.prepare(`
    SELECT id, invoice_date FROM invoices
    WHERE operation_id = ? AND type = 'customer' AND status NOT IN ('cancelled', 'draft') AND invoice_date IS NOT NULL
    ORDER BY invoice_date, id LIMIT 1
  `).get(row.id) as { id: number; invoice_date: string } | undefined;
  const next = first
    ? dueDateForInvoice(db, first, { bl_date: row.bl_date, ship_date: row.ship_date, order_terms: row.payment_terms }).estimate
    : null;

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
