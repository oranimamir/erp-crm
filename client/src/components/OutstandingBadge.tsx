import { useState, type MouseEvent } from 'react';
import { CheckCircle, Info, Loader2 } from 'lucide-react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';

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
 * a small deduction, paid on another operation…) so the invoice stops showing
 * a balance. Opens a small window with the figures and a reason; recorded
 * apart from the payments (`POST /invoices/:id/settle`).
 */
const REASONS = ['Bank fees', 'Discount agreed', 'Rounding', 'Paid in another operation'];

export function SettleButton({ invoiceId, outstanding, currency, invoiceNumber, amount, paid, onDone, className = '' }: {
  invoiceId: number; outstanding: number; currency?: string | null;
  /** Shown in the window when known */
  invoiceNumber?: string | null; amount?: number | null; paid?: number | null;
  onDone: () => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cur = String(currency || 'USD').toUpperCase();
  const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/invoices/${invoiceId}/settle`, { note: reason.trim() });
      setOpen(false);
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not settle the amount');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" onClick={(e: MouseEvent) => { e.stopPropagation(); setReason(''); setError(''); setOpen(true); }}
        title="Close the missing amount (bank fees, a deduction…) so it no longer shows as outstanding"
        className={`inline-flex items-center whitespace-nowrap rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 ${className}`}>
        Amount settled
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()}>
          <Modal open onClose={() => setOpen(false)} title={`Settle the missing amount${invoiceNumber ? ` — ${invoiceNumber}` : ''}`} size="md">
            <div className="space-y-4 text-left">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                {amount != null && (
                  <div className="flex justify-between py-0.5"><span className="text-gray-500">Invoice total</span><span className="font-medium text-gray-900">{fmt(amount)}</span></div>
                )}
                {paid != null && (
                  <div className="flex justify-between py-0.5"><span className="text-gray-500">Received</span><span className="font-medium text-green-700">{fmt(paid)}</span></div>
                )}
                <div className={`flex justify-between py-0.5 ${amount != null || paid != null ? 'mt-1 border-t border-gray-200 pt-1.5' : ''}`}>
                  <span className="font-semibold text-gray-800">To settle</span>
                  <span className="font-bold text-amber-700">{fmt(outstanding)}</span>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-500">Reason</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {REASONS.map(r => (
                    <button key={r} type="button" onClick={() => setReason(r)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${reason === r ? 'border-primary-500 bg-primary-50 font-semibold text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} autoFocus
                  placeholder="e.g. The difference was wired in operation SONL20260103"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>

              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <Info size={14} className="mt-0.5 shrink-0" />
                The invoice will no longer show this amount as outstanding. It is not recorded as money received, and you can undo it from the invoice page.
              </p>
              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Settle {fmt(outstanding)}
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </>
  );
}
