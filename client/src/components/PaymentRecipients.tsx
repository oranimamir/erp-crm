import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, PartyPopper, Plus, Save, Send, X } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from './ui/Card';

/**
 * User Management → Payments: who gets the "Hip hip hooray — we got paid!"
 * email each time a wire transfer is uploaded on a customer invoice. Tick app
 * users (their account email) or add other addresses; one Save for all of it.
 */

interface User { id: number; display_name: string | null; username: string; email: string | null }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PaymentRecipients() {
  const { addToast } = useToast();
  const [recipients, setRecipients] = useState<string[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [configured, setConfigured] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.get('/settings/payment-notifications').then(({ data }) => {
      setRecipients(data.recipients || []);
      setConfigured(!!data.email_configured);
    }).catch(() => addToast('Failed to load the payment email settings', 'error'));
    api.get('/users', { params: { limit: 1000 } })
      .then(({ data }) => setUsers(data?.data || data || []))
      .catch(() => setUsers([]));
  }, []);

  if (!recipients) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-600" size={22} /></div>;

  const has = (key: string) => recipients.includes(key);
  const toggle = (key: string, on: boolean) => {
    setRecipients(prev => (prev ? (on ? [...prev.filter(r => r !== key), key] : prev.filter(r => r !== key)) : prev));
    setDirty(true);
  };
  const others = recipients.filter(r => r.startsWith('email:'));

  function addEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { addToast('Enter a valid email address', 'error'); return; }
    if (has(`email:${email}`)) { addToast('That address already gets the payment emails', 'error'); return; }
    toggle(`email:${email}`, true);
    setNewEmail('');
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const { data } = await api.put('/settings/payment-notifications', { recipients });
      setRecipients(data.recipients || []);
      setDirty(false);
      addToast('Payment email settings saved', 'success');
      return true;
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the payment email settings', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (dirty && !(await save())) return;
    setTesting(true);
    try {
      const { data } = await api.post('/settings/payment-notifications/test');
      addToast(`Test email sent — ${data.message}`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to send the test email', 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <PartyPopper size={18} className="text-green-600" /> Payment received emails
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Each time a wire transfer is uploaded on a customer invoice, the people ticked here get a
          <strong> &ldquo;Hip hip hooray — we got paid!&rdquo;</strong> email with the customer, invoice, operation and amount, and the wire transfer attached.
        </p>
      </div>

      {!configured && (
        <p className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="flex-shrink-0" /> Email is not set up on the server (RESEND_API_KEY), so nothing will be sent.
        </p>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Users</p>
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {users.map(u => {
            const key = `user:${u.id}`;
            const noEmail = !u.email;
            return (
              <label key={u.id} className={`flex items-center gap-3 px-4 py-2.5 ${noEmail ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
                <input type="checkbox" checked={has(key)} disabled={noEmail && !has(key)}
                  onChange={e => toggle(key, e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{u.display_name || u.username}</span>
                  <span className="block text-xs text-gray-500">{u.email || 'No email on this account'}</span>
                </span>
              </label>
            );
          })}
          {users.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">No users</p>}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Other addresses</p>
        {others.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {others.map(r => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                {r.slice(6)}
                <button type="button" onClick={() => toggle(r, false)} className="text-gray-400 hover:text-red-600"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 max-w-md">
          <input type="email" value={newEmail} placeholder="name@example.com"
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <button type="button" onClick={addEmail}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-500">
          {recipients.length === 0 ? 'Nobody gets payment emails yet.' : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.`}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={sendTest} disabled={testing || saving || recipients.length === 0 || !configured}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send a test email
          </button>
          <button type="button" onClick={save} disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </div>
    </Card>
  );
}
