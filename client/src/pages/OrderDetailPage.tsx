import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import StatusBadge from '../components/ui/StatusBadge';
import { ArrowLeft, Package, Truck, Clock, ArrowRight, Pencil, Download, Eye, X } from 'lucide-react';

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

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

  const formatCurrency = (amount: number | null | undefined, currency?: string) => {
    if (amount == null) return '—';
    const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    return `${sym}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const isImage = (filename: string) => /\.(jpg|jpeg|png|webp)$/i.test(filename);

  const openPreview = async (apiPath: string, filename: string) => {
    try {
      const res = await api.get(apiPath, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: res.headers['content-type'] || 'application/octet-stream' });
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewFile(filename);
    } catch {
      addToast('Failed to load preview', 'error');
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewFile(null);
  };

  const downloadFile = async (apiPath: string, filename: string) => {
    try {
      const res = await api.get(apiPath, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast('Failed to download file', 'error');
    }
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

  // Compute per-currency totals
  const currencyTotals: Record<string, number> = {};
  items.forEach((item: any) => {
    const cur = item.currency || 'USD';
    const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
    currencyTotals[cur] = (currencyTotals[cur] || 0) + lineTotal;
  });
  const currencyEntries = Object.entries(currencyTotals);

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
              {order.operation_number && (
                <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  Op# {order.operation_number}
                </span>
              )}
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
            {currencyEntries.length > 0 ? (
              <div className="space-y-0.5">
                {currencyEntries.map(([cur, total]) => (
                  <p key={cur} className="font-medium text-gray-900 text-lg">
                    {cur} {Number(total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                ))}
              </div>
            ) : (
              <p className="font-medium text-gray-900 text-lg">{formatCurrency(order.total_amount)}</p>
            )}
          </div>
          <div>
            <p className="text-gray-500 mb-1">Created</p>
            <p className="font-medium text-gray-900">{formatDate(order.created_at)}</p>
          </div>
          {order.payment_due_date && (
            <div>
              <p className="text-gray-500 mb-1">Payment Due</p>
              <p className="font-medium text-orange-600">{formatDate(order.payment_due_date)}</p>
            </div>
          )}
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

        {order.file_path && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
            <span className="text-sm text-gray-600 flex-1 truncate">{order.file_name || order.file_path}</span>
            <button
              onClick={() => openPreview(`/files/orders/${order.file_path}`, order.file_name || order.file_path)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <Eye size={14} /> View
            </button>
            <button
              onClick={() => downloadFile(`/files/orders/${order.file_path}`, order.file_name || order.file_path)}
              className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 border border-primary-200 rounded-lg px-3 py-1.5"
            >
              <Download size={14} /> Download
            </button>
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Client Name</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Quantity</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Unit Price</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item: any, index: number) => {
                  const cur = item.currency || 'USD';
                  const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                  return (
                    <tr key={item.id || index} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-900">
                        <div>{item.description}</div>
                        {item.packaging && <div className="text-xs text-gray-400">{item.packaging}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.client_product_name || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{item.quantity} {item.unit || ''}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(item.unit_price, cur)}/{item.unit || 'unit'}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-900">{cur} {Number(lineTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {currencyEntries.map(([cur, total], i) => (
                  <tr key={cur} className={i === 0 ? 'border-t-2 border-gray-200 bg-gray-50' : 'bg-gray-50'}>
                    <td colSpan={4} className="px-6 py-2 text-right font-semibold text-gray-700">
                      Total ({cur})
                    </td>
                    <td className="px-6 py-2 text-right font-bold text-gray-900">
                      {cur} {Number(total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {currencyEntries.length === 0 && (
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={4} className="px-6 py-3 text-right font-semibold text-gray-700">Total</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">—</td>
                  </tr>
                )}
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

      {/* File Preview Modal */}
      {previewUrl && previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closePreview}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <p className="font-medium text-gray-900 truncate">{previewFile}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadFile(`/files/orders/${order.file_path}`, previewFile)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <Download size={14} /> Download
                </button>
                <button onClick={closePreview} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-4" style={{ minHeight: 0 }}>
              {isImage(previewFile) ? (
                <img src={previewUrl} alt={previewFile} className="max-w-full max-h-full object-contain rounded-lg shadow" />
              ) : (
                <iframe src={previewUrl} title={previewFile} className="w-full rounded-lg shadow bg-white" style={{ height: '70vh' }} />
              )}
            </div>
          </div>
        </div>
      )}

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
