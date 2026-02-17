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
import Badge from '../components/ui/Badge';
import { Plus, Warehouse, Pencil, Trash2, PackagePlus, PackageMinus } from 'lucide-react';

const categoryOptions = [
  { value: 'raw_material', label: 'Raw Material' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'finished_product', label: 'Finished Product' },
];

const categoryColors: Record<string, 'orange' | 'blue' | 'green'> = {
  raw_material: 'orange',
  packaging: 'blue',
  finished_product: 'green',
};

const categoryLabels: Record<string, string> = {
  raw_material: 'Raw Material',
  packaging: 'Packaging',
  finished_product: 'Finished Product',
};

export default function InventoryPage() {
  const { addToast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '', sku: '', category: 'raw_material', quantity: '0', unit: 'pcs',
    min_stock_level: '0', supplier_id: '', unit_cost: '0', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [adjustModal, setAdjustModal] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const fetchItems = () => {
    setLoading(true);
    api.get('/inventory', { params: { page, limit: 20, search, category: filterCategory } })
      .then(res => { setItems(res.data.data); setTotal(res.data.total); setTotalPages(res.data.totalPages); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, [page, search, filterCategory]);
  useEffect(() => {
    api.get('/suppliers', { params: { limit: 100 } }).then(res => setSuppliers(res.data.data || []));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', sku: '', category: 'raw_material', quantity: '0', unit: 'pcs', min_stock_level: '0', supplier_id: '', unit_cost: '0', notes: '' });
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      name: item.name || '', sku: item.sku || '', category: item.category || 'raw_material',
      quantity: String(item.quantity ?? 0), unit: item.unit || 'pcs',
      min_stock_level: String(item.min_stock_level ?? 0), supplier_id: String(item.supplier_id || ''),
      unit_cost: String(item.unit_cost ?? 0), notes: item.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.sku.trim()) { addToast('Name and SKU are required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/inventory/${editing.id}`, form);
        addToast('Item updated', 'success');
      } else {
        await api.post('/inventory', form);
        addToast('Item created', 'success');
      }
      setShowModal(false);
      fetchItems();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/inventory/${deleteId}`);
      addToast('Item deleted', 'success');
      fetchItems();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  const handleAdjust = async () => {
    if (!adjustModal || !adjustAmount) return;
    try {
      await api.patch(`/inventory/${adjustModal.id}/adjust`, { adjustment: parseFloat(adjustAmount), reason: adjustReason });
      addToast('Stock adjusted', 'success');
      setAdjustModal(null);
      setAdjustAmount('');
      setAdjustReason('');
      fetchItems();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to adjust stock', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <Button onClick={openCreate}><Plus size={16} /> Add Item</Button>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search inventory..." />
            </div>
            <select
              value={filterCategory}
              onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Categories</option>
              {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-sm text-gray-500">{total} items</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Warehouse size={24} />} title="No inventory items" description="Get started by adding your first item." action={<Button onClick={openCreate} size="sm"><Plus size={14} /> Add Item</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Qty</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Min Stock</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Supplier</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Unit Cost</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => {
                  const lowStock = item.quantity < item.min_stock_level;
                  return (
                    <tr key={item.id} className={`hover:bg-gray-50 ${lowStock ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{item.sku}</td>
                      <td className="px-4 py-3"><Badge variant={categoryColors[item.category] || 'gray'}>{categoryLabels[item.category] || item.category}</Badge></td>
                      <td className={`px-4 py-3 text-right font-medium ${lowStock ? 'text-red-600' : 'text-gray-900'}`}>{item.quantity} {item.unit}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{item.min_stock_level} {item.unit}</td>
                      <td className="px-4 py-3 text-gray-600">{item.supplier_name || '-'}</td>
                      <td className="px-4 py-3 text-right text-gray-900">${Number(item.unit_cost).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setAdjustModal(item); setAdjustAmount(''); setAdjustReason(''); }} className="p-1.5 text-gray-400 hover:text-green-600 rounded" title="Adjust stock"><PackagePlus size={16} /></button>
                          <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Pencil size={16} /></button>
                          <button onClick={() => setDeleteId(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Item' : 'New Inventory Item'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Input label="SKU *" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} />
          </div>
          <Select label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={categoryOptions} />
          <div className="grid grid-cols-3 gap-4">
            <Input label="Quantity" type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            <Input label="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
            <Input label="Min Stock Level" type="number" value={form.min_stock_level} onChange={e => setForm({ ...form, min_stock_level: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Supplier"
              value={form.supplier_id}
              onChange={e => setForm({ ...form, supplier_id: e.target.value })}
              options={suppliers.map((s: any) => ({ value: String(s.id), label: s.name }))}
              placeholder="Select supplier..."
            />
            <Input label="Unit Cost ($)" type="number" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} />
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

      <Modal open={adjustModal !== null} onClose={() => setAdjustModal(null)} title={`Adjust Stock: ${adjustModal?.name || ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Current quantity: <strong>{adjustModal?.quantity} {adjustModal?.unit}</strong></p>
          <Input label="Adjustment (+ or -)" type="number" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder="e.g. 10 or -5" />
          <Input label="Reason" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Reason for adjustment" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAdjustModal(null)}>Cancel</Button>
            <Button onClick={handleAdjust} disabled={!adjustAmount}>Adjust</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Delete Item" message="Are you sure you want to delete this inventory item?" confirmLabel="Delete" />
    </div>
  );
}
