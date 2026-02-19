import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import FileUpload from '../components/ui/FileUpload';
import { ArrowLeft, Plus, X, Loader2 } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────
interface OrderItem {
  productId: string;
  description: string;          // TripleW catalog name
  client_product_name: string;  // Name as written in client's order
  quantity: number;
  unit: string;
  currency: string;
  unit_price: number;
  packaging: string;
}

// ── Options ───────────────────────────────────────────────────────────────
const typeOptions = [
  { value: 'customer', label: 'Customer Order' },
  { value: 'supplier', label: 'Supplier Order' },
];

const unitOptions = [
  { value: 'tons', label: 'MT (metric tons)' },
  { value: 'kg',   label: 'kg' },
  { value: 'lbs',  label: 'lbs' },
];

const currencyOptions = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

const incoTermOptions = [
  { value: '', label: '— Select Incoterm —' },
  { value: 'EXW', label: 'EXW – Ex Works' },
  { value: 'FCA', label: 'FCA – Free Carrier' },
  { value: 'FAS', label: 'FAS – Free Alongside Ship' },
  { value: 'FOB', label: 'FOB – Free on Board' },
  { value: 'CFR', label: 'CFR – Cost and Freight' },
  { value: 'CIF', label: 'CIF – Cost, Insurance & Freight' },
  { value: 'CPT', label: 'CPT – Carriage Paid To' },
  { value: 'CIP', label: 'CIP – Carriage & Insurance Paid To' },
  { value: 'DAP', label: 'DAP – Delivered at Place' },
  { value: 'DPU', label: 'DPU – Delivered at Place Unloaded' },
  { value: 'DDP', label: 'DDP – Delivered Duty Paid' },
];

const transportOptions = [
  { value: '', label: '— Select Transport —' },
  { value: 'Sea',        label: 'Sea' },
  { value: 'Air',        label: 'Air' },
  { value: 'Road',       label: 'Road' },
  { value: 'Rail',       label: 'Rail' },
  { value: 'Multimodal', label: 'Multimodal' },
];

