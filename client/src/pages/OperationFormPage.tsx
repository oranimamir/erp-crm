import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { ArrowLeft, Upload, Loader2, FileText, X, CheckCircle, Copy, Search } from 'lucide-react';
import { formatDate, todayISO } from '../lib/dates';

const statusOptions = [
  { value: 'pre-ordered',  label: 'Pre-ordered' },
  { value: 'ordered',      label: 'Ordered' },
  { value: 'in production', label: 'In Production' },
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
  /** Copied from an earlier operation (no file) — its number */
  copiedFrom?: string;
}

/** An earlier operation offered as a starting point (`GET /operations/duplicate-sources`). */
interface DuplicateSource {
  id: number; operation_number: string; category: string | null; status: string; created_at: string;
  party: string | null; order_number: string | null; order_date: string | null; products: string | null;
  order_total: number; currency: string | null;
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

  // Automatic number: SO + entity + year + running number (server `GET /operations/next-number`)
  const [entities, setEntities] = useState<Array<{ code: string; company_name: string; is_default: number }>>([]);
  const [entity, setEntity] = useState('');
  const [autoNumber, setAutoNumber] = useState('');
  // True once the user typed a number (or the order carried one) — the automatic one no longer replaces it
  const [ownNumber, setOwnNumber] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [order, setOrder] = useState<PendingOrder | null>(null);

