import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, Mail, Search, Check, Loader2, ExternalLink, Users } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Badge from './ui/Badge';

/**
 * User Management → Notifications (admin). Master/detail: pick someone who
 * receives change notifications, then choose whose changes they hear about.
 * Stored as mutes (`app_settings.notification_mutes`), so anyone not listed is
 * heard about. Each switch saves at once, for that recipient only.
 */

export interface RuleUser {
  id: number; username: string; display_name: string | null; email: string | null;
  role: string; notify_on_changes: number;
}
export interface Mute { recipient: string; actor: number }
export interface NotificationRulesData { users: RuleUser[]; mutes: Mute[]; operation_recipients: string[] }

interface Recipient {
  key: string; label: string; channel: string; userId: number | null; active: boolean; role?: string;
}

export const nameOf = (u: RuleUser) => u.display_name || u.username;

/** How many of the other users this recipient hears about. */
export function scopeOf(data: NotificationRulesData, recipientKey: string, selfId: number | null) {
  const others = data.users.filter(u => u.id !== selfId);
  const muted = new Set(data.mutes.filter(m => m.recipient === recipientKey).map(m => m.actor));
  return { heard: others.filter(u => !muted.has(u.id)).length, total: others.length };
}

export function scopeLabel({ heard, total }: { heard: number; total: number }): string {
  if (heard === total) return 'All users';
  if (heard === 0) return 'Nobody';
  return `${heard} of ${total} users`;
}

