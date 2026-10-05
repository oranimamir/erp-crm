import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { acceptPlaceholderOnTab } from '../lib/placeholderTab';
import { computePacking, kg, netKg, packagingLabel, type PackagingOption } from '../lib/packing';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';
import CompareButtons from '../components/CompareButtons';
import LotFields, { lotFieldsFor, lotsOf } from '../components/LotFields';
import PackingListLayoutEditor from '../components/PackingListLayoutEditor';
import { plWithDefaults, type PackingListLayout } from '../lib/packingListLayout';
import {
  ArrowLeft, Loader2, Eye, FileDown, CheckCircle, FileText, RefreshCw, User, Package, Truck,
  AlertTriangle, RotateCcw, Trash2, Save, BadgeCheck, Undo2, LayoutTemplate, ChevronDown, ChevronRight, Mail, X,
} from 'lucide-react';

// Packing list for a generated invoice: its goods with the packaging from
// Inventory → Packaging, per-unit and per-pallet net / gross weights, and the
// pallet count — laid out the way this customer's PLs are.

// ── Types ─────────────────────────────────────────────────────────────────

interface PlLine {
  reference: string;
  commercial_name: string;
  packaging: string;
  quantity: number;
  quantity_unit: string;
  /** Lot numbers, copied from the invoice and editable here. */
  lots: string[];
  hs_code: string;
  description: string;
  packaging_id: number | null;
  units_override: string;
  pallets_override: string;
  /** Empty pallet weight in kg; blank = 20 kg. */
  pallet_weight_override: string;
  /** The line's whole packaging weight (gross − net) in kg; blank = computed. */
  packaging_weight_override: string;
  volume_cbm: string;
}

interface PlData {
  doc_number: string;
  doc_date: string;
  invoice_number: string;
  po_number: string;
  operation_number: string;
  client_name: string;
  billing_address: string;
  client_contact: string;
  client_phone: string;
  contact_email: string;
  tax_id: string;
  delivery: string;
  delivery_address: string;
  delivery_date_text: string;
  manufacturer: string;
  country_of_origin: string;
  terms: string;
  notes: string;
  lines: PlLine[];
  layout?: Partial<PackingListLayout>;
  [key: string]: unknown; // issuer constants ride along untouched
}

interface PackingList {
  id: number;
  pl_number: string;
  invoice_document_id: number | null;
  order_id: number | null;
  operation_id: number | null;
  /** The draft PDF (watermarked DRAFT) — kept after finalizing. */
  file_name: string | null;
  /** The final PDF, filed beside the draft once finalized. */
  final_file_name?: string | null;
  status: 'draft' | 'final';
  finalized_at: string | null;
  data: Partial<PlData>;
}

interface BillOfLading { id: number; file_path: string; file_name: string }

const FORM_KEYS = [
  'doc_number', 'doc_date', 'invoice_number', 'po_number', 'operation_number',
  'client_name', 'billing_address', 'client_contact', 'client_phone', 'contact_email', 'tax_id',
  'delivery', 'delivery_address', 'delivery_date_text', 'manufacturer', 'country_of_origin', 'terms', 'notes',
] as const;

function toLine(raw: any): PlLine {
  return {
    reference: raw?.reference ?? '',
    commercial_name: raw?.commercial_name ?? '',
    packaging: raw?.packaging ?? '',
    quantity: Number(raw?.quantity) || 0,
    quantity_unit: raw?.quantity_unit || 'KG',
    lots: lotsOf(raw),
    hs_code: raw?.hs_code ?? '',
    description: raw?.description ?? '',
    packaging_id: raw?.packaging_id ?? null,
    units_override: raw?.units_override == null ? '' : String(raw.units_override),
    pallets_override: raw?.pallets_override == null ? '' : String(raw.pallets_override),
    pallet_weight_override: raw?.pallet_weight_override == null ? '' : String(raw.pallet_weight_override),
    packaging_weight_override: raw?.packaging_weight_override == null ? '' : String(raw.packaging_weight_override),
    volume_cbm: raw?.volume_cbm == null ? '' : String(raw.volume_cbm),
  };
}

