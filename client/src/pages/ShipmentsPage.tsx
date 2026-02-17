import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import SearchBar from '../components/ui/SearchBar';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Plus, Package, Eye, Trash2 } from 'lucide-react';

const statusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'returned', label: 'Returned' },
  { value: 'failed', label: 'Failed' },
];

export default function ShipmentsPage() {
  const { addToast } = useToast();
  const [shipments, setShipments] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const fetchShipments = () => {
    setLoading(true);
    api.get('/shipments', { params: { page, limit: 20, search, status: statusFilter, type: typeFilter } })
      .then(res => { setShipments(res.data.data); setTotal(res.data.total); setTotalPages(res.data.totalPages); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchShipments(); }, [page, search, statusFilter, typeFilter]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/shipments/${deleteId}`);
      addToast('Shipment deleted', 'success');
      fetchShipments();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
    setDeleteId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Shipping</h1>
        <Link to="/shipments/new"><Button><Plus size={16} /> New Shipment</Button></Link>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search tracking #, carrier..." />
            </div>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">All Types</option>
              <option value="customer">Customer</option>
              <option value="supplier">Supplier</option>
            </select>
            <span className="text-sm text-gray-500">{total} shipments</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : shipments.length === 0 ? (
          <EmptyState icon={<Package size={24} />} title="No shipments found" description="Create your first shipment." action={<Link to="/shipments/new"><Button size="sm"><Plus size={14} /> New Shipment</Button></Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tracking #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Customer/Supplier</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Carrier</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Order</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Est. Delivery</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shipments.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.tracking_number || `#${s.id}`}</td>
                    <td className="px-4 py-3 text-gray-600">{s.customer_name || s.supplier_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.carrier || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.order_number ? <Link to={`/orders/${s.order_id}`} className="text-primary-600 hover:underline">{s.order_number}</Link> : '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3 text-gray-600">{s.estimated_delivery || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/shipments/${s.id}`} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Eye size={16} /></Link>
                        <button onClick={() => setDeleteId(s.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
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

      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Delete Shipment" message="Are you sure you want to delete this shipment?" confirmLabel="Delete" />
    </div>
  );
}
