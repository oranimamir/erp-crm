import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { ArrowLeft, Upload, Loader2, FileText, X, CheckCircle } from 'lucide-react';

const statusOptions = [
  { value: 'pre-ordered',  label: 'Pre-ordered' },
  { value: 'ordered',      label: 'Ordered' },
  { value: 'shipped',      label: 'Shipped' },
  { value: 'in clearance', label: 'In Clearance' },
  { value: 'delivered',    label: 'Delivered' },
];

const partyTypeOptions = [
  { value: 'none',     label: '— None (assign later) —' },
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
];

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp';

interface ScannedItem {
  product_id?: number | null;
  description: string;
  client_product_name?: string | null;
  quantity: number;
  unit: string;
  currency: string;
  unit_price: number;
  packaging?: string | null;
}

/** The order pulled off the uploaded document, held until the operation exists. */
interface PendingOrder {
  fileName: string;
  order_number: string;
  order_date: string;
  inco_terms: string;
  destination: string;
  transport: string;
  delivery_date: string;
  payment_terms: string;
  notes: string;
  scan_file_path: string | null;
  scan_file_name: string | null;
  items: ScannedItem[];
}

export default function OperationFormPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  const [form, setForm] = useState({
    operation_number: '',
    status: 'pre-ordered',
    category: '' as '' | 'blending' | 'trading',
    partyType: 'none',
    customer_id: '',
    supplier_id: '',
    notes: '',
  });

  const [scanning, setScanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [order, setOrder] = useState<PendingOrder | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/customers', { params: { limit: 1000 } }),
      api.get('/suppliers', { params: { limit: 1000 } }),
    ]).then(([cRes, sRes]) => {
      setCustomers(cRes.data.data || cRes.data);
      setSuppliers(sRes.data.data || sRes.data);
    });
  }, []);

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const setOrderField = (field: keyof PendingOrder, value: string) =>
    setOrder(prev => (prev ? { ...prev, [field]: value } : prev));

  // ── Upload + scan the client's order ──────────────────────────────────
  const handleFile = async (file: File | null) => {
    if (!file) return;
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/orders/scan', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setOrder({
        fileName: file.name,
        order_number:  data.order_number  || '',
        order_date:    data.order_date    || '',
        inco_terms:    data.inco_terms    || '',
        destination:   data.destination   || '',
        transport:     data.transport     || '',
        delivery_date: data.delivery_date || '',
        payment_terms: data.payment_terms || '',
        notes:         data.notes         || '',
        scan_file_path: data.scan_file_path || null,
        scan_file_name: data.scan_file_name || null,
        items: Array.isArray(data.items) ? data.items : [],
      });

      // The order is what starts the operation — carry across what it tells us
      setForm(prev => ({
        ...prev,
        operation_number: prev.operation_number || data.operation_number || '',
        status: prev.status === 'pre-ordered' ? 'ordered' : prev.status,
        ...(data.type === 'customer' && data.customer_id
          ? { partyType: 'customer', customer_id: String(data.customer_id) } : {}),
        ...(data.type === 'supplier' && data.supplier_id
          ? { partyType: 'supplier', supplier_id: String(data.supplier_id) } : {}),
      }));

      if (data.customer_or_supplier_name && !data.customer_id && !data.supplier_id) {
        addToast(`"${data.customer_or_supplier_name}" is not in your customer list — pick the party below.`, 'info');
      } else {
        addToast('Order read from the document — please review before creating', 'success');
      }
    } catch (err: any) {
      const detail = err.response?.data?.error || '';
      addToast(
        detail.toLowerCase().includes('credit balance')
          ? 'AI scanning unavailable: Anthropic API credits depleted. Create the operation and add the order from its page.'
          : detail || 'Could not read the document. Create the operation and add the order from its page.',
        'info'
      );
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files?.[0] || null);
  }

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.operation_number.trim()) {
      addToast('Operation number is required', 'error');
      return;
    }
    if (!form.category) {
      addToast('Choose whether this is a blending or a trading operation', 'error');
      return;
    }

    const partyId = form.partyType === 'customer' ? form.customer_id
      : form.partyType === 'supplier' ? form.supplier_id : '';

    if (order) {
      if (!order.order_number.trim()) { addToast('Order number is required', 'error'); return; }
      if (!partyId) { addToast('Select the customer or supplier the order belongs to', 'error'); return; }
      if (!order.items.length) { addToast('No products were read from the order — add the order from the operation page instead', 'error'); return; }
    }

    setSaving(true);
    let operationId: number | null = null;

    try {
      const payload: any = {
        operation_number: form.operation_number.trim(),
        status: form.status,
        category: form.category,
        notes: form.notes || null,
      };
      if (form.partyType === 'customer' && form.customer_id) payload.customer_id = Number(form.customer_id);
      if (form.partyType === 'supplier' && form.supplier_id) payload.supplier_id = Number(form.supplier_id);

      const { data } = await api.post('/operations', payload);
      operationId = data.id;
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to create operation', 'error');
      setSaving(false);
      return;
    }

    // Operation exists from here on — an order failure must not strand the user
    if (order) {
      try {
        await api.post('/orders', {
          link_operation_id: operationId,
          order_number:  order.order_number.trim(),
          order_date:    order.order_date    || null,
          type:          form.partyType,
          customer_id:   form.partyType === 'customer' ? Number(form.customer_id) : null,
          supplier_id:   form.partyType === 'supplier' ? Number(form.supplier_id) : null,
          inco_terms:    order.inco_terms    || null,
          destination:   order.destination   || null,
          transport:     order.transport     || null,
          delivery_date: order.delivery_date || null,
          payment_terms: order.payment_terms || null,
          notes:         order.notes         || null,
          file_path:     order.scan_file_path,
          file_name:     order.scan_file_name,
          items: order.items.map(item => ({
            description:         item.description,
            client_product_name: item.client_product_name || null,
            quantity:            Number(item.quantity)   || 0,
            unit:                item.unit     || 'tons',
            currency:            item.currency || 'USD',
            unit_price:          Number(item.unit_price) || 0,
            packaging:           item.packaging || null,
          })),
        });
        addToast('Operation created with its order', 'success');
      } catch (err: any) {
        addToast(
          `Operation created, but the order failed: ${err.response?.data?.error || 'unknown error'}. Add it from the operation page.`,
          'error'
        );
      }
    } else {
      addToast('Operation created', 'success');
    }

    setSaving(false);
    navigate(`/operations/${operationId}`);
  };

  const itemsTotal = order?.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0) ?? 0;
  const itemsCurrency = order?.items[0]?.currency || 'USD';

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/operations')}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} /> Back to Operations
      </button>

      <h1 className="text-2xl font-bold text-gray-900">New Operation</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Upload the client's order to start the operation, or create it now and link an order later.
      </p>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Client order ───────────────────────────────────────────── */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Client Order (optional)</label>

            {!order ? (
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                onDrop={onDrop}
                onClick={() => !scanning && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-7 cursor-pointer transition-colors ${
                  isDragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                {scanning ? (
                  <>
                    <Loader2 size={22} className="text-primary-500 animate-spin" />
                    <p className="text-sm font-medium text-gray-600">Reading the order…</p>
                  </>
                ) : (
                  <>
                    <Upload size={22} className={isDragging ? 'text-primary-500' : 'text-gray-400'} />
                    <p className="text-sm font-medium text-gray-600">
                      {isDragging ? 'Drop the order here' : 'Drag & drop the order, or click to browse'}
                    </p>
                    <p className="text-xs text-gray-400">PDF, JPEG, PNG, WebP · the details are read automatically</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={e => handleFile(e.target.files?.[0] || null)}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-green-200 bg-green-50/50 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-green-200 bg-green-50">
                  <CheckCircle size={15} className="text-green-600 flex-shrink-0" />
                  <span className="text-sm text-green-900 font-medium flex-1 truncate">{order.fileName}</span>
                  <button
                    type="button"
                    onClick={() => setOrder(null)}
                    className="p-1 rounded text-green-700 hover:bg-green-100"
                    title="Remove the order"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Order Number *"
                      value={order.order_number}
                      onChange={e => setOrderField('order_number', e.target.value)}
                      placeholder="e.g. CF261205"
                    />
                    <Input
                      label="Order Date"
                      type="date"
                      value={order.order_date}
                      onChange={e => setOrderField('order_date', e.target.value)}
                    />
                  </div>

                  {order.items.length > 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Qty</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Unit Price</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {order.items.map((item, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 text-gray-800">{item.description || '—'}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{item.quantity} {item.unit}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{item.unit_price} {item.currency}</td>
                              <td className="px-3 py-2 text-right font-medium text-gray-900">
                                {((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })} {item.currency}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50">
                          <tr>
                            <td colSpan={3} className="px-3 py-2 text-right font-semibold text-gray-700">Total</td>
                            <td className="px-3 py-2 text-right font-bold text-gray-900">
                              {itemsTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} {itemsCurrency}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      No products were read from this document. Create the operation, then add the order from its page.
                    </p>
                  )}

                  {(order.inco_terms || order.destination || order.delivery_date || order.payment_terms) && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      {order.inco_terms    && <div><p className="text-xs text-gray-500">Inco Terms</p><p className="text-gray-800">{order.inco_terms}</p></div>}
                      {order.destination   && <div><p className="text-xs text-gray-500">Destination</p><p className="text-gray-800">{order.destination}</p></div>}
                      {order.delivery_date && <div><p className="text-xs text-gray-500">Delivery Date</p><p className="text-gray-800">{order.delivery_date}</p></div>}
                      {order.payment_terms && <div><p className="text-xs text-gray-500">Payment Terms</p><p className="text-gray-800">{order.payment_terms}</p></div>}
                    </div>
                  )}

                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    <FileText size={12} /> Everything else can be edited on the order once the operation exists.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Operation ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <Input
              label="Operation Number *"
              value={form.operation_number}
              onChange={e => set('operation_number', e.target.value)}
              placeholder="e.g. OP-2024-001"
              autoFocus
            />
            <Select
              label="Status"
              value={form.status}
              onChange={e => set('status', e.target.value)}
              options={statusOptions}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Category *</label>
            <div className="flex gap-2">
              {(['blending', 'trading'] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('category', c)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    form.category === c
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {c === 'blending' ? 'Blending' : 'Trading'}
                </button>
              ))}
            </div>
            {form.category === 'trading' && (
              <p className="text-xs text-gray-500">Trading operations can generate a supplier purchase order from the order.</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label={order ? 'Party Type *' : 'Party Type'}
              value={form.partyType}
              onChange={e => set('partyType', e.target.value)}
              options={partyTypeOptions}
            />
            {form.partyType === 'customer' && (
              <Select
                label="Customer"
                value={form.customer_id}
                onChange={e => set('customer_id', e.target.value)}
                options={customers.map(c => ({ value: String(c.id), label: c.name }))}
                placeholder="Select customer..."
              />
            )}
            {form.partyType === 'supplier' && (
              <Select
                label="Supplier"
                value={form.supplier_id}
                onChange={e => set('supplier_id', e.target.value)}
                options={suppliers.map(s => ({ value: String(s.id), label: s.name }))}
                placeholder="Select supplier..."
              />
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Optional notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" type="button" onClick={() => navigate('/operations')}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || scanning}>
              {saving ? 'Creating...' : order ? 'Create Operation & Order' : 'Create Operation'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
