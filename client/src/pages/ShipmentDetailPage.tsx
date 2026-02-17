import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import Badge from '../components/ui/Badge';
import { ArrowLeft, Pencil, MapPin, Truck, Calendar, Hash, Clock } from 'lucide-react';

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'returned', label: 'Returned' },
  { value: 'failed', label: 'Failed' },
];

export default function ShipmentDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const [shipment, setShipment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState('');
  const [statusNotes, setStatusNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  const fetchShipment = () => {
    api.get(`/shipments/${id}`).then(res => {
      setShipment(res.data);
      setNewStatus(res.data.status);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchShipment(); }, [id]);

  const updateStatus = async () => {
    if (newStatus === shipment.status) return;
    setUpdating(true);
    try {
      await api.patch(`/shipments/${id}/status`, { status: newStatus, notes: statusNotes });
      addToast('Status updated', 'success');
      setStatusNotes('');
      fetchShipment();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update', 'error');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;
  if (!shipment) return <p className="text-center py-20 text-gray-500">Shipment not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/shipments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} /> Back to Shipping</Link>
        <Link to={`/shipments/${id}/edit`}><Button variant="secondary" size="sm"><Pencil size={14} /> Edit</Button></Link>
      </div>

      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{shipment.tracking_number || `Shipment #${shipment.id}`}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {shipment.type === 'customer' ? 'Customer' : 'Supplier'}: {shipment.customer_name || shipment.supplier_name}
            </p>
          </div>
          <StatusBadge status={shipment.status} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center gap-2 text-gray-600"><Truck size={16} /> {shipment.carrier || 'No carrier'}</div>
          {shipment.order_number && <div className="flex items-center gap-2 text-gray-600"><Hash size={16} /> <Link to={`/orders/${shipment.order_id}`} className="text-primary-600 hover:underline">{shipment.order_number}</Link></div>}
          {shipment.estimated_delivery && <div className="flex items-center gap-2 text-gray-600"><Calendar size={16} /> Est: {shipment.estimated_delivery}</div>}
          <div className="flex items-center gap-2 text-gray-600"><Clock size={16} /> Created: {new Date(shipment.created_at).toLocaleDateString()}</div>
        </div>
        {shipment.notes && <p className="mt-4 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{shipment.notes}</p>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Update Status</h2>
          </div>
          <div className="p-5 space-y-3">
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <textarea value={statusNotes} onChange={e => setStatusNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            <Button onClick={updateStatus} disabled={updating || newStatus === shipment.status} size="sm">{updating ? 'Updating...' : 'Update Status'}</Button>
          </div>
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Status History</h2>
          </div>
          <div className="p-5">
            {!shipment.status_history?.length ? (
              <p className="text-sm text-gray-500 text-center py-4">No history</p>
            ) : (
              <div className="space-y-3">
                {shipment.status_history.map((h: any) => (
                  <div key={h.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 shrink-0" />
                    <div className="text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        {h.old_status && <><StatusBadge status={h.old_status} /><span className="text-gray-400">&rarr;</span></>}
                        <StatusBadge status={h.new_status} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {h.changed_by_name && `by ${h.changed_by_name} · `}{new Date(h.created_at).toLocaleString()}
                      </p>
                      {h.notes && <p className="text-xs text-gray-600 mt-0.5">{h.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
