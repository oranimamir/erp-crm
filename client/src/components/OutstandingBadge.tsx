import type { MouseEvent } from 'react';
import api from '../lib/api';

/**
 * What is still owed on an invoice after its wire transfers (`outstanding`
 * from the API, in the invoice's currency) — shown under its amount.
 */
export function outstandingText(outstanding: number | null | undefined, currency?: string | null): string | null {
  if (!outstanding) return null;
  return `${outstanding.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(currency || 'USD').toUpperCase()}`;
}

export default function OutstandingBadge({ outstanding, currency, className = '' }: { outstanding?: number | null; currency?: string | null; className?: string }) {
  const text = outstandingText(outstanding, currency);
  if (!text) return null;
  return (
    <span title="The wire transfers received are less than the invoice"
      className={`inline-block whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200 ${className}`}>
      {text} outstanding
    </span>
  );
}

/** The toast after a wire upload: paid in full, or how much is left. */
export function wireUploadMessage(data: any, fallback: string): { text: string; partial: boolean } {
  const left = outstandingText(data?.outstanding, data?.invoice_currency);
  return left
    ? { text: `Wire transfer recorded — ${left} still outstanding on this invoice`, partial: true }
    : { text: fallback, partial: false };
}

/**
 * "Amount settled": closes a short payment's remainder on purpose (bank fees,
 * a small deduction…) so the invoice stops showing a balance. Asks for an
 * optional note; recorded apart from the payments (`POST /invoices/:id/settle`).
 */
export function SettleButton({ invoiceId, outstanding, currency, onDone, className = '' }: {
  invoiceId: number; outstanding: number; currency?: string | null; onDone: () => void; className?: string;
}) {
  const settle = async (e: MouseEvent) => {
    e.stopPropagation();
    const text = outstandingText(outstanding, currency);
    const note = window.prompt(`Mark the missing ${text} as settled?\n\nIt will no longer show as outstanding (it is not counted as money received).\nReason (optional) — e.g. bank fees, discount, rounding:`, '');
    if (note === null) return;
    try {
      await api.post(`/invoices/${invoiceId}/settle`, { note });
      onDone();
    } catch (err: any) {
      window.alert(err?.response?.data?.error || 'Could not settle the amount');
    }
  };
  return (
    <button type="button" onClick={settle}
      title="Close the missing amount (bank fees, a deduction…) so it no longer shows as outstanding"
      className={`inline-flex items-center whitespace-nowrap rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 ${className}`}>
      Amount settled
    </button>
  );
}