function toFormData(raw: any): PlData {
  const merged: any = { ...(raw || {}) };
  for (const key of FORM_KEYS) merged[key] = merged[key] == null ? '' : String(merged[key]);
  merged.lines = Array.isArray(raw?.lines) ? raw.lines.map(toLine) : [];
  return merged as PlData;
}

function toPayload(form: PlData, layout: PackingListLayout) {
  const { packing: _packing, ...rest } = form as any;
  return {
    ...rest,
    layout,
    lines: form.lines.map(l => ({
      ...l,
      ...lotFieldsFor(l.lots),
      units_override: l.units_override === '' ? null : Number(l.units_override),
      pallets_override: l.pallets_override === '' ? null : Number(l.pallets_override),
      pallet_weight_override: l.pallet_weight_override === '' ? null : Number(l.pallet_weight_override),
      packaging_weight_override: l.packaging_weight_override === '' ? null : Number(l.packaging_weight_override),
    })),
  };
}

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

function Section({ icon, title, children, action }: {
  icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/** A count that is computed unless typed; the reset hands it back to the calculation. */
function CountField({ label, value, computed, onChange, decimals }: {
  label: string; value: string; computed: number; onChange: (v: string) => void; decimals?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between text-xs font-medium text-gray-500">
        {label}
        {value !== '' && (
          <button type="button" onClick={() => onChange('')} title={`Reset to ${computed}`}
            className="text-gray-400 hover:text-primary-600"><RotateCcw size={11} /></button>
        )}
      </label>
      <input type="number" min={0} step={decimals ? 'any' : undefined} value={value} placeholder={String(computed)}
        onChange={e => onChange(e.target.value)}
        className={`${inputCls} ${value === '' ? '' : 'border-amber-300 bg-amber-50'}`} />
    </div>
  );
}

/** Two figures side by side in the line's weight summary. */
function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className={strong ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}>{value}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function PackingListPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const invoiceParam = params.get('invoice_document_id');

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PlData>(toFormData({}));
  const [packingList, setPackingList] = useState<PackingList | null>(null);
  const [invoiceDocId, setInvoiceDocId] = useState<number | null>(invoiceParam ? Number(invoiceParam) : null);
  const [operationId, setOperationId] = useState<number | null>(null);
  const [packaging, setPackaging] = useState<PackagingOption[]>([]);
  const [candidates, setCandidates] = useState<number[][]>([]);

  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const [showEmail, setShowEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [billOfLading, setBillOfLading] = useState<BillOfLading | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  // Which document is shown beside the packing list

  // How this customer's packing lists are laid out — see PackingListLayoutEditor
  const [layout, setLayout] = useState<PackingListLayout>(plWithDefaults(null));
  const [layoutSource, setLayoutSource] = useState('the standard packing list template');
  const [showLayout, setShowLayout] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [profile, setProfile] = useState<{ id: number; name: string } | null>(null);

  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const setLine = (index: number, patch: Partial<PlLine>) =>
    setForm(prev => ({ ...prev, lines: prev.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));

  const adopt = useCallback((record: PackingList) => {
    setPackingList(record);
    setForm(toFormData(record.data));
    setInvoiceDocId(record.invoice_document_id);
    setOperationId(record.operation_id);
    setOrderId(record.order_id ?? null);
    setLayout(plWithDefaults(record.data.layout));
    setLayoutSource('this packing list as it was saved');
  }, []);

  const takeProfile = (data: any) => {
    if (data?.profile_id) setProfile({ id: data.profile_id, name: data.profile_name || 'this customer' });
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: options } = await api.get('/packing-lists/packaging');
        if (!cancelled) setPackaging(options || []);
        if (id) {
          const { data } = await api.get(`/packing-lists/${id}`);
          if (cancelled) return;
          adopt(data);
          takeProfile(data);
          setCandidates(data.candidates || []);
          return;
        }
        if (!invoiceParam) {
          addToast('Generate the invoice first — the packing list is built from it', 'error');
          navigate('/operations');
          return;
        }
        const { data } = await api.get('/packing-lists/prepare', { params: { invoice_document_id: invoiceParam } });
        if (cancelled) return;
        setCandidates(data.candidates || []);
        takeProfile(data);
        if (data.existing) {
          adopt(data.existing);
          addToast('A packing list already exists for this invoice — opening it for editing', 'info');
        } else {
          setForm(toFormData(data.draft));
          setLayout(plWithDefaults(data.draft?.layout));
          setLayoutSource(data.layout_source || 'the standard packing list template');
          setOperationId(data.invoice?.operation_id ?? null);
          setOrderId(data.invoice?.order_id ?? null);
        }
      } catch (err: any) {
        if (!cancelled) {
          addToast(err.response?.data?.error || 'Failed to load the packing list', 'error');
          navigate('/operations');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, invoiceParam]);

  // The operation's Bill of Lading, if uploaded — enables "Compare with BL"
  useEffect(() => {
    const url = packingList ? `/packing-lists/${packingList.id}/bl`
      : invoiceDocId ? `/packing-lists/bl-for-invoice/${invoiceDocId}` : null;
    if (!url) return;
    api.get(url).then(({ data }) => setBillOfLading(data || null)).catch(() => setBillOfLading(null));
  }, [packingList?.id, invoiceDocId]);

  // ── Actions ─────────────────────────────────────────────────────────────

  async function refreshFromInvoice() {
    if (!invoiceDocId) return;
    setRefreshing(true);
    try {
      const { data } = await api.post('/packing-lists/refresh-lines', {
        invoice_document_id: invoiceDocId, lines: toPayload(form, layout).lines,
      });
      setForm(prev => ({ ...prev, lines: (data.lines || []).map(toLine) }));
      setCandidates(data.candidates || []);
      addToast('Lines refreshed from the invoice', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to refresh from the invoice', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await api.post('/packing-lists/preview', { data: toPayload(form, layout) }, { responseType: 'blob' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
    } catch {
      addToast('Failed to render the preview', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  /** Saves the form as the draft PL (watermarked DRAFT); returns the saved record. */
  async function saveDraft(quiet = false): Promise<PackingList | null> {
    const body = { invoice_document_id: invoiceDocId, data: toPayload(form, layout) };
    const { data } = packingList
      ? await api.put(`/packing-lists/${packingList.id}`, body)
      : await api.post('/packing-lists', body);
    adopt(data);
    if (!quiet) {
      addToast(data.operation_id
        ? `Draft saved — ${data.file_name} is in the operation's Documents`
        : `Draft saved as ${data.file_name} (no operation linked, so not filed under Documents)`, 'success');
    }
    if (!packingList) navigate(`/packing-lists/${data.id}`, { replace: true });
    return data;
  }

  async function handleSave() {
    setSaving(true);
    try { await saveDraft(); }
    catch (err: any) { addToast(err.response?.data?.error || 'Failed to save the packing list', 'error'); }
    finally { setSaving(false); }
  }

  /**
   * The final PL is made from the draft: what is on screen is saved as the
   * draft first, then the final PDF is produced from it and filed beside the
   * draft, which stays in the operation's Documents. Allowed without a BL.
   */
  async function handleFinalize() {
    setFinalizing(true);
    try {
      const draft = await saveDraft(true);
      if (!draft) return;
      const { data } = await api.post(`/packing-lists/${draft.id}/finalize`);
      adopt(data.record);
      if (data.bl_found) addToast(`Packing list finalized — ${data.record.final_file_name}`, 'success');
      else addToast(`Finalized as ${data.record.final_file_name} — no BL in the operation documents yet`, 'info');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to finalize the packing list', 'error');
    } finally {
      setFinalizing(false);
    }
  }

  /** Makes this layout the customer's standing packing list format. */
  async function handleSaveLayout() {
    if (!profile) return;
    setSavingLayout(true);
    try {
      const { data } = await api.put(`/packing-lists/layout/${profile.id}`, { layout });
      setLayout(plWithDefaults(data.layout));
      setLayoutSource(`saved on ${profile.name}`);
      addToast(data.message || 'Packing list format saved', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the packing list format', 'error');
    } finally {
      setSavingLayout(false);
    }
  }

  /** Opens the email dialog pre-filled with the consignee and the defaults from Settings. */
  async function openEmail() {
    if (!packingList) return;
    const join = (a: string, b: string[] = []) =>
      [...new Set([...a.split(/[,;]/).map(x => x.trim()), ...b].filter(Boolean))].join(', ');
    let defaults: any = null;
    try { defaults = (await api.get('/settings/document-emails')).data?.packing_list; } catch { /* no defaults */ }
    setEmailTo(prev => join(prev || form.contact_email || '', defaults?.to));
    setEmailCc(prev => join(prev, defaults?.cc));
    setEmailSubject(prev => prev || `Packing List ${packingList.pl_number}${packingList.final_file_name ? '' : ' (draft)'}${form.client_name ? ` — ${form.client_name}` : ''}`);
    setShowEmail(true);
  }

  async function handleSend() {
    if (!packingList) return;
    if (!emailTo.trim()) { addToast('Enter at least one recipient', 'error'); return; }
    setSending(true);
    try {
      const { data } = await api.post(`/packing-lists/${packingList.id}/email`, {
        to: emailTo, cc: emailCc, subject: emailSubject, message: emailMessage,
      });
      addToast(data.message, 'success');
      setShowEmail(false);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to send the email', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleReopen() {
    if (!packingList) return;
    setFinalizing(true);
    try {
      const { data } = await api.post(`/packing-lists/${packingList.id}/reopen`);
      adopt(data.record);
      addToast('Packing list reopened as a draft', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to reopen the packing list', 'error');
    } finally {
      setFinalizing(false);
    }
  }

  async function handleDownload(version: 'draft' | 'final') {
    if (!packingList) return;
    try {
      const res = await api.get(`/packing-lists/${packingList.id}/pdf`, { params: { version }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = (version === 'final' ? packingList.final_file_name : packingList.file_name) || `${form.doc_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  async function handleDelete() {
    if (!packingList) return;
    if (!confirm(`Delete packing list ${packingList.pl_number}?`)) return;
    try {
      await api.delete(`/packing-lists/${packingList.id}`);
      addToast('Packing list deleted', 'success');
      navigate(operationId ? `/operations/${operationId}` : '/operations');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete the packing list', 'error');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" size={24} /></div>;
  }

  const byId = new Map(packaging.map(p => [p.id, p]));
  const figures = form.lines.map(l =>
    computePacking(netKg(l.quantity, l.quantity_unit), byId.get(l.packaging_id ?? -1), {
      units: l.units_override, pallets: l.pallets_override, pallet_weight: l.pallet_weight_override,
      packaging_weight: l.packaging_weight_override,
    }));
  const totals = figures.reduce((acc, f) => ({
    units: acc.units + f.units, pallets: acc.pallets + f.pallets,
    net: acc.net + f.net_kg, gross: acc.gross + f.gross_kg,
  }), { units: 0, pallets: 0, net: 0, gross: 0 });
  const unmatched = form.lines.filter(l => !l.packaging_id || !byId.has(l.packaging_id)).length;

  const backTo = operationId ? `/operations/${operationId}` : '/operations';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> Back to operation
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={refreshFromInvoice} disabled={refreshing || !invoiceDocId}
            title="Re-read the lines and quantities from the invoice, keeping the packaging chosen">
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh from invoice
          </Button>
          <Button variant="secondary" size="sm" onClick={handlePreview} disabled={previewing}>
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
          </Button>
          <CompareButtons
            kinds={['order', 'oc', 'invoice', 'bl']}
            orderId={orderId}
            title="Packing list"
            bl={billOfLading ? { number: '', file_path: billOfLading.file_path, file_name: billOfLading.file_name } : null}
            renderPreview={async () => (await api.post('/packing-lists/preview', { data: toPayload(form, layout) }, { responseType: 'blob' })).data as Blob}
          />
          <Button variant={packingList?.status === 'final' ? 'secondary' : 'primary'} size="sm" onClick={handleSave} disabled={saving}
            title={packingList?.status === 'final' ? 'Saving changes turns the packing list back into a draft' : undefined}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save as draft PL
          </Button>
          {packingList?.status === 'final' ? (
            <Button variant="secondary" size="sm" onClick={handleReopen} disabled={finalizing}>
              {finalizing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Reopen as draft
            </Button>
          ) : (
            <Button size="sm" onClick={handleFinalize} disabled={finalizing || saving}
              title={`Saves this draft, then makes the final PL from it — the draft stays filed too${billOfLading ? '' : '. No BL in the operation documents yet — you can still finalize'}`}>
              {finalizing ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />} Finalize the PL
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => handleDownload('draft')} disabled={!packingList?.file_name}>
            <FileDown size={14} /> Download draft
          </Button>
          <Button variant="secondary" size="sm" onClick={() => handleDownload('final')} disabled={!packingList?.final_file_name}
            title={packingList?.final_file_name ? undefined : 'Not finalized yet'}>
            <FileDown size={14} /> Download final
          </Button>
          <Button variant="secondary" size="sm" onClick={openEmail} disabled={!packingList}
            title={packingList?.final_file_name ? 'Email the final packing list' : 'Email the draft packing list (not finalized yet)'}>
            <Mail size={14} /> Send by email
          </Button>
          {packingList && (
            <Button variant="secondary" size="sm" onClick={handleDelete}>
              <Trash2 size={14} /> Delete
            </Button>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          Packing List
          {packingList?.status === 'final' ? (
            <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-800">
              <BadgeCheck size={12} /> Final{packingList.finalized_at ? ` · ${formatDate(packingList.finalized_at.slice(0, 10))}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800">
              Draft
            </span>
          )}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Built from invoice <strong className="text-gray-700">{form.invoice_number || '—'}</strong>. Packaging, units per pallet
          and weights come from <Link to="/inventory" className="text-primary-600 hover:underline">Inventory → Packaging</Link>.
          The draft is saved as <strong className="text-gray-700">
            {(form.doc_number || 'packing-list').replace(/[^A-Za-z0-9._-]+/g, '-')}-DRAFT.pdf
          </strong> (watermarked DRAFT); finalizing makes <strong className="text-gray-700">
            {(form.doc_number || 'packing-list').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf
          </strong> from it and keeps the draft{operationId && ' — both in the operation\'s Documents'}. Finalize once the BL is in
          {billOfLading ? <> — <span className="text-green-700">BL found: {billOfLading.file_name}</span></> : ' — no BL in the operation documents yet'}.
        </p>
      </div>

      {packingList && (
        <div className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm ${packingList.status === 'final' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
          {packingList.final_file_name && (
            <span className="flex items-center gap-2 text-green-800">
              <BadgeCheck size={16} className="flex-shrink-0 text-green-600" />
              <span><strong>{packingList.final_file_name}</strong> — final{packingList.status === 'final' ? '' : ' (reopened since: finalize again to replace it)'}</span>
            </span>
          )}
          {packingList.file_name && (
            <span className={`flex items-center gap-2 ${packingList.status === 'final' ? 'text-green-800' : 'text-amber-800'}`}>
              <CheckCircle size={16} className={`flex-shrink-0 ${packingList.status === 'final' ? 'text-green-600' : 'text-amber-600'}`} />
              <span><strong>{packingList.file_name}</strong> — draft, watermarked DRAFT{packingList.status === 'final' ? ', kept alongside the final' : ''}</span>
            </span>
          )}
          {operationId && <span className="text-xs text-gray-500 pl-6">Both are in the operation&rsquo;s Documents.</span>}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="space-y-5">
          <Section icon={<FileText size={16} />} title="Document">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Packing list number" value={form.doc_number} onChange={v => set('doc_number', v)}
                placeholder={`${form.operation_number || form.invoice_number}PL`} />
              <Field label="Date" type="date" value={form.doc_date} onChange={v => set('doc_date', v)} />
              <Field label="Invoice #" value={form.invoice_number} onChange={v => set('invoice_number', v)} />
              <Field label="Your order #" value={form.po_number} onChange={v => set('po_number', v)} />
              <Field label="Our order #" value={form.operation_number} onChange={v => set('operation_number', v)} />
            </div>
          </Section>

          <Section icon={<User size={16} />} title="Consignee">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name" value={form.client_name} onChange={v => set('client_name', v)} className="sm:col-span-2" />
              <AreaField label="Address (one line per row)" value={form.billing_address} onChange={v => set('billing_address', v)} className="sm:col-span-2" />
              <Field label="Contact person" value={form.client_contact} onChange={v => set('client_contact', v)} />
              <Field label="Contact phone" value={form.client_phone} onChange={v => set('client_phone', v)} />
              <Field label="Contact email" type="email" value={form.contact_email} onChange={v => set('contact_email', v)} />
              <Field label="Tax Id" value={form.tax_id} onChange={v => set('tax_id', v)} />
            </div>
          </Section>

          <Section icon={<Truck size={16} />} title="Delivery & notes">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Delivery" value={form.delivery} onChange={v => set('delivery', v)} />
              <Field label="Delivery date" value={form.delivery_date_text} onChange={v => set('delivery_date_text', v)} />
              <Field label="Delivery address" value={form.delivery_address} onChange={v => set('delivery_address', v)} className="sm:col-span-2" />
              <AreaField label="Notes" value={form.notes} onChange={v => set('notes', v)} className="sm:col-span-2"
                rows={3} placeholder="e.g. Goods shipped in 2 x 20' containers" />
              {layout.origin && (
                <>
                  <AreaField label="Manufacturer" value={form.manufacturer} onChange={v => set('manufacturer', v)} className="sm:col-span-2" />
                  <Field label="Country of origin" value={form.country_of_origin} onChange={v => set('country_of_origin', v)} />
                </>
              )}
              {layout.show_terms && (
                <AreaField label="Terms & conditions" value={form.terms} onChange={v => set('terms', v)} className="sm:col-span-2" />
              )}
            </div>
          </Section>

          {/* The customer's own packing list format */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <button type="button" onClick={() => setShowLayout(v => !v)}
              className="w-full px-5 py-3.5 border-b border-gray-100 flex items-center gap-2 text-left">
              <span className="text-gray-400"><LayoutTemplate size={16} /></span>
              <span className="font-semibold text-gray-800 text-sm flex-1 truncate">
                Packing list format
                <span className="ml-2 font-normal text-xs text-gray-400">from {layoutSource}</span>
              </span>
              {showLayout ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
            </button>
            {showLayout && (
              <div className="p-5">
                <PackingListLayoutEditor
                  layout={layout}
                  source={layoutSource}
                  customerName={profile?.name || form.client_name}
                  canSaveDefault={!!profile}
                  saving={savingLayout}
                  onChange={setLayout}
                  onSaveDefault={handleSaveLayout}
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <Section icon={<Package size={16} />} title={`Lines (${form.lines.length})`}>
            <div className="space-y-4">
              {unmatched > 0 && (
                <p className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="flex-shrink-0" />
                  {unmatched === 1 ? '1 line has' : `${unmatched} lines have`} no packaging matched — choose one below.
                </p>
              )}
              {form.lines.length === 0 && (
                <p className="text-sm text-gray-400">The invoice has no lines.</p>
              )}
              {form.lines.map((line, index) => {
                const f = figures[index];
                const suggested = new Set(candidates[index] || []);
                const pkg = byId.get(line.packaging_id ?? -1);
                return (
                  <div key={index} className="rounded-lg border border-gray-200 p-4 space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-800">{line.commercial_name || `Line ${index + 1}`}</span>
                      <span className="text-xs text-gray-500">
                        {line.reference}{line.reference && ' · '}{kg(line.quantity)} {line.quantity_unit}
                        {line.lots.some(l => l.trim()) && ` · Lot ${line.lots.filter(l => l.trim()).join(' / ')}`}
                      </span>
                    </div>

                    <LotFields lots={line.lots} onChange={lots => setLine(index, { lots })} />

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500">Packaging</label>
                      <select
                        value={line.packaging_id ?? ''}
                        onChange={e => setLine(index, {
                          packaging_id: e.target.value ? Number(e.target.value) : null,
                          units_override: '', pallets_override: '', packaging_weight_override: '',
                        })}
                        className={`${inputCls} ${pkg ? '' : 'border-amber-300'}`}
                      >
                        <option value="">Choose packaging…</option>
                        {suggested.size > 0 && (
                          <optgroup label="Matches this line">
                            {packaging.filter(p => suggested.has(p.id)).map(p =>
                              <option key={p.id} value={p.id}>{packagingLabel(p)}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="All packaging">
                          {packaging.filter(p => !suggested.has(p.id)).map(p =>
                            <option key={p.id} value={p.id}>{packagingLabel(p)}</option>)}
                        </optgroup>
                      </select>
                      {pkg && (
                        <p className="text-xs text-gray-400">
                          {pkg.product_mass} kg per unit · packaging {pkg.weight_packaging ?? 0} kg per unit · {pkg.units_per_pallet ?? '—'} per pallet
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <CountField label="Units" value={line.units_override} computed={f.computed_units}
                        onChange={v => setLine(index, { units_override: v })} />
                      <CountField label="Pallets" value={line.pallets_override} computed={f.computed_pallets}
                        onChange={v => setLine(index, { pallets_override: v })} />
                      <CountField label="Pallet weight (kg)" value={line.pallet_weight_override} computed={20}
                        onChange={v => setLine(index, { pallet_weight_override: v })} />
                      <Field label="Volume CBM" value={line.volume_cbm} onChange={v => setLine(index, { volume_cbm: v })} />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                      <CountField label="Packaging weight (kg)" value={line.packaging_weight_override} decimals
                        computed={Math.round(f.computed_packaging_kg * 100) / 100}
                        onChange={v => setLine(index, { packaging_weight_override: v })} />
                      <Figure label="Gross weight" value={`${kg(f.net_kg)} + ${kg(f.packaging_kg)} = ${kg(f.gross_kg)} kg`} strong />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs rounded-lg bg-gray-50 px-3 py-2">
                      <Figure label="Net weight (unit)" value={pkg ? `${kg(f.unit_net_kg)} kg` : '—'} />
                      <Figure label="Gross weight (unit)" value={pkg ? `${kg(f.unit_gross_kg)} kg` : '—'} />
                      <Figure label="Pallet net weight" value={f.units_per_pallet ? `${kg(f.pallet_net_kg)} kg` : '—'} />
                      <Figure label="Pallet gross weight" value={f.units_per_pallet ? `${kg(f.pallet_gross_kg)} kg` : '—'} />
                      <Figure label="Line net" value={`${kg(f.net_kg)} kg`} />
                      <Figure label="Line gross" value={`${kg(f.gross_kg)} kg`} strong />
                    </div>
                  </div>
                );
              })}

              {form.lines.length > 0 && (
                <div className="border-t border-gray-100 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Figure label="Total net weight" value={`${kg(totals.net)} kg`} />
                  <Figure label="Packages" value={kg(totals.units)} />
                  <Figure label="Pallets" value={kg(totals.pallets)} />
                  <Figure label="Total gross weight" value={`${kg(totals.gross)} kg`} strong />
                </div>
              )}
            </div>
          </Section>

          <Section icon={<Eye size={16} />} title="Preview">
            {previewUrl ? (
              <div className="space-y-3">
                <iframe src={previewUrl} title="Packing list preview" className="w-full rounded-lg border border-gray-200 bg-white" style={{ height: '70vh' }} />
                <button type="button" onClick={handlePreview} disabled={previewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                  {previewing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh preview
                </button>
              </div>
            ) : (
              <div className="text-center py-10 text-sm text-gray-400">
                <Eye size={24} className="mx-auto mb-2 text-gray-300" />
                Click <strong className="text-gray-600">Preview</strong> to render the packing list.
              </div>
            )}
          </Section>
        </div>
      </div>

      {showEmail && packingList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !sending && setShowEmail(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail size={16} className="text-gray-400" /> Send {packingList.final_file_name || packingList.file_name}
              </h3>
              <button onClick={() => setShowEmail(false)} disabled={sending} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="To (comma-separated)" value={emailTo} onChange={setEmailTo} placeholder="buyer@example.com" />
              <Field label="CC (comma-separated)" value={emailCc} onChange={setEmailCc} placeholder="logistics@example.com" />
              <Field label="Subject" value={emailSubject} onChange={setEmailSubject} />
              <AreaField label="Message (optional)" value={emailMessage} onChange={setEmailMessage} rows={4} placeholder="Leave empty to use the default covering note." />
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <FileText size={12} /> {packingList.final_file_name || `${packingList.file_name} (draft — not finalized yet)`} will be attached.
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