// ── Helpers ───────────────────────────────────────────────────────────────
function toMetricTons(quantity: number, unit: string): string {
  if (!quantity) return '0';
  let mt: number;
  if (unit === 'kg') mt = quantity / 1000;
  else if (unit === 'lbs') mt = quantity / 2204.623;
  else mt = quantity;
  return mt.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const emptyItem = (): OrderItem => ({
  productId: '', description: '', client_product_name: '',
  quantity: 1, unit: 'tons', currency: 'USD', unit_price: 0, packaging: '',
});

// ── Component ─────────────────────────────────────────────────────────────
export default function OrderFormPage() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { addToast } = useToast();
  const isEditing   = Boolean(id);

  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [scanning,     setScanning]     = useState(false);
  const [scanFilePath, setScanFilePath] = useState<string | null>(null);
  const [scanFileName, setScanFileName] = useState<string | null>(null);

  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products,  setProducts]  = useState<any[]>([]);

  // ── Form state ───────────────────────────────────────────────────────
  const [form, setForm] = useState({
    operation_number: '',
    order_number:  '',
    order_date:    new Date().toISOString().slice(0, 10),
    type:          'customer',
    customer_id:   '',
    supplier_id:   '',
    // Shipping & terms
    inco_terms:    '',
    destination:   '',
    transport:     '',
    delivery_date: '',
    payment_terms: '',
    // Extra
    description:   '',
    notes:         '',
  });

  const [items, setItems] = useState<OrderItem[]>([emptyItem()]);

  // ── Load reference data ──────────────────────────────────────────────
  useEffect(() => {
    Promise.allSettled([
      api.get('/customers', { params: { limit: 1000 } }),
      api.get('/suppliers', { params: { limit: 1000 } }),
      api.get('/products',  { params: { limit: 1000 } }),
    ]).then(([cRes, sRes, pRes]) => {
      if (cRes.status === 'fulfilled') setCustomers(cRes.value.data.data || []);
      if (sRes.status === 'fulfilled') setSuppliers(sRes.value.data.data || []);
      if (pRes.status === 'fulfilled') setProducts(pRes.value.data.data  || []);
    });
  }, []);

  // ── Load existing order (edit mode) ─────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/orders/${id}`)
      .then(res => {
        const o = res.data;
        setForm({
          operation_number: o.operation_number || '',
          order_number:  o.order_number  || '',
          order_date:    o.order_date    || new Date().toISOString().slice(0, 10),
          type:          o.type          || 'customer',
          customer_id:   o.customer_id   ? String(o.customer_id)  : '',
          supplier_id:   o.supplier_id   ? String(o.supplier_id)  : '',
          inco_terms:    o.inco_terms    || '',
          destination:   o.destination   || '',
          transport:     o.transport     || '',
          delivery_date: o.delivery_date || '',
          payment_terms: o.payment_terms || '',
          description:   o.description   || '',
          notes:         o.notes         || '',
        });
        if (o.items?.length > 0) {
          setItems(o.items.map((item: any) => ({
            productId:           '',
            description:         item.description         || '',
            client_product_name: item.client_product_name || '',
            quantity:            item.quantity  ?? 1,
            unit:                item.unit      || 'tons',
            currency:            item.currency  || 'USD',
            unit_price:          item.unit_price ?? 0,
            packaging:           item.packaging  || '',
          })));
        }
      })
      .catch(() => { addToast('Failed to load order', 'error'); navigate('/orders'); })
      .finally(() => setLoading(false));
  }, [id]);

  // ── Field helpers ────────────────────────────────────────────────────
  const updateField = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const updateItem = (index: number, field: keyof OrderItem, value: string | number) =>
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));

  const selectProduct = (index: number, productId: string) => {
    const product = products.find(p => String(p.id) === productId);
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return { ...item, productId, description: product ? product.name : '' };
    }));
  };

  const addItem    = () => setItems(prev => [...prev, emptyItem()]);
  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const itemTotal  = (item: OrderItem) => (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
  const grandTotal = useMemo(() => items.reduce((sum, item) => sum + itemTotal(item), 0), [items]);

  // ── AI Scan ──────────────────────────────────────────────────────────
  const handleScanFile = async (file: File | null) => {
    if (!file) return;
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await api.post('/orders/scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const data = res.data;

      // Auto-fill header fields (only if not already filled)
      setForm(prev => ({
        ...prev,
        operation_number: data.operation_number || prev.operation_number,
        order_number:  data.order_number  || prev.order_number,
        order_date:    data.order_date    || prev.order_date,
        inco_terms:    data.inco_terms    || prev.inco_terms,
        destination:   data.destination   || prev.destination,
        transport:     data.transport     || prev.transport,
        delivery_date: data.delivery_date || prev.delivery_date,
        payment_terms: data.payment_terms || prev.payment_terms,
        notes:         data.notes         || prev.notes,
        ...(data.type === 'customer' && data.customer_id ? { type: 'customer', customer_id: String(data.customer_id) } : {}),
        ...(data.type === 'supplier' && data.supplier_id ? { type: 'supplier', supplier_id: String(data.supplier_id) } : {}),
      }));

      if (data.items?.length > 0) {
        setItems(data.items.map((item: any) => ({
          productId:           item.product_id ? String(item.product_id) : '',
          description:         item.description         || '',
          client_product_name: item.client_product_name || '',
          quantity:            item.quantity  || 1,
          unit:                item.unit      || 'tons',
          currency:            item.currency  || 'USD',
          unit_price:          item.unit_price || 0,
          packaging:           item.packaging  || '',
        })));
      }

      if (data.scan_file_path) setScanFilePath(data.scan_file_path);
      if (data.scan_file_name) setScanFileName(data.scan_file_name);
      addToast('Order scanned — please review and confirm all fields', 'success');
    } catch (err: any) {
      const detail = err.response?.data?.error || '';
      const msg = detail.toLowerCase().includes('credit balance')
        ? 'AI scanning unavailable: Anthropic API credits depleted.'
        : detail || 'Could not auto-scan. Fill in fields manually.';
      addToast(msg, 'info');
    } finally {
      setScanning(false);
    }
  };

  // ── Submit ───────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.order_number.trim())                        { addToast('Order number is required', 'error'); return; }
    if (form.type === 'customer' && !form.customer_id)    { addToast('Please select a customer', 'error'); return; }
    if (form.type === 'supplier' && !form.supplier_id)    { addToast('Please select a supplier', 'error'); return; }
    if (!items.some(item => item.description.trim()))     { addToast('Please select at least one product', 'error'); return; }

    setSaving(true);
    try {
      const payload = {
        operation_number: form.operation_number || null,
        order_number:  form.order_number,
        order_date:    form.order_date    || null,
        type:          form.type,
        customer_id:   form.type === 'customer' ? Number(form.customer_id) : null,
        supplier_id:   form.type === 'supplier' ? Number(form.supplier_id) : null,
        inco_terms:    form.inco_terms    || null,
        destination:   form.destination   || null,
        transport:     form.transport     || null,
        delivery_date: form.delivery_date || null,
        payment_terms: form.payment_terms || null,
        description:   form.description,
        notes:         form.notes,
        file_path:     scanFilePath || null,
        file_name:     scanFileName || null,
        items: items
          .filter(item => item.description.trim())
          .map(item => ({
            description:         item.description,
            client_product_name: item.client_product_name || null,
            quantity:            Number(item.quantity)   || 0,
            unit:                item.unit,
            currency:            item.currency,
            unit_price:          Number(item.unit_price) || 0,
            packaging:           item.packaging || null,
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

  // ── Field label helper ────────────────────────────────────────────────
  const Label = ({ children }: { children: string }) => (
    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{children}</label>
  );

  const textArea = (field: string, value: string, placeholder?: string, rows = 2) => (
    <textarea
      value={value}
      onChange={e => updateField(field, e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
    />
  );

  return (
    <div className="space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Back to Orders
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">{isEditing ? 'Edit Order' : 'New Order'}</h1>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── AI Scan ─────────────────────────────────────────────────── */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Auto-fill from Order Document</h2>
          <p className="text-xs text-gray-500 mb-3">
            Upload your customer's order (PDF or image). The AI will extract all fields below and auto-fill them — review and adjust before saving.
          </p>
          <FileUpload onFileSelect={handleScanFile} />
          {scanning && (
            <div className="flex items-center gap-2 text-sm text-primary-600 mt-2">
              <Loader2 size={16} className="animate-spin" />
              Scanning with AI — extracting all fields…
            </div>
          )}
        </Card>

        {/* ── Order Details ────────────────────────────────────────────── */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Order Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Input label="Operation #" value={form.operation_number}
              onChange={e => updateField('operation_number', e.target.value)} placeholder="e.g. OP-2026-001" />
            <Input label="Order Number *" value={form.order_number}
              onChange={e => updateField('order_number', e.target.value)} placeholder="e.g. ORD-001" />
            <Input label="Date of Order" type="date" value={form.order_date}
              onChange={e => updateField('order_date', e.target.value)} />
            <Select label="Type *" value={form.type}
              onChange={e => { updateField('type', e.target.value); updateField('customer_id', ''); updateField('supplier_id', ''); }}
              options={typeOptions} />
            {form.type === 'customer' ? (
              <Select label="Customer *" value={form.customer_id}
                onChange={e => updateField('customer_id', e.target.value)}
                options={customers.map(c => ({ value: String(c.id), label: c.name }))}
                placeholder="Select a customer..." />
            ) : (
              <Select label="Supplier *" value={form.supplier_id}
                onChange={e => updateField('supplier_id', e.target.value)}
                options={suppliers.map(s => ({ value: String(s.id), label: s.name }))}
                placeholder="Select a supplier..." />
            )}
          </div>
        </Card>

        {/* ── Shipping & Terms ─────────────────────────────────────────── */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Shipping &amp; Terms</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Label>Inco Terms</Label>
              <select
                value={form.inco_terms}
                onChange={e => updateField('inco_terms', e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {incoTermOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <Input label="Destination" value={form.destination}
              onChange={e => updateField('destination', e.target.value)} placeholder="e.g. Port of Rotterdam" />
            <div>
              <Label>Transport</Label>
              <select
                value={form.transport}
                onChange={e => updateField('transport', e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <Input label="Delivery Date" type="date" value={form.delivery_date}
              onChange={e => updateField('delivery_date', e.target.value)} />
            <Input label="Payment Terms" value={form.payment_terms}
              onChange={e => updateField('payment_terms', e.target.value)} placeholder="e.g. Net 30, 30% advance" />
          </div>
        </Card>

        {/* ── Order Items ──────────────────────────────────────────────── */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Order Items</h2>
            <Button type="button" variant="secondary" size="sm" onClick={addItem}>
              <Plus size={14} /> Add Item
            </Button>
          </div>

          <div className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {/* TripleW catalog product */}
                  <div className="space-y-1">
                    <Label>TripleW Product *</Label>
                    <select
                      value={item.productId}
                      onChange={e => selectProduct(index, e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">— Select product —</option>
                      {products.map((p: any) => (
                        <option key={p.id} value={String(p.id)}>{p.name} ({p.sku})</option>
                      ))}
                    </select>
                    {!item.productId && item.description && (
                      <p className="text-xs text-amber-600">Scanned: "{item.description}" — please confirm above</p>
                    )}
                  </div>

                  {/* Client's product name */}
                  <div className="space-y-1">
                    <Label>Product name as per client's order</Label>
                    <input
                      type="text"
                      value={item.client_product_name}
                      onChange={e => updateItem(index, 'client_product_name', e.target.value)}
                      placeholder="Name used in customer's order document"
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                {/* Packaging */}
                <div className="space-y-1">
                  <Label>Packaging</Label>
                  <input
                    type="text"
                    value={item.packaging}
                    onChange={e => updateItem(index, 'packaging', e.target.value)}
                    placeholder="e.g. 25kg bags, bulk, drums..."
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                {/* Qty / Unit / MT / Price / Currency / Total / Remove */}
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1">
                    <Label>Quantity</Label>
                    <input type="number" min="0" step="any" value={item.quantity}
                      onChange={e => updateItem(index, 'quantity', Number(e.target.value))}
                      className="block w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="space-y-1">
                    <Label>Unit</Label>
                    <select value={item.unit} onChange={e => updateItem(index, 'unit', e.target.value)}
                      className="block rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      {unitOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>= Metric Tons</Label>
                    <div className="flex items-center h-[38px] px-3 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 min-w-[90px]">
                      {toMetricTons(Number(item.quantity), item.unit)} MT
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Unit Price</Label>
                    <div className="flex gap-1">
                      <input type="number" min="0" step="0.01" value={item.unit_price}
                        onChange={e => updateItem(index, 'unit_price', Number(e.target.value))}
                        className="block w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      <select value={item.currency} onChange={e => updateItem(index, 'currency', e.target.value)}
                        className="block rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                        {currencyOptions.map(o => <option key={o.value} value={o.value}>{o.value}/unit</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Total</Label>
                    <div className="flex items-center h-[38px] px-3 rounded-lg bg-white border border-gray-200 text-sm font-semibold text-gray-900 min-w-[100px]">
                      {item.currency === 'EUR' ? '€' : '$'}{itemTotal(item).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <button type="button" onClick={() => removeItem(index)} disabled={items.length <= 1}
                    className="p-2 text-gray-400 hover:text-red-600 rounded disabled:opacity-30 self-end">
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-end gap-4">
            <span className="text-sm font-medium text-gray-600">Grand Total:</span>
            <span className="text-lg font-bold text-gray-900">
              ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </Card>

        {/* ── Notes ────────────────────────────────────────────────────── */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Additional Information</h2>
          <div className="space-y-3">
            <div>
              <Label>Description</Label>
              {textArea('description', form.description, 'Brief order description...')}
            </div>
            <div>
              <Label>Internal Notes</Label>
              {textArea('notes', form.notes, 'Internal notes...')}
            </div>
          </div>
        </Card>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <Link to="/orders"><Button type="button" variant="secondary">Cancel</Button></Link>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Update Order' : 'Create Order'}
          </Button>
        </div>
      </form>
    </div>
  );
}
