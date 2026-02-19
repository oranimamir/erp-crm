import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { ArrowLeft, Plus, X } from 'lucide-react';

interface OrderItem {
  productId: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
}

const typeOptions = [
  { value: 'customer', label: 'Customer Order' },
  { value: 'supplier', label: 'Supplier Order' },
];

const unitOptions = [
  { value: 'tons', label: 'MT (metric tons)' },
  { value: 'kg', label: 'kg' },
  { value: 'lbs', label: 'lbs' },
];

function toMetricTons(quantity: number, unit: string): string {
  if (!quantity) return '0';
  let mt: number;
  if (unit === 'kg') mt = quantity / 1000;
  else if (unit === 'lbs') mt = quantity / 2204.623;
  else mt = quantity;
  return mt.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const emptyItem = (): OrderItem => ({ productId: '', description: '', quantity: 1, unit: 'tons', unit_price: 0 });

export default function OrderFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isEditing = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [form, setForm] = useState({
    order_number: '',
    type: 'customer',
    customer_id: '',
    supplier_id: '',
    description: '',
    notes: '',
  });

  const [items, setItems] = useState<OrderItem[]>([emptyItem()]);

  useEffect(() => {
    Promise.all([
      api.get('/customers', { params: { limit: 1000 } }),
      api.get('/suppliers', { params: { limit: 1000 } }),
      api.get('/products', { params: { limit: 1000 } }),
    ]).then(([cRes, sRes, pRes]) => {
      setCustomers(cRes.data.data || []);
      setSuppliers(sRes.data.data || []);
      setProducts(pRes.data.data || []);
    }).catch(() => {
      // products may not exist yet, still load customers/suppliers
      Promise.all([
        api.get('/customers', { params: { limit: 1000 } }),
        api.get('/suppliers', { params: { limit: 1000 } }),
      ]).then(([cRes, sRes]) => {
        setCustomers(cRes.data.data || []);
        setSuppliers(sRes.data.data || []);
      });
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/orders/${id}`)
      .then(res => {
        const o = res.data;
        setForm({
          order_number: o.order_number || '',
          type: o.type || 'customer',
          customer_id: o.customer_id ? String(o.customer_id) : '',
          supplier_id: o.supplier_id ? String(o.supplier_id) : '',
          description: o.description || '',
          notes: o.notes || '',
        });
        if (o.items && o.items.length > 0) {
          setItems(o.items.map((item: any) => ({
            productId: '',
            description: item.description || '',
            quantity: item.quantity ?? 1,
            unit: item.unit || 'tons',
            unit_price: item.unit_price ?? 0,
          })));
        }
      })
      .catch(() => {
        addToast('Failed to load order', 'error');
        navigate('/orders');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const updateItem = (index: number, field: keyof OrderItem, value: string | number) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const selectProduct = (index: number, productId: string) => {
    const product = products.find(p => String(p.id) === productId);
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return {
        ...item,
        productId,
        description: product ? product.name : item.description,
        unit: product ? product.unit : item.unit,
      };
    }));
  };

  const addItem = () => setItems(prev => [...prev, emptyItem()]);

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const itemTotal = (item: OrderItem) => (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);

  const grandTotal = useMemo(() => items.reduce((sum, item) => sum + itemTotal(item), 0), [items]);

  const formatCurrency = (amount: number) =>
    `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.order_number.trim()) { addToast('Order number is required', 'error'); return; }
    if (form.type === 'customer' && !form.customer_id) { addToast('Please select a customer', 'error'); return; }
    if (form.type === 'supplier' && !form.supplier_id) { addToast('Please select a supplier', 'error'); return; }
    if (!items.some(item => item.description.trim())) {
      addToast('Please add at least one line item with a description', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        order_number: form.order_number,
        type: form.type,
        customer_id: form.type === 'customer' ? Number(form.customer_id) : null,
        supplier_id: form.type === 'supplier' ? Number(form.supplier_id) : null,
        description: form.description,
        notes: form.notes,
        items: items
          .filter(item => item.description.trim())
          .map(item => ({
            description: item.description,
            quantity: Number(item.quantity) || 0,
            unit: item.unit,
            unit_price: Number(item.unit_price) || 0,
          })),
      };

      if (isEditing) {
        await api.put(`/orders/${id}`, payload);
        addToast('Order updated', 'success');
      } else {
        await api.post('/orders', payload);
        addToast('Order created', 'success');
      }
      navigate('/orders');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save order', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Back to Orders
      </Link>

      <h1 className="text-2xl font-bold text-gray-900">
        {isEditing ? 'Edit Order' : 'New Order'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Order Details */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Order Number *"
              value={form.order_number}
              onChange={e => updateField('order_number', e.target.value)}
              placeholder="e.g. ORD-001"
            />
            <Select
              label="Type *"
              value={form.type}
              onChange={e => {
                updateField('type', e.target.value);
                updateField('customer_id', '');
                updateField('supplier_id', '');
              }}
              options={typeOptions}
            />
            {form.type === 'customer' ? (
              <Select
                label="Customer *"
                value={form.customer_id}
                onChange={e => updateField('customer_id', e.target.value)}
                options={customers.map(c => ({ value: String(c.id), label: c.name }))}
                placeholder="Select a customer..."
              />
            ) : (
              <Select
                label="Supplier *"
                value={form.supplier_id}
                onChange={e => updateField('supplier_id', e.target.value)}
                options={suppliers.map(s => ({ value: String(s.id), label: s.name }))}
                placeholder="Select a supplier..."
              />
            )}
          </div>
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                rows={2}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Order description..."
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => updateField('notes', e.target.value)}
                rows={2}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Internal notes..."
              />
            </div>
          </div>
        </Card>

        {/* Order Items */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Order Items</h2>
            <Button type="button" variant="secondary" size="sm" onClick={addItem}>
              <Plus size={14} /> Add Item
            </Button>
          </div>

          <div className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                {/* Row 1: Product selector + Description */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {products.length > 0 && (
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Product (optional)</label>
                      <select
                        value={item.productId}
                        onChange={e => selectProduct(index, e.target.value)}
                        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">Select product to auto-fill...</option>
                        {products.map((p: any) => (
                          <option key={p.id} value={String(p.id)}>{p.name} ({p.sku})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Description *</label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={e => updateItem(index, 'description', e.target.value)}
                      placeholder="Item description..."
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                {/* Row 2: Qty, Unit, MT, Unit Price, Total, Remove */}
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Quantity</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.quantity}
                      onChange={e => updateItem(index, 'quantity', Number(e.target.value))}
                      className="block w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Unit</label>
                    <select
                      value={item.unit}
                      onChange={e => updateItem(index, 'unit', e.target.value)}
                      className="block rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {unitOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">= Metric Tons</label>
                    <div className="flex items-center h-[38px] px-3 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 min-w-[80px]">
                      {toMetricTons(Number(item.quantity), item.unit)} MT
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Unit Price ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={e => updateItem(index, 'unit_price', Number(e.target.value))}
                      className="block w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Total</label>
                    <div className="flex items-center h-[38px] px-3 rounded-lg bg-white border border-gray-200 text-sm font-semibold text-gray-900 min-w-[100px]">
                      {formatCurrency(itemTotal(item))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    disabled={items.length <= 1}
                    className="p-2 text-gray-400 hover:text-red-600 rounded disabled:opacity-30 disabled:cursor-not-allowed self-end"
                    title="Remove item"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Grand Total */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-end gap-4">
            <span className="text-sm font-medium text-gray-600">Grand Total:</span>
            <span className="text-lg font-bold text-gray-900">{formatCurrency(grandTotal)}</span>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Link to="/orders">
            <Button type="button" variant="secondary">Cancel</Button>
          </Link>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Update Order' : 'Create Order'}
          </Button>
        </div>
      </form>
    </div>
  );
}
