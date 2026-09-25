import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { acceptPlaceholderOnTab } from '../lib/placeholderTab';
import OrderCompareModal from '../components/OrderCompareModal';
import { useCompanyEntities } from '../lib/useCompanyEntities';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';
import {
  ArrowLeft, Plus, Trash2, Loader2, Eye, X, FileDown, Mail,
  CheckCircle, FileText, RefreshCw, Building2, Package, Truck, AlertTriangle, Columns2,
} from 'lucide-react';

// Supplier purchase order for a trading operation — the order confirmation's
// form, addressed to the supplier, with purchase prices typed in by hand.

// ── Types ─────────────────────────────────────────────────────────────────

interface PoLine {
  line: number;
  reference: string;
  commercial_name: string;
  packaging: string;
  quantity: string;
  quantity_unit: string;
  unit_price: string;
  currency: string;
  hs_code: string;
  description: string;
}

interface PoData {
  po_number: string;
  po_date: string;
  sq_number: string;
  our_ref: string;
  client_code: string;
  client_name: string;
  billing_address: string;
  client_phone: string;
  tax_id: string;
  contact_email: string;
  items: PoLine[];
  delivery: string;
  delivery_address: string;
  delivery_contact: string;
  delivery_date_text: string;
  freight: string;
  vat: string;
  terms: string;
  [key: string]: unknown; // issuer constants ride along untouched
}

interface PurchaseOrder {
  id: number;
  po_number: string;
  order_id: number;
  operation_id: number | null;
  supplier_id: number | null;
  file_name: string | null;
  sent_to: string | null;
  sent_at: string | null;
  data: Partial<PoData>;
}

/** Supplier categories, the trading ones (listed by default) first. */
const SUPPLIER_GROUPS = [
  { key: 'raw_materials', label: 'Raw materials', trading: true },
  { key: 'blenders', label: 'Blenders', trading: true },
  { key: 'logistics', label: 'Logistics', trading: false },
  { key: 'shipping', label: 'Shipping', trading: false },
  { key: 'other', label: 'Other', trading: false },
];

const UNITS = ['KG', 'TONS', 'MT', 'LBS', 'L', 'PAIL', 'DRUM', 'IBC'];
const CURRENCIES = ['EUR', 'USD', 'GBP'];

const FORM_KEYS = [
  'po_number', 'po_date', 'sq_number', 'our_ref', 'client_code',
  'client_name', 'billing_address', 'client_phone', 'tax_id', 'contact_email',
  'delivery', 'delivery_address', 'delivery_contact', 'delivery_date_text',
  'freight', 'vat', 'terms',
] as const;

const emptyLine = (n: number): PoLine => ({
  line: n, reference: '', commercial_name: '', packaging: '',
  quantity: '', quantity_unit: 'KG', unit_price: '', currency: 'EUR',
  hs_code: '', description: '',
});

const blankData = (): PoData => ({
  po_number: '', po_date: new Date().toISOString().slice(0, 10),
  sq_number: '', our_ref: '', client_code: '',
  client_name: '', billing_address: '', client_phone: '', tax_id: '', contact_email: '',
  items: [emptyLine(1)],
  delivery: '', delivery_address: '', delivery_contact: '', delivery_date_text: '',
  freight: '0', vat: '0', terms: '',
});

function toFormData(raw: any): PoData {
  const merged: any = { ...blankData(), ...(raw || {}) };
  for (const key of FORM_KEYS) {
    merged[key] = merged[key] == null ? (blankData() as any)[key] : String(merged[key]);
  }
  const items = Array.isArray(raw?.items) && raw.items.length ? raw.items : [emptyLine(1)];
  merged.items = items.map((item: any, index: number) => ({
    ...emptyLine(index + 1),
    line: item?.line ?? index + 1,
    reference: item?.reference ?? '',
    commercial_name: item?.commercial_name ?? '',
    packaging: item?.packaging ?? '',
    quantity: item?.quantity == null ? '' : String(item.quantity),
    quantity_unit: item?.quantity_unit || 'KG',
    unit_price: item?.unit_price == null ? '' : String(item.unit_price),
    currency: item?.currency || 'EUR',
    hs_code: item?.hs_code ?? '',
    description: item?.description ?? '',
  }));
  return merged as PoData;
}

