import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import { ArrowLeft, Mail, Phone, MapPin, Building, FileText, ShoppingCart, Package } from 'lucide-react';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const [customer, setCustomer] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/customers/${id}`),
      api.get(`/customers/${id}/invoices`),
      api.get(`/customers/${id}/orders`),
      api.get(`/customers/${id}/shipments`),
    ]).then(([c, i, o, s]) => {
      setCustomer(c.data);
      setInvoices(i.data);
      setOrders(o.data);
      setShipments(s.data);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;
  if (!customer) return <p className="text-center py-20 text-gray-500">Customer not found</p>;

  return (
    <div className="space-y-6">
      <Link to="/customers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} /> Back to Customers</Link>

      <Card className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{customer.name}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {customer.email && <div className="flex items-center gap-2 text-gray-600"><Mail size={16} /> {customer.email}</div>}
          {customer.phone && <div className="flex items-center gap-2 text-gray-600"><Phone size={16} /> {customer.phone}</div>}
          {customer.address && <div className="flex items-center gap-2 text-gray-600"><MapPin size={16} /> {customer.address}</div>}
          {customer.company && <div className="flex items-center gap-2 text-gray-600"><Building size={16} /> {customer.company}</div>}
        </div>
        {customer.notes && <p className="mt-4 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{customer.notes}</p>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <FileText size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Invoices ({invoices.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {invoices.length === 0 ? <p className="px-5 py-6 text-center text-sm text-gray-500">No invoices</p> : invoices.map(inv => (
              <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium">{inv.invoice_number}</p>
                  <p className="text-xs text-gray-500">${inv.amount?.toLocaleString()}</p>
                </div>
                <StatusBadge status={inv.status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <ShoppingCart size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Orders ({orders.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {orders.length === 0 ? <p className="px-5 py-6 text-center text-sm text-gray-500">No orders</p> : orders.map(o => (
              <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium">{o.order_number}</p>
                  <p className="text-xs text-gray-500">${o.total_amount?.toLocaleString()}</p>
                </div>
                <StatusBadge status={o.status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Package size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Shipments ({shipments.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {shipments.length === 0 ? <p className="px-5 py-6 text-center text-sm text-gray-500">No shipments</p> : shipments.map(s => (
              <Link key={s.id} to={`/shipments/${s.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium">{s.tracking_number || `#${s.id}`}</p>
                  <p className="text-xs text-gray-500">{s.carrier || 'No carrier'}</p>
                </div>
                <StatusBadge status={s.status} />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
