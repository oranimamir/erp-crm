import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import EntityBankDocuments from '../components/EntityBankDocuments';
import { Building2, Plus, Save, Star, Trash2, Loader2, Landmark, X, FileDown } from 'lucide-react';

// The TripleW legal entities that issue documents. An entity can hold several
// banks, each with a USD and a EUR account; documents print the default bank's
// account matching their currency. Only an admin edits this page.

interface Bank {
  bank_name: string;
  bank_address: string;
  usd_account: string;
  usd_bic: string;
  eur_account: string;
  eur_bic: string;
}

const EMPTY_BANK: Bank = { bank_name: '', bank_address: '', usd_account: '', usd_bic: '', eur_account: '', eur_bic: '' };

interface Entity {
  code: string;
  company_name: string;
  address1: string;
  address2: string;
  address3: string;
  tel: string;
  email: string;
  vat: string;
  kvk: string;
  contact_person: string;
  bank_name: string;
  bank_address: string;
  usd_account: string;
  usd_bic: string;
  eur_account: string;
  eur_bic: string;
  delivery_address: string;
  is_default: number;
  banks: Bank[];
  default_bank: number;
}

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function normalise(raw: any): Entity {
  const out: any = { ...raw };
  for (const key of Object.keys(out)) if (out[key] == null) out[key] = '';
  if (!Array.isArray(out.banks) || !out.banks.length) {
    out.banks = [Object.fromEntries(Object.keys(EMPTY_BANK).map(k => [k, out[k] || '']))];
  }
  out.default_bank = Math.min(Math.max(Number(out.default_bank) || 0, 0), out.banks.length - 1);
  return out as Entity;
}

function Field({ label, value, onChange, placeholder, className = '', disabled }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; disabled?: boolean;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <input value={value} placeholder={placeholder} disabled={disabled} onChange={e => onChange(e.target.value)}
        className={`${inputCls} ${disabled ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : ''}`} />
    </div>
  );
}

