import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, PackageOpen } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';

/**
 * Non-commercial operations: samples sent to customers, and shipping with
 * raw-material suppliers / blenders. Numbered NCO<entity><year><nnn> by the
 * server; never counted as sales.
 */

type NcoType = 'samples' | 'shipping';
type Entity = 'BE' | 'NL';

interface Nco {
  id: number;
  nco_number: string;
  entity: Entity;
  type: NcoType;
  customer_id: number | null;
  supplier_id: number | null;
  customer_name: string | null;
  supplier_name: string | null;
  supplier_category: string | null;
  nco_date: string | null;
  notes: string | null;
}

interface Party { id: number; name: string; category?: string }

const TYPE_LABEL: Record<NcoType, string> = { samples: 'Samples', shipping: 'Shipping' };
const SUPPLIER_CATEGORY_LABEL: Record<string, string> = { raw_materials: 'Raw materials', blenders: 'Blenders' };
const SHIPPING_CATEGORIES = ['raw_materials', 'blenders'];

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function Pills<T extends string>({ value, options, onChange }: {
  value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map(([code, label]) => (
        <button key={label} type="button" onClick={() => onChange(code)}
          className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
            value === code ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}>
          {label}
        </button>
      ))}
    </div>
  );
}

interface FormState { entity: Entity; type: NcoType; customer_id: string; supplier_id: string; nco_date: string; notes: string }

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (entity: Entity = 'BE'): FormState =>
  ({ entity, type: 'samples', customer_id: '', supplier_id: '', nco_date: today(), notes: '' });

export default function NonCommercialOperationsPage() {
  const { addToast } = useToast();
  const [entity, setEntity] = useState<'' | Entity>('');
  const [type, setType] = useState<'' | NcoType>('');
  const [rows, setRows] = useState<Nco[]>([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);

  const [editing, setEditing] = useState<Nco | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [nextNumber, setNextNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Nco | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/non-commercial-operations', { params: { entity: entity || undefined, type: type || undefined } })
      .then(res => setRows(res.data.data || []))
      .catch(() => addToast('Failed to load non-commercial operations', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [entity, type]);

  useEffect(() => {
    api.get('/customers', { params: { limit: 10000 } })
      .then(res => setCustomers((res.data.data || []).sort((a: Party, b: Party) => a.name.localeCompare(b.name))))
      .catch(() => {});
    api.get('/suppliers', { params: { limit: 10000 } })
      .then(res => setSuppliers((res.data.data || [])
        .filter((s: Party) => SHIPPING_CATEGORIES.includes(s.category || ''))
        .sort((a: Party, b: Party) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);

  // The number a new NCO will get — the server assigns it on save
  useEffect(() => {
    if (!showForm || editing) return;
    api.get('/non-commercial-operations/next-number', { params: { entity: form.entity, date: form.nco_date } })
      .then(res => setNextNumber(res.data.nco_number))
      .catch(() => setNextNumber(''));
  }, [showForm, editing, form.entity, form.nco_date]);

  const set = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }));

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm(entity || 'BE'));
    setShowForm(true);
  };

  const openEdit = (row: Nco) => {
    setEditing(row);
    setForm({
      entity: row.entity, type: row.type,
      customer_id: row.customer_id ? String(row.customer_id) : '',
      supplier_id: row.supplier_id ? String(row.supplier_id) : '',
      nco_date: row.nco_date || '', notes: row.notes || '',
    });
    setShowForm(true);
  };

  async function save() {
    setSaving(true);
    try {
      const payload = {
        type: form.type,
        customer_id: form.type === 'samples' ? Number(form.customer_id) || null : null,
        supplier_id: form.type === 'shipping' ? Number(form.supplier_id) || null : null,
        nco_date: form.nco_date,
        notes: form.notes,
      };
      if (editing) {
        await api.put(`/non-commercial-operations/${editing.id}`, payload);
        addToast(`${editing.nco_number} saved`, 'success');
      } else {
        const { data } = await api.post('/non-commercial-operations', { ...payload, entity: form.entity });
        addToast(`${data.nco_number} created`, 'success');
      }
      setShowForm(false);
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: Nco) {
    try {
      await api.delete(`/non-commercial-operations/${row.id}`);
      addToast(`${row.nco_number} deleted`, 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  const partyMissing = form.type === 'samples' ? !form.customer_id : !form.supplier_id;
  const dash = <span className="text-gray-300">—</span>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Non-Commercial Operations</h1>
        <Button onClick={openNew}><Plus size={16} /> New NCO</Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Pills value={entity} onChange={setEntity} options={[['', 'All'], ['BE', 'BE'], ['NL', 'NL']] as const} />
        <Pills value={type} onChange={setType} options={[['', 'All types'], ['samples', 'Samples'], ['shipping', 'Shipping']] as const} />
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            <PackageOpen size={24} className="mx-auto mb-2 text-gray-300" />
            No non-commercial operations yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">NCO #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Customer / Supplier</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.nco_number}</td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(r.nco_date) || dash}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.type === 'samples' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'
                      }`}>{TYPE_LABEL[r.type]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-900">
                      {r.type === 'samples' ? (r.customer_name || dash) : (
                        r.supplier_name ? (
                          <>
                            {r.supplier_name}
                            {r.supplier_category && (
                              <span className="ml-1.5 text-xs text-gray-400">{SUPPLIER_CATEGORY_LABEL[r.supplier_category] || r.supplier_category}</span>
                            )}
                          </>
                        ) : dash
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate" title={r.notes || ''}>{r.notes || dash}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded text-gray-400 hover:text-primary-600" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setDeleteRow(r)} className="p-1.5 rounded text-gray-400 hover:text-red-600" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showForm} onClose={() => !saving && setShowForm(false)}
        title={editing ? `Edit ${editing.nco_number}` : 'New non-commercial operation'}>
        <div className="space-y-4">
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500">Entity</label>
                <Pills value={form.entity} onChange={v => set({ entity: v })} options={[['BE', 'BE'], ['NL', 'NL']] as const} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500">Number</label>
                <div className="text-sm font-semibold text-gray-900 py-1">{nextNumber || '…'}</div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Type</label>
            <Pills value={form.type} onChange={v => set({ type: v })} options={[['samples', 'Samples'], ['shipping', 'Shipping']] as const} />
          </div>

          {form.type === 'samples' ? (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Customer</label>
              <select value={form.customer_id} onChange={e => set({ customer_id: e.target.value })} className={inputCls}>
                <option value="">Choose the customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Supplier (raw materials or blenders)</label>
              <select value={form.supplier_id} onChange={e => set({ supplier_id: e.target.value })} className={inputCls}>
                <option value="">Choose the supplier…</option>
                {SHIPPING_CATEGORIES.map(cat => (
                  <optgroup key={cat} label={SUPPLIER_CATEGORY_LABEL[cat]}>
                    {suppliers.filter(s => s.category === cat).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Date</label>
            <input type="date" value={form.nco_date} onChange={e => set({ nco_date: e.target.value })} className={inputCls} />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Notes</label>
            <textarea rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} className={inputCls}
              placeholder={form.type === 'samples' ? 'What samples, how much…' : 'What is shipped, from / to…'} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || partyMissing}>
              {saving && <Loader2 size={14} className="animate-spin" />} {editing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteRow !== null}
        onClose={() => setDeleteRow(null)}
        onConfirm={() => deleteRow && handleDelete(deleteRow)}
        title="Delete non-commercial operation"
        message={`Delete ${deleteRow?.nco_number ?? ''}? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
