import { useEffect, useMemo, useState } from 'react';
import { Mail, Send, AlertTriangle, CheckCircle, Loader2, Plus, X, Save, DatabaseBackup } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Card from './ui/Card';

/**
 * User Management → Backups: who gets the weekly backup email and what. Tick
 * a user, then give them Everything (the full backup: database + all uploads)
 * or only the tabs they need (Customers, Operations, Supplier Invoices…).
 * Other addresses can be added the same way. One Save for all of it.
 */

interface Recipient { recipient: string; parts: string[] }
interface Settings { enabled: boolean; recipients: Recipient[]; day: number; hour: number; minute: number }
interface PartInfo { key: string; label: string; hint: string }
interface LastRun { ok: boolean; at: string; message: string }
interface User { id: number; display_name: string | null; username: string; email: string | null }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const selectCls = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function BackupRecipients() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [everything, setEverything] = useState<string[]>(['database', 'documents']);
  const [users, setUsers] = useState<User[]>([]);
  const [timezone, setTimezone] = useState('Europe/Brussels');
  const [configured, setConfigured] = useState(true);
  const [last, setLast] = useState<LastRun | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get('/backup/email').then(({ data }) => {
      setSettings(data.settings);
      setParts(data.parts || []);
      setTabs(data.tabs || []);
      setEverything(data.everything || ['database', 'documents']);
      setTimezone(data.timezone || 'Europe/Brussels');
      setConfigured(!!data.email_configured);
      setLast(data.last || null);
    }).catch(() => addToast('Failed to load the backup settings', 'error'));
    api.get('/users', { params: { limit: 1000 } })
      .then(({ data }) => setUsers(data?.data || data || []))
      .catch(() => setUsers([]));
  }, []);

  const label = useMemo(() => Object.fromEntries(parts.map(p => [p.key, p.label])), [parts]);
  const hint = useMemo(() => Object.fromEntries(parts.map(p => [p.key, p.hint])), [parts]);

  if (!settings) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-600" size={22} /></div>;

  const set = (patch: Partial<Settings>) => { setSettings(prev => (prev ? { ...prev, ...patch } : prev)); setDirty(true); };
  const entry = (key: string) => settings.recipients.find(r => r.recipient === key);
  const setEntry = (key: string, partsFor: string[] | null) => set({
    recipients: partsFor === null
      ? settings.recipients.filter(r => r.recipient !== key)
      : entry(key)
        ? settings.recipients.map(r => (r.recipient === key ? { ...r, parts: partsFor } : r))
        : [...settings.recipients, { recipient: key, parts: partsFor }],
  });
  const isEverything = (p: string[]) => everything.every(e => p.includes(e));
  const missingChoice = settings.recipients.filter(r => !r.parts.length);
  const others = settings.recipients.filter(r => r.recipient.startsWith('email:'));

  async function save(): Promise<boolean> {
    if (missingChoice.length) { addToast('Choose Everything or at least one tab for each person who gets the backup', 'error'); return false; }
    setSaving(true);
    try {
      const { data } = await api.put('/backup/email', settings);
      setSettings(data.settings);
      setDirty(false);
      addToast('Backup settings saved', 'success');
      return true;
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the backup settings', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    if (dirty && !(await save())) return;
    setSending(true);
    try {
      const { data } = await api.post('/backup/email/send');
      setLast(data);
      addToast('Backup sent', 'success');
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.at) setLast(data);
      addToast(data?.error || 'Failed to send the backup', 'error');
    } finally {
      setSending(false);
    }
  }

  function addEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { addToast('Enter a valid email address', 'error'); return; }
    if (entry(`email:${email}`)) { addToast('That address already gets the backup', 'error'); return; }
    setEntry(`email:${email}`, [...everything]);
    setNewEmail('');
  }

  /** The Everything / tabs choice for one recipient. */
  const chooser = (key: string, p: string[]) => {
    const all = isEverything(p);
    const extras = p.filter(x => !tabs.includes(x) && !everything.includes(x));
    return (
      <div className="space-y-2">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs font-medium">
          <button type="button" onClick={() => setEntry(key, [...everything])}
            className={`px-3 py-1 ${all ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            Everything
          </button>
          <button type="button" onClick={() => !all || setEntry(key, [])}
            className={`px-3 py-1 border-l border-gray-300 ${!all ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            Choose tabs
          </button>
        </div>
        {all ? (
          <p className="text-xs text-gray-500">The full backup: {everything.map(e => label[e] || e).join(' + ')}.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {[...tabs, ...extras].map(t => {
              const on = p.includes(t);
              return (
                <button key={t} type="button" title={hint[t]}
                  onClick={() => setEntry(key, on ? p.filter(x => x !== t) : [...p, t])}
                  className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${on
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {on ? '✓ ' : ''}{label[t] || t}
                </button>
              );
            })}
            {!p.length && <span className="text-xs text-red-600">Pick at least one tab</span>}
          </div>
        )}
      </div>
    );
  };

  const row = (key: string, name: string, sub: string | null, disabledReason?: string, removable = false) => {
    const e = entry(key);
    return (
      <tr key={key} className="align-top">
        <td className="px-4 py-3 w-10">
          <input type="checkbox" checked={!!e} disabled={!!disabledReason && !e}
            onChange={ev => setEntry(key, ev.target.checked ? [...everything] : null)}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-40" />
        </td>
        <td className="px-2 py-3 min-w-[180px]">
          <p className="text-sm font-medium text-gray-900">{name}</p>
          {sub && <p className="text-xs text-gray-500">{sub}</p>}
          {disabledReason && <p className="text-xs text-amber-600">{disabledReason}</p>}
        </td>
        <td className="px-2 py-3">
          {e ? chooser(key, e.parts) : <span className="text-xs text-gray-400">No backup</span>}
        </td>
        <td className="px-2 py-3 w-8">
          {removable && (
            <button type="button" onClick={() => setEntry(key, null)} title="Remove this address"
              className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50"><X size={14} /></button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><DatabaseBackup size={16} className="text-gray-400" /> Backup by email</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Tick who gets the backup, then give each person everything or only the tabs they need. Each tab comes as a ZIP with an Excel of its records and its documents.
            </p>
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
          <button onClick={save} disabled={saving || sending || !dirty}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {saving && !sending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {dirty ? 'Save' : 'Saved'}
          </button>
          <button onClick={sendNow} disabled={saving || sending || !configured || !settings.recipients.length}
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
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3" />
                <th className="px-2 py-3">User</th>
                <th className="px-2 py-3">Receives</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => row(`user:${u.id}`, u.display_name || u.username, u.email, u.email ? undefined : 'No email on this account'))}
              {others.map(r => row(r.recipient, r.recipient.slice(6), 'Other address', undefined, true))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
          <Mail size={14} className="text-gray-400" />
          <input value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addEmail(); }}
            placeholder="Someone without an account — email address"
            className="flex-1 min-w-[220px] max-w-sm border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <button type="button" onClick={addEmail}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            <Plus size={14} /> Add address
          </button>
          <span className="text-xs text-gray-400 ml-auto">A part over 25 MB is not attached — the email names it, and it can be downloaded in Settings → Backup.</span>
        </div>
      </Card>
    </div>
  );
}