  // ── Start from a previous operation (recurring sales) ────────────────
  const [searchParams] = useSearchParams();
  const [duplicatedFrom, setDuplicatedFrom] = useState<number | null>(null);
  const [sources, setSources] = useState<DuplicateSource[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!pickerOpen || sources) return;
    api.get('/operations/duplicate-sources').then(({ data }) => setSources(data || [])).catch(() => setSources([]));
  }, [pickerOpen, sources]);
  const shownSources = useMemo(() => {
    const term = sourceSearch.trim().toLowerCase();
    const list = sources || [];
    return (term ? list.filter(s => [s.operation_number, s.party, s.order_number, s.products]
      .some(v => String(v || '').toLowerCase().includes(term))) : list).slice(0, 60);
  }, [sources, sourceSearch]);

  useEffect(() => {
    Promise.all([
      api.get('/customers', { params: { limit: 1000 } }),
      api.get('/suppliers', { params: { limit: 1000 } }),
    ]).then(([cRes, sRes]) => {
      setCustomers(cRes.data.data || cRes.data);
      setSuppliers(sRes.data.data || sRes.data);
    });
  }, []);

  useEffect(() => {
    api.get('/company-entities').then(({ data }) => {
      const list = data || [];
      setEntities(list);
      setEntity(prev => prev || (list.find((e: any) => e.is_default) || list[0])?.code || 'BE');
    }).catch(() => setEntity(prev => prev || 'BE'));
  }, []);

  useEffect(() => {
    if (!entity) return;
    api.get('/operations/next-number', { params: { entity } })
      .then(({ data }) => {
        setAutoNumber(data.operation_number);
        if (!ownNumber) setForm(prev => ({ ...prev, operation_number: data.operation_number }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  const useAutomatic = () => { setOwnNumber(false); setForm(prev => ({ ...prev, operation_number: autoNumber })); };

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const setOrderField = (field: keyof PendingOrder, value: string) =>
    setOrder(prev => (prev ? { ...prev, [field]: value } : prev));

  /** Prefills everything from an earlier operation: client, category, entity and its order (lines, prices, terms). */
  const applyDuplicate = async (id: number) => {
    setCopying(true);
    try {
      const { data: op } = await api.get(`/operations/${id}`);
      const code = entities.map(e => e.code).sort((a, b) => b.length - a.length)
        .find(c => String(op.operation_number || '').toUpperCase().startsWith(`SO${c}`));
      if (code) setEntity(code);
      setDuplicatedFrom(op.id);
      setForm(prev => ({
        ...prev,
        category: op.category === 'blending' || op.category === 'trading' ? op.category : prev.category,
        status: 'ordered',
        partyType: op.customer_id ? 'customer' : op.supplier_id ? 'supplier' : prev.partyType,
        customer_id: op.customer_id ? String(op.customer_id) : '',
        supplier_id: op.supplier_id ? String(op.supplier_id) : '',
      }));
      const items: ScannedItem[] = (op.order_items || []).map((i: any) => ({
        description: i.description || '', client_product_name: i.client_product_name || null,
        quantity: Number(i.quantity) || 0, unit: i.unit || 'tons', currency: i.currency || 'USD',
        unit_price: Number(i.unit_price) || 0, packaging: i.packaging || null,
      }));
      setOrder(op.order_id ? {
        fileName: '', copiedFrom: op.operation_number,
        order_number: '', order_date: todayISO(),
        inco_terms: op.inco_terms || '', destination: op.destination || '', transport: op.transport || '',
        delivery_date: '', payment_terms: op.payment_terms || '', notes: '',
        scan_file_path: null, scan_file_name: null, items,
      } : null);
      setPickerOpen(false);
      addToast(op.order_id
        ? `Copied from ${op.operation_number} — enter the client's new order number, check quantities and prices`
        : `Copied from ${op.operation_number} (it has no order to copy)`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not copy that operation', 'error');
    } finally {
      setCopying(false);
    }
  };

  // ?from=<id> (Duplicate on an operation page) starts the copy at once
  const fromParam = Number(searchParams.get('from'));
  const fromApplied = useRef(false);
  useEffect(() => {
    if (fromApplied.current || !fromParam || !entities.length) return;
    fromApplied.current = true;
    applyDuplicate(fromParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParam, entities.length]);

  const setItem = (index: number, field: 'quantity' | 'unit_price', value: string) =>
    setOrder(prev => (prev ? { ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, [field]: value as any } : it)) } : prev));
  const removeItem = (index: number) =>
    setOrder(prev => (prev ? { ...prev, items: prev.items.filter((_, i) => i !== index) } : prev));

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

      // An order that already carries our operation number (SOBE…) keeps it, under its entity
      if (data.operation_number && !ownNumber) {
        setOwnNumber(true);
        const code = entities.map(e => e.code).sort((a, b) => b.length - a.length)
          .find(c => String(data.operation_number).toUpperCase().startsWith(`SO${c}`));
        if (code) setEntity(code);
      }

      // The order is what starts the operation — carry across what it tells us
      setForm(prev => ({
        ...prev,
        operation_number: (!ownNumber && data.operation_number) ? data.operation_number : prev.operation_number,
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
    if (ownNumber ? !form.operation_number.trim() : !entity) {
      addToast(ownNumber ? 'Operation number is required' : 'Choose the entity (BE / NL)', 'error');
      return;
    }
    if (!form.category) {
      addToast('Choose whether this is a blending or a trading operation', 'error');
      return;
    }

    const partyId = form.partyType === 'customer' ? form.customer_id
      : form.partyType === 'supplier' ? form.supplier_id : '';

    if (order) {
      if (!order.order_number.trim()) { addToast(order.copiedFrom ? "Enter the client's new order number" : 'Order number is required', 'error'); return; }
      if (!partyId) { addToast('Select the customer or supplier the order belongs to', 'error'); return; }
      if (!order.items.length) { addToast('No products were read from the order — add the order from the operation page instead', 'error'); return; }
    }

    setSaving(true);
    let operationId: number | null = null;

    try {
      const payload: any = {
        // The automatic number is allocated by the server at creation, so two people can't take the same one
        operation_number: ownNumber ? form.operation_number.trim() : '',
        entity,
        status: form.status,
        category: form.category,
        notes: form.notes || null,
        ...(duplicatedFrom ? { duplicated_from: duplicatedFrom } : {}),
      };
      if (form.partyType === 'customer' && form.customer_id) payload.customer_id = Number(form.customer_id);
      if (form.partyType === 'supplier' && form.supplier_id) payload.supplier_id = Number(form.supplier_id);

      const { data } = await api.post('/operations', payload);
      operationId = data.id;
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to create operation', 'error');
      if (err.response?.data?.suggested) { setOwnNumber(false); setAutoNumber(err.response.data.suggested); set('operation_number', err.response.data.suggested); }
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
          notes:         order.notes || (order.copiedFrom ? `Copied from ${order.copiedFrom}` : null),
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
        Upload the client's order to start the operation — choose BE or NL and the number is given automatically — or create it now and add the order from its page.
      </p>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Start from a previous operation ─────────────────────────── */}
          <div className="rounded-xl border border-primary-100 bg-primary-50/40 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Copy size={16} className="text-primary-600" />
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-semibold text-gray-900">Recurring sale? Start from a previous operation</p>
                <p className="text-xs text-gray-500">
                  {duplicatedFrom && order?.copiedFrom
                    ? <>Copied from <strong>{order.copiedFrom}</strong> — client, category, products, prices and terms are filled in; the order confirmation and invoice will reuse its wording.</>
                    : 'Copies the client, category, products, quantities, prices and terms — and later the OC / invoice wording.'}
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(v => !v)} disabled={copying}>
                {copying ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                {duplicatedFrom ? 'Choose another' : 'Choose operation'}
              </Button>
            </div>
            {pickerOpen && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-white">
                <div className="relative border-b border-gray-100 p-2">
                  <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input autoFocus value={sourceSearch} onChange={e => setSourceSearch(e.target.value)}
                    placeholder="Search by operation, client, order or product…"
                    className="w-full rounded-md border border-gray-200 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {!sources ? (
                    <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-primary-600" /></div>
                  ) : shownSources.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-gray-400">No operation matches.</p>
                  ) : shownSources.map(src => (
                    <button key={src.id} type="button" onClick={() => applyDuplicate(src.id)}
                      className={`flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-primary-50/60 ${duplicatedFrom === src.id ? 'bg-primary-50' : ''}`}>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{src.operation_number}</span>
                          <span className="text-sm text-gray-700">{src.party || '—'}</span>
                          {src.category && (
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${src.category === 'blending' ? 'bg-purple-50 text-purple-700' : 'bg-sky-50 text-sky-700'}`}>
                              {src.category === 'blending' ? 'Blending' : 'Trading'}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {src.products || 'No order lines'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-gray-500">
                        {src.order_number && <span className="block">Order {src.order_number}</span>}
                        <span className="block">{formatDate(src.order_date || src.created_at)}</span>
                        {src.order_total > 0 && <span className="block font-medium text-gray-700">{Number(src.order_total).toLocaleString('en-US', { maximumFractionDigits: 0 })} {src.currency}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

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
                  <span className="text-sm text-green-900 font-medium flex-1 truncate">
                    {order.copiedFrom ? `Order copied from ${order.copiedFrom} — upload the client's new order to replace it, or adjust below` : order.fileName}
                  </span>
                  {order.copiedFrom && (
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="rounded px-2 py-0.5 text-xs font-medium text-green-800 hover:bg-green-100">Upload new order</button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setOrder(null); setDuplicatedFrom(null); }}
                    className="p-1 rounded text-green-700 hover:bg-green-100"
                    title="Remove the order"
                  >
                    <X size={15} />
                  </button>
                </div>

                <input ref={order.copiedFrom ? fileInputRef : undefined} type="file" accept={ACCEPTED} className="hidden"
                  onChange={e => handleFile(e.target.files?.[0] || null)} />
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    <Input
                      label="Delivery Date"
                      type="date"
                      value={/^\d{4}-\d{2}-\d{2}$/.test(order.delivery_date) ? order.delivery_date : ''}
                      onChange={e => setOrderField('delivery_date', e.target.value)}
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
                              <td className="px-3 py-2 text-gray-800">
                                <span className="flex items-center gap-1.5">
                                  {order.items.length > 1 && (
                                    <button type="button" onClick={() => removeItem(i)} title="Remove this line"
                                      className="p-0.5 rounded text-gray-300 hover:text-red-600"><X size={13} /></button>
                                  )}
                                  {item.description || '—'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">
                                <input type="number" step="any" value={item.quantity} onChange={e => setItem(i, 'quantity', e.target.value)}
                                  className="w-24 rounded border border-gray-200 px-1.5 py-0.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /> {item.unit}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">
                                <input type="number" step="any" value={item.unit_price} onChange={e => setItem(i, 'unit_price', e.target.value)}
                                  className="w-24 rounded border border-gray-200 px-1.5 py-0.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /> {item.currency}
                              </td>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-gray-100">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Entity *</label>
              <div className="flex gap-2">
                {(entities.length ? entities.map(e => e.code) : ['BE', 'NL']).map(code => (
                  <button key={code} type="button" onClick={() => setEntity(code)}
                    title={entities.find(e => e.code === code)?.company_name}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      entity === code ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {code}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Input
                label="Operation Number *"
                value={form.operation_number}
                onChange={e => { setOwnNumber(true); set('operation_number', e.target.value); }}
                placeholder={autoNumber || 'SOBE20260001'}
              />
              <p className="text-xs text-gray-500">
                {ownNumber
                  ? <>Your own number. {autoNumber && <button type="button" onClick={useAutomatic} className="text-primary-600 hover:underline">Use automatic ({autoNumber})</button>}</>
                  : 'Automatic — next number for this entity and year (taken when you create it). Type to use your own.'}
              </p>
            </div>
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
