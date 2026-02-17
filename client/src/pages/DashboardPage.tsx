import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import { Users, Truck, FileText, ShoppingCart, Package, DollarSign, TrendingUp, Clock } from 'lucide-react';

interface Stats {
  customers: number;
  suppliers: number;
  totalOrders: number;
  activeOrders: number;
  totalInvoices: number;
  pendingInvoiceAmount: number;
  paidInvoiceAmount: number;
  totalPayments: number;
  activeShipments: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);
  const [shippingOverview, setShippingOverview] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/stats'),
      api.get('/dashboard/recent-orders'),
      api.get('/dashboard/pending-invoices'),
      api.get('/dashboard/shipping-overview'),
    ]).then(([s, o, i, sh]) => {
      setStats(s.data);
      setRecentOrders(o.data);
      setPendingInvoices(i.data);
      setShippingOverview(sh.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;

  const statCards = [
    { label: 'Customers', value: stats?.customers ?? 0, icon: Users, color: 'text-blue-600 bg-blue-100', to: '/customers' },
    { label: 'Suppliers', value: stats?.suppliers ?? 0, icon: Truck, color: 'text-purple-600 bg-purple-100', to: '/suppliers' },
    { label: 'Active Orders', value: stats?.activeOrders ?? 0, icon: ShoppingCart, color: 'text-orange-600 bg-orange-100', to: '/orders' },
    { label: 'Active Shipments', value: stats?.activeShipments ?? 0, icon: Package, color: 'text-green-600 bg-green-100', to: '/shipments' },
    { label: 'Pending Invoices', value: `$${(stats?.pendingInvoiceAmount ?? 0).toLocaleString()}`, icon: Clock, color: 'text-yellow-600 bg-yellow-100', to: '/invoices' },
    { label: 'Paid Invoices', value: `$${(stats?.paidInvoiceAmount ?? 0).toLocaleString()}`, icon: DollarSign, color: 'text-green-600 bg-green-100', to: '/invoices' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map(card => (
          <Link key={card.label} to={card.to}>
            <Card className="p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${card.color}`}>
                  <card.icon size={24} />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Orders</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentOrders.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No orders yet</p>
            ) : recentOrders.slice(0, 5).map((order: any) => (
              <Link key={order.id} to={`/orders/${order.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{order.order_number}</p>
                  <p className="text-xs text-gray-500">{order.customer_name || order.supplier_name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-900">${order.total_amount?.toLocaleString()}</span>
                  <StatusBadge status={order.status} />
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Pending Invoices</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {pendingInvoices.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No pending invoices</p>
            ) : pendingInvoices.slice(0, 5).map((inv: any) => (
              <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{inv.invoice_number}</p>
                  <p className="text-xs text-gray-500">{inv.customer_name || inv.supplier_name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-900">${inv.amount?.toLocaleString()}</span>
                  <StatusBadge status={inv.status} />
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Active Shipments</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {shippingOverview.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No active shipments</p>
            ) : shippingOverview.slice(0, 5).map((sh: any) => (
              <Link key={sh.id} to={`/shipments/${sh.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{sh.tracking_number || `Shipment #${sh.id}`}</p>
                  <p className="text-xs text-gray-500">{sh.carrier} {sh.order_number ? `- ${sh.order_number}` : ''}</p>
                </div>
                <StatusBadge status={sh.status} />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
