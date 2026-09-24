import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import InvoiceLayoutEditor from './InvoiceLayoutEditor';
import { withDefaults, type InvoiceLayout } from '../lib/invoiceLayout';
import { Check, ChevronDown, ChevronRight, LayoutTemplate, Loader2, Pencil, Plus, Save, Star, Trash2, X } from 'lucide-react';

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
    /** How this customer's Commercial Invoice is laid out. */
    invoice_layout?: Partial<InvoiceLayout>;
  };
  /** Where the layout came from — saved here, a past invoice, or a master. */
  invoice_layout_source?: string;
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

  /** The invoice template is replaced whole — a removed row must stay removed. */
  function patchLayout(layout: InvoiceLayout) {
    if (!active) return;
    setDirty(true);
    setProfiles(prev => prev.map(p => (p.id !== active.id ? p : {
      ...p,
      data: { ...p.data, invoice_layout: layout },
    })));
  }

  /** Renames a profile straight away — only the name is sent, unsaved edits stay pending. */
  async function renameProfile(id: number, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) { addToast('A profile needs a name', 'error'); return false; }
    try {
      await api.put(`/customers/${customerId}/profiles/${id}`, { name: trimmed });
      setProfiles(prev => prev.map(p => (p.id === id ? { ...p, name: trimmed } : p)));
      addToast(`Renamed to "${trimmed}"`, 'success');
      return true;
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to rename', 'error');
      return false;
    }
  }

  async function save(quiet = false): Promise<boolean> {
    if (!active) return true;
    setSaving(true);
    try {
      await api.put(`/customers/${customerId}/profiles/${active.id}`, { name: active.name, data: active.data });
      if (!quiet) addToast('Document defaults saved', 'success');
      setDirty(false);
      return true;
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Unsaved edits belong to the active profile — keep them before leaving it. */
  async function saveBeforeLeaving(): Promise<boolean> {
    if (!dirty) return true;
    const ok = await save(true);
    if (ok && active) addToast(`Saved your changes to "${active.name}"`, 'info');
    return ok;
  }

  async function selectProfile(id: number) {
    if (id === activeId) return;
    if (!(await saveBeforeLeaving())) return;
    setActiveId(id);
  }

  /** A new profile, empty or starting from a copy of the active one's details. */
  async function addProfile(name: string, copyFromActive = false): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) { addToast('A profile needs a name', 'error'); return false; }
    if (!(await saveBeforeLeaving())) return false;
    try {
      const body: any = { name: trimmed };
      if (copyFromActive && active) body.data = active.data;
      const { data } = await api.post(`/customers/${customerId}/profiles`, body);
      setProfiles(prev => [...prev, data]);
      setActiveId(data.id);
      setDirty(false);
      addToast(`Profile "${trimmed}" added`, 'success');
      return true;
    } catch {
      addToast('Failed to add profile', 'error');
      return false;
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

  return { profiles, active, activeId, selectProfile, loading, saving, dirty, patch, patchLayout, renameProfile, save, addProfile, makeDefault, removeProfile };
}

export type ProfileState = ReturnType<typeof useCustomerProfiles>;

// ── One document screen ───────────────────────────────────────────────────

const TITLES: Record<DocType, string> = {
  order_confirmation: 'Order Confirmation',
  invoice: 'Commercial Invoice',
  packing_list: 'Packing List',
};

export default function DocumentDefaults({ docType, state }: { docType: DocType; state: ProfileState }) {
  const { profiles, active, loading, saving, dirty, patch, patchLayout, save } = state;
  const [showTemplate, setShowTemplate] = useState(false);

  if (loading) {
    return <Card className="p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-primary-600" /></Card>;
  }

  if (!profiles.length) return <ProfileBar state={state} />;

  return (
    <div className="space-y-5">
      <ProfileBar state={state} />

      {active && (
        <>
          {/* Shared identity — the same values on all three documents */}
          <Card>
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <h2 className="font-semibold text-gray-800 text-sm">Client identity</h2>
              <span className="text-xs text-gray-400">· shared across all documents</span>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                    <div className="sm:col-span-2 pt-2 border-t border-gray-100">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bank account</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Printed on this profile&rsquo;s invoices, whichever entity issues them.
                        Leave blank to use the issuing entity&rsquo;s own account.
                      </p>
                    </div>
                    <Field label="Bank" value={active.data.invoice.bank_name} onChange={v => patch('invoice', 'bank_name', v)} placeholder="ING Bank NV - Foreign Operations" />
                    <Field label="BIC" value={active.data.invoice.bic} onChange={v => patch('invoice', 'bic', v)} placeholder="INGBNL2A" />
                    <Field label="IBAN" value={active.data.invoice.iban} onChange={v => patch('invoice', 'iban', v)} placeholder="NL55 INGB 0107 6779 54" className="sm:col-span-2" />
                    <Field label="Bank address" value={active.data.invoice.bank_address} onChange={v => patch('invoice', 'bank_address', v)} placeholder="PO Box 1800, 1000 BV Amsterdam, Netherlands" className="sm:col-span-2" />
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
                <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {dirty ? 'Save changes' : 'Saved'}
                </Button>
              </div>
            </div>
          </Card>

          {/* The shape of the document itself — invoices only */}
          {docType === 'invoice' && (
            <Card>
              <button
                type="button"
                onClick={() => setShowTemplate(v => !v)}
                className="w-full px-5 py-3.5 border-b border-gray-100 flex items-center gap-2 text-left hover:bg-gray-50"
              >
                <LayoutTemplate size={16} className="text-gray-400" />
                <span className="font-semibold text-gray-800 text-sm flex-1">
                  Invoice template
                  {active.invoice_layout_source && (
                    <span className="ml-2 font-normal text-xs text-gray-400">from {active.invoice_layout_source}</span>
                  )}
                </span>
                {showTemplate ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
              </button>
              {showTemplate && (
                <div className="p-5 space-y-5">
                  <InvoiceLayoutEditor
                    layout={withDefaults(active.data.invoice_layout)}
                    source={active.invoice_layout_source || 'the standard company template'}
                    customerName={active.data.shared.legal_name || active.name}
                    onChange={patchLayout}
                  />
                  <div className="flex justify-end pt-3 border-t border-gray-100">
                    <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {dirty ? 'Save changes' : 'Saved'}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Profile bar: choose, rename, add, default, delete ─────────────────────

/**
 * The customer's billing profiles, one per legal entity they trade as. Renames
 * and new profiles save immediately; switching away saves pending edits first.
 */
export function ProfileBar({ state }: { state: ProfileState }) {
  const { profiles, active, activeId, selectProfile, renameProfile, addProfile, makeDefault, removeProfile } = state;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);

  const startRename = () => { setNameDraft(active?.name || ''); setRenaming(true); setAdding(false); };
  const commitRename = async () => {
    if (!active) return;
    if (nameDraft.trim() === active.name) { setRenaming(false); return; }
    setBusy(true);
    if (await renameProfile(active.id, nameDraft)) setRenaming(false);
    setBusy(false);
  };
  const commitAdd = async () => {
    setBusy(true);
    if (await addProfile(newName, copy)) { setAdding(false); setNewName(''); setCopy(false); }
    setBusy(false);
  };

  return (
    <Card className="px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-500">Billing profiles</span>
          {profiles.map(p => (
            p.id === activeId && renaming ? (
              <span key={p.id} className="flex items-center gap-1">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
                  className="w-40 rounded-lg border border-primary-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button onClick={commitRename} disabled={busy} className="p-1 rounded text-green-600 hover:bg-green-50" title="Save name"><Check size={14} /></button>
                <button onClick={() => setRenaming(false)} className="p-1 rounded text-gray-400 hover:bg-gray-100" title="Cancel"><X size={14} /></button>
              </span>
            ) : (
              <button
                key={p.id}
                onClick={() => { setRenaming(false); selectProfile(p.id); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  p.id === activeId
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.name}{p.is_default ? ' ★' : ''}
              </button>
            )
          ))}
          {!adding && (
            <button
              onClick={() => { setAdding(true); setRenaming(false); }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 rounded-lg px-2 py-1.5"
            >
              <Plus size={12} /> Add profile
            </button>
          )}
        </div>
        {active && !renaming && (
          <div className="flex items-center gap-2">
            <button onClick={startRename} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1">
              <Pencil size={12} /> Rename
            </button>
            {!active.is_default && (
              <button onClick={makeDefault} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1">
                <Star size={12} /> Make default
              </button>
            )}
            {profiles.length > 1 && (
              <button onClick={removeProfile} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2 py-1">
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        )}
      </div>

      {!profiles.length && !adding && (
        <p className="text-sm text-gray-500">
          No profiles yet. Add one per legal entity this customer trades as (e.g. "Costa Rica", "Guatemala")
          to stop retyping their details on every document.
        </p>
      )}

      {adding && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary-200 bg-primary-50/40 px-3 py-2.5">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Profile name, e.g. Guatemala"
            className="w-56 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {active && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={copy} onChange={e => setCopy(e.target.checked)} />
              Copy details from "{active.name}"
            </label>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={commitAdd} disabled={busy || !newName.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
