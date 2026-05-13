import { useState, useEffect, useMemo, FormEvent } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Plus, Pencil, Trash2, X, Wallet, Filter } from 'lucide-react';
import { formatDate } from '../lib/dates';

type Status = 'planned' | 'actualized' | 'cancelled';

interface Forecast {
  id: number;
  description: string;
  supplier_id: number | null;
  order_id: number | null;
  amount: number;
  currency: string;
  fx_rate: number | null;
  eur_amount: number | null;
  expected_date: string;
  status: Status;
  notes: string | null;
  supplier_name?: string | null;
  order_number?: string | null;
}

interface Supplier { id: number; name: string; }
interface OrderRef { id: number; order_number: string; }

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CNY'];
const STATUSES: Status[] = ['planned', 'actualized', 'cancelled'];

const STATUS_STYLES: Record<Status, string> = {
  planned:    'bg-blue-100 text-blue-700 border-blue-200',
  actualized: 'bg-green-100 text-green-700 border-green-200',
  cancelled:  'bg-gray-100 text-gray-500 border-gray-200',
};

function fmtEur(n: number | null | undefined) {
  if (n == null || !isFinite(n)) return '—';
  return `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAmount(n: number, currency: string) {
  const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
  const body = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol}${body}` : `${body} ${currency}`;
}

function eurValue(f: Forecast): number {
  if (f.eur_amount != null) return f.eur_amount;
  if ((f.currency || 'EUR').toUpperCase() === 'EUR') return f.amount;
  return f.amount;
}

interface FormState {
  description: string;
  supplier_id: string;
  order_id: string;
  amount: string;
  currency: string;
  expected_date: string;
  status: Status;
  notes: string;
}

const EMPTY_FORM: FormState = {
  description: '',
  supplier_id: '',
  order_id: '',
  amount: '',
  currency: 'EUR',
  expected_date: new Date().toISOString().slice(0, 10),
  status: 'planned',
  notes: '',
};

