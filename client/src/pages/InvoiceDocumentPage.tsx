import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';
import EntityConfirmStep from '../components/EntityConfirmStep';
import {
  ArrowLeft, Plus, Trash2, Loader2, Eye, X, FileDown, Mail,
  CheckCircle, FileText, RefreshCw, User, Package, Truck, Factory,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

interface InvLine {
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
  lot: string;
}

interface InvData {
  doc_number: string;
  doc_date: string;
  sq_number: string;
  our_ref: string;
  po_number: string;
  operation_number: string;
  client_code: string;
  attention: string;
  client_name: string;
  billing_address: string;
  client_phone: string;
  tax_id: string;
  eori: string;
  contact_email: string;
  items: InvLine[];
  delivery: string;
  delivery_address: string;
  delivery_date_text: string;
  freight: string;
  vat: string;
  manufacturer: string;
  country_of_origin: string;
  terms: string;
  [key: string]: unknown; // issuer + bank constants ride along untouched
}

interface InvoiceRecord {
  id: number;
  invoice_number: string;
  order_id: number;
  operation_id: number | null;
  file_name: string | null;
  sent_to: string | null;
  sent_at: string | null;
  data: Partial<InvData>;
}

const UNITS = ['KG', 'TONS', 'MT', 'LBS', 'L', 'PAIL', 'DRUM', 'IBC'];
const CURRENCIES = ['EUR', 'USD', 'GBP'];

const FORM_KEYS = [
  'doc_number', 'doc_date', 'sq_number', 'our_ref', 'po_number', 'operation_number',
  'client_code', 'attention', 'client_name', 'billing_address', 'client_phone',
  'tax_id', 'eori', 'contact_email', 'delivery', 'delivery_address',
  'delivery_date_text', 'freight', 'vat', 'manufacturer', 'country_of_origin', 'terms',
] as const;

const emptyLine = (n: number): InvLine => ({
  line: n, reference: '', commercial_name: '', packaging: '',
  quantity: '', quantity_unit: 'KG', unit_price: '', currency: 'EUR',
  hs_code: '', description: '', lot: '',
});

const blankData = (): InvData => ({
  doc_number: '', doc_date: new Date().toISOString().slice(0, 10),
  sq_number: '', our_ref: '', po_number: '', operation_number: '',
  client_code: '', attention: '', client_name: '', billing_address: '',
  client_phone: '', tax_id: '', eori: '', contact_email: '',
  items: [emptyLine(1)],
  delivery: '', delivery_address: '', delivery_date_text: '',
  freight: '0', vat: '0', manufacturer: '', country_of_origin: '', terms: '',
});

function toFormData(raw: any): InvData {
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
    lot: item?.lot ?? '',
  }));
  return merged as InvData;
}

/** Origin is opt-in, so strip it unless the user asked for it. */
function toPayload(form: InvData, includeOrigin: boolean) {
  return {
    ...form,
    freight: Number(form.freight) || 0,
    vat: Number(form.vat) || 0,
    manufacturer: includeOrigin ? form.manufacturer : '',
    country_of_origin: includeOrigin ? form.country_of_origin : '',
    items: form.items.map((item, index) => ({
      ...item,
      line: index + 1,
      quantity: item.quantity === '' ? 0 : Number(item.quantity),
      unit_price: item.unit_price === '' ? 0 : Number(item.unit_price),
    })),
  };
}

