import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';
import { Building2, Plus, Save, Star, Trash2, Loader2, Landmark, X } from 'lucide-react';

// The TripleW legal entities that issue documents. Each has a USD and a EUR
// account; a document prints the one matching its currency.

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
}

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function normalise(raw: any): Entity {
  const out: any = { ...raw };
  for (const key of Object.keys(out)) if (out[key] == null) out[key] = '';
  return out as Entity;
}

function Field({ label, value, onChange, placeholder, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

function EntityCard({ entity, onSaved, onDeleted, onDefault }: {
  entity: Entity;
  onSaved: (e: Entity) => void;
  onDeleted: (code: string) => void;
  onDefault: (code: string) => void;
}) {
  const { addToast } = useToast();
  const [form, setForm] = useState<Entity>(entity);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setForm(entity), [entity]);

  const set = (key: keyof Entity) => (value: string) => setForm(prev => ({ ...prev, [key]: value }));
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
        ) : (
          <button onClick={() => onDefault(entity.code)} className="text-xs text-gray-400 hover:text-amber-600 flex items-center gap-1">
            <Star size={12} /> Set as default
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Building2 size={13} /> Company</h3>
          <Field label="Company name" value={form.company_name} onChange={set('company_name')} />
          <Field label="Address line 1" value={form.address1} onChange={set('address1')} />
          <Field label="Address line 2" value={form.address2} onChange={set('address2')} />
          <Field label="Address line 3" value={form.address3} onChange={set('address3')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Contact person" value={form.contact_person} onChange={set('contact_person')} />
            <Field label="Phone" value={form.tel} onChange={set('tel')} />
            <Field label="Email" value={form.email} onChange={set('email')} />
            <Field label="VAT" value={form.vat} onChange={set('vat')} />
            <Field label="KVK / company no." value={form.kvk} onChange={set('kvk')} />
          </div>
          <Field label="Delivery address (order confirmations)" value={form.delivery_address} onChange={set('delivery_address')} />
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Landmark size={13} /> Bank</h3>
          <Field label="Bank name" value={form.bank_name} onChange={set('bank_name')} />
          <Field label="Bank address" value={form.bank_address} onChange={set('bank_address')} />

          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <p className="text-xs font-semibold text-gray-600">USD account <span className="font-normal text-gray-400">— printed on USD documents</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="IBAN / account no." value={form.usd_account} onChange={set('usd_account')} className="sm:col-span-2" />
              <Field label="BIC / SWIFT" value={form.usd_bic} onChange={set('usd_bic')} />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <p className="text-xs font-semibold text-gray-600">EUR account <span className="font-normal text-gray-400">— printed on EUR and other documents</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="IBAN / account no." value={form.eur_account} onChange={set('eur_account')} className="sm:col-span-2" />
              <Field label="BIC / SWIFT" value={form.eur_bic} onChange={set('eur_bic')} />
            </div>
          </div>
          <p className="text-xs text-gray-400">If the matching account is empty, the other one is printed.</p>
        </div>
      </div>
    </div>
  );
}

export default function TripleWDetailsPage() {
  const { addToast } = useToast();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

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
            entity from its operation number (SOBE… → BE) and prints the bank account for its currency.
          </p>
        </div>
        <div className="sm:ml-auto">
          <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add entity</Button>
        </div>
      </div>

      {adding && (
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

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={24} /></div>
      ) : (
        entities.map(entity => (
          <EntityCard
            key={entity.code}
            entity={entity}
            onSaved={saved => setEntities(prev => prev.map(e => (e.code === saved.code ? saved : e)))}
            onDeleted={code => setEntities(prev => prev.filter(e => e.code !== code))}
            onDefault={makeDefault}
          />
        ))
      )}
    </div>
  );
}
