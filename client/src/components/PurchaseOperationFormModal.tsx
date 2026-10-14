import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../lib/api';
import { todayISO } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Button from './ui/Button';
import Modal from './ui/Modal';

/**
 * New / edit window for a purchase operation: number (the next PO<year>NNNN
 * unless one is typed), supplier (raw materials / blenders listed, all
 * categories on request, or a typed name), date, notes.
 */

export interface PurchaseOperation {
  id: number;
  po_number: string;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_label: string | null;
  po_date: string | null;
  notes: string | null;
}

interface Supplier { id: number; name: string; category: string | null }

/** Purchases are made from raw-material suppliers and blenders; others on request. */
const TRADING = ['raw_materials', 'blenders'];
const CATEGORY_LABEL: Record<string, string> = {
  raw_materials: 'Raw materials', blenders: 'Blenders', logistics: 'Logistics', shipping: 'Shipping', other: 'Other',
};

interface FormState { po_number: string; supplier_id: string; supplier_name: string; po_date: string; notes: string }

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export default function PurchaseOperationFormModal({ open, editing, onClose, onSaved }: {
  open: boolean;
  /** The purchase operation being edited, or null for a new one. */
  editing: PurchaseOperation | null;
  onClose: () => void;
  onSaved: (row: PurchaseOperation, created: boolean) => void;
}) {
  const { addToast } = useToast();
  const blank = (): FormState => ({ po_number: '', supplier_id: '', supplier_name: '', po_date: todayISO(), notes: '' });
  const [form, setForm] = useState<FormState>(blank());
  const [nextNumber, setNextNumber] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [typed, setTyped] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }));

  useEffect(() => {
    if (!open) return;
    setForm(editing ? {
      po_number: editing.po_number,
      supplier_id: editing.supplier_id ? String(editing.supplier_id) : '',
      supplier_name: editing.supplier_id ? '' : (editing.supplier_name || ''),
      po_date: editing.po_date || '', notes: editing.notes || '',
    } : blank());
    setTyped(!!editing && !editing.supplier_id);
    setShowAll(false);
    api.get('/suppliers', { params: { limit: 10000 } })
      .then(res => setSuppliers((res.data.data || []).sort((a: Supplier, b: Supplier) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, [open, editing?.id]);

  // An edited operation's supplier outside raw materials / blenders still shows
  useEffect(() => {
    const current = suppliers.find(s => String(s.id) === form.supplier_id);
    if (current && !TRADING.includes(current.category || '')) setShowAll(true);
  }, [suppliers]);

  // The number a new purchase operation will get — the server assigns it on save
  useEffect(() => {
    if (!open || editing) return;
    api.get('/purchase-operations/next-number', { params: { date: form.po_date || undefined } })
      .then(res => setNextNumber(res.data.po_number))
      .catch(() => setNextNumber(''));
  }, [open, editing, form.po_date]);

  const groups = useMemo(() => {
    const list = showAll ? suppliers : suppliers.filter(s => TRADING.includes(s.category || ''));
    const keys = [...TRADING, ...Object.keys(CATEGORY_LABEL).filter(k => !TRADING.includes(k))];
    const byKey = new Map<string, Supplier[]>();
    for (const s of list) {
      const k = keys.includes(s.category || '') ? s.category! : 'other';
      byKey.set(k, [...(byKey.get(k) || []), s]);
    }
    return keys.filter(k => byKey.has(k)).map(k => ({ key: k, label: CATEGORY_LABEL[k] || k, suppliers: byKey.get(k)! }));
  }, [suppliers, showAll]);

  const supplierChosen = typed ? !!form.supplier_name.trim() : !!form.supplier_id;

  async function save() {
    setSaving(true);
    try {
      const payload = {
        // Blank = the next number in the series
        po_number: form.po_number.trim(),
        supplier_id: typed ? null : Number(form.supplier_id) || null,
        supplier_name: typed ? form.supplier_name.trim() : null,
        po_date: form.po_date, notes: form.notes,
      };
      if (editing) {
        const { data } = await api.put(`/purchase-operations/${editing.id}`, payload);
        addToast(`${data.po_number} saved`, 'success');
        onSaved(data, false);
      } else {
        const { data } = await api.post('/purchase-operations', payload);
        addToast(`${data.po_number} created`, 'success');
        onSaved(data, true);
      }
    } catch (err: any) {
      const suggested = err.response?.data?.suggested;
      if (suggested) set({ po_number: suggested });
      addToast(`${err.response?.data?.error || 'Failed to save'}${suggested ? ` — ${suggested} filled in instead` : ''}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !saving && onClose()}
      title={editing ? `Edit ${editing.po_number}` : 'New purchase operation'}>
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Number</label>
          <input value={form.po_number} onChange={e => set({ po_number: e.target.value })}
            placeholder={editing ? editing.po_number : (nextNumber || 'next in the series')}
            className={`${inputCls} font-semibold`} />
          <p className="text-[11px] text-gray-400">
            {editing ? 'Change it to renumber — a PO already generated keeps its number.'
              : form.po_number.trim()
                ? <button type="button" className="text-primary-600 hover:underline" onClick={() => set({ po_number: '' })}>Use automatic</button>
                : 'Automatic (PO + year + 4 digits) — or type your own.'}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-500">Supplier</label>
            <div className="flex items-center gap-3 text-xs">
              {!typed && (
                <label className="inline-flex items-center gap-1 text-gray-500">
                  <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                  All categories
                </label>
              )}
              <button type="button" className="text-primary-600 hover:text-primary-700"
                onClick={() => { setTyped(t => !t); set({ supplier_id: '', supplier_name: '' }); }}>
                {typed ? 'Choose from Suppliers' : 'Other (type a name)'}
              </button>
            </div>
          </div>
          {typed ? (
            <input value={form.supplier_name} onChange={e => set({ supplier_name: e.target.value })} className={inputCls}
              placeholder="Supplier name" autoFocus />
          ) : (
            <select value={form.supplier_id} onChange={e => set({ supplier_id: e.target.value })} className={inputCls}>
              <option value="">{showAll ? 'Choose the supplier…' : 'Choose a raw materials supplier or blender…'}</option>
              {groups.map(g => (
                <optgroup key={g.key} label={g.label}>
                  {g.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Date</label>
          <input type="date" value={form.po_date} onChange={e => set({ po_date: e.target.value })} className={inputCls} />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Notes</label>
          <textarea rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} className={inputCls} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !supplierChosen}>
            {saving && <Loader2 size={14} className="animate-spin" />} {editing ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
