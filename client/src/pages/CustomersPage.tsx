import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Plus, Users, Eye, Pencil, Trash2 } from 'lucide-react';

export default function CustomersPage() {
  const { addToast } = useToast();
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', company: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const fetchCustomers = () => {
    setLoading(true);
    api.get('/customers', { params: { page, limit: 20, search } })
      .then(res => { setCustomers(res.data.data); setTotal(res.data.total); setTotalPages(res.data.totalPages); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCustomers(); }, [page, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', address: '', company: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({ name: c.name || '', email: c.email || '', phone: c.phone || '', address: c.address || '', company: c.company || '', notes: c.notes || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { addToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/customers/${editing.id}`, form);
        addToast('Customer updated', 'success');
      } else {
        await api.post('/customers', form);
        addToast('Customer created', 'success');
      }
      setShowModal(false);
      fetchCustomers();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/customers/${deleteId}`);
      addToast('Customer deleted', 'success');
      fetchCustomers();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <Button onClick={openCreate}><Plus size={16} /> Add Customer</Button>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search customers..." />
            </div>
            <span className="text-sm text-gray-500">{total} customers</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : customers.length === 0 ? (
          <EmptyState icon={<Users size={24} />} title="No customers found" description="Get started by adding your first customer." action={<Button onClick={openCreate} size="sm"><Plus size={14} /> Add Customer</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customers.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-gray-600">{c.email || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{c.phone || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{c.company || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/customers/${c.id}`} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Eye size={16} /></Link>
                        <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Pencil size={16} /></button>
                        <button onClick={() => setDeleteId(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Customer' : 'New Customer'} size="lg">
        <div className="space-y-4">
          <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <Input label="Company" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} />
          <Input label="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Delete Customer" message="Are you sure you want to delete this customer? This action cannot be undone." confirmLabel="Delete" />
    </div>
  );
}
