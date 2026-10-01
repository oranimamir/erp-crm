import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

/**
 * Monthly spending limit for AI invoice reading (admin): uploads and the full
 * check stop using AI when this month's spend reaches it.
 */

interface Limit { monthly_usd: number; spent_usd: number; left_usd: number }

export default function AiSpendingSettings() {
  const { addToast } = useToast();
  const [data, setData] = useState<Limit | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/ai-limit')
      .then(({ data }) => { setData(data); setValue(String(data.monthly_usd)); })
      .catch(() => addToast('Failed to load the AI spending limit', 'error'));
  }, []);

  if (!data) return null;

  async function save() {
    setSaving(true);
    try {
      const res = await api.put('/settings/ai-limit', { monthly_usd: Number(value) });
      setData(res.data);
      addToast('AI spending limit saved', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  const pct = data.monthly_usd > 0 ? Math.min(100, (data.spent_usd / data.monthly_usd) * 100) : 100;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Sparkles size={16} className="text-gray-500" />
          AI invoice reading
        </h2>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-600">
          Supplier invoices are checked for free first; AI is used only when that can't confirm them — on upload and in the full check.
          When this month's AI spend reaches the limit, the AI is not used until next month (or until you raise the limit), and you are told which invoices were not read by AI.
        </p>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Spent this month</span>
            <span className="font-medium tabular-nums">${data.spent_usd.toFixed(2)} of ${data.monthly_usd.toFixed(2)}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full">
            <div className={`h-2 rounded-full ${pct >= 90 ? 'bg-red-500' : 'bg-primary-600'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Monthly limit (USD)</label>
            <input type="number" min="0" step="1" value={value} onChange={e => setValue(e.target.value)}
              className="block w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <button onClick={save} disabled={saving || value === String(data.monthly_usd)}
            className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-gray-400">A typical monthly ZIP costs well under $1; checking all invoices once costs a few dollars at most.</p>
      </div>
    </div>
  );
}
