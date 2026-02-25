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
import { Plus, Warehouse, Pencil, Trash2, PackagePlus, FileSpreadsheet, Package, Box } from 'lucide-react';
import { downloadExcel } from '../lib/exportExcel';

// ─── Inventory Tab ────────────────────────────────────────────────────────────

const unitOptions = [
  { value: 'tons', label: 'tons' },
  { value: 'kg', label: 'kg' },
  { value: 'L', label: 'L' },
  { value: 'pcs', label: 'pcs' },
  { value: 'boxes', label: 'boxes' },
];

const categoryColor = (cat: string): 'blue' | 'green' | 'gray' => {
  if (cat === 'Circulac') return 'blue';
  if (cat === 'Naturlac') return 'green';
  return 'gray';
};

function InventoryTab() {
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
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [form, setForm] = useState({
    name: '', sku: '', category: '', quantity: '0', unit: 'tons',
    min_stock_level: '0', supplier_id: '', notes: '',
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
    api.get('/products', { params: { limit: 1000 } }).then(res => setProducts(res.data.data || [])).catch(() => {});
  }, []);

  const applyProduct = (pid: string, prev: typeof form) => {
    const p = products.find((x: any) => String(x.id) === pid);
    if (!p) return prev;
    return { ...prev, name: p.name, sku: p.sku, category: p.category };
  };

  const openCreate = () => {
    setEditing(null);
    setSelectedProduct('');
    setForm({ name: '', sku: '', category: '', quantity: '0', unit: 'tons', min_stock_level: '0', supplier_id: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    const matched = products.find((p: any) => p.sku === item.sku);
    setSelectedProduct(matched ? String(matched.id) : '');
    setForm({
      name: item.name || '', sku: item.sku || '', category: item.category || '',
      quantity: String(item.quantity ?? 0), unit: item.unit || 'tons',
      min_stock_level: String(item.min_stock_level ?? 0), supplier_id: String(item.supplier_id || ''),
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!editing && !selectedProduct) { addToast('Please select a product', 'error'); return; }
    if (!form.name.trim()) { addToast('A product must be selected', 'error'); return; }
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

  const selectedProductData = products.find((p: any) => String(p.id) === selectedProduct);

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={async () => {
          const res = await api.get('/inventory', { params: { page: 1, limit: 9999, search, category: filterCategory } });
          downloadExcel('inventory', ['Product', 'SKU', 'Category', 'Quantity', 'Unit', 'Min Stock', 'Supplier'],
            res.data.data.map((item: any) => [item.name, item.sku || '', item.category || '', item.quantity, item.unit, item.min_stock_level, item.supplier_name || '']));
        }}><FileSpreadsheet size={16} /> Export Excel</Button>
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
              <option value="Circulac">Circulac</option>
              <option value="Naturlac">Naturlac</option>
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Qty</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Min Stock</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Supplier</th>
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
                      <td className="px-4 py-3"><Badge variant={categoryColor(item.category)}>{item.category || '-'}</Badge></td>
                      <td className={`px-4 py-3 text-right font-medium ${lowStock ? 'text-red-600' : 'text-gray-900'}`}>{item.quantity} {item.unit}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{item.min_stock_level} {item.unit}</td>
                      <td className="px-4 py-3 text-gray-600">{item.supplier_name || '-'}</td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Inventory Item' : 'New Inventory Item'} size="lg">
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Product *</label>
            <select
              value={selectedProduct}
              onChange={e => {
                const pid = e.target.value;
                setSelectedProduct(pid);
                setForm(prev => applyProduct(pid, prev));
              }}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">— Select a product —</option>
              {products.map((p: any) => (
                <option key={p.id} value={String(p.id)}>{p.name} ({p.sku})</option>
              ))}
            </select>
            {products.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No products found. Add products in the Products tab first.</p>
            )}
          </div>

          {selectedProductData && (
            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg text-sm">
              <span className="font-medium text-gray-900">{selectedProductData.name}</span>
              <span className="text-gray-500">SKU: <span className="font-mono">{selectedProductData.sku}</span></span>
              <Badge variant={categoryColor(selectedProductData.category)}>{selectedProductData.category}</Badge>
            </div>
          )}
          {!selectedProduct && editing && form.name && (
            <div className="p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
              Current item: <strong>{form.name}</strong> (SKU: {form.sku}) — select a product above to re-link
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <Input label="Quantity" type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            <Select label="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} options={unitOptions} />
            <Input label="Min Stock Level" type="number" value={form.min_stock_level} onChange={e => setForm({ ...form, min_stock_level: e.target.value })} />
          </div>

          <Select
            label="Supplier"
            value={form.supplier_id}
            onChange={e => setForm({ ...form, supplier_id: e.target.value })}
            options={suppliers.map((s: any) => ({ value: String(s.id), label: s.name }))}
            placeholder="Select supplier..."
          />

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
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

// ─── Products Tab ─────────────────────────────────────────────────────────────

const categoryOptions = [
  { value: 'Circulac', label: 'Circulac' },
  { value: 'Naturlac', label: 'Naturlac' },
];

const categoryColors: Record<string, 'blue' | 'green' | 'gray'> = {
  Circulac: 'blue',
  Naturlac: 'green',
};

const emptyProductForm = { name: '', sku: '', category: 'Circulac', notes: '' };

function ProductsTab() {
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
  const [form, setForm] = useState({ ...emptyProductForm });
  const [saving, setSaving] = useState(false);

  const fetchItems = () => {
    setLoading(true);
    api.get('/products', { params: { page, limit: 20, search, category: filterCategory } })
      .then(res => {
        setItems(res.data.data);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, [page, search, filterCategory]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyProductForm });
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      name: item.name || '',
      sku: item.sku || '',
      category: item.category || 'Circulac',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.sku.trim()) {
      addToast('Name and SKU are required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/products/${editing.id}`, form);
        addToast('Product updated', 'success');
      } else {
        await api.post('/products', form);
        addToast('Product created', 'success');
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
      await api.delete(`/products/${deleteId}`);
      addToast('Product deleted', 'success');
      fetchItems();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus size={16} /> Add Product</Button>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search products..." />
            </div>
            <select
              value={filterCategory}
              onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Categories</option>
              {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-sm text-gray-500">{total} products</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Package size={24} />}
            title="No products"
            description="Get started by adding your first product."
            action={<Button onClick={openCreate} size="sm"><Plus size={14} /> Add Product</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Notes</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{item.sku}</td>
                    <td className="px-4 py-3">
                      <Badge variant={categoryColors[item.category] || 'gray'}>
                        {item.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[250px] truncate">{item.notes || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Pencil size={16} /></button>
                        <button onClick={() => setDeleteId(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Product' : 'New Product'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Input label="SKU *" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} />
          </div>
          <Select label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={categoryOptions} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Optional notes..."
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
        title="Delete Product"
        message="Are you sure you want to delete this product?"
        confirmLabel="Delete"
      />
    </div>
  );
}

// ─── Packaging Tab ────────────────────────────────────────────────────────────

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

const emptyPackagingForm: PackagingForm = {
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

function PackagingTab() {
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
  const [form, setForm] = useState<PackagingForm>({ ...emptyPackagingForm });
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
    setForm({ ...emptyPackagingForm });
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
      <div className="flex justify-end">
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

// ─── Main Page ────────────────────────────────────────────────────────────────

type InventoryTabId = 'inventory' | 'products' | 'packaging';

const tabs: { id: InventoryTabId; label: string }[] = [
  { id: 'inventory', label: 'Stock' },
  { id: 'products', label: 'Products' },
  { id: 'packaging', label: 'Packaging' },
];

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<InventoryTabId>('inventory');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'inventory' && <InventoryTab />}
      {activeTab === 'products' && <ProductsTab />}
      {activeTab === 'packaging' && <PackagingTab />}
    </div>
  );
}
