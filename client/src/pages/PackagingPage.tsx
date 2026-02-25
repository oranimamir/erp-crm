import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Plus, Box, Pencil, Trash2 } from 'lucide-react';

interface PackagingForm {
  type: string;
  product_mass: string;
  product: string[];
  code: string;
  units_per_pallet: string;
  pallet_label_code: string;
  weight_per_pallet: string;
  weight_packaging: string;
  weight_pallet: string;
  gross_weight: string;
  compatible: string;
  notes: string;
}

const emptyForm: PackagingForm = {
  type: '',
  product_mass: '',
  product: [],
  code: '',
  units_per_pallet: '',
  pallet_label_code: '',
  weight_per_pallet: '',
  weight_packaging: '',
  weight_pallet: '',
  gross_weight: '',
  compatible: 'Food',
  notes: '',
};

export default function PackagingPage() {
  const { addToast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<PackagingForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    api.get('/products', { params: { limit: 500 } })
      .then(res => setProducts(res.data.data || []))
      .catch(() => {});
  }, []);

  const fetchItems = () => {
    setLoading(true);
    api.get('/packaging', { params: { page, limit: 50, search } })
      .then(res => {
        setItems(res.data.data);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, [page, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      type: item.type || '',
      product_mass: item.product_mass ?? '',
      product: item.product ? item.product.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      code: item.code || '',
      units_per_pallet: item.units_per_pallet ?? '',
      pallet_label_code: item.pallet_label_code || '',
      weight_per_pallet: item.weight_per_pallet ?? '',
      weight_packaging: item.weight_packaging ?? '',
      weight_pallet: item.weight_pallet ?? '',
      gross_weight: item.gross_weight ?? '',
      compatible: item.compatible || 'Food',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.type.trim() || !form.code.trim()) {
      addToast('Type and Packaging Code are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        product: form.product.join(', '),
        product_mass: form.product_mass !== '' ? Number(form.product_mass) : null,
        units_per_pallet: form.units_per_pallet !== '' ? Number(form.units_per_pallet) : null,
        weight_per_pallet: form.weight_per_pallet !== '' ? Number(form.weight_per_pallet) : null,
        weight_packaging: form.weight_packaging !== '' ? Number(form.weight_packaging) : null,
        weight_pallet: form.weight_pallet !== '' ? Number(form.weight_pallet) : null,
        gross_weight: form.gross_weight !== '' ? Number(form.gross_weight) : null,
      };
      if (editing) {
        await api.put(`/packaging/${editing.id}`, payload);
        addToast('Packaging updated', 'success');
      } else {
        await api.post('/packaging', payload);
        addToast('Packaging created', 'success');
      }
      setShowModal(false);
      fetchItems();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/packaging/${deleteId}`);
      addToast('Packaging deleted', 'success');
      fetchItems();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Packaging</h1>
        <Button onClick={openCreate}><Plus size={16} /> Add Packaging</Button>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search by type, product or code..." />
            </div>
            <span className="text-sm text-gray-500">{total} packaging type{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Box size={24} />}
            title="No packaging types"
            description="Add your first packaging type."
            action={<Button onClick={openCreate} size="sm"><Plus size={14} /> Add Packaging</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-3 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-right px-3 py-3 font-medium text-gray-600">Product mass</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-600">Product</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-600">Packaging code</th>
                  <th className="text-right px-3 py-3 font-medium text-gray-600"># per pal</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-600">Code on pallet label</th>
                  <th className="text-right px-3 py-3 font-medium text-gray-600">Product weight per pal</th>
                  <th className="text-right px-3 py-3 font-medium text-gray-600">Weight packaging</th>
                  <th className="text-right px-3 py-3 font-medium text-gray-600">Weight pallet</th>
                  <th className="text-right px-3 py-3 font-medium text-gray-600">Gross weight</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-600">Compatible</th>
                  <th className="text-right px-3 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{item.type}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmt(item.product_mass, 3)}</td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[160px] truncate">{item.product || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700 font-mono text-xs">{item.code}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{item.units_per_pallet ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{item.pallet_label_code || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmt(item.weight_per_pallet)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmt(item.weight_packaging)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmt(item.weight_pallet)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700 font-medium">{fmt(item.gross_weight)}</td>
                    <td className="px-3 py-2.5">
                      {item.compatible ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {item.compatible}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Pencil size={15} /></button>
                        <button onClick={() => setDeleteId(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={15} /></button>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Packaging' : 'New Packaging'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Type *" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="e.g. 15l short blue pails" />
            <Input label="Product mass" type="number" value={form.product_mass} onChange={e => setForm({ ...form, product_mass: e.target.value })} placeholder="e.g. 18" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Product
                {form.product.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-primary-600">{form.product.length} selected</span>
                )}
              </label>
              <select
                multiple
                value={form.product}
                onChange={e => {
                  const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                  setForm({ ...form, product: selected });
                }}
                size={Math.min(products.length + 1, 8)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {products.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400">Hold Ctrl / Cmd to select multiple</p>
            </div>
            <Input label="Packaging code *" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. PU18" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="# per pal" type="number" value={form.units_per_pallet} onChange={e => setForm({ ...form, units_per_pallet: e.target.value })} placeholder="e.g. 32" />
            <Input label="Code on pallet label" value={form.pallet_label_code} onChange={e => setForm({ ...form, pallet_label_code: e.target.value })} placeholder="e.g. PU18032" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Product weight per pal" type="number" value={form.weight_per_pallet} onChange={e => setForm({ ...form, weight_per_pallet: e.target.value })} />
            <Input label="Weight packaging" type="number" value={form.weight_packaging} onChange={e => setForm({ ...form, weight_packaging: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Weight pallet" type="number" value={form.weight_pallet} onChange={e => setForm({ ...form, weight_pallet: e.target.value })} />
            <Input label="Gross weight" type="number" value={form.gross_weight} onChange={e => setForm({ ...form, gross_weight: e.target.value })} />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Compatible</label>
              <input
                value={form.compatible}
                onChange={e => setForm({ ...form, compatible: e.target.value })}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="e.g. Food"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <input
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Optional notes"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Packaging"
        message="Are you sure you want to delete this packaging type?"
        confirmLabel="Delete"
      />
    </div>
  );
}
