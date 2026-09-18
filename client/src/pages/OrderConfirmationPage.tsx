import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';
import {
  ArrowLeft, Plus, Trash2, Loader2, Eye, X, FileDown, Mail,
  CheckCircle, FileText, RefreshCw, Building2, User, Package,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

interface OcLine {
  line: number;
  reference: string;
  commercial_name: string;
  packaging: string;
  quantity: string;
  quantity_unit: string;
  unit_price: string;
  price_unit: string;
  currency: string;
  hs_code: string;
  description: string;
}

interface OcData {
  oc_number: string;
  company_name: string;
  company_address1: string;
  company_address2: string;
  company_country: string;
  company_tel: string;
  company_email: string;
  company_vat: string;
  company_kvk: string;
  client_name: string;
  contact_person: string;
  contact_phone: string;
  contact_email: string;
  client_phone: string;
  billing_address: string;
  tax_id: string;
  client_code: string;
  oc_date: string;
  sq_number: string;
  our_ref: string;
  po_number: string;
  items: OcLine[];
  delivery: string;
  delivery_date_text: string;
  note: string;
  terms: string;
}

interface Confirmation {
  id: number;
  oc_number: string;
  order_id: number;
  operation_id: number | null;
  file_name: string | null;
  sent_to: string | null;
  sent_at: string | null;
  data: Partial<OcData>;
}

const UNITS = ['KG', 'TONS', 'MT', 'LBS', 'DRUMS', 'IBC', 'L'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];

const emptyLine = (n: number): OcLine => ({
  line: n, reference: '', commercial_name: '', packaging: '',
  quantity: '', quantity_unit: 'KG', unit_price: '', price_unit: 'KG',
  currency: 'USD', hs_code: '', description: '',
});

const blankData = (): OcData => ({
  oc_number: '',
  company_name: '', company_address1: '', company_address2: '', company_country: '',
  company_tel: '', company_email: '', company_vat: '', company_kvk: '',
  client_name: '', contact_person: '', contact_phone: '', contact_email: '',
  client_phone: '', billing_address: '', tax_id: '', client_code: '',
  oc_date: new Date().toISOString().slice(0, 10),
  sq_number: '', our_ref: '', po_number: '',
  items: [emptyLine(1)],
  delivery: '', delivery_date_text: '', note: '', terms: '',
});

/** Server values arrive loosely typed (numbers, nulls) — normalise for the form. */
function toFormData(raw: any): OcData {
  const base = blankData();
  const merged: any = { ...base, ...(raw || {}) };
  for (const key of Object.keys(base)) {
    if (key === 'items') continue;
    if (merged[key] == null) merged[key] = (base as any)[key];
    else merged[key] = String(merged[key]);
  }
  const items = Array.isArray(raw?.items) && raw.items.length ? raw.items : [emptyLine(1)];
  merged.items = items.map((item: any, index: number) => ({
    ...emptyLine(index + 1),
    ...item,
    line: item?.line ?? index + 1,
    reference: item?.reference ?? '',
    commercial_name: item?.commercial_name ?? '',
    packaging: item?.packaging ?? '',
    quantity: item?.quantity == null ? '' : String(item.quantity),
    quantity_unit: item?.quantity_unit || 'KG',
    unit_price: item?.unit_price == null ? '' : String(item.unit_price),
    price_unit: item?.price_unit || item?.quantity_unit || 'KG',
    currency: item?.currency || 'USD',
    hs_code: item?.hs_code ?? '',
    description: item?.description ?? '',
  }));
  return merged as OcData;
}

/** Form strings back to the numeric shape the PDF builder expects. */
function toPayload(form: OcData) {
  return {
    ...form,
    items: form.items.map((item, index) => ({
      ...item,
      line: index + 1,
      quantity: item.quantity === '' ? 0 : Number(item.quantity),
      unit_price: item.unit_price === '' ? 0 : Number(item.unit_price),
    })),
  };
}

function lineTotal(item: OcLine): number {
  const q = Number(item.quantity) || 0;
  const p = Number(item.unit_price) || 0;
  return q * p;
}

// ── Small field primitives ────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = 'text', className = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
      />
    </div>
  );
}

