import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Loader2, ShoppingBag, Search } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import PurchaseOperationFormModal, { type PurchaseOperation } from '../components/PurchaseOperationFormModal';

/**
 * Purchase operations: purchases from a supplier, numbered PO<year><nnnn>.
 * Each starts with its supplier PO (named as the operation) and holds the
 * supplier's documents; sales operations can reuse both.
 */

interface Row extends PurchaseOperation {
  document_count: number;
  purchase_order_id: number | null;
  purchase_order_status: 'draft' | 'final' | null;
}

export default function PurchaseOperationsPage() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PurchaseOperation | null>(null);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/purchase-operations', { params: { search: search.trim() || undefined } })
      .then(res => setRows(res.data.data || []))
      .catch(() => addToast('Failed to load purchase operations', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search]);

  async function handleDelete(row: Row) {
    try {
      await api.delete(`/purchase-operations/${row.id}`);
      addToast(`${row.po_number} deleted`, 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  const dash = <span className="text-gray-300">—</span>;
  const poBadge = (r: Row) => !r.purchase_order_id
    ? <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">To generate</span>
    : r.purchase_order_status === 'draft'
      ? <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">Draft</span>
      : <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700">Generated ✓</span>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Operations</h1>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={16} /> New purchase operation</Button>
      </div>

      <div className="relative w-fit">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search number, supplier, notes…"
          className="rounded-full border border-gray-300 bg-white pl-8 pr-3 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            <ShoppingBag size={24} className="mx-auto mb-2 text-gray-300" />
            No purchase operations yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">PO #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Purchase order</th>
                  <th className="px-4 py-3 text-right">Documents</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.id} onClick={() => navigate(`/purchase-operations/${r.id}`)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.po_number}</td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(r.po_date) || dash}</td>
                    <td className="px-4 py-2.5 text-gray-900">{r.supplier_label || dash}</td>
                    <td className="px-4 py-2.5">{poBadge(r)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{r.document_count || dash}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate" title={r.notes || ''}>{r.notes || dash}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditing(r); setShowForm(true); }} className="p-1.5 rounded text-gray-400 hover:text-primary-600" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setDeleteRow(r)} className="p-1.5 rounded text-gray-400 hover:text-red-600" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PurchaseOperationFormModal
        open={showForm}
        editing={editing}
        onClose={() => setShowForm(false)}
        onSaved={(row, created) => {
          setShowForm(false);
          if (created) navigate(`/purchase-operations/${row.id}`);
          else load();
        }}
      />

      <ConfirmDialog
        open={deleteRow !== null}
        onClose={() => setDeleteRow(null)}
        onConfirm={() => deleteRow && handleDelete(deleteRow)}
        title="Delete purchase operation"
        message={`Delete ${deleteRow?.po_number ?? ''} with its purchase order and documents? The files go to the Archive. Copies already filed on sales operations stay.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
