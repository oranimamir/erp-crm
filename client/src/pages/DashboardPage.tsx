import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import { Package, TrendingUp, Clock, BarChart3, Navigation } from 'lucide-react';
import { formatDate } from '../lib/dates';

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

const OP_STATUS_COLORS: Record<string, string> = {
  'pre-ordered': 'bg-purple-100 text-purple-800',
  ordered:       'bg-yellow-100 text-yellow-800',
  shipped:       'bg-blue-100   text-blue-800',
  delivered:     'bg-green-100  text-green-800',
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [openOperations, setOpenOperations] = useState<any[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);
  const [shippingOverview, setShippingOverview] = useState<any[]>([]);
  const [monthlyPayments, setMonthlyPayments] = useState<any[]>([]);
  const [inTransit, setInTransit] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/stats'),
      api.get('/dashboard/open-operations'),
      api.get('/dashboard/pending-invoices'),
      api.get('/dashboard/shipping-overview'),
      api.get('/dashboard/monthly-payments'),
      api.get('/dashboard/in-transit'),
      api.get('/dashboard/forecast'),
    ]).then(([s, o, i, sh, mp, it, fc]) => {
      setStats(s.data);
      setOpenOperations(o.data);
      setPendingInvoices(i.data);
      setShippingOverview(sh.data);
      setMonthlyPayments(mp.data);
      setInTransit(it.data);
      setForecast(fc.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;

  const statCards = [
    { label: 'Active Shipments', value: stats?.activeShipments ?? 0, icon: Package, color: 'text-green-600 bg-green-100', to: '/shipments' },
    { label: 'Pending Receivable (EUR)', value: `€${(stats?.pendingInvoiceAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Clock, color: 'text-yellow-600 bg-yellow-100', to: '/invoices' },
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
        {/* Open Operations */}
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Open Operations</h2>
            <Link to="/operations" className="text-xs text-primary-600 hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {openOperations.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No open operations</p>
            ) : openOperations.slice(0, 8).map((op: any) => (
              <Link key={op.id} to={`/operations/${op.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{op.operation_number}</p>
                  <p className="text-xs text-gray-500">{op.customer_name || op.supplier_name || op.order_number || '—'}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${OP_STATUS_COLORS[op.status] || 'bg-gray-100 text-gray-700'}`}>
                  {op.status}
                </span>
              </Link>
            ))}
          </div>
        </Card>

        {/* Pending Invoices — all sent, overdue marked in red */}
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Pending Invoices</h2>
            <span className="text-xs text-gray-400">{pendingInvoices.length} total</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {pendingInvoices.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No pending invoices</p>
            ) : pendingInvoices.map((inv: any) => {
              const isOverdue = inv.status === 'overdue' ||
                (inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid' && inv.status !== 'cancelled');
              const daysOverdue = isOverdue && inv.due_date
                ? Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000)
                : 0;
              return (
                <Link key={inv.id} to={`/invoices/${inv.id}`}
                  className={`flex items-center justify-between px-5 py-3 hover:bg-gray-50 ${isOverdue ? 'bg-red-50 hover:bg-red-100' : ''}`}
                >
                  <div>
                    <p className={`text-sm font-medium ${isOverdue ? 'text-red-900' : 'text-gray-900'}`}>
                      {inv.invoice_number}
                    </p>
                    <p className="text-xs text-gray-500">{inv.customer_name || inv.supplier_name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {inv.due_date && (
                      <span className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                        {isOverdue ? `${daysOverdue}d overdue` : `Due ${formatDate(inv.due_date)}`}
                      </span>
                    )}
                    <span className={`text-sm font-medium ${isOverdue ? 'text-red-900' : 'text-gray-900'}`}>
                      €{(inv.eur_amount ?? inv.amount)?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                    <StatusBadge status={inv.status} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        {/* Active Shipments */}
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

      {/* Monthly Cash Flow Chart + Paid-per-Month breakdown */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <BarChart3 size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Monthly Cash Flow — EUR ({new Date().getFullYear()})</h2>
        </div>
        <div className="p-5">
          {monthlyPayments.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">No payment data available</p>
          ) : (() => {
            const maxVal = Math.max(...monthlyPayments.map((m: any) => Math.max(m.received, m.paid_out)), 1);
            const latest = monthlyPayments[monthlyPayments.length - 1];
            const net = (latest?.received ?? 0) - (latest?.paid_out ?? 0);
            return (
              <div className="space-y-4">
                {/* Summary row */}
                <div className="grid grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-0.5">Received (this month)</p>
                    <p className="text-lg font-bold text-green-600">€{(latest?.received ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-0.5">Paid Out (this month)</p>
                    <p className="text-lg font-bold text-red-500">€{(latest?.paid_out ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-0.5">Net (this month)</p>
                    <p className={`text-lg font-bold ${net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {net >= 0 ? '+' : ''}€{Math.abs(net).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                {/* Legend */}
                <div className="flex items-center gap-5 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received from clients</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400 inline-block" /> Paid to suppliers</span>
                </div>
                {/* Bar chart */}
                <div className="flex items-end gap-1.5" style={{ height: '180px' }}>
                  {monthlyPayments.map((m: any) => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <div className="w-full flex items-end justify-center gap-0.5">
                        <div
                          className="flex-1 max-w-[14px] bg-green-500 rounded-t transition-all"
                          style={{ height: `${Math.max(m.received > 0 ? (m.received / maxVal) * 155 : 0, m.received > 0 ? 2 : 0)}px` }}
                          title={`Received: €${m.received.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                        />
                        <div
                          className="flex-1 max-w-[14px] bg-red-400 rounded-t transition-all"
                          style={{ height: `${Math.max(m.paid_out > 0 ? (m.paid_out / maxVal) * 155 : 0, m.paid_out > 0 ? 2 : 0)}px` }}
                          title={`Paid Out: €${m.paid_out.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
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
                    <td className="px-4 py-3 text-gray-600">{formatDate(sh.estimated_delivery) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Revenue Forecast */}
      {forecast.length > 0 && (() => {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const maxBar = Math.max(...forecast.map((m: any) => m.paid + m.pending), 1);
        const totalPaid = forecast.reduce((s: number, m: any) => s + m.paid, 0);
        const totalPending = forecast.reduce((s: number, m: any) => s + m.pending, 0);
        return (
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Revenue Forecast {new Date().getFullYear()}</h2>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Pending</span>
              </div>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-3 gap-4 pb-4 border-b border-gray-100 mb-4">
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Received YTD</p>
                  <p className="text-lg font-bold text-green-600">€{totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Pending Invoices</p>
                  <p className="text-lg font-bold text-amber-500">€{totalPending.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Total Expected</p>
                  <p className="text-lg font-bold text-gray-900">€{(totalPaid + totalPending).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
              <div className="flex items-end gap-1" style={{ height: 160 }}>
                {forecast.map((m: any) => {
                  const isCurrent = m.month === currentMonth;
                  const paidH = m.paid > 0 ? Math.max((m.paid / maxBar) * 140, 3) : 0;
                  const pendingH = m.pending > 0 ? Math.max((m.pending / maxBar) * 140, 3) : 0;
                  return (
                    <div key={m.month} className={`flex-1 flex flex-col items-center gap-1 h-full justify-end ${isCurrent ? 'relative' : ''}`}>
                      {isCurrent && <div className="absolute inset-x-0 inset-y-0 bg-primary-50 rounded pointer-events-none" />}
                      <div className="w-full flex flex-col items-center relative z-10">
                        {m.pending > 0 && (
                          <div className="w-4/5 bg-amber-400 rounded-t" style={{ height: `${pendingH}px` }}
                            title={`Pending: €${m.pending.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                        )}
                        {m.paid > 0 && (
                          <div className={`w-4/5 bg-green-500 ${m.pending > 0 ? '' : 'rounded-t'}`} style={{ height: `${paidH}px` }}
                            title={`Received: €${m.paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                        )}
                        {m.paid === 0 && m.pending === 0 && (
                          <div className="w-4/5 bg-gray-100 rounded-t" style={{ height: '2px' }} />
                        )}
                      </div>
                      <span className={`text-[10px] relative z-10 ${isCurrent ? 'font-bold text-primary-600' : 'text-gray-400'}`}>
                        {new Date(m.month + '-02').toLocaleDateString('en-GB', { month: 'short' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
