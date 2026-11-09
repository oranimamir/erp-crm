import db from '../database.js';

/**
 * What is still owed on an invoice once its wire transfers (and recorded
 * payments) are counted — in the invoice's own currency. A wire in another
 * currency is converted through its EUR value at the invoice's rate. Only
 * invoices with at least one payment have a balance; less than a cent is none.
 */
export interface InvoiceBalance { paid_amount: number | null; outstanding: number | null }

const round2 = (n: number) => Math.round(n * 100) / 100;

function inInvoiceCurrency(inv: any, amount: number, currency: string | null, eur: number | null): number {
  const invCur = String(inv.currency || 'USD').toUpperCase();
  const cur = String(currency || invCur).toUpperCase();
  if (cur === invCur) return amount;
  const eurValue = eur != null ? Number(eur) : cur === 'EUR' ? amount : null;
  if (eurValue == null) return amount;
  if (invCur === 'EUR') return eurValue;
  return inv.fx_rate ? eurValue / Number(inv.fx_rate) : amount;
}

/** Balances of these invoices (rows need id, amount, currency, fx_rate, status). */
export function balancesFor(invoices: any[]): Map<number, InvoiceBalance> {
  const out = new Map<number, InvoiceBalance>();
  if (!invoices.length) return out;
  const byId = new Map(invoices.map(i => [Number(i.id), i]));
  const paid = new Map<number, number>();
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ph = chunk.map(() => '?').join(',');
    const wires = db.prepare(`SELECT invoice_id, amount, currency, eur_amount FROM wire_transfers WHERE invoice_id IN (${ph}) AND status != 'rejected'`).all(...chunk) as any[];
    let pays: any[] = [];
    try { pays = db.prepare(`SELECT invoice_id, amount FROM payments WHERE invoice_id IN (${ph})`).all(...chunk) as any[]; } catch { /* no payments table */ }
    for (const w of wires) {
      const inv = byId.get(Number(w.invoice_id));
      paid.set(Number(w.invoice_id), (paid.get(Number(w.invoice_id)) || 0) + inInvoiceCurrency(inv, Number(w.amount) || 0, w.currency, w.eur_amount));
    }
    for (const p of pays) paid.set(Number(p.invoice_id), (paid.get(Number(p.invoice_id)) || 0) + (Number(p.amount) || 0));
  }
  for (const [id, inv] of byId) {
    const got = paid.get(id);
    if (got == null || inv.status === 'cancelled' || inv.status === 'paid_with_other') { out.set(id, { paid_amount: got != null ? round2(got) : null, outstanding: null }); continue; }
    const left = round2((Number(inv.amount) || 0) - got);
    out.set(id, { paid_amount: round2(got), outstanding: left >= 0.01 ? left : null });
  }
  return out;
}

/** Adds `paid_amount` / `outstanding` to each invoice row. */
export function withBalances<T extends Record<string, any>>(rows: T[]): Array<T & InvoiceBalance> {
  const balances = balancesFor(rows);
  return rows.map(r => ({ ...r, ...(balances.get(Number(r.id)) || { paid_amount: null, outstanding: null }) }));
}
