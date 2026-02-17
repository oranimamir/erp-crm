import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import StatusBadge from '../components/ui/StatusBadge';
import { Plus, Factory, Pencil, Trash2, Eye, ArrowRight, Clock } from 'lucide-react';

const productionStatuses = [
  { value: 'new_order', label: 'New Order' },
  { value: 'stock_check', label: 'Stock Check' },
  { value: 'sufficient_stock', label: 'Sufficient Stock' },
  { value: 'lot_issued', label: 'Lot Issued' },
  { value: 'discussing_with_toller', label: 'Discussing with Toller' },
  { value: 'supplying_toller', label: 'Supplying Toller' },
  { value: 'in_production', label: 'In Production' },
  { value: 'production_complete', label: 'Production Complete' },
  { value: 'sample_testing', label: 'Sample Testing' },
  { value: 'to_warehousing', label: 'To Warehousing' },
  { value: 'coa_received', label: 'COA Received' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function ProductionPage() {
  const { addToast } = useToast();
  const [batches, setBatches] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [detailBatch, setDetailBatch] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    lot_number: '', product_name: '', order_id: '', customer_id: '',
    toller_supplier_id: '', ingredients_at_toller: false, quantity: '0', unit: 'kg', notes: '',
  });

  const fetchBatches = () => {
    setLoading(true);
    api.get('/production', { params: { page, limit: 20, search, status: filterStatus } })
      .then(res => { setBatches(res.data.data); setTotal(res.data.total); setTotalPages(res.data.totalPages); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBatches(); }, [page, search, filterStatus]);
  useEffect(() => {
    Promise.all([
      api.get('/customers', { params: { limit: 100 } }),
      api.get('/suppliers', { params: { limit: 100 } }),
      api.get('/orders', { params: { limit: 100 } }),
    ]).then(([c, s, o]) => {
      setCustomers(c.data.data || []);
      setSuppliers(s.data.data || []);
      setOrders(o.data.data || []);
    });
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ lot_number: '', product_name: '', order_id: '', customer_id: '', toller_supplier_id: '', ingredients_at_toller: false, quantity: '0', unit: 'kg', notes: '' });
    setShowModal(true);
  };

  const openEdit = (b: any) => {
    setEditing(b);
    setForm({
      lot_number: b.lot_number || '', product_name: b.product_name || '',
      order_id: String(b.order_id || ''), customer_id: String(b.customer_id || ''),
      toller_supplier_id: String(b.toller_supplier_id || ''),
      ingredients_at_toller: !!b.ingredients_at_toller,
      quantity: String(b.quantity ?? 0), unit: b.unit || 'kg', notes: b.notes || '',
    });
    setShowModal(true);
  };

  const openDetail = async (b: any) => {
    setDetailLoading(true);
    setDetailBatch(null);
    try {
      const res = await api.get(`/production/${b.id}`);
      setDetailBatch(res.data);
    } catch { addToast('Failed to load batch details', 'error'); }
    finally { setDetailLoading(false); }
  };

  const handleSave = async () => {
    if (!form.lot_number.trim() || !form.product_name.trim()) { addToast('Lot number and product name are required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/production/${editing.id}`, form);
        addToast('Batch updated', 'success');
      } else {
        await api.post('/production', form);
        addToast('Batch created', 'success');
      }
      setShowModal(false);
      fetchBatches();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/production/${deleteId}`);
      addToast('Batch deleted', 'success');
      fetchBatches();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  const handleStatusChange = async (batchId: number, newStatus: string) => {
    try {
      await api.patch(`/production/${batchId}/status`, { status: newStatus });
      addToast('Status updated', 'success');
      fetchBatches();
      if (detailBatch?.id === batchId) openDetail({ id: batchId });
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update status', 'error');
    }
  };

  const tollers = suppliers.filter((s: any) => s.category === 'blenders');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Production Batches</h1>
        <Button onClick={openCreate}><Plus size={16} /> New Batch</Button>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search batches..." />
            </div>
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              {productionStatuses.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-sm text-gray-500">{total} batches</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : batches.length === 0 ? (
          <EmptyState icon={<Factory size={24} />} title="No production batches" description="Create your first production batch." action={<Button onClick={openCreate} size="sm"><Plus size={14} /> New Batch</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Lot #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Toller</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Qty</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batches.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 font-mono text-xs">{b.lot_number}</td>
                    <td className="px-4 py-3 text-gray-900">{b.product_name}</td>
                    <td className="px-4 py-3 text-gray-600">{b.customer_name || '-'}</td>
                    <td className="px-4 py-3">
                      <select
                        value={b.status}
                        onChange={e => handleStatusChange(b.id, e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                      >
                        {productionStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{b.toller_name || '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{b.quantity} {b.unit}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(b.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openDetail(b)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Eye size={16} /></button>
                        <button onClick={() => openEdit(b)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Pencil size={16} /></button>
                        <button onClick={() => setDeleteId(b.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Batch' : 'New Production Batch'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Lot Number *" value={form.lot_number} onChange={e => setForm({ ...form, lot_number: e.target.value })} />
            <Input label="Product Name *" value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Customer" value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} options={customers.map((c: any) => ({ value: String(c.id), label: c.name }))} placeholder="Select customer..." />
            <Select label="Order" value={form.order_id} onChange={e => setForm({ ...form, order_id: e.target.value })} options={orders.map((o: any) => ({ value: String(o.id), label: o.order_number }))} placeholder="Select order..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Toller (Blender)" value={form.toller_supplier_id} onChange={e => setForm({ ...form, toller_supplier_id: e.target.value })} options={tollers.map((s: any) => ({ value: String(s.id), label: s.name }))} placeholder="Select toller..." />
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.ingredients_at_toller} onChange={e => setForm({ ...form, ingredients_at_toller: e.target.checked })} className="rounded border-gray-300" />
                Ingredients at Toller
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Quantity" type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            <Input label="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={detailBatch !== null || detailLoading} onClose={() => setDetailBatch(null)} title={`Batch: ${detailBatch?.lot_number || '...'}`} size="lg">
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : detailBatch ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Product:</span> <strong>{detailBatch.product_name}</strong></div>
              <div><span className="text-gray-500">Customer:</span> <strong>{detailBatch.customer_name || '-'}</strong></div>
              <div><span className="text-gray-500">Order:</span> <strong>{detailBatch.order_number || '-'}</strong></div>
              <div><span className="text-gray-500">Toller:</span> <strong>{detailBatch.toller_name || '-'}</strong></div>
              <div><span className="text-gray-500">Quantity:</span> <strong>{detailBatch.quantity} {detailBatch.unit}</strong></div>
              <div><span className="text-gray-500">Status:</span> <StatusBadge status={detailBatch.status} /></div>
            </div>
            {detailBatch.notes && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{detailBatch.notes}</p>}

            <div className="border-t border-gray-200 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={16} className="text-gray-400" />
                <h3 className="font-semibold text-gray-900">Status History</h3>
              </div>
              {(!detailBatch.status_history || detailBatch.status_history.length === 0) ? (
                <p className="text-sm text-gray-500">No status changes recorded</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-200" />
                  <div className="space-y-4">
                    {detailBatch.status_history.map((entry: any, idx: number) => (
                      <div key={entry.id || idx} className="relative flex gap-3">
                        <div className="relative z-10 mt-1.5 w-[15px] h-[15px] rounded-full bg-white border-2 border-primary-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {entry.old_status && <StatusBadge status={entry.old_status} />}
                            {entry.old_status && <ArrowRight size={14} className="text-gray-400 shrink-0" />}
                            <StatusBadge status={entry.new_status} />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                            {entry.changed_by_name && <span className="font-medium">{entry.changed_by_name}</span>}
                            <span>{new Date(entry.created_at).toLocaleString()}</span>
                          </div>
                          {entry.notes && <p className="mt-1 text-xs text-gray-500 bg-gray-50 rounded p-2">{entry.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Delete Batch" message="Are you sure you want to delete this production batch?" confirmLabel="Delete" />
    </div>
  );
}
