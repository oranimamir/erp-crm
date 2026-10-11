import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Loader2, Cpu, Search } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import TechnologyOperationFormModal, { type TechnologyOperation } from '../components/TechnologyOperationFormModal';
import { TO_STATUSES, toStatusOf } from '../lib/toStatus';

/**
 * Technology operations: technology services TripleW provides and is
 * reimbursed for on its expenses. Numbered TO<entity><year><nnnn> like sales
 * operations; expenses are uploaded on each operation and invoiced as TI…
 * invoices (revenue, like the CI invoices).
 */

type Entity = 'BE' | 'NL';

interface Row extends TechnologyOperation {
  expenses_eur: number;
  expense_count: number;
  uninvoiced_count: number;
  invoiced_eur: number;
}

const eur = (n: number) => `€${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TechnologyOperationsPage() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [entity, setEntity] = useState<'' | Entity>('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TechnologyOperation | null>(null);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/technology-operations', { params: { entity: entity || undefined, status: status || undefined, search: search.trim() || undefined } })
      .then(res => setRows(res.data.data || []))
      .catch(() => addToast('Failed to load technology operations', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [entity, status, search]);

  async function handleDelete(row: Row) {
    try {
      await api.delete(`/technology-operations/${row.id}`);
      addToast(`${row.to_number} deleted`, 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  const dash = <span className="text-gray-300">—</span>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Technology Operations</h1>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={16} /> New operation</Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {([['', 'All'], ['BE', 'BE'], ['NL', 'NL']] as const).map(([code, label]) => (
            <button key={label} type="button" onClick={() => setEntity(code)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                entity === code ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}>{label}</button>
          ))}
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500">
          <option value="">All statuses</option>
          {TO_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search number, customer, title…"
            className="rounded-full border border-gray-300 bg-white pl-8 pr-3 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            <Cpu size={24} className="mx-auto mb-2 text-gray-300" />
            No technology operations yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">TO #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Expenses</th>
                  <th className="px-4 py-3 text-right">Invoiced</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const st = toStatusOf(r.status);
                  return (
                    <tr key={r.id} onClick={() => navigate(`/technology-operations/${r.id}`)} className="hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.to_number}</td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(r.to_date) || dash}</td>
                      <td className="px-4 py-2.5 text-gray-900">{r.customer_name || dash}</td>
                      <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate" title={r.title || ''}>{r.title || dash}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <span className="text-gray-900">{eur(r.expenses_eur)}</span>
                        <span className="block text-[11px] text-gray-400">
                          {r.expense_count} expense{r.expense_count === 1 ? '' : 's'}
                          {r.uninvoiced_count > 0 && <span className="text-amber-600"> · {r.uninvoiced_count} not invoiced</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap text-gray-900">{r.invoiced_eur ? eur(r.invoiced_eur) : dash}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditing(r); setShowForm(true); }} className="p-1.5 rounded text-gray-400 hover:text-primary-600" title="Edit">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteRow(r)} className="p-1.5 rounded text-gray-400 hover:text-red-600" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TechnologyOperationFormModal
        open={showForm}
        editing={editing}
        defaultEntity={entity || 'BE'}
        onClose={() => setShowForm(false)}
        onSaved={(row, created) => {
          setShowForm(false);
          if (created) navigate(`/technology-operations/${row.id}`);
          else load();
        }}
      />

      <ConfirmDialog
        open={deleteRow !== null}
        onClose={() => setDeleteRow(null)}
        onConfirm={() => deleteRow && handleDelete(deleteRow)}
        title="Delete technology operation"
        message={`Delete ${deleteRow?.to_number ?? ''} with its expenses and invoices? The files go to the Archive.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
