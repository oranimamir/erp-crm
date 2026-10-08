import { useEffect, useState } from 'react';
import { Truck, X, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';

/**
 * Mark as Shipped: the shipment date, then each customer invoice's due date as
 * its own payment terms give it (`GET /operations/:id/ship-preview`) —
 * "45 days end of month" from the invoice date, "60 days from B/L" from the BL
 * (or this shipment date). No fixed number of days; each date can be changed.
 */

interface PreviewInvoice {
  id: number; invoice_number: string; status: string; invoice_date: string | null; current_due_date: string | null;
  terms: string | null; terms_source: 'invoice' | 'order' | null;
  due_date: string | null; basis: 'bl' | 'invoice' | null; days: number | null; end_of_month: boolean;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ShipOperationModal({ operation, onClose, onShipped }: {
  operation: { id: number; operation_number: string; ship_date?: string | null };
  onClose: () => void;
  onShipped: (shipDate: string) => void;
}) {
  const { addToast } = useToast();
  const [shipDate, setShipDate] = useState(operation.ship_date || todayISO());
  const [invoices, setInvoices] = useState<PreviewInvoice[] | null>(null);
  // Dates the user typed over the computed ones, per invoice
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shipDate)) return;
    api.get(`/operations/${operation.id}/ship-preview`, { params: { ship_date: shipDate } })
      .then(r => setInvoices(r.data.invoices || []))
      .catch(() => setInvoices([]));
  }, [operation.id, shipDate]);

  async function confirm() {
    setSaving(true);
    try {
      const due_dates: Record<number, string> = {};
      for (const [id, v] of Object.entries(overrides)) due_dates[Number(id)] = v;
      await api.post(`/operations/${operation.id}/ship`, { ship_date: shipDate, due_dates });
      addToast('Operation marked as shipped — invoices updated', 'success');
      onShipped(shipDate);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to mark as shipped', 'error');
    } finally {
      setSaving(false);
    }
  }

  const how = (inv: PreviewInvoice) => {
    if (!inv.terms) return 'No payment terms with a number of days on the invoice — set the date by hand or leave it';
    if (inv.basis === 'bl') return `${inv.days} days from the B/L${inv.end_of_month ? ', end of month' : ''}`;
    if (!inv.invoice_date) return 'The invoice has no date yet';
    return `${inv.days} days from the invoice date${inv.end_of_month ? ', end of month' : ''}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Truck size={17} className="text-blue-500" />
            Mark as Shipped — {operation.operation_number}
          </h3>
          <button onClick={() => !saving && onClose()} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shipment Date</label>
            <input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>

          {invoices === null ? (
            <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-primary-600" /></div>
          ) : invoices.length === 0 ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              No customer invoices linked — status will be updated but no due dates will be set.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Due date per invoice — from its payment terms
              </p>
              {invoices.map(inv => {
                const value = overrides[inv.id] ?? inv.due_date ?? '';
                const edited = overrides[inv.id] !== undefined && overrides[inv.id] !== (inv.due_date ?? '');
                return (
                  <div key={inv.id} className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-blue-900">{inv.invoice_number}</span>
                      {inv.status === 'draft' && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">draft → sent</span>}
                      {inv.invoice_date && <span className="text-xs text-blue-600">dated {formatDate(inv.invoice_date)}</span>}
                    </div>
                    {inv.terms && (
                      <p className="text-xs text-gray-700">
                        <span className="text-gray-500">Payment terms{inv.terms_source === 'order' ? ' (from the order — none stored on this invoice)' : ''}:</span> “{inv.terms}”
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="date" value={value}
                        onChange={e => setOverrides(prev => ({ ...prev, [inv.id]: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      {edited && inv.due_date && (
                        <button type="button" onClick={() => setOverrides(prev => { const n = { ...prev }; delete n[inv.id]; return n; })}
                          className="text-xs text-primary-600 hover:underline">Back to {formatDate(inv.due_date)}</button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {edited ? 'Set by hand' : how(inv)}
                      {!value && inv.current_due_date ? ` · keeps its due date ${formatDate(inv.current_due_date)}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-60">
            Cancel
          </button>
          <button onClick={confirm} disabled={saving || !shipDate || invoices === null}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />}
            {saving ? 'Saving...' : 'Confirm Shipment'}
          </button>
        </div>
      </div>
    </div>
  );
}
