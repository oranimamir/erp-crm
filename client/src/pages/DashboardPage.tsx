import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import { Users, Truck, FileText, ShoppingCart, Package, DollarSign, TrendingUp, Clock, BarChart3, Navigation, AlertTriangle } from 'lucide-react';

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
  const [monthlyPayments, setMonthlyPayments] = useState<any[]>([]);
  const [inTransit, setInTransit] = useState<any[]>([]);
  const [overdueInvoices, setOverdueInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/stats'),
      api.get('/dashboard/recent-orders'),
      api.get('/dashboard/pending-invoices'),
      api.get('/dashboard/shipping-overview'),
      api.get('/dashboard/monthly-payments'),
      api.get('/dashboard/in-transit'),
      api.get('/dashboard/overdue-invoices'),
    ]).then(([s, o, i, sh, mp, it, ov]) => {
      setStats(s.data);
      setRecentOrders(o.data);
      setPendingInvoices(i.data);
      setShippingOverview(sh.data);
      setMonthlyPayments(mp.data);
      setInTransit(it.data);
      setOverdueInvoices(ov.data);
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

      {overdueInvoices.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={20} className="text-red-600" />
            <h2 className="text-lg font-semibold text-red-800">
              {overdueInvoices.length} Overdue Invoice{overdueInvoices.length !== 1 ? 's' : ''}
            </h2>
          </div>
          <div className="divide-y divide-red-100">
            {overdueInvoices.map((inv: any) => {
              const daysOverdue = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24));
              return (
                <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center justify-between py-2 hover:bg-red-100 rounded px-2 -mx-2">
                  <div>
                    <span className="text-sm font-medium text-red-900">{inv.invoice_number}</span>
                    <span className="text-sm text-red-700 ml-2">{inv.customer_name || inv.supplier_name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-red-900">
                      ${inv.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded-full">
                      {daysOverdue} day{daysOverdue !== 1 ? 's' : ''} overdue
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

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

      {/* Monthly Payments Chart */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <BarChart3 size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Monthly Cash Flow (Last 12 Months)</h2>
        </div>
        <div className="p-5">
          {monthlyPayments.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">No payment data available</p>
          ) : (() => {
            const maxVal = Math.max(...monthlyPayments.map(m => Math.max(m.received, m.paid_out)), 1);
            const latest = monthlyPayments[monthlyPayments.length - 1];
            const net = (latest?.received ?? 0) - (latest?.paid_out ?? 0);
            return (
              <div className="space-y-4">
                {/* Summary row for most recent month */}
                <div className="grid grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-0.5">Received (this month)</p>
                    <p className="text-lg font-bold text-green-600">${(latest?.received ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-0.5">Paid Out (this month)</p>
                    <p className="text-lg font-bold text-red-500">${(latest?.paid_out ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-0.5">Net (this month)</p>
                    <p className={`text-lg font-bold ${net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {net >= 0 ? '+' : ''}${net.toLocaleString()}
                    </p>
                  </div>
                </div>
                {/* Legend */}
                <div className="flex items-center gap-5 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received from clients</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400 inline-block" /> Paid to suppliers</span>
                </div>
                {/* Side-by-side bar chart */}
                <div className="flex items-end gap-1.5" style={{ height: '180px' }}>
                  {monthlyPayments.map((m: any) => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <div className="w-full flex items-end justify-center gap-0.5">
                        <div
                          className="flex-1 max-w-[14px] bg-green-500 rounded-t transition-all"
                          style={{ height: `${Math.max(m.received > 0 ? (m.received / maxVal) * 155 : 0, m.received > 0 ? 2 : 0)}px` }}
                          title={`Received: $${m.received.toLocaleString()}`}
                        />
                        <div
                          className="flex-1 max-w-[14px] bg-red-400 rounded-t transition-all"
                          style={{ height: `${Math.max(m.paid_out > 0 ? (m.paid_out / maxVal) * 155 : 0, m.paid_out > 0 ? 2 : 0)}px` }}
                          title={`Paid Out: $${m.paid_out.toLocaleString()}`}
                        />
                        {m.received === 0 && m.paid_out === 0 && (
                          <div className="w-full max-w-[28px] bg-gray-100 rounded-t" style={{ height: '2px' }} />
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">
                        {new Date(m.month + '-01').toLocaleDateString(undefined, { month: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </Card>

      {/* In Transit to Customers */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Navigation size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">In Transit to Customers ({inTransit.length})</h2>
        </div>
        {inTransit.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">No shipments in transit</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Order #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Carrier</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tracking #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">ETA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inTransit.map((sh: any) => (
                  <tr key={sh.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {sh.order_number ? <Link to={`/orders/${sh.order_id}`} className="text-primary-600 hover:text-primary-700">{sh.order_number}</Link> : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{sh.customer_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{sh.carrier || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{sh.tracking_number || '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={sh.status} /></td>
                    <td className="px-4 py-3 text-gray-600">{sh.estimated_delivery ? new Date(sh.estimated_delivery).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
