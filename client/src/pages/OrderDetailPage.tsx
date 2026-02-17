import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import StatusBadge from '../components/ui/StatusBadge';
import { ArrowLeft, Package, Truck, Clock, ArrowRight, Pencil } from 'lucide-react';

const statusOptions = [
  { value: 'order_placed', label: 'Order Placed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const typeColors: Record<string, 'blue' | 'purple'> = {
  customer: 'blue',
  supplier: 'purple',
};

const typeLabels: Record<string, string> = {
  customer: 'Customer Order',
  supplier: 'Supplier Order',
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchOrder = () => {
    setLoading(true);
    api.get(`/orders/${id}`)
      .then(res => {
        setOrder(res.data);
        setNewStatus(res.data.status || '');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrder(); }, [id]);

  const handleStatusUpdate = async () => {
    if (!newStatus || newStatus === order.status) {
      addToast('Please select a different status', 'error');
      return;
    }
    setUpdatingStatus(true);
    try {
      await api.patch(`/orders/${id}/status`, { status: newStatus });
      addToast('Status updated', 'success');
      fetchOrder();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update status', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount == null) return '$0.00';
    return `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!order) {
    return <p className="text-center py-20 text-gray-500">Order not found</p>;
  }

  const items: any[] = order.items || [];
  const shipments: any[] = order.shipments || [];
  const statusHistory: any[] = order.status_history || [];

  const itemsTotal = items.reduce(
    (sum: number, item: any) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  );

  return (
    <div className="space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Back to Orders
      </Link>

      {/* Order Info */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900">{order.order_number}</h1>
              <Badge variant={typeColors[order.type] || 'gray'}>{typeLabels[order.type] || order.type}</Badge>
            </div>
            <StatusBadge status={order.status} />
          </div>
          <Link to={`/orders/${id}/edit`}>
            <Button variant="secondary" size="sm"><Pencil size={14} /> Edit Order</Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-gray-500 mb-1">{order.type === 'supplier' ? 'Supplier' : 'Customer'}</p>
            <p className="font-medium text-gray-900">{order.customer_name || order.supplier_name || '-'}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">Total Amount</p>
            <p className="font-medium text-gray-900 text-lg">{formatCurrency(order.total_amount)}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">Created</p>
            <p className="font-medium text-gray-900">{formatDate(order.created_at)}</p>
          </div>
        </div>

        {order.description && (
          <div className="mt-6">
            <p className="text-sm text-gray-500 mb-1">Description</p>
            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{order.description}</p>
          </div>
        )}

        {order.notes && (
          <div className="mt-4">
            <p className="text-sm text-gray-500 mb-1">Notes</p>
            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{order.notes}</p>
          </div>
        )}
      </Card>

      {/* Status Update */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Update Status</h2>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-xs space-y-1">
            <label className="block text-sm font-medium text-gray-700">New Status</label>
            <select
              value={newStatus}
              onChange={e => setNewStatus(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {statusOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <Button
            onClick={handleStatusUpdate}
            disabled={updatingStatus || newStatus === order.status}
          >
            {updatingStatus ? 'Updating...' : 'Update Status'}
          </Button>
        </div>
      </Card>

      {/* Order Items */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Package size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Order Items ({items.length})</h2>
        </div>
        {items.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">No items in this order</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Description</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">Quantity</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">Unit Price</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item: any, index: number) => {
                  const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                  return (
                    <tr key={item.id || index} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-900">{item.description}</td>
                      <td className="px-6 py-3 text-right text-gray-600">{item.quantity}</td>
                      <td className="px-6 py-3 text-right text-gray-600">{formatCurrency(item.unit_price)}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-900">{formatCurrency(lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={3} className="px-6 py-3 text-right font-semibold text-gray-700">Total</td>
                  <td className="px-6 py-3 text-right font-bold text-gray-900">{formatCurrency(itemsTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Linked Shipments */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Truck size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Linked Shipments ({shipments.length})</h2>
        </div>
        {shipments.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">No shipments linked to this order</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {shipments.map((s: any) => (
              <Link
                key={s.id}
                to={`/shipments/${s.id}`}
                className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {s.tracking_number || `Shipment #${s.id}`}
                    </p>
                    <p className="text-xs text-gray-500">{s.carrier || 'No carrier specified'}</p>
                  </div>
                </div>
                <StatusBadge status={s.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Status History */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Status History</h2>
        </div>
        {statusHistory.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">No status changes recorded</p>
        ) : (
          <div className="px-6 py-4">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-3.5 top-2 bottom-2 w-px bg-gray-200" />

              <div className="space-y-6">
                {statusHistory.map((entry: any, index: number) => (
                  <div key={entry.id || index} className="relative flex gap-4">
                    {/* Timeline dot */}
                    <div className="relative z-10 flex-shrink-0 w-7 h-7 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                    </div>

                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <StatusBadge status={entry.old_status} />
                        <ArrowRight size={14} className="text-gray-400 flex-shrink-0" />
                        <StatusBadge status={entry.new_status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        {entry.changed_by && <span>by {entry.changed_by}</span>}
                        <span>{formatDate(entry.created_at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
