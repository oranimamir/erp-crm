import { useEffect, useState } from 'react';
import { Bell, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

/**
 * Operation change emails (admin): when on, every change made to an operation
 * in the Operations tab is emailed to these recipients (not to the person who
 * made the change).
 */

interface Settings { enabled: boolean; recipients: string[]; email_configured: boolean }

export default function OperationNotifySettings() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [saving, setSaving] = useState(false);
  // App users with an email, offered as one-click recipients
  const [users, setUsers] = useState<Array<{ id: number; display_name: string | null; username: string; email: string }>>([]);

  useEffect(() => {
    api.get('/settings/operation-notifications').then(({ data }) => {
      setSettings(data);
      setEnabled(data.enabled);
      setRecipients(data.recipients.join(', '));
    }).catch(() => addToast('Failed to load the operation notification settings', 'error'));
    api.get('/users', { params: { limit: 1000 } })
      .then(({ data }) => setUsers((data?.data || []).filter((u: any) => u.email)))
      .catch(() => setUsers([]));
  }, []);

  if (!settings) return null;

  const recipientList = recipients.split(/[,;\s]+/).map(r => r.trim()).filter(Boolean);
  const hasRecipient = (email: string) => recipientList.some(r => r.toLowerCase() === email.toLowerCase());
  const toggleUser = (email: string) => setRecipients(
    (hasRecipient(email) ? recipientList.filter(r => r.toLowerCase() !== email.toLowerCase()) : [...recipientList, email]).join(', ')
  );

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put('/settings/operation-notifications', { enabled, recipients });
      setSettings(data);
      setEnabled(data.enabled);
      setRecipients(data.recipients.join(', '));
      addToast('Operation notification settings saved', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Bell size={16} className="text-gray-500" />
          Operation change emails
        </h2>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-gray-600">
            Send an email whenever an operation is changed in the Operations tab — created, edited, status, dates, country,
            documents added or removed, or deleted. The person who made the change is not emailed.
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer shrink-0">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            Send notifications
          </label>
        </div>

        {!settings.email_configured && (
          <p className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="flex-shrink-0" /> Email is not configured on the server (RESEND_API_KEY) — nothing can be sent yet.
          </p>
        )}

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600">Send to (comma-separated)</label>
          <input value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="ops@example.com, ceo@example.com"
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

        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