function toPayload(form: PoData) {
  return {
    ...form,
    freight: Number(form.freight) || 0,
    vat: Number(form.vat) || 0,
    items: form.items.map((item, index) => ({
      ...item,
      line: index + 1,
      quantity: item.quantity === '' ? 0 : Number(item.quantity),
      unit_price: item.unit_price === '' ? null : Number(item.unit_price),
    })),
  };
}

const lineTotal = (item: PoLine) => (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

// ── Field primitives ──────────────────────────────────────────────────────

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function Field({ label, value, onChange, placeholder, type = 'text', className = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => acceptPlaceholderOnTab(e, value, placeholder, onChange)} className={inputCls} />
    </div>
  );
}

function AreaField({ label, value, onChange, placeholder, rows = 2, className = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; rows?: number; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <textarea value={value} rows={rows} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => acceptPlaceholderOnTab(e, value, placeholder, onChange)} className={inputCls} />
    </div>
  );
}

function Section({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const orderIdParam = params.get('order_id');
  const operationIdParam = params.get('operation_id');

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PoData>(blankData());
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [orderId, setOrderId] = useState<number | null>(orderIdParam ? Number(orderIdParam) : null);
  const [operationId, setOperationId] = useState<number | null>(operationIdParam ? Number(operationIdParam) : null);
  const [operationNumber, setOperationNumber] = useState('');
  const [entity, setEntity] = useState<string>('BE');
  const entities = useCompanyEntities();
  const [suppliers, setSuppliers] = useState<Array<{ id: number; name: string; category?: string }>>([]);
  // Trading goods are bought from raw-material suppliers and blenders
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  const [supplierId, setSupplierId] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [showEmail, setShowEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sending, setSending] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const setItem = (index: number, patch: Partial<PoLine>) =>
    setForm(prev => ({ ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));

  const addItem = () =>
    setForm(prev => ({ ...prev, items: [...prev.items, emptyLine(prev.items.length + 1)] }));

  const removeItem = (index: number) =>
    setForm(prev => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }));

  const adopt = useCallback((record: PurchaseOrder) => {
    setPurchaseOrder(record);
    setForm(toFormData(record.data));
    setOrderId(record.order_id);
    setOperationId(record.operation_id);
    setSupplierId(record.supplier_id ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (id) {
          const { data } = await api.get(`/purchase-orders/${id}`);
          if (cancelled) return;
          adopt(data);
          setSuppliers(data.suppliers || []);
          return;
        }
        if (!orderIdParam) {
          addToast('No order selected', 'error');
          navigate('/operations');
          return;
        }
        const { data } = await api.get('/purchase-orders/prepare', {
          params: { order_id: orderIdParam, operation_id: operationIdParam || undefined },
        });
        if (cancelled) return;
        setSuppliers(data.suppliers || []);
        if (data.existing) {
          adopt(data.existing);
          addToast('A purchase order already exists for this order — opening it for editing', 'info');
        } else {
          setForm(toFormData(data.draft));
          setEntity(data.entity);
          setSupplierId(data.supplier_id ?? null);
          if (data.operation) {
            setOperationId(data.operation.id);
            setOperationNumber(data.operation.operation_number);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          addToast(err.response?.data?.error || 'Failed to load the purchase order', 'error');
          navigate('/operations');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, orderIdParam]);

  useEffect(() => {
    if (!showEmail) return;
    setEmailTo(prev => prev || form.contact_email || '');
    setEmailSubject(prev => prev || `Purchase Order ${form.po_number}`);
  }, [showEmail]);

  // ── Actions ─────────────────────────────────────────────────────────────

  /** Re-fetch the draft for another entity; the lines typed so far are kept. */
  async function reDraft(nextEntity: string) {
    if (purchaseOrder) { addToast('Already generated — edit the fields directly', 'info'); return; }
    try {
      const { data } = await api.get('/purchase-orders/prepare', {
        params: { order_id: orderIdParam || orderId, operation_id: operationId || undefined, entity: nextEntity, supplier_id: supplierId || undefined },
      });
      if (data.draft) {
        const fresh = toFormData(data.draft);
        setForm(prev => ({ ...fresh, ...pickSupplierAndLines(prev) }));
        setEntity(data.entity);
      }
    } catch {
      addToast('Failed to reload the draft', 'error');
    }
  }

  /** Fill the supplier block from the chosen supplier. */
  async function chooseSupplier(nextId: number | null) {
    setSupplierId(nextId);
    if (!nextId) return;
    try {
      const { data } = await api.get(`/suppliers/${nextId}`);
      setForm(prev => ({
        ...prev,
        client_name: data.name || '',
        billing_address: data.address || '',
        client_phone: data.phone || '',
        contact_email: data.email || '',
        tax_id: data.vat_number || prev.tax_id,
      }));
      const missing = [!data.address && 'address', !data.phone && 'phone', !data.email && 'email'].filter(Boolean);
      addToast(
        missing.length
          ? `${data.name} added — no ${missing.join(', ')} on file in Suppliers; fill in below if needed`
          : `${data.name}'s details added to the purchase order`,
        missing.length ? 'info' : 'success',
      );
    } catch {
      addToast('Failed to load the supplier', 'error');
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await api.post('/purchase-orders/preview', { data: toPayload(form) }, { responseType: 'blob' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
    } catch {
      addToast('Failed to render the preview', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    if (!orderId) { addToast('No order linked', 'error'); return; }
    if (!form.client_name.trim()) { addToast('Choose the supplier first', 'error'); return; }
    setSaving(true);
    try {
      const body = { order_id: orderId, operation_id: operationId, supplier_id: supplierId, data: toPayload(form) };
      const { data } = purchaseOrder
        ? await api.put(`/purchase-orders/${purchaseOrder.id}`, body)
        : await api.post('/purchase-orders', body);
      adopt(data);
      addToast(`Generated ${data.file_name}${operationId ? ' — filed under the operation documents' : ''}`, 'success');
      if (!purchaseOrder) navigate(`/purchase-orders/${data.id}`, { replace: true });
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to generate the purchase order', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (!purchaseOrder) return;
    try {
      const res = await api.get(`/purchase-orders/${purchaseOrder.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = purchaseOrder.file_name || `${form.po_number}PO.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  async function handleSend() {
    if (!purchaseOrder) return;
    if (!emailTo.trim()) { addToast('Enter at least one recipient', 'error'); return; }
    setSending(true);
    try {
      const { data } = await api.post(`/purchase-orders/${purchaseOrder.id}/email`, {
        to: emailTo, subject: emailSubject, message: emailMessage,
      });
      setPurchaseOrder(data.purchase_order);
      addToast(data.message, 'success');
      setShowEmail(false);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to send the email', 'error');
    } finally {
      setSending(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" size={24} /></div>;
  }

  const subtotal = form.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const freight = Number(form.freight) || 0;
  const vat = Number(form.vat) || 0;
  const currency = form.items.find(i => i.currency)?.currency || 'EUR';
  const unpriced = form.items.filter(i => i.unit_price === '' || Number(i.unit_price) === 0).length;

  const backTo = operationId ? `/operations/${operationId}` : '/operations';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> Back to operation
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handlePreview} disabled={previewing}>
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setComparing(true)} disabled={!orderId}
            title="Show the customer's order side by side with this document">
            <Columns2 size={14} /> Compare with order
          </Button>
          {comparing && orderId && (
            <OrderCompareModal
              orderId={orderId}
              title="Purchase order"
              renderPreview={async () => (await api.post('/purchase-orders/preview', { data: toPayload(form) }, { responseType: 'blob' })).data as Blob}
              onClose={() => setComparing(false)}
            />
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {purchaseOrder ? 'Confirm & regenerate' : 'Confirm & generate'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownload} disabled={!purchaseOrder}>
            <FileDown size={14} /> Download PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowEmail(true)} disabled={!purchaseOrder}>
            <Mail size={14} /> Send by email
          </Button>
        </div>
      </div>

      {/* Issuing entity */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Issuing entity</span>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {entities.map(e => (
            <button
              key={e.code}
              onClick={() => reDraft(e.code)}
              disabled={!!purchaseOrder}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-60 ${
                (purchaseOrder ? (form.entity_code || entity) : entity) === e.code
                  ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {e.company_name} ({e.code})
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">from the operation number</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Supplier Purchase Order</h1>
        <p className="text-sm text-gray-500 mt-1">
          Built from the customer's order. Enter the purchase prices, then confirm to produce the PDF. It is saved as{' '}
          <strong className="text-gray-700">
            {(operationNumber || form.po_number || 'operation').replace(/[^A-Za-z0-9._-]+/g, '-')}PO.pdf
          </strong>
          {operationId && ' under the operation documents'}.
        </p>
      </div>

      {purchaseOrder && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
          <span className="text-green-800"><strong>{purchaseOrder.file_name}</strong> generated.</span>
          {purchaseOrder.sent_at && <span className="text-green-700">Sent to {purchaseOrder.sent_to}.</span>}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="space-y-5">
          <Section icon={<FileText size={16} />} title="Document">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Purchase order number" value={form.po_number} onChange={v => set('po_number', v)} placeholder={operationNumber || 'Operation number'} />
              <Field label="Date" type="date" value={form.po_date} onChange={v => set('po_date', v)} />
              <Field label="Our ref" value={form.our_ref} onChange={v => set('our_ref', v)} />
              <Field label="Your ref (supplier quote)" value={form.sq_number} onChange={v => set('sq_number', v)} />
              <Field label="Supplier code" value={form.client_code} onChange={v => set('client_code', v)} />
            </div>
          </Section>

          <Section icon={<Building2 size={16} />} title="Supplier">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-500">Supplier</label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input type="checkbox" checked={showAllSuppliers} onChange={e => setShowAllSuppliers(e.target.checked)} />
                    Show all suppliers
                  </label>
                </div>
                <select
                  value={supplierId ?? ''}
                  onChange={e => chooseSupplier(e.target.value ? Number(e.target.value) : null)}
                  className={inputCls}
                >
                  <option value="">Select supplier…</option>
                  {SUPPLIER_GROUPS.map(g => {
                    const list = suppliers.filter(s =>
                      (s.category || 'other') === g.key && (showAllSuppliers || g.trading || s.id === supplierId));
                    return list.length ? (
                      <optgroup key={g.key} label={g.label}>
                        {list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                <p className="text-xs text-gray-400">
                  Raw materials and blenders suppliers from the Suppliers tab. Choosing one fills in their name, address, phone and email below.
                </p>
              </div>
              <Field label="Name on document" value={form.client_name} onChange={v => set('client_name', v)} className="sm:col-span-2" />
              <AreaField label="Address (one line per row)" value={form.billing_address} onChange={v => set('billing_address', v)} className="sm:col-span-2" />
              <Field label="Phone" value={form.client_phone} onChange={v => set('client_phone', v)} />
              <Field label="Tax Id" value={form.tax_id} onChange={v => set('tax_id', v)} />
              <Field label="Email (for sending — not printed)" type="email" value={form.contact_email} onChange={v => set('contact_email', v)} className="sm:col-span-2" />
            </div>
          </Section>

          <Section icon={<Truck size={16} />} title="Delivery, terms & totals">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Delivery" value={form.delivery} onChange={v => set('delivery', v)} placeholder="CIF Puerto Quetzal" />
              <Field label="Delivery date" value={form.delivery_date_text} onChange={v => set('delivery_date_text', v)} />
              <Field label="Delivery address" value={form.delivery_address} onChange={v => set('delivery_address', v)} className="sm:col-span-2" />
              <Field label="Contact" value={form.delivery_contact} onChange={v => set('delivery_contact', v)} className="sm:col-span-2" />
              <Field label={`Freight (${currency})`} type="number" value={form.freight} onChange={v => set('freight', v)} />
              <Field label={`VAT (${currency})`} type="number" value={form.vat} onChange={v => set('vat', v)} />
              <AreaField label="Terms & conditions" value={form.terms} onChange={v => set('terms', v)} className="sm:col-span-2" placeholder="Payment 30 days from BL" />
            </div>

            <div className="mt-4 border-t border-gray-100 pt-3 space-y-1 text-sm">
              <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{money(subtotal)} {currency}</span></div>
              <div className="flex justify-between text-gray-600"><span>Freight</span><span>{money(freight)} {currency}</span></div>
              <div className="flex justify-between text-gray-600"><span>VAT</span><span>{money(vat)} {currency}</span></div>
              <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-100">
                <span>Total Order</span><span>{money(subtotal + freight + vat)} {currency}</span>
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-5">
          <Section icon={<Package size={16} />} title={`Line items (${form.items.length})`}>
            <div className="space-y-4">
              {unpriced > 0 && (
                <p className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="flex-shrink-0" />
                  {unpriced === 1 ? '1 line has' : `${unpriced} lines have`} no purchase price yet.
                </p>
              )}
              {form.items.map((item, index) => (
                <div key={index} className="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Line {index + 1}</span>
                    <button type="button" onClick={() => removeItem(index)} disabled={form.items.length === 1}
                      className="p-1 rounded text-gray-300 hover:text-red-600 disabled:opacity-40 disabled:hover:text-gray-300" title="Remove line">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Reference" value={item.reference} onChange={v => setItem(index, { reference: v })} />
                    <Field label="Commercial name" value={item.commercial_name} onChange={v => setItem(index, { commercial_name: v })} />
                    <Field label="Packaging" value={item.packaging} onChange={v => setItem(index, { packaging: v })} placeholder="25 KG Pail" />
                    <Field label="HS code" value={item.hs_code} onChange={v => setItem(index, { hs_code: v })} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Quantity" type="number" value={item.quantity} onChange={v => setItem(index, { quantity: v })} />
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500">Unit</label>
                      <select value={item.quantity_unit} onChange={e => setItem(index, { quantity_unit: e.target.value })} className={inputCls}>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <Field label="Purchase price" type="number" value={item.unit_price} onChange={v => setItem(index, { unit_price: v })} />
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500">Currency</label>
                      <select value={item.currency} onChange={e => setItem(index, { currency: e.target.value })} className={inputCls}>
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <AreaField label="Description (optional)" value={item.description} onChange={v => setItem(index, { description: v })} />

                  <p className="text-right text-sm font-semibold text-gray-800">
                    {money(lineTotal(item))} {item.currency}
                  </p>
                </div>
              ))}

              <button type="button" onClick={addItem}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                <Plus size={14} /> Add line
              </button>
            </div>
          </Section>

          <Section icon={<Eye size={16} />} title="Preview">
            {previewUrl ? (
              <div className="space-y-3">
                <iframe src={previewUrl} title="Purchase order preview" className="w-full rounded-lg border border-gray-200 bg-white" style={{ height: '70vh' }} />
                <button type="button" onClick={handlePreview} disabled={previewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                  {previewing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh preview
                </button>
              </div>
            ) : (
              <div className="text-center py-10 text-sm text-gray-400">
                <Eye size={24} className="mx-auto mb-2 text-gray-300" />
                Click <strong className="text-gray-600">Preview</strong> to render the purchase order.
              </div>
            )}
          </Section>
        </div>
      </div>

      {showEmail && purchaseOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !sending && setShowEmail(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail size={16} className="text-gray-400" /> Send {purchaseOrder.file_name}
              </h3>
              <button onClick={() => setShowEmail(false)} disabled={sending} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="To (comma-separated)" type="email" value={emailTo} onChange={setEmailTo} placeholder="sales@supplier.com" />
              <Field label="Subject" value={emailSubject} onChange={setEmailSubject} />
              <AreaField label="Message (optional)" value={emailMessage} onChange={setEmailMessage} rows={4} placeholder="Leave empty to use the default covering note." />
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <FileText size={12} /> {purchaseOrder.file_name} will be attached.
              </p>
            </div>
            <div className="px-5 py-3.5 border-t border-gray-200 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowEmail(false)} disabled={sending}>Cancel</Button>
              <Button size="sm" onClick={handleSend} disabled={sending || !emailTo.trim()}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What the user has already filled in, kept across an entity switch. */
function pickSupplierAndLines(form: PoData): Partial<PoData> {
  return {
    client_name: form.client_name,
    billing_address: form.billing_address,
    client_phone: form.client_phone,
    tax_id: form.tax_id,
    contact_email: form.contact_email,
    client_code: form.client_code,
    sq_number: form.sq_number,
    items: form.items,
    terms: form.terms,
  };
}