export default function WorkingCapitalPage() {
  const [items, setItems] = useState<Forecast[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<OrderRef[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterYear, setFilterYear] = useState<string>(String(new Date().getFullYear()));
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSupplier, setFilterSupplier] = useState<string>('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filterYear)     params.year = filterYear;
    if (filterMonth)    params.month = filterMonth;
    if (filterStatus)   params.status = filterStatus;
    if (filterSupplier) params.supplier_id = filterSupplier;
    api.get('/working-capital', { params })
      .then(r => setItems(r.data))
      .catch(err => { console.error('[working-capital] load failed', err); setItems([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    Promise.all([
      api.get('/suppliers'),
      api.get('/orders', { params: { limit: 200 } }),
    ]).then(([s, o]) => {
      setSuppliers(Array.isArray(s.data) ? s.data : s.data.data ?? []);
      setOrders(Array.isArray(o.data) ? o.data : o.data.data ?? []);
    }).catch(err => console.warn('[working-capital] suppliers/orders load failed', err));
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterYear, filterMonth, filterStatus, filterSupplier]);

  const totalEur = useMemo(
    () => items.filter(i => i.status !== 'cancelled').reduce((s, i) => s + eurValue(i), 0),
    [items],
  );
  const plannedEur = useMemo(
    () => items.filter(i => i.status === 'planned').reduce((s, i) => s + eurValue(i), 0),
    [items],
  );
  const actualizedEur = useMemo(
    () => items.filter(i => i.status === 'actualized').reduce((s, i) => s + eurValue(i), 0),
    [items],
  );

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(f: Forecast) {
    setEditingId(f.id);
    setForm({
      description: f.description,
      supplier_id: f.supplier_id ? String(f.supplier_id) : '',
      order_id:    f.order_id    ? String(f.order_id)    : '',
      amount: String(f.amount),
      currency: (f.currency || 'EUR').toUpperCase(),
      expected_date: f.expected_date,
      status: f.status,
      notes: f.notes ?? '',
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.description.trim()) { setError('Description is required'); return; }
    const amt = parseFloat(form.amount);
    if (!isFinite(amt) || amt <= 0) { setError('Amount must be a positive number'); return; }
    if (!form.expected_date) { setError('Expected date is required'); return; }

    setSaving(true);
    const payload = {
      description: form.description.trim(),
      supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
      order_id:    form.order_id    ? Number(form.order_id)    : null,
      amount: amt,
      currency: form.currency,
      expected_date: form.expected_date,
      status: form.status,
      notes: form.notes.trim() || null,
    };
    try {
      if (editingId == null) {
        await api.post('/working-capital', payload);
      } else {
        await api.put(`/working-capital/${editingId}`, payload);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this forecast entry?')) return;
    try {
      await api.delete(`/working-capital/${id}`);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Delete failed');
    }
  }

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1, y + 2];
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="w-7 h-7 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Working Capital</h1>
            <p className="text-sm text-gray-500">Foreseen expenses required to fulfill upcoming sales activity</p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} /> Add Forecast Entry
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Planned outflow</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{fmtEur(plannedEur)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Actualized outflow</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{fmtEur(actualizedEur)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total (excl. cancelled)</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmtEur(totalEur)}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Filter size={14} /> Filters:
          </div>
          <select className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5"
            value={filterYear} onChange={e => setFilterYear(e.target.value)}>
            <option value="">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5"
            value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
            <option value="">All months</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={String(m).padStart(2, '0')}>
                {new Date(2000, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' })}
              </option>
            ))}
          </select>
          <select className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5"
            value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {(filterYear || filterMonth || filterStatus || filterSupplier) && (
            <button
              onClick={() => { setFilterYear(''); setFilterMonth(''); setFilterStatus(''); setFilterSupplier(''); }}
              className="text-sm text-gray-500 hover:text-gray-700 underline">
              Clear
            </button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Wallet className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="font-medium">No forecast entries yet</p>
            <p className="text-sm mt-1">Add expected material purchases or other working-capital outflows so they appear in the dashboard cash-flow view.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Expected date</th>
                  <th className="text-left px-4 py-2.5 font-medium">Description</th>
                  <th className="text-left px-4 py-2.5 font-medium">Supplier</th>
                  <th className="text-left px-4 py-2.5 font-medium">Order</th>
                  <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                  <th className="text-right px-4 py-2.5 font-medium">EUR</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(it => (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{formatDate(it.expected_date)}</td>
                    <td className="px-4 py-2.5 text-gray-900">
                      <div>{it.description}</div>
                      {it.notes && <div className="text-xs text-gray-400 mt-0.5">{it.notes}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{it.supplier_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-gray-700">{it.order_number || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtAmount(it.amount, it.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900">{fmtEur(eurValue(it))}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[it.status]}`}>
                        {it.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(it)} className="text-gray-400 hover:text-primary-600 p-1" title="Edit">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(it.id)} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 text-sm">
                <tr>
                  <td colSpan={5} className="px-4 py-2.5 text-right text-gray-500 font-medium">Total (excl. cancelled)</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">{fmtEur(totalEur)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                {editingId == null ? 'Add Forecast Entry' : 'Edit Forecast Entry'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600" disabled={saving}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
                <input type="text" required value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Raw material pre-payment for ORD-2026-014" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Expected payment date *</label>
                  <input type="date" required value={form.expected_date}
                    onChange={e => setForm({ ...form, expected_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as Status })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Amount *</label>
                  <input type="number" required step="0.01" min="0" value={form.amount}
                    onChange={e => setForm({ ...form, amount: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
                  <select value={form.currency}
                    onChange={e => setForm({ ...form, currency: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Supplier (optional)</label>
                  <select value={form.supplier_id}
                    onChange={e => setForm({ ...form, supplier_id: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— None —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Linked order (optional)</label>
                  <select value={form.order_id}
                    onChange={e => setForm({ ...form, order_id: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— None —</option>
                    {orders.map(o => <option key={o.id} value={o.id}>{o.order_number}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea rows={2} value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                  placeholder="Anything else worth remembering" />
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="secondary" type="button" onClick={() => setModalOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : (editingId == null ? 'Add entry' : 'Save changes')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
