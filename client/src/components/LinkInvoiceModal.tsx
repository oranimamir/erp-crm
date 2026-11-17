import { useEffect, useState } from 'react';
import { Link2, Loader2, Search } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Operation page → Invoices → "Link existing invoice": for older operations
 * whose invoices were recorded without them. Likely ones come first (the
 * invoice names the operation, has its number or its order number, same
 * client); an invoice on another operation moves here. Its wire transfers
 * come along — they belong to the invoice.
 */

interface Candidate {
  id: number; invoice_number: string; amount: number; currency: string | null; status: string; invoice_date: string | null;
  customer_name: string | null; linked_operation_number: string | null; wire_count: number; reasons: string[]; suggested: boolean;
}

export default function LinkInvoiceModal({ operationId, operationNumber, onClose, onLinked }: {
  operationId: number; operationNumber: string; onClose: () => void; onLinked: () => void;
}) {
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/operations/${operationId}/invoice-candidates`, { params: { search: search.trim() || undefined } })
        .then(({ data }) => setRows(data.invoices || []))
        .catch(() => setRows([]));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [operationId, search]);

  const toggle = (id: number) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const link = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/operations/${operationId}/invoices/link`, { invoice_ids: [...picked] });
      addToast(`${data.linked} invoice${data.linked === 1 ? '' : 's'} linked to ${operationNumber}`, 'success');
      onLinked();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not link the invoices', 'error');
    } finally {
      setSaving(false);
    }
  };

  const money = (n: number, c: string | null) => `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(c || 'USD').toUpperCase()}`;
  const moving = (rows || []).filter(r => picked.has(r.id) && r.linked_operation_number);

  return (
    <Modal open onClose={onClose} title={`Link an existing invoice to ${operationNumber}`} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          For invoices recorded before they were tied to this operation. Linking brings their wire transfers along.
        </p>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice number, client, PO, operation…"
            className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
          {!rows ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-600" size={20} /></div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">{search ? 'No invoice matches.' : 'No unlinked customer invoice. Search to find one on another operation.'}</p>
          ) : rows.map(r => (
            <label key={r.id} className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-gray-50 ${picked.has(r.id) ? 'bg-primary-50/60' : ''}`}>
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)}
                className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{r.invoice_number}</span>
                  <span className="text-sm text-gray-700">{r.customer_name || '—'}</span>
                  {r.suggested && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Suggested</span>}
                  {r.linked_operation_number && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">on {r.linked_operation_number}</span>}
                </span>
                <span className="block text-xs text-gray-500">
                  {formatDate(r.invoice_date) || 'no date'} · {r.status}
                  {r.wire_count > 0 ? ` · ${r.wire_count} wire transfer${r.wire_count === 1 ? '' : 's'}` : ''}
                  {r.reasons.length ? ` · ${r.reasons.join(', ')}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium text-gray-900">{money(r.amount, r.currency)}</span>
            </label>
          ))}
        </div>
        {moving.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {moving.map(m => `${m.invoice_number} moves from ${m.linked_operation_number}`).join(' · ')}.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={link} disabled={!picked.size || saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link {picked.size || ''} invoice{picked.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
