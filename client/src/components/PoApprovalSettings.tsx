import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Loader2, PenLine, ShieldCheck, Trash2, Upload } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Card from './ui/Card';

/**
 * User Management → PO approvals: which users' supplier POs an admin must
 * approve before they are generated, each admin's signature (printed on the
 * POs they generate or approve), and the POs waiting right now.
 */

interface UserRow { id: number; username: string; display_name: string | null; email: string | null; role: 'admin' | 'user'; po_requires_approval: boolean; has_signature: boolean }
interface Pending { id: number; po_number: string; supplier: string; requested_by_name: string | null; approval_requested_at: string | null }

/** An admin's signature, fetched with the session (it is not a public file). */
function SignatureImage({ userId, version }: { userId: number; version: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    api.get(`/settings/po-approvals/${userId}/signature`, { responseType: 'blob' })
      .then(r => { revoke = URL.createObjectURL(r.data); setUrl(revoke); })
      .catch(() => setUrl(null));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [userId, version]);
  return url
    ? <img src={url} alt="Signature" className="h-12 max-w-[180px] object-contain bg-white rounded border border-gray-200 px-2" />
    : <span className="text-xs text-gray-400">…</span>;
}

export default function PoApprovalSettings() {
  const { addToast } = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [versions, setVersions] = useState<Record<number, number>>({});
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const load = () => {
    api.get('/settings/po-approvals').then(r => setUsers(r.data)).catch(() => addToast('Failed to load the users', 'error'));
    api.get('/purchase-orders/approvals/pending').then(r => setPending(r.data || [])).catch(() => {});
  };
  useEffect(load, []);

  const name = (u: UserRow) => u.display_name || u.username;

  async function toggle(u: UserRow) {
    setBusy(u.id);
    try {
      await api.put(`/settings/po-approvals/${u.id}`, { requires: !u.po_requires_approval });
      setUsers(prev => prev?.map(x => (x.id === u.id ? { ...x, po_requires_approval: !u.po_requires_approval } : x)) ?? prev);
      addToast(`${name(u)}'s supplier POs ${!u.po_requires_approval ? 'now need' : 'no longer need'} an admin's approval`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function uploadSignature(u: UserRow, file: File) {
    setBusy(u.id);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/settings/po-approvals/${u.id}/signature`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setUsers(prev => prev?.map(x => (x.id === u.id ? { ...x, has_signature: true } : x)) ?? prev);
      setVersions(v => ({ ...v, [u.id]: (v[u.id] || 0) + 1 }));
      addToast(`Signature saved for ${name(u)}`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to upload the signature', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function removeSignature(u: UserRow) {
    if (!confirm(`Remove ${name(u)}'s signature? POs they approve will then show their name without a signature.`)) return;
    setBusy(u.id);
    try {
      await api.delete(`/settings/po-approvals/${u.id}/signature`);
      setUsers(prev => prev?.map(x => (x.id === u.id ? { ...x, has_signature: false } : x)) ?? prev);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to remove the signature', 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!users) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-600" size={22} /></div>;
  const admins = users.filter(u => u.role === 'admin');
  const others = users.filter(u => u.role !== 'admin');

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Clock size={18} className="text-blue-600" /> Waiting for approval <span className="text-sm font-normal text-gray-400">({pending.length})</span>
          </h2>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {pending.map(p => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-semibold text-gray-900">{p.po_number}</span>
                {p.supplier && <span className="text-sm text-gray-600">{p.supplier}</span>}
                <span className="text-xs text-gray-400">
                  {p.requested_by_name ? `by ${p.requested_by_name}` : ''}{p.approval_requested_at ? ` · ${formatDate(p.approval_requested_at.slice(0, 10))}` : ''}
                </span>
                <Link to={`/purchase-orders/${p.id}`} className="ml-auto text-sm font-medium text-primary-600 hover:underline">Review →</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck size={18} className="text-primary-600" /> Supplier POs that need approval</h2>
          <p className="text-sm text-gray-500 mt-1">
            When a ticked user confirms a supplier purchase order it is not generated yet: the admins get an email, and an admin approves it
            (it is then generated with that admin's signature) or sends it back with a note. Admins never need approval.
          </p>
        </div>
        {others.length === 0 ? (
          <p className="text-sm text-gray-400">There are no non-admin users.</p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {others.map(u => (
              <label key={u.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={u.po_requires_approval} disabled={busy === u.id} onChange={() => toggle(u)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{name(u)}</span>
                  <span className="block text-xs text-gray-500">{u.email || u.username}</span>
                </span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.po_requires_approval ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {u.po_requires_approval ? 'Needs approval' : 'Generates directly'}
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><PenLine size={18} className="text-primary-600" /> Admin signatures</h2>
          <p className="text-sm text-gray-500 mt-1">
            Printed under "Approved for TripleW" with the admin's name and date on the supplier POs they generate or approve.
            A PNG with a transparent or white background works best (up to 2 MB).
          </p>
        </div>
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {admins.map(u => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-[160px] flex-1">
                <span className="block text-sm font-medium text-gray-900">{name(u)}</span>
                <span className="block text-xs text-gray-500">{u.email || u.username}</span>
              </span>
              {u.has_signature ? <SignatureImage userId={u.id} version={versions[u.id] || 0} /> : <span className="text-xs text-amber-600">No signature yet</span>}
              <input ref={el => { fileRefs.current[u.id] = el; }} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadSignature(u, f); }} />
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={() => fileRefs.current[u.id]?.click()} disabled={busy === u.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  {busy === u.id ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {u.has_signature ? 'Replace' : 'Upload'}
                </button>
                {u.has_signature && (
                  <button onClick={() => removeSignature(u)} disabled={busy === u.id} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Remove the signature">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
