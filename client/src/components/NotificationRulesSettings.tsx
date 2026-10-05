import { useEffect, useMemo, useState } from 'react';
import { Users, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Button from './ui/Button';

/**
 * Who is notified about whom (admin): one row per person who receives change
 * notifications, one column per user who makes changes. Unticking a box stops
 * that recipient hearing about that user's changes — by email and in the bell.
 */

interface AppUser { id: number; username: string; display_name: string | null; email: string | null; notify_on_changes: number }
interface Mute { recipient: string; actor: number }
interface Recipient { key: string; label: string; sub: string; userId: number | null }

const nameOf = (u: AppUser) => u.display_name || u.username;

export default function NotificationRulesSettings() {
  const { addToast } = useToast();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [opRecipients, setOpRecipients] = useState<string[]>([]);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/notification-rules').then(({ data }) => {
      setUsers(data.users);
      setOpRecipients(data.operation_recipients || []);
      const set = new Set<string>((data.mutes as Mute[]).map(m => `${m.recipient}|${m.actor}`));
      setMuted(set);
      setSaved(set);
    }).catch(() => addToast('Failed to load the notification rules', 'error'));
  }, []);

  // Everyone who gets notifications: users with Notify on, plus emails typed
  // under Operation change emails that aren't an app user's
  const recipients = useMemo<Recipient[]>(() => {
    if (!users) return [];
    const list: Recipient[] = users.filter(u => u.notify_on_changes).map(u => ({
      key: `user:${u.id}`, label: nameOf(u), sub: u.email || 'no email — bell only', userId: u.id,
    }));
    for (const email of opRecipients) {
      const user = users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
      if (user) {
        if (!list.some(r => r.userId === user.id)) {
          list.push({ key: `user:${user.id}`, label: nameOf(user), sub: `${email} · operation changes only`, userId: user.id });
        }
      } else {
        list.push({ key: `email:${email.toLowerCase()}`, label: email, sub: 'operation changes only', userId: null });
      }
    }
    return list;
  }, [users, opRecipients]);

  if (!users) return null;

  const toggle = (recipient: string, actor: number) => setMuted(prev => {
    const next = new Set(prev);
    const key = `${recipient}|${actor}`;
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const dirty = muted.size !== saved.size || [...muted].some(k => !saved.has(k));

  async function save() {
    setSaving(true);
    try {
      const mutes = [...muted].map(k => {
        const at = k.lastIndexOf('|');
        return { recipient: k.slice(0, at), actor: Number(k.slice(at + 1)) };
      });
      const { data } = await api.put('/settings/notification-rules', { mutes });
      const set = new Set<string>((data.mutes as Mute[]).map(m => `${m.recipient}|${m.actor}`));
      setMuted(set);
      setSaved(set);
      addToast('Notification rules saved', 'success');
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
          <Users size={16} className="text-gray-500" />
          Who is notified about whom
        </h2>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-600">
          Each row is someone who receives change notifications; each column is a user who makes changes.
          Untick a box to stop that person being notified about that user's changes — by email and in the bell.
          Nobody is ever notified about their own changes.
        </p>

        {recipients.length === 0 ? (
          <p className="text-sm text-gray-400">
            Nobody receives notifications yet — turn on Notify for a user under Users, or add Operation change email recipients.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Receives ↓ · about changes by →
                  </th>
                  {users.map(u => (
                    <th key={u.id} className="px-3 py-2 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">{nameOf(u)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recipients.map(r => (
                  <tr key={r.key}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{r.label}</div>
                      <div className="text-xs text-gray-400">{r.sub}</div>
                    </td>
                    {users.map(u => (
                      <td key={u.id} className="px-3 py-2 text-center">
                        {r.userId === u.id ? (
                          <span className="text-gray-300" title="Nobody is notified about their own changes">—</span>
                        ) : (
                          <input type="checkbox" checked={!muted.has(`${r.key}|${u.id}`)}
                            onChange={() => toggle(r.key, u.id)}
                            title={`${r.label} ${muted.has(`${r.key}|${u.id}`) ? 'is not' : 'is'} notified about ${nameOf(u)}'s changes`}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving && <Loader2 size={14} className="animate-spin" />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
