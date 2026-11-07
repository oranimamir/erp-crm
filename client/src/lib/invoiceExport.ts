import api from './api';
import { formatDate } from './dates';

/**
 * The invoice's own figures for the Customer Invoices Excel exports: a
 * generated invoice is read off its document (lines, tonnage, totals), an
 * uploaded one gives its recorded amount and tonnage
 * (`POST /api/invoices/export-details`).
 */
export async function invoiceExportDetails(ids: number[]): Promise<Record<number, any>> {
  if (!ids.length) return {};
  const { data } = await api.post('/invoices/export-details', { ids });
  return data || {};
}

export const INVOICE_DETAIL_HEADERS = [
  'Source', 'Products', 'References', 'Quantities', 'Unit prices', 'Lots', 'Tonnage (MT)',
  'Currency', 'Products subtotal', 'Transport / freight', 'Insurance', 'VAT / tax', 'Total (incl. transport, insurance, VAT)', 'Original amount (USD)', 'FX rate (to EUR)', 'EUR amount',
  'Incoterm / delivery', 'Payment terms', 'Check',
];

/** One row's detail cells, in INVOICE_DETAIL_HEADERS order; `inv` is the recorded invoice. */
export function invoiceDetailCells(inv: any, d: any): (string | number | null)[] {
  const currency = String(d?.currency || inv.currency || '').toUpperCase();
  const total = d?.total ?? inv.amount ?? null;
  return [
    d?.source || '', d?.products || '', d?.references || '', d?.quantities || '', d?.unit_prices || '', d?.lots || '',
    d?.tonnage_mt ?? inv.quantity_mt ?? '',
    currency, d?.subtotal ?? '', d?.freight ?? '', d?.insurance ?? '', d?.vat ?? '', total ?? '',
    currency === 'USD' ? total ?? '' : '',
    inv.fx_rate ?? (currency === 'EUR' ? 1 : ''),
    inv.eur_amount ?? (currency === 'EUR' ? total ?? '' : ''),
    d?.incoterm || '', d?.payment_terms || '', d?.check || '',
  ];
}

export const fmtDate = (s?: string | null) => (s ? formatDate(s) || '' : '');
