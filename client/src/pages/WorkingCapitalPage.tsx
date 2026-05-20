import { useState, useEffect, useMemo, FormEvent } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Plus, Pencil, Trash2, X, Wallet, Filter, Search, Archive, ArchiveRestore } from 'lucide-react';
import { formatDate } from '../lib/dates';

type Status = 'planned' | 'actualized' | 'cancelled';

interface ForecastOperation {
  id: number;
  operation_number: string;
  party_name?: string | null;
}

interface Forecast {
  id: number;
  description: string;
  supplier_name: string | null;
  amount: number;
  currency: string;
  fx_rate: number | null;
  eur_amount: number | null;
  expected_date: string;
  status: Status;
  notes: string | null;
  archived?: number;
  operations: ForecastOperation[];
}

interface OperationRef {
  id: number;
  operation_number: string;
  customer_name?: string | null;
  supplier_name?: string | null;
}

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

function fmtAxis(n: number) {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000)     return `€${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  return `€${Math.round(n)}`;
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
  supplier_name: string;
  operation_ids: number[];
  amount: string;
  currency: string;
  expected_date: string;
  status: Status;
  notes: string;
}

const EMPTY_FORM: FormState = {
  description: '',
  supplier_name: '',
  operation_ids: [],
  amount: '',
  currency: 'EUR',
  expected_date: new Date().toISOString().slice(0, 10),
  status: 'planned',
  notes: '',
};

interface OperationMultiPickerProps {
  operations: OperationRef[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

function OperationMultiPicker({ operations, selectedIds, onChange }: OperationMultiPickerProps) {
  const [search, setSearch] = useState('');
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => {
    const m = new Map<number, OperationRef>();
    for (const o of operations) m.set(o.id, o);
    return m;
  }, [operations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return operations;
    return operations.filter(o => {
      const party = (o.customer_name || o.supplier_name || '').toLowerCase();
      return o.operation_number.toLowerCase().includes(q) || party.includes(q);
    });
  }, [operations, search]);

  const toggle = (id: number) => {
    if (selectedSet.has(id)) onChange(selectedIds.filter(x => x !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div className="space-y-2">
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map(id => {
            const op = byId.get(id);
            const label = op ? op.operation_number : `#${id}`;
            return (
              <span key={id} className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-full px-2 py-0.5 text-xs">
                {label}
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="hover:bg-primary-100 rounded-full p-0.5"
                  aria-label={`Remove ${label}`}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search operations..."
          className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto bg-white">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-400 px-3 py-2 text-center">No operations match</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map(o => {
              const checked = selectedSet.has(o.id);
              return (
                <li key={o.id}>
                  <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={checked} onChange={() => toggle(o.id)} className="h-3.5 w-3.5" />
                    <span className="text-sm text-gray-900">{o.operation_number}</span>
                    {(o.customer_name || o.supplier_name) && (
                      <span className="text-xs text-gray-500 truncate">— {o.customer_name || o.supplier_name}</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function WorkingCapitalPage() {
  const [items, setItems] = useState<Forecast[]>([]);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  const [operations, setOperations] = useState<OperationRef[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterYear, setFilterYear] = useState<string>(String(new Date().getFullYear()));
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSupplierName, setFilterSupplierName] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filterYear)         params.year = filterYear;
    if (filterMonth)        params.month = filterMonth;
    if (filterStatus)       params.status = filterStatus;
    if (filterSupplierName) params.supplier_name = filterSupplierName;
    if (showArchived)       params.archived = '1';
    api.get('/working-capital', { params })
      .then(r => setItems(r.data))
      .catch(err => { console.error('[working-capital] load failed', err); setItems([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    Promise.all([
      api.get('/working-capital/supplier-names'),
      api.get('/operations', { params: { limit: 1000, tab: 'active' } }),
    ]).then(([sn, ops]) => {
      setSupplierNames(Array.isArray(sn.data) ? sn.data : []);
      setOperations(Array.isArray(ops.data) ? ops.data : ops.data.data ?? []);
    }).catch(err => console.warn('[working-capital] supplier-names/operations load failed', err));
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterYear, filterMonth, filterStatus, filterSupplierName, showArchived]);

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

  // Working capital per month (EUR, excl. cancelled), keyed by YYYY-MM.
  const monthly = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of items) {
      if (it.status === 'cancelled') continue;
      const month = (it.expected_date || '').slice(0, 7); // YYYY-MM
      if (month.length !== 7) continue;
      totals.set(month, (totals.get(month) ?? 0) + eurValue(it));
    }
    // If a single year is selected (and no month filter), show all 12 months
    // so the timeline reads continuously even where there's no outflow.
    if (filterYear && !filterMonth) {
      return Array.from({ length: 12 }, (_, i) => {
        const month = `${filterYear}-${String(i + 1).padStart(2, '0')}`;
        return { month, total: totals.get(month) ?? 0 };
      });
    }
    return Array.from(totals.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));
  }, [items, filterYear, filterMonth]);

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
      supplier_name: f.supplier_name ?? '',
      operation_ids: (f.operations ?? []).map(o => o.id),
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
      supplier_name: form.supplier_name.trim() || null,
      operation_ids: form.operation_ids,
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

  async function handleArchive(id: number, archived: boolean) {
    try {
      await api.patch(`/working-capital/${id}/archive`, { archived });
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Archive failed');
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
            value={filterSupplierName} onChange={e => setFilterSupplierName(e.target.value)}>
            <option value="">All suppliers</option>
            {supplierNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          {(filterYear || filterMonth || filterStatus || filterSupplierName) && (
            <button
              onClick={() => { setFilterYear(''); setFilterMonth(''); setFilterStatus(''); setFilterSupplierName(''); }}
              className="text-sm text-gray-500 hover:text-gray-700 underline">
              Clear
            </button>
          )}
          <button
            onClick={() => setShowArchived(v => !v)}
            className={`ml-auto inline-flex items-center gap-1.5 text-sm rounded-lg px-2.5 py-1.5 border transition-colors ${
              showArchived ? 'bg-primary-50 text-primary-700 border-primary-200' : 'text-gray-500 border-gray-300 hover:bg-gray-50'
            }`}>
            <Archive size={14} /> {showArchived ? 'Viewing archived' : 'Show archived'}
          </button>
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
                  <th className="text-left px-4 py-2.5 font-medium">Operations</th>
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
                    <td className="px-4 py-2.5 text-gray-700">
                      {it.operations && it.operations.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {it.operations.map(op => (
                            <span key={op.id} className="inline-block bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-xs">
                              {op.operation_number}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
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
                      {showArchived ? (
                        <button onClick={() => handleArchive(it.id, false)} className="text-gray-400 hover:text-primary-600 p-1 ml-1" title="Unarchive">
                          <ArchiveRestore size={15} />
                        </button>
                      ) : (
                        <button onClick={() => handleArchive(it.id, true)} className="text-gray-400 hover:text-amber-600 p-1 ml-1" title="Archive (paid / done)">
                          <Archive size={15} />
                        </button>
                      )}
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

      {/* Per-month chart */}
      {!loading && monthly.some(m => m.total > 0) && (() => {
        const maxVal = Math.max(...monthly.map(m => m.total), 1);
        const chartH = 180;
        return (
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Working Capital — Per Month (EUR, excl. cancelled)</h2>
              </div>
              <span className="text-xs text-gray-500">Total: <strong className="text-gray-900">{fmtEur(totalEur)}</strong></span>
            </div>
            <div className="p-5">
              <div className="flex gap-2">
                {/* Y-axis */}
                <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: chartH }}>
                  {[maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0].map((v, i) => (
                    <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">{fmtAxis(v)}</span>
                  ))}
                </div>
                {/* Chart */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="relative" style={{ height: chartH }}>
                    {[0, 25, 50, 75, 100].map(pct => (
                      <div key={pct} className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                        style={{ bottom: `${(pct / 100) * chartH}px` }} />
                    ))}
                    <div className="flex items-end gap-1.5 h-full">
                      {monthly.map(m => {
                        const barH = m.total > 0 ? Math.max((m.total / maxVal) * (chartH - 20), 3) : 0;
                        return (
                          <div key={m.month} className="flex-1 h-full flex flex-col items-center justify-end group relative">
                            {m.total > 0 && <span className="text-[10px] text-primary-700 font-semibold tabular-nums whitespace-nowrap mb-0.5">{fmtAxis(m.total)}</span>}
                            <div className="w-full max-w-[32px] bg-primary-500 rounded-t transition-all hover:bg-primary-600 cursor-pointer"
                              style={{ height: `${barH}px` }} />
                            {/* Tooltip on hover */}
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                              <div className="font-semibold">{new Date(m.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
                              <div>{fmtEur(m.total)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    {monthly.map(m => (
                      <div key={m.month} className="flex-1 text-center text-[10px] text-gray-400 truncate">
                        {new Date(m.month + '-01').toLocaleDateString(undefined, { month: 'short' })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
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
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Supplier (optional)</label>
                <input
                  list="wc-supplier-names"
                  type="text"
                  value={form.supplier_name}
                  onChange={e => setForm({ ...form, supplier_name: e.target.value })}
                  placeholder="Type or pick a supplier"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <datalist id="wc-supplier-names">
                  {supplierNames.map(name => <option key={name} value={name} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Linked operations (optional)
                  {form.operation_ids.length > 0 && <span className="text-gray-400 font-normal ml-1">· {form.operation_ids.length} selected</span>}
                </label>
                <OperationMultiPicker
                  operations={operations}
                  selectedIds={form.operation_ids}
                  onChange={ids => setForm({ ...form, operation_ids: ids })}
                />
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
