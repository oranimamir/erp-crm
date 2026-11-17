import { useEffect, useState } from 'react';
import { Landmark, Link2, Loader2, Receipt, Search, ShoppingCart } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Operation page → "Allocate existing records": for an operation created
 * after the fact, its order and invoices that already exist are suggested in
 * one list — each invoice with the wire transfers it brings along — and
 * allocated in one go (`GET /operations/:id/allocation-candidates`,
 * `POST /operations/:id/allocate`). The clear matches start ticked.
 */

interface Wire { id: number; amount: number; currency: string | null; transfer_date: string; bank_reference: string | null }
interface Inv {
  id: number; invoice_number: string; amount: number; currency: string | null; status: string; invoice_date: string | null;
  customer_name: string | null; linked_operation_number: string | null; reasons: string[]; suggested: boolean; score: number;
  wire_transfers: Wire[];
}
interface Ord {
  id: number; order_number: string; order_date: string | null; status: string; total_amount: number | null; currency: string | null;
  party: string | null; linked_operation_number: string | null; reasons: string[]; suggested: boolean; score: number;
}

const money = (n: number | null | undefined, c?: string | null) =>
  `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(c || 'USD').toUpperCase()}`;

export default function AllocateRecordsModal({ operationId, operationNumber, onClose, onDone }: {
  operationId: number; operationNumber: string; onClose: () => void; onDone: () => void;
}) {
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ operation: { has_order: boolean; order_number: string | null }; orders: Ord[]; invoices: Inv[] } | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [invoiceIds, setInvoiceIds] = useState<Set<number>>(new Set());
  const [primed, setPrimed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/operations/${operationId}/allocation-candidates`, { params: { search: search.trim() || undefined } })
        .then(({ data: d }) => {
          setData(d);
          // First load: tick the clear matches that are not on another operation
          if (!primed) {
            setPrimed(true);
            const strongOrder = (d.orders as Ord[]).find(o => o.score >= 8 && !o.linked_operation_number);
            if (strongOrder && !d.operation.has_order) setOrderId(strongOrder.id);
            setInvoiceIds(new Set((d.invoices as Inv[]).filter(i => i.score >= 8 && !i.linked_operation_number).map(i => i.id)));
          }
        })
        .catch(() => setData({ operation: { has_order: false, order_number: null }, orders: [], invoices: [] }));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, search]);

  const toggleInvoice = (id: number) => setInvoiceIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosenInvoices = (data?.invoices || []).filter(i => invoiceIds.has(i.id));
  const wireCount = chosenInvoices.reduce((n, i) => n + i.wire_transfers.length, 0);
  const moving = [
    ...(data?.orders || []).filter(o => o.id === orderId && o.linked_operation_number).map(o => `order ${o.order_number} moves from ${o.linked_operation_number}`),
    ...chosenInvoices.filter(i => i.linked_operation_number).map(i => `invoice ${i.invoice_number} moves from ${i.linked_operation_number}`),
  ];

  const allocate = async () => {
    setSaving(true);
    try {
      const { data: r } = await api.post(`/operations/${operationId}/allocate`, { order_id: orderId, invoice_ids: [...invoiceIds] });
      addToast(r.allocated.length
        ? `Allocated to ${operationNumber}: ${r.allocated.join(', ')}${r.wire_transfers ? ` + ${r.wire_transfers} wire transfer${r.wire_transfers === 1 ? '' : 's'}` : ''}${r.completed ? ' — delivered and paid, so it is now Completed' : ''}`
        : 'Nothing new to allocate', 'success');
      onDone();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not allocate', 'error');
    } finally {
      setSaving(false);
    }
  };

  const Tag = ({ r }: { r: { suggested: boolean; linked_operation_number: string | null } }) => (
    <>
      {r.suggested && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Suggested</span>}
      {r.linked_operation_number && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">on {r.linked_operation_number}</span>}
    </>
  );

  return (
    <Modal open onClose={onClose} title={`Allocate existing records to ${operationNumber}`} size="xl" closeOnBackdrop={false}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          The order and invoices already in the system for this operation. Each invoice brings its wire transfers along.
          Clear matches are ticked — check and click Allocate.
        </p>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order or invoice number, client, operation…"
            className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>

        {!data ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary-600" size={20} /></div>
        ) : (
          <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1">
            {/* Order */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <ShoppingCart size={13} /> Order {data.operation.has_order && <span className="normal-case font-normal text-gray-400">— now {data.operation.order_number}; pick one only to replace it</span>}
              </h3>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50">
                  <input type="radio" checked={orderId === null} onChange={() => setOrderId(null)} className="text-primary-600 focus:ring-primary-500" />
                  {data.operation.has_order ? 'Keep the current order' : 'No order'}
                </label>
                {data.orders.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-400">No order found{search ? ' for this search' : ''}.</p>
                ) : data.orders.map(o => (
                  <label key={o.id} className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-gray-50 ${orderId === o.id ? 'bg-primary-50/60' : ''}`}>
                    <input type="radio" checked={orderId === o.id} onChange={() => setOrderId(o.id)} className="mt-1 text-primary-600 focus:ring-primary-500" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{o.order_number}</span>
                        <span className="text-sm text-gray-700">{o.party || '—'}</span>
                        <Tag r={o} />
                      </span>
                      <span className="block text-xs text-gray-500">
                        {formatDate(o.order_date) || 'no date'}{o.reasons.length ? ` · ${o.reasons.join(', ')}` : ''}
                      </span>
                    </span>
                    {o.total_amount ? <span className="shrink-0 text-sm text-gray-700">{money(o.total_amount, o.currency)}</span> : null}
                  </label>
                ))}
              </div>
            </section>

            {/* Invoices + their wire transfers */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Receipt size={13} /> Invoices and their wire transfers
              </h3>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {data.invoices.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-400">{search ? 'No invoice matches.' : 'No unallocated customer invoice. Search to find one on another operation.'}</p>
                ) : data.invoices.map(i => (
                  <label key={i.id} className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-gray-50 ${invoiceIds.has(i.id) ? 'bg-primary-50/60' : ''}`}>
                    <input type="checkbox" checked={invoiceIds.has(i.id)} onChange={() => toggleInvoice(i.id)}
                      className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{i.invoice_number}</span>
                        <span className="text-sm text-gray-700">{i.customer_name || '—'}</span>
                        <Tag r={i} />
                      </span>
                      <span className="block text-xs text-gray-500">
                        {formatDate(i.invoice_date) || 'no date'} · {i.status}{i.reasons.length ? ` · ${i.reasons.join(', ')}` : ''}
                      </span>
                      {i.wire_transfers.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {i.wire_transfers.map(w => (
                            <span key={w.id} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 ring-1 ring-emerald-200">
                              <Landmark size={10} /> {money(w.amount, w.currency || i.currency)} · {formatDate(w.transfer_date)}{w.bank_reference ? ` · ${w.bank_reference}` : ''}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-gray-900">{money(i.amount, i.currency)}</span>
                  </label>
                ))}
              </div>
            </section>
          </div>
        )}

        {moving.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{moving.join(' · ')}.</p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
          <span className="text-xs text-gray-500">
            {orderId ? '1 order · ' : ''}{invoiceIds.size} invoice{invoiceIds.size === 1 ? '' : 's'}{wireCount ? ` · ${wireCount} wire transfer${wireCount === 1 ? '' : 's'}` : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={allocate} disabled={saving || (!orderId && !invoiceIds.size)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Allocate
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
