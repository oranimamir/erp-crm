import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';

/**
 * The operation's date, editable in place. Blank = the order date, else the
 * day it was created — the same date the Sales Operations list shows, sorts
 * and filters by.
 */
export default function OperationDateEdit({ operation, onSaved }: {
  operation: { id: number; operation_date?: string | null; order_date?: string | null; created_at: string };
  onSaved: () => void;
}) {
  const { addToast } = useToast();
  const fallback = (operation.order_date || operation.created_at || '').slice(0, 10);
  const shown = operation.operation_date || fallback;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(shown);
  const [saving, setSaving] = useState(false);

  const save = async (next: string | null) => {
    setSaving(true);
    try {
      await api.put(`/operations/${operation.id}`, { operation_date: next });
      addToast(next ? `Operation date set to ${formatDate(next)}` : 'Operation date reset', 'success');
      setEditing(false);
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the date', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" onClick={() => { setValue(shown); setEditing(true); }}
        className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-gray-100 hover:text-gray-700"
        title="Change the operation date">
        Date {formatDate(shown) || '-'}
        <Pencil size={11} className="text-gray-400" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span>Date</span>
      <input type="date" value={value} autoFocus disabled={saving}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && value) save(value); if (e.key === 'Escape') setEditing(false); }}
        className="rounded-md border border-gray-300 px-1.5 py-0.5 text-sm text-gray-800" />
      <button type="button" disabled={saving || !value} onClick={() => save(value)}
        className="p-1 rounded text-green-700 hover:bg-green-50 disabled:opacity-40" title="Save"><Check size={14} /></button>
      <button type="button" disabled={saving} onClick={() => setEditing(false)}
        className="p-1 rounded text-gray-500 hover:bg-gray-100" title="Cancel"><X size={14} /></button>
      {operation.operation_date && (
        <button type="button" disabled={saving} onClick={() => save(null)}
          className="text-xs text-gray-500 underline hover:text-gray-700"
          title={`Go back to ${operation.order_date ? 'the order date' : 'the day it was created'}`}>
          Reset
        </button>
      )}
    </span>
  );
}