function Switch({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: () => void; disabled?: boolean; label: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label}
      onClick={onChange} disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-primary-600' : 'bg-gray-300'
      }`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function NotificationRules({ data, onChange, onToggleNotify, selected, onSelect }: {
  data: NotificationRulesData;
  onChange: (mutes: Mute[]) => void;
  onToggleNotify: (userId: number) => Promise<void>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // Every app user (Notify on or off), then emails typed under Settings →
  // Operation change emails that don't belong to an app user
  const recipients = useMemo<Recipient[]>(() => {
    const list: Recipient[] = data.users.map(u => ({
      key: `user:${u.id}`,
      label: nameOf(u),
      channel: u.email ? 'Email + bell' : 'Bell only — no email',
      userId: u.id,
      active: !!u.notify_on_changes,
      role: u.role,
    }));
    for (const email of data.operation_recipients) {
      const user = data.users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
      if (user) {
        const r = list.find(x => x.userId === user.id)!;
        if (!r.active) { r.active = true; r.channel = 'Operation changes only'; }
      } else {
        list.push({ key: `email:${email.toLowerCase()}`, label: email, channel: 'Operation changes only', userId: null, active: true });
      }
    }
    // Active recipients first, then alphabetical
    return list.sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label));
  }, [data]);

  const visible = recipients.filter(r => !query.trim() || r.label.toLowerCase().includes(query.trim().toLowerCase()));
  const current = recipients.find(r => r.key === selected) || recipients[0] || null;
  const activeCount = recipients.filter(r => r.active).length;

  async function saveMutes(recipient: string, mutedActors: number[]) {
    const before = data.mutes;
    const optimistic = [
      ...before.filter(m => m.recipient !== recipient),
      ...mutedActors.map(actor => ({ recipient, actor })),
    ];
    onChange(optimistic);
    setSaving(true);
    setSavedKey(null);
    try {
      const { data: res } = await api.put(`/settings/notification-rules/${encodeURIComponent(recipient)}`, { muted_actors: mutedActors });
      onChange(res.mutes);
      setSavedKey(recipient);
    } catch (err: any) {
      onChange(before);
      addToast(err.response?.data?.error || 'Failed to save the notification rule', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!current) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-12 text-center text-sm text-gray-500">
        No users yet.
      </div>
    );
  }

  const others = data.users.filter(u => u.id !== current.userId);
  const mutedNow = new Set(data.mutes.filter(m => m.recipient === current.key).map(m => m.actor));
  const scope = scopeOf(data, current.key, current.userId);
  const toggleActor = (actor: number) => {
    const next = new Set(mutedNow);
    if (next.has(actor)) next.delete(actor); else next.add(actor);
    saveMutes(current.key, [...next]);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Choose whose changes each person is notified about — by email and in the bell. New users are heard about by
        everyone until you change it here. Nobody is ever notified about their own changes.
      </p>

      {activeCount === 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <BellOff size={14} className="flex-shrink-0" />
          Nobody receives change notifications yet — switch on “Receive change notifications” for a user below.
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-[280px_1fr]">
        {/* Recipients */}
        <div className="border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50/60">
          <div className="p-3 border-b border-gray-200">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people…"
                className="w-full rounded-lg border border-gray-300 bg-white pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
          <ul className="max-h-[520px] overflow-y-auto divide-y divide-gray-100">
            {visible.map(r => {
              const s = scopeOf(data, r.key, r.userId);
              const isCurrent = r.key === current.key;
              return (
                <li key={r.key}>
                  <button type="button" onClick={() => onSelect(r.key)}
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors border-l-2 ${
                      isCurrent ? 'bg-white border-primary-600' : 'border-transparent hover:bg-white'
                    }`}>
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      r.active ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-400'
                    }`}>
                      {r.userId ? r.label.slice(0, 2).toUpperCase() : <Mail size={14} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-medium ${r.active ? 'text-gray-900' : 'text-gray-400'}`}>{r.label}</span>
                      <span className="block truncate text-xs text-gray-400">{r.active ? r.channel : 'Notifications off'}</span>
                    </span>
                    {r.active
                      ? <Badge variant={s.heard === s.total ? 'green' : s.heard === 0 ? 'gray' : 'blue'}>
                          {s.heard === s.total ? 'All' : `${s.heard}/${s.total}`}
                        </Badge>
                      : <Badge variant="gray">Off</Badge>}
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">No match</li>}
          </ul>
        </div>

        {/* Selected recipient */}
        <div className="min-w-0">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 truncate">What {current.label} is notified about</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {current.active ? `${current.channel} · ${scopeLabel(scope)}` : 'Receives no change notifications'}
              </p>
            </div>
            {current.userId != null ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <Switch checked={!!data.users.find(u => u.id === current.userId)?.notify_on_changes}
                  onChange={() => onToggleNotify(current.userId!)}
                  label="Receive change notifications" />
                Receive change notifications
              </label>
            ) : (
              <Link to="/settings" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
                Managed in Settings → Operation change emails <ExternalLink size={12} />
              </Link>
            )}
          </div>

          <div className="px-6 py-3 flex items-center justify-between border-b border-gray-100 text-xs">
            <span className="font-semibold uppercase tracking-wide text-gray-500">Changes made by</span>
            <span className="flex items-center gap-3">
              {saving ? <span className="flex items-center gap-1 text-gray-400"><Loader2 size={12} className="animate-spin" /> Saving…</span>
                : savedKey === current.key ? <span className="flex items-center gap-1 text-green-600"><Check size={12} /> Saved</span> : null}
              <button type="button" disabled={!current.active || saving || mutedNow.size === 0}
                onClick={() => saveMutes(current.key, [])}
                className="text-primary-600 hover:underline disabled:text-gray-300 disabled:no-underline">Select all</button>
              <button type="button" disabled={!current.active || saving || scope.heard === 0}
                onClick={() => saveMutes(current.key, others.map(u => u.id))}
                className="text-primary-600 hover:underline disabled:text-gray-300 disabled:no-underline">Clear all</button>
            </span>
          </div>

          {!current.active && (
            <p className="mx-6 mt-3 flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <BellOff size={13} /> Switch on “Receive change notifications” to choose whose changes {current.label} hears about.
            </p>
          )}

          <ul className="divide-y divide-gray-100">
            {current.userId != null && (
              <li className="px-6 py-2.5 flex items-center justify-between gap-4 text-sm text-gray-400">
                <span>{current.label} <span className="text-xs">(themself)</span></span>
                <span className="text-xs">Never notified about own changes</span>
              </li>
            )}
            {others.map(u => {
              const heard = !mutedNow.has(u.id);
              return (
                <li key={u.id} className="px-6 py-2.5 flex items-center justify-between gap-4">
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-medium ${current.active ? 'text-gray-900' : 'text-gray-400'}`}>{nameOf(u)}</span>
                    <span className="block truncate text-xs text-gray-400">{u.email || u.username} · {u.role}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`hidden sm:inline text-xs ${heard && current.active ? 'text-gray-600' : 'text-gray-400'}`}>
                      {heard ? <><Bell size={11} className="inline -mt-0.5" /> Notified</> : 'Not notified'}
                    </span>
                    <Switch checked={heard} disabled={!current.active || saving} onChange={() => toggleActor(u.id)}
                      label={`${current.label} ${heard ? 'is' : 'is not'} notified about ${nameOf(u)}'s changes`} />
                  </span>
                </li>
              );
            })}
            {others.length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
                <Users size={18} /> No other users yet.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
