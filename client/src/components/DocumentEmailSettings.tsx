import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

/**
 * Default recipients for emailed invoices and packing lists (admin). They are
 * pre-filled in the Send by email dialog, next to the customer's contact.
 */

type Kind = 'invoice' | 'packing_list';
type Form = Record<Kind, { to: string; cc: string }>;

const LABELS: Record<Kind, string> = { invoice: 'Invoices', packing_list: 'Packing lists' };

const inputCls = 'block w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

export default function DocumentEmailSettings() {
  const { addToast } = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const fromServer = (data: any): Form => ({
    invoice: { to: (data?.invoice?.to || []).join(', '), cc: (data?.invoice?.cc || []).join(', ') },
    packing_list: { to: (data?.packing_list?.to || []).join(', '), cc: (data?.packing_list?.cc || []).join(', ') },
  });

  useEffect(() => {
    api.get('/settings/document-emails')
      .then(({ data }) => setForm(fromServer(data)))
      .catch(() => addToast('Failed to load the document email settings', 'error'));
  }, []);

  if (!form) return null;

  const set = (kind: Kind, field: 'to' | 'cc', value: string) =>
    setForm(prev => (prev ? { ...prev, [kind]: { ...prev[kind], [field]: value } } : prev));

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const { data } = await api.put('/settings/document-emails', form);
      setForm(fromServer(data));
      addToast('Default document emails saved', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the document email settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Mail size={16} className="text-gray-500" />
          Document emails
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Default recipients, pre-filled when an invoice or a packing list is sent by email (next to the customer&rsquo;s contact).
        </p>
      </div>
      <div className="px-6 py-5 space-y-5">
        {(Object.keys(LABELS) as Kind[]).map(kind => (
          <div key={kind} className="space-y-2">
            <p className="text-sm font-medium text-gray-900">{LABELS[kind]}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">To (comma-separated)</label>
                <input value={form[kind].to} onChange={e => set(kind, 'to', e.target.value)} className={inputCls}
                  placeholder="logistics@example.com" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">CC (comma-separated)</label>
                <input value={form[kind].cc} onChange={e => set(kind, 'cc', e.target.value)} className={inputCls}
                  placeholder="accounting@example.com" />
              </div>
            </div>
          </div>
        ))}
        <button onClick={save} disabled={saving}
          className="px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
