import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { NCO_STATUSES, ncoStatusOf } from '../lib/ncoStatus';

/** The NCO's status as a coloured pill that is also the picker; saves on change. */
export default function NcoStatusSelect({ ncoId, status, onSaved }: {
  ncoId: number;
  status: string | null | undefined;
  onSaved: (status: string) => void;
}) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const current = ncoStatusOf(status);

  async function change(next: string) {
    if (next === current.value) return;
    setSaving(true);
    try {
      await api.put(`/non-commercial-operations/${ncoId}`, { status: next });
      onSaved(next);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to change the status', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <select value={current.value} onChange={e => change(e.target.value)} disabled={saving} title="Change the status"
        className={`appearance-none cursor-pointer rounded-full border-0 py-0.5 pl-2 pr-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 ${current.cls}`}>
        {NCO_STATUSES.map(s => <option key={s.value} value={s.value} className="bg-white text-gray-800">{s.label}</option>)}
      </select>
      {saving && <Loader2 size={12} className="animate-spin text-gray-400" />}
    </span>
  );
}
