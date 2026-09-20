import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Loader2, Plus, Save, Star, Trash2 } from 'lucide-react';

/**
 * Per-customer defaults reused when generating documents. A customer may trade
 * as several legal entities, so the data is held per named profile: a shared
 * identity block common to every document, plus a section per document type.
 *
 * The state lives in `useCustomerProfiles` on the page so that switching
 * between the document screens never discards unsaved edits.
 */

export type DocType = 'order_confirmation' | 'invoice' | 'packing_list';

export interface Profile {
  id: number;
  name: string;
  is_default: boolean;
  data: {
    shared: Record<string, string>;
    order_confirmation: Record<string, string>;
    invoice: Record<string, string>;
    packing_list: Record<string, string>;
    match: Record<string, string>;
  };
}

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function Field({ label, value, onChange, placeholder, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <input value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

function Area({ label, value, onChange, placeholder, rows = 3, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      <textarea value={value || ''} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

// ── State shared by the three document screens ────────────────────────────

export function useCustomerProfiles(customerId: string | number) {
  const { addToast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/customers/${customerId}/profiles`);
      setProfiles(data);
      setActiveId(prev => (prev && data.some((p: Profile) => p.id === prev) ? prev : data[0]?.id ?? null));
    } catch {
      addToast('Failed to load document defaults', 'error');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const active = profiles.find(p => p.id === activeId) || null;

  function patch(section: 'shared' | 'match' | DocType, key: string, value: string) {
    if (!active) return;
    setDirty(true);
    setProfiles(prev => prev.map(p => p.id !== active.id ? p : {
      ...p,
      data: { ...p.data, [section]: { ...p.data[section], [key]: value } },
    }));
  }

  function rename(name: string) {
    if (!active) return;
    setDirty(true);
    setProfiles(prev => prev.map(p => (p.id === active.id ? { ...p, name } : p)));
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      await api.put(`/customers/${customerId}/profiles/${active.id}`, { name: active.name, data: active.data });
      addToast('Document defaults saved', 'success');
      setDirty(false);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addProfile() {
    try {
      const { data } = await api.post(`/customers/${customerId}/profiles`, { name: `Profile ${profiles.length + 1}` });
      setProfiles(prev => [...prev, data]);
      setActiveId(data.id);
      setDirty(false);
    } catch {
      addToast('Failed to add profile', 'error');
    }
  }

  async function makeDefault() {
    if (!active) return;
    try {
      await api.put(`/customers/${customerId}/profiles/${active.id}`, { name: active.name, data: active.data, is_default: true });
      addToast(`"${active.name}" is now the default`, 'success');
      setDirty(false);
      load();
    } catch {
      addToast('Failed to set default', 'error');
    }
  }

  async function removeProfile() {
    if (!active) return;
    if (!window.confirm(`Delete the "${active.name}" profile? This cannot be undone.`)) return;
    try {
      await api.delete(`/customers/${customerId}/profiles/${active.id}`);
      setActiveId(null);
      setDirty(false);
      load();
    } catch {
      addToast('Failed to delete profile', 'error');
    }
  }

  return { profiles, active, activeId, setActiveId, loading, saving, dirty, patch, rename, save, addProfile, makeDefault, removeProfile };
}

export type ProfileState = ReturnType<typeof useCustomerProfiles>;

// ── One document screen ───────────────────────────────────────────────────

const TITLES: Record<DocType, string> = {
  order_confirmation: 'Order Confirmation',
  invoice: 'Commercial Invoice',
  packing_list: 'Packing List',
};

export default function DocumentDefaults({ docType, state }: { docType: DocType; state: ProfileState }) {
  const {
    profiles, active, activeId, setActiveId, loading, saving, dirty,
    patch, rename, save, addProfile, makeDefault, removeProfile,
  } = state;

  if (loading) {
    return <Card className="p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-primary-600" /></Card>;
  }

  if (!profiles.length) {
    return (
      <Card className="p-8 text-center text-sm text-gray-500">
        <p>No document defaults yet.</p>
        <p className="text-gray-400 mt-1">Add a profile to stop retyping this customer's details on every document.</p>
        <Button size="sm" className="mt-4" onClick={addProfile}><Plus size={14} /> Add profile</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Billing profile — a customer may trade as several legal entities */}
      <Card className="px-5 py-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-500">Billing profile</span>
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                p.id === activeId
                  ? 'bg-primary-50 border-primary-300 text-primary-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p.name}{p.is_default ? ' ★' : ''}
            </button>
          ))}
          <button onClick={addProfile} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 rounded-lg px-2 py-1.5">
            <Plus size={12} /> Add
          </button>
        </div>
        <div className="flex items-center gap-2">
          {active && !active.is_default && (
            <button onClick={makeDefault} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1">
              <Star size={12} /> Make default
            </button>
          )}
          {active && profiles.length > 1 && (
            <button onClick={removeProfile} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2 py-1">
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </Card>

      {active && (
        <>
          {/* Shared identity — the same values on all three documents */}
          <Card>
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <h2 className="font-semibold text-gray-800 text-sm">Client identity</h2>
              <span className="text-xs text-gray-400">· shared across all documents</span>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Profile name" value={active.name} onChange={rename} placeholder="Costa Rica" />
              <Field label="Client code" value={active.data.shared.client_code} onChange={v => patch('shared', 'client_code', v)} placeholder="00GR01" />
              <Field label="Legal name" value={active.data.shared.legal_name} onChange={v => patch('shared', 'legal_name', v)} placeholder="Astron Chemicals SA" className="sm:col-span-2" />
              <Area label="Billing address (one line per row)" value={active.data.shared.billing_address} onChange={v => patch('shared', 'billing_address', v)} className="sm:col-span-2" />
              <Field label="Tax ID" value={active.data.shared.tax_id} onChange={v => patch('shared', 'tax_id', v)} />
              <Field label="EORI#" value={active.data.shared.eori} onChange={v => patch('shared', 'eori', v)} placeholder="GR094468327" />
              <Field label="Contact person" value={active.data.shared.contact_person} onChange={v => patch('shared', 'contact_person', v)} />
              <Field label="Contact phone" value={active.data.shared.contact_phone} onChange={v => patch('shared', 'contact_phone', v)} />
              <Field label="Contact email" value={active.data.shared.contact_email} onChange={v => patch('shared', 'contact_email', v)} />
              <Field label="Attention" value={active.data.shared.attention} onChange={v => patch('shared', 'attention', v)} placeholder="Melina Mamma m.mamma@…" />
            </div>
          </Card>

          {/* How an incoming order is recognised as belonging to this entity */}
          <Card>
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <h2 className="font-semibold text-gray-800 text-sm">Match orders to this entity</h2>
              <span className="text-xs text-gray-400">· how the system recognises it</span>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500">
                When an order ships to this country, its documents are drafted from this profile.
                You are always asked to confirm before anything is generated.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Country" value={active.data.match?.country} onChange={v => patch('match', 'country', v)} placeholder="Guatemala" />
                <Field label="Other match terms (comma separated)" value={active.data.match?.keywords} onChange={v => patch('match', 'keywords', v)} placeholder="Puerto Quetzal, DISCA" />
              </div>
            </div>
          </Card>

          {/* This document's own defaults */}
          <Card>
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-sm">{TITLES[docType]} defaults</h2>
            </div>
            <div className="p-5 space-y-4">
              {docType === 'packing_list' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Saved for later — the packing list generator is not built yet.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {docType === 'order_confirmation' && (
                  <>
                    <Field label="Delivery (incoterm + place)" value={active.data.order_confirmation.delivery} onChange={v => patch('order_confirmation', 'delivery', v)} placeholder="CIF Piraeus Greece" />
                    <Field label="SQ suffix" value={active.data.order_confirmation.sq_suffix} onChange={v => patch('order_confirmation', 'sq_suffix', v)} placeholder="GR" />
                    <Area label="Delivery address" value={active.data.order_confirmation.delivery_address} onChange={v => patch('order_confirmation', 'delivery_address', v)} rows={2} className="sm:col-span-2" />
                    <Area label="Payment terms" value={active.data.order_confirmation.terms} onChange={v => patch('order_confirmation', 'terms', v)} rows={2} placeholder="100% payable at 60 days date of B/L" className="sm:col-span-2" />
                    <Area label="Note" value={active.data.order_confirmation.note} onChange={v => patch('order_confirmation', 'note', v)} rows={2} className="sm:col-span-2" />
                  </>
                )}

                {docType === 'invoice' && (
                  <>
                    <Field label="Delivery (incoterm + place)" value={active.data.invoice.delivery} onChange={v => patch('invoice', 'delivery', v)} placeholder="CIF Piraeus Greece" />
                    <div />
                    <Area label="Delivery address" value={active.data.invoice.delivery_address} onChange={v => patch('invoice', 'delivery_address', v)} rows={2} className="sm:col-span-2" />
                    <Area label="Payment terms" value={active.data.invoice.terms} onChange={v => patch('invoice', 'terms', v)} rows={2} className="sm:col-span-2" />
                    <Area label="Note" value={active.data.invoice.note} onChange={v => patch('invoice', 'note', v)} rows={2} className="sm:col-span-2" />
                  </>
                )}

                {docType === 'packing_list' && (
                  <>
                    <Field label="Port of loading" value={active.data.packing_list.port_of_loading} onChange={v => patch('packing_list', 'port_of_loading', v)} placeholder="Antwerp" />
                    <Field label="Port of discharge" value={active.data.packing_list.port_of_discharge} onChange={v => patch('packing_list', 'port_of_discharge', v)} placeholder="Piraeus" />
                    <Area label="Consignee / delivery address" value={active.data.packing_list.delivery_address} onChange={v => patch('packing_list', 'delivery_address', v)} rows={2} className="sm:col-span-2" />
                    <Area label="Note" value={active.data.packing_list.note} onChange={v => patch('packing_list', 'note', v)} rows={2} className="sm:col-span-2" />
                  </>
                )}
              </div>

              <div className="flex justify-end pt-3 border-t border-gray-100">
                <Button size="sm" onClick={save} disabled={saving || !dirty}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {dirty ? 'Save changes' : 'Saved'}
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
