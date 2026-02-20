import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
import Badge from '../components/ui/Badge';
import { Plus, Truck, Eye, Pencil, Trash2, BarChart3, FileSpreadsheet } from 'lucide-react';
import { downloadExcel } from '../lib/exportExcel';

const CHART_COLORS = [
  'bg-purple-500', 'bg-blue-500', 'bg-orange-400', 'bg-teal-500',
  'bg-red-400', 'bg-green-500', 'bg-pink-400', 'bg-indigo-500',
];
const DOT_COLORS = [
  'bg-purple-500', 'bg-blue-500', 'bg-orange-400', 'bg-teal-500',
  'bg-red-400', 'bg-green-500', 'bg-pink-400', 'bg-indigo-500',
];

const categoryOptions = [
  { value: 'logistics', label: 'Logistics' },
  { value: 'blenders', label: 'Blenders' },
  { value: 'raw_materials', label: 'Raw Materials' },
  { value: 'shipping', label: 'Shipping' },
];

const categoryColors: Record<string, 'blue' | 'purple' | 'orange' | 'green'> = {
  logistics: 'blue', blenders: 'purple', raw_materials: 'orange', shipping: 'green',
};

const categoryLabels: Record<string, string> = {
  logistics: 'Logistics', blenders: 'Blenders', raw_materials: 'Raw Materials', shipping: 'Shipping',
};

export default function SuppliersPage() {
  const { addToast } = useToast();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', category: 'logistics', notes: '' });
  const [saving, setSaving] = useState(false);
  const [paymentData, setPaymentData] = useState<any[]>([]);

  const fetchSuppliers = () => {
    setLoading(true);
    api.get('/suppliers', { params: { page, limit: 20, search, category: categoryFilter } })
      .then(res => { setSuppliers(res.data.data); setTotal(res.data.total); setTotalPages(res.data.totalPages); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSuppliers(); }, [page, search, categoryFilter]);

  useEffect(() => {
    api.get('/dashboard/supplier-payments').then(r => setPaymentData(r.data)).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', address: '', category: 'logistics', notes: '' });
    setShowModal(true);
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setForm({ name: s.name || '', email: s.email || '', phone: s.phone || '', address: s.address || '', category: s.category, notes: s.notes || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { addToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/suppliers/${editing.id}`, form);
        addToast('Supplier updated', 'success');
      } else {
        await api.post('/suppliers', form);
        addToast('Supplier created', 'success');
      }
      setShowModal(false);
      fetchSuppliers();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/suppliers/${deleteId}`);
      addToast('Supplier deleted', 'success');
      fetchSuppliers();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={async () => {
            const res = await api.get('/suppliers', { params: { page: 1, limit: 9999, search, category: categoryFilter } });
            downloadExcel('suppliers', ['Name', 'Category', 'Email', 'Phone', 'Address', 'Notes'],
              res.data.data.map((s: any) => [s.name, s.category || '', s.email || '', s.phone || '', s.address || '', s.notes || '']));
          }}><FileSpreadsheet size={16} /> Export Excel</Button>
          <Button onClick={openCreate}><Plus size={16} /> Add Supplier</Button>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search suppliers..." />
            </div>
            <select
              value={categoryFilter}
              onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Categories</option>
              {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-sm text-gray-500">{total} suppliers</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : suppliers.length === 0 ? (
          <EmptyState icon={<Truck size={24} />} title="No suppliers found" description="Add your first supplier." action={<Button onClick={openCreate} size="sm"><Plus size={14} /> Add Supplier</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {suppliers.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-4 py-3"><Badge variant={categoryColors[s.category] || 'gray'}>{categoryLabels[s.category] || s.category}</Badge></td>
                    <td className="px-4 py-3 text-gray-600">{s.email || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.phone || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/suppliers/${s.id}`} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Eye size={16} /></Link>
                        <button onClick={() => openEdit(s)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Pencil size={16} /></button>
                        <button onClick={() => setDeleteId(s.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Supplier' : 'New Supplier'} size="lg">
        <div className="space-y-4">
          <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Select label="Category *" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={categoryOptions} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <Input label="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
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

      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Delete Supplier" message="Are you sure you want to delete this supplier?" confirmLabel="Delete" />

      {/* Supplier Payments Chart */}
      {(() => {
        const months = [...new Set(paymentData.map((d: any) => d.month))].sort() as string[];
        const names = [...new Set(paymentData.map((d: any) => d.supplier_name))] as string[];
        if (months.length === 0) return null;
        const lookup: Record<string, Record<string, number>> = {};
        paymentData.forEach((d: any) => {
          if (!lookup[d.month]) lookup[d.month] = {};
          lookup[d.month][d.supplier_name] = d.total;
        });
        const monthTotals = months.map(m => Object.values(lookup[m] || {}).reduce((s: number, v: any) => s + v, 0));
        const maxTotal = Math.max(...monthTotals, 1);
        return (
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <BarChart3 size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Payments to Suppliers (Last 6 Months)</h2>
            </div>
            <div className="p-5">
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mb-4">
                {names.map((name, i) => (
                  <span key={name} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`w-3 h-3 rounded ${DOT_COLORS[i % DOT_COLORS.length]}`} />
                    {name}
                  </span>
                ))}
              </div>
              {/* Stacked bar chart */}
              <div className="flex items-end gap-2" style={{ height: '200px' }}>
                {months.map(m => {
                  const monthData = lookup[m] || {};
                  const monthTotal = monthTotals[months.indexOf(m)];
                  return (
                    <div key={m} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <span className="text-xs text-gray-500 font-medium mb-1">
                        ${monthTotal > 0 ? (monthTotal >= 1000 ? `${(monthTotal/1000).toFixed(0)}k` : monthTotal.toFixed(0)) : ''}
                      </span>
                      <div
                        className="w-full flex flex-col-reverse rounded-t overflow-hidden"
                        style={{ height: `${Math.max((monthTotal / maxTotal) * 155, monthTotal > 0 ? 4 : 0)}px` }}
                      >
                        {names.map((name, i) => {
                          const val = monthData[name] || 0;
                          const pct = monthTotal > 0 ? (val / monthTotal) * 100 : 0;
                          return pct > 0 ? (
                            <div
                              key={name}
                              className={`w-full ${CHART_COLORS[i % CHART_COLORS.length]}`}
                              style={{ height: `${pct}%` }}
                              title={`${name}: $${val.toLocaleString()}`}
                            />
                          ) : null;
                        })}
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">
                        {new Date(m + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
