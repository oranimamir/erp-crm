import { useEffect, useState } from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';
import api from '../lib/api';
import { todayISO } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { TO_STATUSES } from '../lib/toStatus';

/**
 * New / edit window for a technology operation: entity (BE / NL), number (the
 * next TO<entity><year>NNNN unless one is typed), customer (or a new client
 * added inline), title, date, status, notes.
 */

type Entity = 'BE' | 'NL';

export interface TechnologyOperation {
  id: number;
  to_number: string;
  entity: Entity;
  customer_id: number | null;
  customer_name: string | null;
  title: string | null;
  to_date: string | null;
  status: string;
  notes: string | null;
}

interface Party { id: number; name: string }
interface NewClient { name: string; company: string; address: string; contact_person: string; email: string; phone: string; vat_number: string }
const emptyClient = (): NewClient => ({ name: '', company: '', address: '', contact_person: '', email: '', phone: '', vat_number: '' });

interface FormState { entity: Entity; to_number: string; customer_id: string; title: string; to_date: string; status: string; notes: string }

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export default function TechnologyOperationFormModal({ open, editing, defaultEntity = 'BE', onClose, onSaved }: {
  open: boolean;
  /** The operation being edited, or null for a new one. */
  editing: TechnologyOperation | null;
  defaultEntity?: Entity;
  onClose: () => void;
  onSaved: (row: TechnologyOperation, created: boolean) => void;
}) {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState>({ entity: defaultEntity, to_number: '', customer_id: '', title: '', to_date: todayISO(), status: 'open', notes: '' });
  const [nextNumber, setNextNumber] = useState('');
  const [customers, setCustomers] = useState<Party[]>([]);
  const [saving, setSaving] = useState(false);
  const [newClient, setNewClient] = useState<NewClient | null>(null);
  const [savingClient, setSavingClient] = useState(false);

  const set = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }));

  useEffect(() => {
    if (!open) return;
    setNewClient(null);
    setForm(editing ? {
      entity: editing.entity, to_number: editing.to_number,
      customer_id: editing.customer_id ? String(editing.customer_id) : '',
      title: editing.title || '', to_date: editing.to_date || '', status: editing.status || 'open', notes: editing.notes || '',
    } : { entity: defaultEntity, to_number: '', customer_id: '', title: '', to_date: todayISO(), status: 'open', notes: '' });
    api.get('/customers', { params: { limit: 10000 } })
      .then(res => setCustomers((res.data.data || []).sort((a: Party, b: Party) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, [open, editing?.id]);

  // The number a new operation will get — the server assigns it on save
  useEffect(() => {
    if (!open || editing) return;
    api.get('/technology-operations/next-number', { params: { entity: form.entity, date: form.to_date || undefined } })
      .then(res => setNextNumber(res.data.to_number))
      .catch(() => setNextNumber(''));
  }, [open, editing, form.entity, form.to_date]);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        customer_id: Number(form.customer_id) || null,
        title: form.title, to_date: form.to_date, status: form.status, notes: form.notes,
        // Blank = the next number in the series
        to_number: form.to_number.trim(),
      };
      if (editing) {
        const { data } = await api.put(`/technology-operations/${editing.id}`, payload);
        addToast(`${data.to_number} saved`, 'success');
        onSaved(data, false);
      } else {
        const { data } = await api.post('/technology-operations', { ...payload, entity: form.entity });
        addToast(`${data.to_number} created`, 'success');
        onSaved(data, true);
      }
    } catch (err: any) {
      const suggested = err.response?.data?.suggested;
      if (suggested) set({ to_number: suggested });
      addToast(`${err.response?.data?.error || 'Failed to save'}${suggested ? ` — ${suggested} filled in instead` : ''}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addClient() {
    if (!newClient?.name.trim()) { addToast('Give the client a name', 'error'); return; }
    setSavingClient(true);
    try {
      const { data } = await api.post('/customers', {
        ...newClient, name: newClient.name.trim(), company: newClient.company.trim() || newClient.name.trim(),
      });
      setCustomers(prev => [...prev, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name)));
      set({ customer_id: String(data.id) });
      setNewClient(null);
      addToast(`${data.name} added to Customers`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not add the client', 'error');
    } finally {
      setSavingClient(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !saving && onClose()}
      title={editing ? `Edit ${editing.to_number}` : 'New technology operation'}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {!editing && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Entity</label>
              <div className="flex gap-2">
                {(['BE', 'NL'] as const).map(code => (
                  <button key={code} type="button" onClick={() => set({ entity: code })}
                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                      form.entity === code ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}>{code}</button>
                ))}
              </div>
            </div>
          )}
          <div className={`space-y-1 ${editing ? 'col-span-2' : ''}`}>
            <label className="block text-xs font-medium text-gray-500">Number</label>
            <input value={form.to_number} onChange={e => set({ to_number: e.target.value })}
              placeholder={editing ? editing.to_number : (nextNumber || 'next in the series')}
              className={`${inputCls} font-semibold`} />
            <p className="text-[11px] text-gray-400">
              {editing ? 'Change it to renumber — invoices already generated keep their number.'
                : form.to_number.trim()
                  ? <button type="button" className="text-primary-600 hover:underline" onClick={() => set({ to_number: '' })}>Use automatic</button>
                  : 'Automatic — or type your own.'}
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-500">Customer (invoiced)</label>
            {!newClient && (
              <button type="button" onClick={() => setNewClient(emptyClient())}
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                <UserPlus size={12} /> New client
              </button>
            )}
          </div>
          {!newClient ? (
            <select value={form.customer_id} onChange={e => set({ customer_id: e.target.value })} className={inputCls}>
              <option value="">Choose the customer…</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <div className="space-y-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">New client</span>
                <button type="button" onClick={() => setNewClient(null)} className="text-gray-400 hover:text-gray-600" title="Cancel"><X size={14} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} placeholder="Name *" className={inputCls} autoFocus />
                <input value={newClient.company} onChange={e => setNewClient({ ...newClient, company: e.target.value })} placeholder="Legal / company name" className={inputCls} />
              </div>
              <textarea rows={2} value={newClient.address} onChange={e => setNewClient({ ...newClient, address: e.target.value })} placeholder="Billing address" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <input value={newClient.contact_person} onChange={e => setNewClient({ ...newClient, contact_person: e.target.value })} placeholder="Contact person" className={inputCls} />
                <input value={newClient.email} onChange={e => setNewClient({ ...newClient, email: e.target.value })} placeholder="Email" className={inputCls} />
                <input value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} placeholder="Phone" className={inputCls} />
                <input value={newClient.vat_number} onChange={e => setNewClient({ ...newClient, vat_number: e.target.value })} placeholder="VAT / Tax ID" className={inputCls} />
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={addClient} disabled={savingClient || !newClient.name.trim()}>
                  {savingClient ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Add client
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Title</label>
          <input value={form.title} onChange={e => set({ title: e.target.value })} className={inputCls}
            placeholder="What the technology service is" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Date</label>
            <input type="date" value={form.to_date} onChange={e => set({ to_date: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Status</label>
            <select value={form.status} onChange={e => set({ status: e.target.value })} className={inputCls}>
              {TO_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Notes</label>
          <textarea rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} className={inputCls} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.customer_id || !!newClient}>
            {saving && <Loader2 size={14} className="animate-spin" />} {editing ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