function AreaField({ label, value, onChange, placeholder, rows = 3, className = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; rows?: number; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
      />
    </div>
  );
}

function Section({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
        {subtitle && <span className="text-xs text-gray-400">· {subtitle}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function OrderConfirmationPage() {
  const { id } = useParams<{ id: string }>(); // confirmation id when editing
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const orderIdParam = params.get('order_id');
  const operationIdParam = params.get('operation_id');

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<OcData>(blankData());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [orderId, setOrderId] = useState<number | null>(orderIdParam ? Number(orderIdParam) : null);
  const [operationId, setOperationId] = useState<number | null>(operationIdParam ? Number(operationIdParam) : null);
  const [operationNumber, setOperationNumber] = useState<string>('');
  const [orderNumber, setOrderNumber] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [showEmail, setShowEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sending, setSending] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  const set = <K extends keyof OcData>(key: K, value: OcData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const setItem = (index: number, patch: Partial<OcLine>) =>
    setForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));

  const addItem = () =>
    setForm(prev => ({ ...prev, items: [...prev.items, emptyLine(prev.items.length + 1)] }));

  const removeItem = (index: number) =>
    setForm(prev => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }));

  // ── Load ────────────────────────────────────────────────────────────────

  const adopt = useCallback((record: Confirmation) => {
    setConfirmation(record);
    setForm(toFormData(record.data));
    setOrderId(record.order_id);
    setOperationId(record.operation_id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (id) {
          const { data } = await api.get(`/order-confirmations/${id}`);
          if (!cancelled) adopt(data);
          return;
        }
        if (!orderIdParam) {
          addToast('No order selected', 'error');
          navigate('/operations');
          return;
        }
        const { data } = await api.get('/order-confirmations/prepare', { params: { order_id: orderIdParam } });
        if (cancelled) return;
        if (data.existing) {
          adopt(data.existing);
          addToast('An order confirmation already exists for this order — opening it for editing', 'info');
        } else {
          setForm(toFormData(data.draft));
          setOrderNumber(data.order?.order_number || '');
          if (data.operation) {
            setOperationId(data.operation.id);
            setOperationNumber(data.operation.operation_number);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          addToast(err.response?.data?.error || 'Failed to load the order confirmation', 'error');
          navigate('/operations');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, orderIdParam]);

  // Prefill the e-mail dialog from the confirmed contact
  useEffect(() => {
    if (!showEmail) return;
    setEmailTo(prev => prev || form.contact_email || '');
    setEmailSubject(prev => prev || `Order Confirmation ${form.oc_number}${form.client_name ? ` — ${form.client_name}` : ''}`);
  }, [showEmail]);

  // ── Actions ─────────────────────────────────────────────────────────────

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await api.post('/order-confirmations/preview', { data: toPayload(form) }, { responseType: 'blob' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
    } catch {
      addToast('Failed to render the preview', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    if (!form.oc_number.trim()) { addToast('Confirmation number is required', 'error'); return; }
    if (!orderId) { addToast('No order linked', 'error'); return; }

    setSaving(true);
    try {
      const body = { order_id: orderId, operation_id: operationId, data: toPayload(form) };
      const { data } = confirmation
        ? await api.put(`/order-confirmations/${confirmation.id}`, body)
        : await api.post('/order-confirmations', body);
      adopt(data);
      addToast(
        operationId
          ? 'Order confirmation generated and filed under the operation documents'
          : 'Order confirmation generated',
        'success'
      );
      if (!confirmation) navigate(`/order-confirmations/${data.id}`, { replace: true });
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to generate the order confirmation', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (!confirmation) { addToast('Generate the confirmation first', 'error'); return; }
    try {
      const res = await api.get(`/order-confirmations/${confirmation.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = confirmation.file_name || `${form.oc_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  async function handleSend() {
    if (!confirmation) return;
    if (!emailTo.trim()) { addToast('Enter at least one recipient', 'error'); return; }
    setSending(true);
    try {
      const { data } = await api.post(`/order-confirmations/${confirmation.id}/email`, {
        to: emailTo, subject: emailSubject, message: emailMessage,
      });
      setConfirmation(data.confirmation);
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
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={24} />
      </div>
    );
  }

  const totals = form.items.reduce<Record<string, number>>((acc, item) => {
    const cur = item.currency || 'USD';
    acc[cur] = (acc[cur] || 0) + lineTotal(item);
    return acc;
  }, {});

  const backTo = operationId ? `/operations/${operationId}` : orderId ? `/orders/${orderId}` : '/operations';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> Back to {operationId ? 'operation' : 'order'}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handlePreview} disabled={previewing}>
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {confirmation ? 'Confirm & regenerate' : 'Confirm & generate'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownload} disabled={!confirmation}>
            <FileDown size={14} /> Download PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowEmail(true)} disabled={!confirmation}>
            <Mail size={14} /> Send by email
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Order Confirmation</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generated from {orderNumber || confirmation?.oc_number ? `order ${orderNumber || '—'}` : 'the uploaded order'}
          {operationNumber && ` · operation ${operationNumber}`}
          {' · '}review every field, then confirm to produce the PDF in the company template.
        </p>
      </div>

      {confirmation && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
          <span className="text-green-800">
            <strong>{confirmation.oc_number}</strong> generated
            {confirmation.operation_id ? ' and filed under the operation documents' : ''}.
          </span>
          {confirmation.sent_at && (
            <span className="text-green-700">Sent to {confirmation.sent_to}.</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="space-y-5">
          {/* Document */}
          <Section icon={<FileText size={16} />} title="Document">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Confirmation number" value={form.oc_number} onChange={v => set('oc_number', v)} placeholder="SONL20260107OC" />
              <Field label="Date" type="date" value={form.oc_date} onChange={v => set('oc_date', v)} />
              <Field label="SQ" value={form.sq_number} onChange={v => set('sq_number', v)} placeholder="SQ202601 CR" />
              <Field label="Our ref" value={form.our_ref} onChange={v => set('our_ref', v)} />
              <Field label="PO number" value={form.po_number} onChange={v => set('po_number', v)} />
              <Field label="Client code" value={form.client_code} onChange={v => set('client_code', v)} placeholder="00CR02" />
            </div>
          </Section>

          {/* Client */}
          <Section icon={<User size={16} />} title="Client">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Client name" value={form.client_name} onChange={v => set('client_name', v)} className="sm:col-span-2" />
              <Field label="Contact person" value={form.contact_person} onChange={v => set('contact_person', v)} />
              <Field label="Contact phone" value={form.contact_phone} onChange={v => set('contact_phone', v)} />
              <Field label="Contact email" type="email" value={form.contact_email} onChange={v => set('contact_email', v)} />
              <Field label="Client phone" value={form.client_phone} onChange={v => set('client_phone', v)} />
              <AreaField label="Address (one line per row)" value={form.billing_address} onChange={v => set('billing_address', v)} className="sm:col-span-2" />
              <Field label="Tax Id" value={form.tax_id} onChange={v => set('tax_id', v)} />
            </div>
          </Section>

          {/* Delivery & terms */}
          <Section icon={<Package size={16} />} title="Delivery & terms">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Delivery" value={form.delivery} onChange={v => set('delivery', v)} placeholder="CIF Puerto Moin Costa Rica" />
              <Field label="Delivery date" value={form.delivery_date_text} onChange={v => set('delivery_date_text', v)} placeholder="September 2026" />
              <AreaField label="Note" value={form.note} onChange={v => set('note', v)} rows={2} className="sm:col-span-2" />
              <AreaField label="Terms & conditions" value={form.terms} onChange={v => set('terms', v)} rows={2} className="sm:col-span-2" />
            </div>
          </Section>

          {/* Issuer */}
          <Section icon={<Building2 size={16} />} title="Issuer" subtitle="shown in the header">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Company name" value={form.company_name} onChange={v => set('company_name', v)} />
              <Field label="Address line 1" value={form.company_address1} onChange={v => set('company_address1', v)} />
              <Field label="Address line 2" value={form.company_address2} onChange={v => set('company_address2', v)} />
              <Field label="Country" value={form.company_country} onChange={v => set('company_country', v)} />
              <Field label="Tel" value={form.company_tel} onChange={v => set('company_tel', v)} />
              <Field label="Email" value={form.company_email} onChange={v => set('company_email', v)} />
              <Field label="VAT" value={form.company_vat} onChange={v => set('company_vat', v)} />
              <Field label="KVK" value={form.company_kvk} onChange={v => set('company_kvk', v)} />
            </div>
          </Section>
        </div>

        <div className="space-y-5">
          {/* Line items */}
          <Section icon={<Package size={16} />} title={`Line items (${form.items.length})`}>
            <div className="space-y-4">
              {form.items.map((item, index) => (
                <div key={index} className="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Line {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      disabled={form.items.length === 1}
                      className="p-1 rounded text-gray-300 hover:text-red-600 disabled:opacity-40 disabled:hover:text-gray-300"
                      title="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Reference" value={item.reference} onChange={v => setItem(index, { reference: v })} placeholder="MLCSL04 DU25" />
                    <Field label="Commercial name" value={item.commercial_name} onChange={v => setItem(index, { commercial_name: v })} />
                    <Field label="Packaging" value={item.packaging} onChange={v => setItem(index, { packaging: v })} placeholder="250 KG drums" />
                    <Field label="HS code" value={item.hs_code} onChange={v => setItem(index, { hs_code: v })} placeholder="3824.99" />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Quantity" type="number" value={item.quantity} onChange={v => setItem(index, { quantity: v })} />
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500">Unit</label>
                      <select
                        value={item.quantity_unit}
                        onChange={e => setItem(index, { quantity_unit: e.target.value, price_unit: e.target.value })}
                        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <Field label="Unit price" type="number" value={item.unit_price} onChange={v => setItem(index, { unit_price: v })} />
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500">Currency</label>
                      <select
                        value={item.currency}
                        onChange={e => setItem(index, { currency: e.target.value })}
                        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <AreaField label="Description" value={item.description} onChange={v => setItem(index, { description: v })} rows={2} />

                  <p className="text-right text-sm font-semibold text-gray-800">
                    {lineTotal(item).toLocaleString('en-US', { maximumFractionDigits: 2 })} {item.currency}
                  </p>
                </div>
              ))}

              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                <Plus size={14} /> Add line
              </button>

              <div className="border-t border-gray-100 pt-3 space-y-1">
                {Object.entries(totals).map(([currency, amount]) => (
                  <p key={currency} className="text-right text-sm text-gray-700">
                    Total <strong className="text-gray-900">
                      {amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} {currency}
                    </strong>
                  </p>
                ))}
              </div>
            </div>
          </Section>

          {/* Preview */}
          <Section icon={<Eye size={16} />} title="Preview">
            {previewUrl ? (
              <div className="space-y-3">
                <iframe src={previewUrl} title="Order confirmation preview" className="w-full rounded-lg border border-gray-200 bg-white" style={{ height: '70vh' }} />
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                >
                  {previewing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh preview
                </button>
              </div>
            ) : (
              <div className="text-center py-10 text-sm text-gray-400">
                <Eye size={24} className="mx-auto mb-2 text-gray-300" />
                Click <strong className="text-gray-600">Preview</strong> to render the confirmation in the company template.
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* Email modal */}
      {showEmail && confirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !sending && setShowEmail(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail size={16} className="text-gray-400" /> Send {confirmation.oc_number}
              </h3>
              <button onClick={() => setShowEmail(false)} disabled={sending} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="To (comma-separated)" type="email" value={emailTo} onChange={setEmailTo} placeholder="buyer@example.com" />
              <Field label="Subject" value={emailSubject} onChange={setEmailSubject} />
              <AreaField label="Message (optional)" value={emailMessage} onChange={setEmailMessage} rows={4} placeholder="Leave empty to use the default covering note." />
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <FileText size={12} /> {confirmation.file_name} will be attached.
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