const lineTotal = (item: InvLine) => (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
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
        onChange={e => onChange(e.target.value)} className={inputCls} />
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
        onChange={e => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

function Section({ icon, title, children, action }: {
  icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <h2 className="font-semibold text-gray-800 text-sm flex-1">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function InvoiceDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const orderIdParam = params.get('order_id');
  const operationIdParam = params.get('operation_id');

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<InvData>(blankData());
  const [record, setRecord] = useState<InvoiceRecord | null>(null);
  const [orderId, setOrderId] = useState<number | null>(orderIdParam ? Number(orderIdParam) : null);
  const [operationId, setOperationId] = useState<number | null>(operationIdParam ? Number(operationIdParam) : null);

  const [entity, setEntity] = useState<'NL' | 'BE'>('BE');
  const [profiles, setProfiles] = useState<Array<{ id: number; name: string; is_default: boolean }>>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [matchedBy, setMatchedBy] = useState('');
  const [matchConfident, setMatchConfident] = useState(false);
  // The entity must be confirmed before a document can be generated
  const [entityConfirmed, setEntityConfirmed] = useState(false);
  const [chooseEntity, setChooseEntity] = useState(false);
  const [includeOrigin, setIncludeOrigin] = useState(false);

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

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const setItem = (index: number, patch: Partial<InvLine>) =>
    setForm(prev => ({ ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));

  const addItem = () =>
    setForm(prev => ({ ...prev, items: [...prev.items, emptyLine(prev.items.length + 1)] }));

  const removeItem = (index: number) =>
    setForm(prev => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }));

  const adopt = useCallback((rec: InvoiceRecord) => {
    setRecord(rec);
    setEntityConfirmed(true);
    setForm(toFormData(rec.data));
    setOrderId(rec.order_id);
    setOperationId(rec.operation_id);
    setIncludeOrigin(!!(rec.data.manufacturer || rec.data.country_of_origin));
  }, []);

  /** Re-fetch the draft when the entity or billing profile changes. */
  const loadDraft = useCallback(async (opts: { entity?: string; profile_id?: number } = {}) => {
    const { data } = await api.get('/invoice-documents/prepare', {
      params: { order_id: orderIdParam || orderId, ...opts },
    });
    if (data.existing) { adopt(data.existing); return; }
    setForm(toFormData(data.draft));
    setEntity(data.entity);
    setProfiles(data.profiles || []);
    setProfileId(data.profile_id ?? null);
    setProfileName(data.profile_name ?? null);
    setMatchedBy(data.matched_by || '');
    setMatchConfident(!!data.match_confident);
    setIncludeOrigin(false);
    if (data.operation) setOperationId(data.operation.id);
  }, [orderIdParam, orderId, adopt]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (id) {
          const { data } = await api.get(`/invoice-documents/${id}`);
          if (!cancelled) adopt(data);
          return;
        }
        if (!orderIdParam) {
          addToast('No order selected', 'error');
          navigate('/operations');
          return;
        }
        await loadDraft();
      } catch (err: any) {
        if (!cancelled) {
          addToast(err.response?.data?.error || 'Failed to load the invoice', 'error');
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
    setEmailSubject(prev => prev || `Commercial Invoice ${form.doc_number}${form.client_name ? ` — ${form.client_name}` : ''}`);
  }, [showEmail]);

  async function switchEntity(next: 'NL' | 'BE') {
    setEntity(next);
    if (record) { addToast('Entity is fixed once the invoice is generated', 'info'); return; }
    try { await loadDraft({ entity: next, ...(profileId ? { profile_id: profileId } : {}) }); }
    catch { addToast('Failed to switch entity', 'error'); }
  }

  // The entity is never applied silently — see EntityConfirmStep
  const entityReady = profiles.length < 2 || entityConfirmed;

  async function chooseEntityProfile(nextId: number) {
    setProfileId(nextId);
    setChooseEntity(false);
    try {
      const { data } = await api.get('/invoice-documents/prepare', {
        params: { order_id: orderIdParam || orderId, entity, profile_id: nextId },
      });
      if (data.draft) {
        setForm(toFormData(data.draft));
        setProfileName(data.profile_name ?? null);
        setMatchedBy(data.matched_by || '');
        setMatchConfident(!!data.match_confident);
      }
    } catch {
      addToast('Failed to load that entity', 'error');
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await api.post('/invoice-documents/preview', { data: toPayload(form, includeOrigin) }, { responseType: 'blob' });
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
    setSaving(true);
    try {
      const body = { order_id: orderId, operation_id: operationId, profile_id: profileId, data: toPayload(form, includeOrigin) };
      const { data } = record
        ? await api.put(`/invoice-documents/${record.id}`, body)
        : await api.post('/invoice-documents', body);
      adopt(data);
      addToast(`Generated ${data.file_name}${operationId ? ' — filed under the operation documents' : ''}`, 'success');
      if (!record) navigate(`/invoices/documents/${data.id}`, { replace: true });
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to generate the invoice', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (!record) return;
    try {
      const res = await api.get(`/invoice-documents/${record.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = record.file_name || `${form.doc_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  async function handleSend() {
    if (!record) return;
    if (!emailTo.trim()) { addToast('Enter at least one recipient', 'error'); return; }
    setSending(true);
    try {
      const { data } = await api.post(`/invoice-documents/${record.id}/email`, {
        to: emailTo, subject: emailSubject, message: emailMessage,
      });
      setRecord(data.invoice);
      addToast(data.message, 'success');
      setShowEmail(false);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to send the email', 'error');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" size={24} /></div>;
  }

  const subtotal = form.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const freight = Number(form.freight) || 0;
  const vat = Number(form.vat) || 0;
  const currency = form.items.find(i => i.currency)?.currency || 'EUR';

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
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !entityReady}
            title={entityReady ? undefined : 'Confirm the customer entity first'}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {record ? 'Confirm & regenerate' : 'Confirm & generate'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownload} disabled={!record}>
            <FileDown size={14} /> Download PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowEmail(true)} disabled={!record}>
            <Mail size={14} /> Send by email
          </Button>
        </div>
      </div>

      <EntityConfirmStep
        profiles={profiles}
        profileId={profileId}
        profileName={profileName}
        matchedBy={matchedBy}
        confident={matchConfident}
        confirmed={entityConfirmed}
        chooseMode={chooseEntity}
        identity={{ client_code: form.client_code, tax_id: form.tax_id, billing_address: form.billing_address }}
        onConfirm={() => setEntityConfirmed(true)}
        onChoose={chooseEntityProfile}
        onReopen={() => { setEntityConfirmed(false); setChooseEntity(true); }}
      />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Commercial Invoice</h1>
        <p className="text-sm text-gray-500 mt-1">
          Check the details, then confirm to produce the PDF as{' '}
          <strong className="text-gray-700">{(form.doc_number || 'invoice').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf</strong>
          {operationId && ' under the operation documents'}.
        </p>
      </div>

      {record && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
          <span className="text-green-800"><strong>{record.file_name}</strong> generated.</span>
          {record.sent_at && <span className="text-green-700">Sent to {record.sent_to}.</span>}
        </div>
      )}

      {/* Issuer + billing profile */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Issuing entity</span>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(['BE', 'NL'] as const).map(code => (
              <button
                key={code}
                onClick={() => switchEntity(code)}
                disabled={!!record}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-60 ${
                  entity === code ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {code === 'BE' ? 'TripleW BV (BE)' : 'TripleW NL BV (NL)'}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-400">from the operation number</span>
        </div>

      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="space-y-5">
          <Section icon={<FileText size={16} />} title="Document">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Invoice number" value={form.doc_number} onChange={v => set('doc_number', v)} placeholder="CIBE202601" />
              <Field label="Date" type="date" value={form.doc_date} onChange={v => set('doc_date', v)} />
              <Field label="SQ" value={form.sq_number} onChange={v => set('sq_number', v)} placeholder="SQ202601 GR" />
              <Field label="Our ref" value={form.our_ref} onChange={v => set('our_ref', v)} />
              <Field label="Your order# (PO)" value={form.po_number} onChange={v => set('po_number', v)} />
              <Field label="Our order# (operation)" value={form.operation_number} onChange={v => set('operation_number', v)} />
              <Field label="Client code" value={form.client_code} onChange={v => set('client_code', v)} placeholder="00GR01" />
              <Field label="Attention" value={form.attention} onChange={v => set('attention', v)} />
            </div>
          </Section>

          <Section icon={<User size={16} />} title="Client">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Client name" value={form.client_name} onChange={v => set('client_name', v)} className="sm:col-span-2" />
              <AreaField label="Address (one line per row)" value={form.billing_address} onChange={v => set('billing_address', v)} className="sm:col-span-2" />
              <Field label="Phone" value={form.client_phone} onChange={v => set('client_phone', v)} />
              <Field label="Tax Id" value={form.tax_id} onChange={v => set('tax_id', v)} />
              <Field label="EORI#" value={form.eori} onChange={v => set('eori', v)} />
              <Field label="Email (for sending — not printed)" type="email" value={form.contact_email} onChange={v => set('contact_email', v)} />
            </div>
          </Section>

          <Section icon={<Truck size={16} />} title="Delivery, terms & totals">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Delivery" value={form.delivery} onChange={v => set('delivery', v)} placeholder="CIF Piraeus Greece" />
              <Field label="Delivery date" value={form.delivery_date_text} onChange={v => set('delivery_date_text', v)} placeholder="May 24, 2026" />
              <Field label="Delivery address" value={form.delivery_address} onChange={v => set('delivery_address', v)} className="sm:col-span-2" />
              <Field label={`Freight (${currency})`} type="number" value={form.freight} onChange={v => set('freight', v)} />
              <Field label={`VAT (${currency})`} type="number" value={form.vat} onChange={v => set('vat', v)} />
              <AreaField label="Terms & conditions" value={form.terms} onChange={v => set('terms', v)} className="sm:col-span-2" />
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

          {/* Origin block — opt-in, per the template */}
          <Section
            icon={<Factory size={16} />}
            title="Manufacturer & country of origin"
            action={
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeOrigin}
                  onChange={e => setIncludeOrigin(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Add to this invoice
              </label>
            }
          >
            {includeOrigin ? (
              <div className="space-y-4">
                <AreaField label="Manufacturer" value={form.manufacturer} onChange={v => set('manufacturer', v)} rows={3}
                  placeholder="Made in China for TripleW by …" />
                <Field label="Country of origin" value={form.country_of_origin} onChange={v => set('country_of_origin', v)} placeholder="China" />
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                Not included. Tick <strong className="text-gray-600">Add to this invoice</strong> if this shipment needs the manufacturer and origin declared.
              </p>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section icon={<Package size={16} />} title={`Line items (${form.items.length})`}>
            <div className="space-y-4">
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
                    <Field label="Reference" value={item.reference} onChange={v => setItem(index, { reference: v })} placeholder="CLNCG5H BU25" />
                    <Field label="Commercial name" value={item.commercial_name} onChange={v => setItem(index, { commercial_name: v })} />
                    <Field label="Packaging" value={item.packaging} onChange={v => setItem(index, { packaging: v })} placeholder="25 KG bags" />
                    <Field label="HS code" value={item.hs_code} onChange={v => setItem(index, { hs_code: v })} placeholder="2918.11" />
                    <Field label="Lot" value={item.lot} onChange={v => setItem(index, { lot: v })} placeholder="01.2602-003" className="sm:col-span-2" />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Quantity" type="number" value={item.quantity} onChange={v => setItem(index, { quantity: v })} />
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500">Unit</label>
                      <select value={item.quantity_unit} onChange={e => setItem(index, { quantity_unit: e.target.value })} className={inputCls}>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <Field label="Unit price" type="number" value={item.unit_price} onChange={v => setItem(index, { unit_price: v })} />
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
                <iframe src={previewUrl} title="Invoice preview" className="w-full rounded-lg border border-gray-200 bg-white" style={{ height: '70vh' }} />
                <button type="button" onClick={handlePreview} disabled={previewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                  {previewing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh preview
                </button>
              </div>
            ) : (
              <div className="text-center py-10 text-sm text-gray-400">
                <Eye size={24} className="mx-auto mb-2 text-gray-300" />
                Click <strong className="text-gray-600">Preview</strong> to render the invoice.
              </div>
            )}
          </Section>
        </div>
      </div>

      {showEmail && record && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !sending && setShowEmail(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail size={16} className="text-gray-400" /> Send {record.file_name}
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
                <FileText size={12} /> {record.file_name} will be attached.
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
