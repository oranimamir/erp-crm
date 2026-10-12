import { useRef, useState } from 'react';
import { X, Loader2, Upload } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

interface PlanMonth {
  month: string; total: number; payments: number;
  status: 'new' | 'more' | 'same';
  stored_total?: number; new_total: number;
}

const money = (n: number) => `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/**
 * Demo expenses → Import net salaries: the Acerta "total paid by month" Excel.
 * One Salaries row per salary month; a new file adds only what is new — months
 * not imported yet and payments not yet on an imported month.
 */
export default function NetSalaryImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { addToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<PlanMonth[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f); setPlan(null); setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await api.post('/demo-expenses/net-salaries/preview', form);
      const months: PlanMonth[] = res.data.months;
      setPlan(months);
      setTicked(new Set(months.filter(m => m.status !== 'same').map(m => m.month)));
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Could not read the Excel', 'error');
      setFile(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const doImport = async () => {
    if (!file || !plan) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('months', JSON.stringify([...ticked]));
      const res = await api.post('/demo-expenses/net-salaries/import', form);
      const { added, updated, total } = res.data;
      addToast(added || updated ? `Net salaries: ${added} month(s) added${updated ? `, ${updated} updated with new payments` : ''} — ${money(total)}` : 'Nothing new to add', 'success');
      onImported();
      onClose();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Import failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toAdd = (plan || []).filter(m => ticked.has(m.month) && m.status !== 'same').reduce((s, m) => s + m.new_total, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Import net salaries</h2>
            <p className="text-sm text-gray-500 mt-0.5">Net pay to employees per salary month (Acerta Excel) → Demo expenses · Salaries. Only what is new is added.</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={e => pick(e.target.files?.[0])} />
          <button onClick={() => inputRef.current?.click()} disabled={busy}
            className="w-full border-2 border-dashed border-gray-300 rounded-lg py-4 text-sm text-gray-600 hover:border-primary-400 hover:bg-primary-50/40 flex items-center justify-center gap-2">
            {busy && !plan ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {file ? file.name : 'Choose the Excel file'}
          </button>

          {plan && (
            <table className="w-full text-sm mt-4">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="w-8"></th>
                  <th className="text-left py-1.5">Salary month</th>
                  <th className="text-right py-1.5">Payments</th>
                  <th className="text-right py-1.5">Net paid</th>
                  <th className="text-left py-1.5 pl-3">In the system</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.map(m => (
                  <tr key={m.month} className={m.status === 'same' ? 'text-gray-400' : ''}>
                    <td className="py-1.5">
                      <input type="checkbox" disabled={m.status === 'same'} checked={ticked.has(m.month)}
                        onChange={e => setTicked(t => { const n = new Set(t); if (e.target.checked) n.add(m.month); else n.delete(m.month); return n; })} />
                    </td>
                    <td className="py-1.5">{monthName(m.month)}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.payments || ''}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(m.total)}</td>
                    <td className="py-1.5 pl-3 text-xs">
                      {m.status === 'new' ? <span className="text-green-700 font-medium">New month</span>
                        : m.status === 'more' ? <span className="text-amber-700 font-medium">New payments +{money(m.new_total)}</span>
                          : 'Already imported'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between">
          <span className="text-sm text-gray-600">{plan ? <>To add: <strong>{money(toAdd)}</strong></> : ''}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={doImport} disabled={busy || !plan || toAdd === 0}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1.5">
              {busy && plan ? <Loader2 size={14} className="animate-spin" /> : null} Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
