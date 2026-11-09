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