function EntityCard({ entity, canEdit, onSaved, onDeleted, onDefault }: {
  entity: Entity;
  canEdit: boolean;
  onSaved: (e: Entity) => void;
  onDeleted: (code: string) => void;
  onDefault: (code: string) => void;
}) {
  const { addToast } = useToast();
  const [form, setForm] = useState<Entity>(entity);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pdfBank, setPdfBank] = useState('default');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => setForm(entity), [entity]);

  // The saved details as a PDF in the invoice design, to send to a customer / supplier
  async function downloadPdf() {
    setDownloading(true);
    try {
      const resp = await api.get(`/company-entities/${entity.code}/pdf`, {
        params: pdfBank === 'default' ? {} : { bank: pdfBank }, responseType: 'blob',
      });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entity.company_name.replace(/[\\/:*?"<>|]+/g, '-') || entity.code} - Company details.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      addToast('Failed to create the PDF', 'error');
    } finally {
      setDownloading(false);
    }
  }
  const namedBanks = entity.banks.map((b, i) => ({ i, label: b.bank_name || `Bank ${i + 1}` }));

  const set = (key: keyof Entity) => (value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const ro = !canEdit;
  const setBank = (index: number, key: keyof Bank) => (value: string) =>
    setForm(prev => ({ ...prev, banks: prev.banks.map((b, i) => (i === index ? { ...b, [key]: value } : b)) }));
  const addBank = () => setForm(prev => ({ ...prev, banks: [...prev.banks, { ...EMPTY_BANK }] }));
  const removeBank = (index: number) => setForm(prev => ({
    ...prev,
    banks: prev.banks.filter((_, i) => i !== index),
    default_bank: prev.default_bank > index ? prev.default_bank - 1 : prev.default_bank,
  }));
  const dirty = JSON.stringify(form) !== JSON.stringify(entity);

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put(`/company-entities/${entity.code}`, form);
      onSaved(normalise(data));
      addToast(`${data.company_name} saved`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    try {
      await api.delete(`/company-entities/${entity.code}`);
      onDeleted(entity.code);
      addToast(`Entity ${entity.code} deleted`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
      setConfirmDelete(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-primary-50 text-primary-700 text-xs font-bold tracking-wide">{entity.code}</span>
        <h2 className="font-semibold text-gray-800">{entity.company_name}</h2>
        {entity.is_default ? (
          <span className="flex items-center gap-1 text-xs text-amber-600"><Star size={12} className="fill-amber-400" /> Default</span>
        ) : ro ? null : (
          <button onClick={() => onDefault(entity.code)} className="text-xs text-gray-400 hover:text-amber-600 flex items-center gap-1">
            <Star size={12} /> Set as default
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {namedBanks.length > 1 && (
            <select value={pdfBank} onChange={e => setPdfBank(e.target.value)} title="Bank details printed on the PDF"
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="default">Default bank</option>
              {namedBanks.filter(b => b.i !== entity.default_bank).map(b => <option key={b.i} value={String(b.i)}>{b.label}</option>)}
              <option value="all">All banks</option>
            </select>
          )}
          <Button size="sm" variant="secondary" onClick={downloadPdf} disabled={downloading}
            title={dirty ? 'The PDF prints the saved details — save your changes first' : 'Download these details as a PDF to send'}>
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF
          </Button>
        </div>
        {canEdit && <div className="flex items-center gap-2">
          {!entity.is_default && (confirmDelete ? (
            <>
              <span className="text-xs text-red-600">Delete {entity.code}?</span>
              <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Keep</Button>
              <button onClick={remove} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="p-1.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50" title="Delete entity">
              <Trash2 size={15} />
            </button>
          ))}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </Button>
        </div>}
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Building2 size={13} /> Company</h3>
          <Field label="Company name" value={form.company_name} onChange={set('company_name')} disabled={ro} />
          <Field label="Address line 1" value={form.address1} onChange={set('address1')} disabled={ro} />
          <Field label="Address line 2" value={form.address2} onChange={set('address2')} disabled={ro} />
          <Field label="Address line 3" value={form.address3} onChange={set('address3')} disabled={ro} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Contact person" value={form.contact_person} onChange={set('contact_person')} disabled={ro} />
            <Field label="Phone" value={form.tel} onChange={set('tel')} disabled={ro} />
            <Field label="Email" value={form.email} onChange={set('email')} disabled={ro} />
            <Field label="VAT" value={form.vat} onChange={set('vat')} disabled={ro} />
            <Field label="KVK / company no." value={form.kvk} onChange={set('kvk')} disabled={ro} />
          </div>
          <Field label="Delivery address (order confirmations)" value={form.delivery_address} onChange={set('delivery_address')} disabled={ro} />
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Landmark size={13} /> Bank</h3>
          {form.banks.map((bank, i) => {
            const isDefault = form.default_bank === i;
            return (
              <div key={i} className={`rounded-lg border p-3 space-y-3 ${isDefault ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200'}`}>
                <div className="flex items-center gap-2">
                  <label className={`flex items-center gap-1.5 text-xs font-semibold ${isDefault ? 'text-primary-700' : 'text-gray-600'} ${ro ? '' : 'cursor-pointer'}`}>
                    <input type="radio" name={`default-bank-${entity.code}`} checked={isDefault} disabled={ro}
                      onChange={() => setForm(prev => ({ ...prev, default_bank: i }))} />
                    {isDefault ? 'Default bank — printed on documents' : 'Use as default bank'}
                  </label>
                  {canEdit && !isDefault && (
                    <button onClick={() => removeBank(i)} className="ml-auto p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50" title="Remove this bank">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <Field label="Bank name" value={bank.bank_name} onChange={setBank(i, 'bank_name')} disabled={ro} />
                <Field label="Bank address" value={bank.bank_address} onChange={setBank(i, 'bank_address')} disabled={ro} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="USD account — IBAN / account no." value={bank.usd_account} onChange={setBank(i, 'usd_account')} className="sm:col-span-2" disabled={ro} />
                  <Field label="BIC / SWIFT" value={bank.usd_bic} onChange={setBank(i, 'usd_bic')} disabled={ro} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="EUR account — IBAN / account no." value={bank.eur_account} onChange={setBank(i, 'eur_account')} className="sm:col-span-2" disabled={ro} />
                  <Field label="BIC / SWIFT" value={bank.eur_bic} onChange={setBank(i, 'eur_bic')} disabled={ro} />
                </div>
              </div>
            );
          })}
          {canEdit && (
            <button onClick={addBank} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-800">
              <Plus size={13} /> Add another bank
            </button>
          )}
          <p className="text-xs text-gray-400">
            Documents print the default bank: its USD account on USD documents, its EUR account on all others. If the matching account is empty, the other one is printed.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function TripleWDetailsPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin';
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<'details' | 'documents'>('details');
  // Bumped when bank details are applied from a document, so the cards reload their forms
  const [rev, setRev] = useState(0);

  const load = () =>
    api.get('/company-entities')
      .then(({ data }) => setEntities((data || []).map(normalise)))
      .catch(() => addToast('Failed to load the TripleW entities', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  async function create() {
    setCreating(true);
    try {
      const { data } = await api.post('/company-entities', { code: newCode, company_name: newName });
      setEntities(prev => [...prev, normalise(data)]);
      setAdding(false); setNewCode(''); setNewName('');
      addToast(`${data.company_name} added — fill in its details below`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to add entity', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function makeDefault(code: string) {
    try {
      await api.put(`/company-entities/${code}`, { is_default: true });
      await load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to set the default', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={22} className="text-primary-600" /> TripleW Details
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            The entities that issue order confirmations, invoices and purchase orders. Each document picks the
            entity from its operation number (SOBE… → BE) and prints its default bank's account for the document currency.
          </p>
        </div>
        {canEdit ? (
          <div className="sm:ml-auto">
            <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add entity</Button>
          </div>
        ) : (
          <p className="sm:ml-auto text-xs text-gray-500 shrink-0">Read only — an admin can change these details.</p>
        )}
      </div>

      <div className="flex border-b border-gray-200">
        {([['details', 'Details'], ['documents', 'Account ownership documents']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'documents' && (loading
        ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={24} /></div>
        : <EntityBankDocuments entities={entities} canEdit={canEdit}
            onApplied={raw => { const saved = normalise(raw); setEntities(prev => prev.map(e => (e.code === saved.code ? saved : e))); setRev(r => r + 1); }} />)}

      {tab === 'details' && adding && canEdit && (
        <div className="bg-white rounded-xl border border-primary-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 text-sm">New entity</h2>
            <button onClick={() => setAdding(false)} className="p-1 rounded text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Code (2–4 letters)" value={newCode} onChange={v => setNewCode(v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="US" />
            <Field label="Company name" value={newName} onChange={setNewName} placeholder="TripleW US Inc" className="sm:col-span-2" />
          </div>
          <p className="text-xs text-gray-500">
            Operations numbered <strong>SO{newCode || 'XX'}…</strong> will be issued by this entity; you can also pick it by hand on any document.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={create} disabled={creating || newCode.length < 2 || !newName.trim()}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
            </Button>
          </div>
        </div>
      )}

      {tab === 'details' && (loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={24} /></div>
      ) : (
        entities.map(entity => (
          <EntityCard
            key={`${entity.code}-${rev}`}
            entity={entity}
            canEdit={canEdit}
            onSaved={saved => setEntities(prev => prev.map(e => (e.code === saved.code ? saved : e)))}
            onDeleted={code => setEntities(prev => prev.filter(e => e.code !== code))}
            onDefault={makeDefault}
          />
        ))
      ))}
    </div>
  );
}
