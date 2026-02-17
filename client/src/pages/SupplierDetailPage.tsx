import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import Badge from '../components/ui/Badge';
import { ArrowLeft, Mail, Phone, MapPin, Tag, FileText, ShoppingCart, Package, DollarSign } from 'lucide-react';

const categoryColors: Record<string, 'blue' | 'purple' | 'orange' | 'green'> = {
  logistics: 'blue', blenders: 'purple', raw_materials: 'orange', shipping: 'green',
};
const categoryLabels: Record<string, string> = {
  logistics: 'Logistics', blenders: 'Blenders', raw_materials: 'Raw Materials', shipping: 'Shipping',
};

export default function SupplierDetailPage() {
  const { id } = useParams();
  const [supplier, setSupplier] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/suppliers/${id}`),
      api.get(`/suppliers/${id}/invoices`),
      api.get(`/suppliers/${id}/orders`),
      api.get(`/suppliers/${id}/shipments`),
    ]).then(([s, i, o, sh]) => {
      setSupplier(s.data);
      setInvoices(i.data);
      setOrders(o.data);
      setShipments(sh.data);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;
  if (!supplier) return <p className="text-center py-20 text-gray-500">Supplier not found</p>;

  return (
    <div className="space-y-6">
      <Link to="/suppliers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} /> Back to Suppliers</Link>

      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
          <Badge variant={categoryColors[supplier.category] || 'gray'}>{categoryLabels[supplier.category] || supplier.category}</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {supplier.email && <div className="flex items-center gap-2 text-gray-600"><Mail size={16} /> {supplier.email}</div>}
          {supplier.phone && <div className="flex items-center gap-2 text-gray-600"><Phone size={16} /> {supplier.phone}</div>}
          {supplier.address && <div className="flex items-center gap-2 text-gray-600"><MapPin size={16} /> {supplier.address}</div>}
        </div>
        {supplier.notes && <p className="mt-4 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{supplier.notes}</p>}
      </Card>

      {/* Financial Summary */}
      {invoices.length > 0 && (() => {
        const totalCount = invoices.length;
        const totalAmount = invoices.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
        const paidAmount = invoices.filter((inv: any) => inv.status === 'paid').reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
        const outstanding = totalAmount - paidAmount;
        return (
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Financial Summary</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Total Invoices</p>
                <p className="text-xl font-bold text-blue-700">{totalCount}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-600 font-medium">Total Amount</p>
                <p className="text-xl font-bold text-gray-700">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 font-medium">Paid</p>
                <p className="text-xl font-bold text-green-700">${paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="bg-yellow-50 rounded-lg p-3 text-center">
                <p className="text-xs text-yellow-600 font-medium">Outstanding</p>
                <p className="text-xl font-bold text-yellow-700">${outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </Card>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2"><FileText size={16} className="text-gray-400" /><h2 className="font-semibold text-gray-900">Invoices ({invoices.length})</h2></div>
          <div className="divide-y divide-gray-100">
            {invoices.length === 0 ? <p className="px-5 py-6 text-center text-sm text-gray-500">No invoices</p> : invoices.map(inv => (
              <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div><p className="text-sm font-medium">{inv.invoice_number}</p><p className="text-xs text-gray-500">${inv.amount?.toLocaleString()}</p></div>
                <StatusBadge status={inv.status} />
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2"><ShoppingCart size={16} className="text-gray-400" /><h2 className="font-semibold text-gray-900">Orders ({orders.length})</h2></div>
          <div className="divide-y divide-gray-100">
            {orders.length === 0 ? <p className="px-5 py-6 text-center text-sm text-gray-500">No orders</p> : orders.map(o => (
              <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div><p className="text-sm font-medium">{o.order_number}</p><p className="text-xs text-gray-500">${o.total_amount?.toLocaleString()}</p></div>
                <StatusBadge status={o.status} />
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2"><Package size={16} className="text-gray-400" /><h2 className="font-semibold text-gray-900">Shipments ({shipments.length})</h2></div>
          <div className="divide-y divide-gray-100">
            {shipments.length === 0 ? <p className="px-5 py-6 text-center text-sm text-gray-500">No shipments</p> : shipments.map(s => (
              <Link key={s.id} to={`/shipments/${s.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div><p className="text-sm font-medium">{s.tracking_number || `#${s.id}`}</p><p className="text-xs text-gray-500">{s.carrier || 'No carrier'}</p></div>
                <StatusBadge status={s.status} />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
