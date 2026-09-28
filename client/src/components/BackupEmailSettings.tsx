import { useEffect, useState } from 'react';
import { Mail, Send, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';

/**
 * The weekly backup by email (admin): who receives it, what it contains and
 * when it goes out — Monday 06:00 Brussels time by default.
 */

type Part = 'database' | 'documents' | 'invoices' | 'operations';

interface Settings {
  enabled: boolean;
  recipients: string[];
  parts: Part[];
  day: number;
  hour: number;
  minute: number;
}

interface LastRun { ok: boolean; at: string; message: string }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PART_HINTS: Record<Part, string> = {
  database: 'Every record — customers, orders, invoices, operations. Enough to restore the app.',
  documents: 'Every uploaded file (orders, invoices, BLs, wire transfers…). Usually too large to email.',
  invoices: 'Customer and supplier invoice PDFs in folders, with their original names.',
  operations: 'A folder per operation (order, documents by category, invoices) plus an Excel overview of all operations. Split into several emails when large.',
};

const selectCls = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

export default function BackupEmailSettings() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recipients, setRecipients] = useState('');
  const [parts, setParts] = useState<Array<{ key: Part; label: string }>>([]);
  const [timezone, setTimezone] = useState('Europe/Brussels');
  const [configured, setConfigured] = useState(true);
  const [last, setLast] = useState<LastRun | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  // App users with an email, offered as one-click recipients
  const [users, setUsers] = useState<Array<{ id: number; display_name: string | null; username: string; email: string }>>([]);

  useEffect(() => {
    api.get('/backup/email').then(({ data }) => {
      setSettings(data.settings);
      setRecipients((data.settings.recipients || []).join(', '));
      setParts(data.parts || []);
      setTimezone(data.timezone || 'Europe/Brussels');
      setConfigured(!!data.email_configured);
      setLast(data.last || null);
    }).catch(() => addToast('Failed to load the backup email settings', 'error'));
    api.get('/users', { params: { limit: 1000 } })
      .then(({ data }) => setUsers((data?.data || []).filter((u: any) => u.email)))
      .catch(() => setUsers([]));
  }, []);

  if (!settings) return null;

  const set = (patch: Partial<Settings>) => setSettings(prev => (prev ? { ...prev, ...patch } : prev));
  const recipientList = recipients.split(/[,;\s]+/).map(r => r.trim()).filter(Boolean);
  const hasRecipient = (email: string) => recipientList.some(r => r.toLowerCase() === email.toLowerCase());
  const toggleUser = (email: string) => setRecipients(
    (hasRecipient(email) ? recipientList.filter(r => r.toLowerCase() !== email.toLowerCase()) : [...recipientList, email]).join(', ')
  );

  const togglePart = (key: Part) =>
    set({ parts: settings.parts.includes(key) ? settings.parts.filter(p => p !== key) : [...settings.parts, key] });

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const { data } = await api.put('/backup/email', { ...settings, recipients });
      setSettings(data.settings);
      setRecipients(data.settings.recipients.join(', '));
      addToast('Backup email settings saved', 'success');
      return true;
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the backup email settings', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    if (!(await save())) return;
    setSending(true);
    try {
      const { data } = await api.post('/backup/email/send');
      setLast(data);
      addToast(data.message, 'success');
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.at) setLast(data);
      addToast(data?.error || 'Failed to send the backup', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900 mb-0.5 flex items-center gap-1.5">
            <Mail size={14} className="text-gray-400" /> Backup by email
          </p>
          <p className="text-sm text-gray-500">Each part is sent as its own ZIP attachment.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer shrink-0">
          <input type="checkbox" checked={settings.enabled} onChange={e => set({ enabled: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          Send automatically
        </label>
      </div>

      {!configured && (
        <p className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="flex-shrink-0" /> Email is not configured on the server (RESEND_API_KEY) — nothing can be sent yet.
        </p>
      )}

      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">Send to (comma-separated)</label>
        <input value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="finance@example.com, ceo@example.com"
          className="block w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        {users.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-gray-500">Users:</span>
            {users.map(u => {
              const on = hasRecipient(u.email);
              return (
                <button key={u.id} type="button" onClick={() => toggleUser(u.email)} title={u.email}
                  className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${on
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {on ? '✓ ' : '+ '}{u.display_name || u.username}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-600">What the backup includes</label>
        {parts.map(p => (
          <label key={p.key} className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={settings.parts.includes(p.key)} onChange={() => togglePart(p.key)}
              className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            <span className="text-sm text-gray-700 leading-tight">
              {p.label}
              <span className="block text-xs text-gray-400">{PART_HINTS[p.key]}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-gray-400">A part over 25 MB is not attached — the email says so, and it can be downloaded above.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Day</label>
          <select value={settings.day} onChange={e => set({ day: Number(e.target.value) })} className={selectCls}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Time ({timezone.replace('_', ' ')})</label>
          <select value={settings.hour} onChange={e => set({ hour: Number(e.target.value), minute: 0 })} className={selectCls}>
            {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
          </select>
        </div>
        <button onClick={save} disabled={saving || sending}
          className="px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
          {saving && !sending ? 'Saving...' : 'Save'}
        </button>
        <button onClick={sendNow} disabled={saving || sending || !configured}
          className="flex items-center gap-1.5 px-4 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send now
        </button>
      </div>

      {last && (
        <p className={`flex items-start gap-2 text-xs ${last.ok ? 'text-green-700' : 'text-red-600'}`}>
          {last.ok ? <CheckCircle size={13} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />}
          <span>Last run {formatDate(last.at)} {new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: {last.message}</span>
        </p>
      )}
    </div>
  );
}
