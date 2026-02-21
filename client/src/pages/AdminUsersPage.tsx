import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import { Plus, Users, Pencil, Trash2, Mail, Clock, XCircle, Copy, Bell, BellOff, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { formatDate } from '../lib/dates';

const roleOptions = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', role: 'user' });
  const [saving, setSaving] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', display_name: '', role: 'user' });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailResult, setInviteEmailResult] = useState<{ sent: boolean; error?: string | null; not_configured?: boolean } | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);

  // Admin guard
  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, navigate]);

  const fetchUsers = () => {
    setLoading(true);
    api.get('/users', { params: { page, limit: 20, search, role: roleFilter } })
      .then(res => { setUsers(res.data.data); setTotal(res.data.total); setTotalPages(res.data.totalPages); })
      .catch(err => addToast(err.response?.data?.error || 'Failed to load users', 'error'))
      .finally(() => setLoading(false));
  };

  const fetchInvitations = () => {
    api.get('/users/invitations')
      .then(res => setInvitations(res.data))
      .catch(() => {});
  };

  useEffect(() => { fetchUsers(); fetchInvitations(); }, [page, search, roleFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm({ username: '', display_name: '', email: '', password: '', role: 'user' });
    setShowModal(true);
  };

  const openEdit = (u: any) => {
    setEditing(u);
    setForm({ username: u.username || '', display_name: u.display_name || '', email: u.email || '', password: '', role: u.role || 'user' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!editing && !form.username.trim()) { addToast('Username is required', 'error'); return; }
    if (!editing && !form.password) { addToast('Password is required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/users/${editing.id}`, {
          display_name: form.display_name,
          email: form.email,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        });
        addToast('User updated', 'success');
      } else {
        await api.post('/users', form);
        addToast('User created', 'success');
      }
      setShowModal(false);
      fetchUsers();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/users/${deleteId}`);
      addToast('User deleted', 'success');
      fetchUsers();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) { addToast('Email is required', 'error'); return; }
    setInviteSaving(true);
    try {
      const res = await api.post('/users/invite', inviteForm);
      setInviteLink(res.data.invite_link);
      setInviteEmailResult({
        sent: res.data.email_sent,
        error: res.data.email_error,
        not_configured: res.data.email_not_configured,
      });
      fetchInvitations();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to send invite', 'error');
    } finally {
      setInviteSaving(false);
    }
  };

  const handleResendInvite = async (inviteId: number) => {
    setResendingId(inviteId);
    try {
      const res = await api.post(`/users/invitations/${inviteId}/resend`, {});
      if (res.data.email_sent) {
        addToast('Invitation email resent successfully', 'success');
      } else if (res.data.email_not_configured) {
        addToast('Email not configured on server (RESEND_API_KEY missing)', 'error');
      } else {
        addToast(`Email failed: ${res.data.email_error || 'Unknown error'}`, 'error');
      }
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to resend', 'error');
    } finally {
      setResendingId(null);
    }
  };

  const handleToggleNotify = async (userId: number) => {
    try {
      const res = await api.patch(`/users/${userId}/notify`, {});
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, notify_on_changes: res.data.notify_on_changes } : u));
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update notification setting', 'error');
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    try {
      await api.delete(`/users/invitations/${inviteId}`);
      addToast('Invitation revoked', 'success');
      fetchInvitations();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to revoke', 'error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast('Link copied to clipboard', 'success');
  };

  if (currentUser?.role !== 'admin') return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={openCreate}><Plus size={16} /> Add User</Button>
          <Button onClick={() => { setInviteForm({ email: '', display_name: '', role: 'user' }); setInviteLink(null); setInviteEmailResult(null); setShowInviteModal(true); }}><Mail size={16} /> Invite via Email</Button>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search users..." />
            </div>
            <select
              value={roleFilter}
              onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">All Roles</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
            <span className="text-sm text-gray-500">{total} users</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : users.length === 0 ? (
          <EmptyState icon={<Users size={24} />} title="No users found" description="Get started by adding a new user." action={<Button onClick={openCreate} size="sm"><Plus size={14} /> Add User</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Display Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600" title="Receive email notifications on changes">Notify</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Created At</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{u.username}</td>
                    <td className="px-4 py-3 text-gray-600">{u.display_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {u.email ? (
                        <span className="flex items-center gap-1">
                          <Mail size={13} className="text-gray-400" />
                          {u.email}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.role === 'admin' ? 'purple' : 'blue'}>{u.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleNotify(u.id)}
                        title={u.notify_on_changes ? 'Notifications ON — click to disable' : 'Notifications OFF — click to enable'}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                          u.notify_on_changes
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        }`}
                      >
                        {u.notify_on_changes ? <Bell size={12} /> : <BellOff size={12} />}
                        {u.notify_on_changes ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(u)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Pencil size={16} /></button>
                        {u.id !== currentUser?.id && (
                          <button onClick={() => setDeleteId(u.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit User' : 'New User'} size="lg">
        <div className="space-y-4">
          {!editing && (
            <Input label="Username *" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
          )}
          <Input label="Display Name" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
          <Input
            label={editing ? 'Password (leave blank to keep current)' : 'Password *'}
            type="password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
          />
          <Select label="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} options={roleOptions} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Delete User" message="Are you sure you want to delete this user? This action cannot be undone." confirmLabel="Delete" />

      {/* Pending Invitations Section */}
      {invitations.filter(i => !i.accepted_at).length > 0 && (
        <Card>
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Pending Invitations ({invitations.filter(i => !i.accepted_at).length})</h2>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Invited</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Expires</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invitations.filter(i => !i.accepted_at).map(inv => {
                  const expired = new Date(inv.expires_at) < new Date();
                  const appUrl = window.location.origin;
                  const invLink = `${appUrl}/accept-invite?token=${inv.token}`;
                  return (
                    <tr key={inv.id} className={`hover:bg-gray-50 ${expired ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{inv.email}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.display_name || '-'}</td>
                      <td className="px-4 py-3"><Badge variant={inv.role === 'admin' ? 'purple' : 'blue'}>{inv.role}</Badge></td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(inv.created_at)}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {expired ? <span className="text-red-500 text-xs font-medium">Expired</span> : formatDate(inv.expires_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {!expired && (
                            <>
                              <button
                                onClick={() => copyToClipboard(invLink)}
                                className="p-1.5 text-gray-400 hover:text-primary-600 rounded"
                                title="Copy invite link"
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                onClick={() => handleResendInvite(inv.id)}
                                disabled={resendingId === inv.id}
                                className="p-1.5 text-gray-400 hover:text-primary-600 rounded disabled:opacity-50"
                                title="Resend invitation email"
                              >
                                <RefreshCw size={16} className={resendingId === inv.id ? 'animate-spin' : ''} />
                              </button>
                            </>
                          )}
                          <button onClick={() => handleRevokeInvite(inv.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Revoke"><XCircle size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Invite User Modal */}
      <Modal open={showInviteModal} onClose={() => setShowInviteModal(false)} title="Invite User via Email" size="lg">
        <div className="space-y-4">
          {inviteLink ? (
            <div className="space-y-4">
              {/* Email delivery status */}
              {inviteEmailResult?.sent ? (
                <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-3">
                  <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>Invitation email sent successfully to <strong>{inviteForm.email}</strong>.</span>
                </div>
              ) : inviteEmailResult?.not_configured ? (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Email not configured — share the link below instead.</p>
                    <p className="mt-1 text-xs text-amber-700">Add <code className="bg-amber-100 px-1 rounded">RESEND_API_KEY</code> to your server environment variables to enable email sending.</p>
                  </div>
                </div>
              ) : inviteEmailResult?.error?.includes('verify a domain') || inviteEmailResult?.error?.includes('testing emails') ? (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Resend domain not verified — share the link below instead.</p>
                    <p className="mt-1 text-xs text-amber-700">
                      To send emails to any address, verify a domain at{' '}
                      <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="underline font-medium">resend.com/domains</a>
                      {', '}then set <code className="bg-amber-100 px-1 rounded">RESEND_FROM_EMAIL</code> to an address on that domain (e.g. <code className="bg-amber-100 px-1 rounded">noreply@yourdomain.com</code>).
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Email delivery failed — share the link below instead.</p>
                    {inviteEmailResult?.error && (
                      <p className="mt-1 text-xs text-red-700 font-mono break-all">{inviteEmailResult.error}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Invite link — primary action */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">Invite link for <span className="text-primary-600">{inviteForm.email}</span></p>
                  <p className="text-xs text-gray-500 mt-0.5">Send this link to the person you're inviting — it expires in 7 days.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-mono text-xs"
                  />
                </div>
                <button
                  onClick={() => copyToClipboard(inviteLink)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
                >
                  <Copy size={15} />
                  Copy Invite Link
                </button>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setShowInviteModal(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <Input label="Email *" type="email" value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="user@example.com" />
              <Input label="Display Name" value={inviteForm.display_name} onChange={e => setInviteForm({ ...inviteForm, display_name: e.target.value })} placeholder="John Doe" />
              <Select label="Role" value={inviteForm.role} onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })} options={roleOptions} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowInviteModal(false)}>Cancel</Button>
                <Button onClick={handleInvite} disabled={inviteSaving}>{inviteSaving ? 'Sending...' : 'Send Invitation'}</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
