import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import { TrendingUp, BarChart3, Scale, AlertTriangle, Users, Receipt } from 'lucide-react';
import { formatDate } from '../lib/dates';

interface Stats {
  customers: number;
  suppliers: number;
  totalOrders: number;
  activeOrders: number;
  totalInvoices: number;
  paidYTD: number;           // payments received this calendar year
  pendingAmount: number;     // sent/overdue + has due_date
  expectedAmount: number;    // sent + no due_date
  paidInvoiceAmount: number;
  totalPayments: number;
  activeShipments: number;
}

const OP_STATUS_COLORS: Record<string, string> = {
  'pre-ordered':   'bg-purple-100 text-purple-800',
  ordered:         'bg-yellow-100 text-yellow-800',
  shipped:         'bg-blue-100   text-blue-800',
  'in clearance':  'bg-orange-100 text-orange-800',
  delivered:       'bg-green-100  text-green-800',
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [openOperations, setOpenOperations] = useState<any[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);
  const [monthlyPayments, setMonthlyPayments] = useState<any[]>([]);
  const [customerForecast, setCustomerForecast] = useState<{ received: any[]; pending: any[]; expected: any[] }>({ received: [], pending: [], expected: [] });
  const [forecast, setForecast] = useState<any[]>([]);
  const [forecastExpected, setForecastExpected] = useState(0);
  const [tonsYTD, setTonsYTD] = useState(0);
  const [priorYearOverdue, setPriorYearOverdue] = useState<{ invoices: any[]; total: number }>({ invoices: [], total: 0 });
  const [demoExpensesMonthly, setDemoExpensesMonthly] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/stats'),
      api.get('/dashboard/open-operations'),
      api.get('/dashboard/pending-invoices'),
      api.get('/dashboard/monthly-payments'),
      api.get('/dashboard/forecast'),
      api.get('/dashboard/tons-ytd'),
      api.get('/dashboard/prior-year-overdue'),
      api.get('/dashboard/customer-forecast'),
      api.get('/dashboard/demo-expenses-monthly'),
    ]).then(([s, o, i, mp, fc, ty, pyo, cf, dem]) => {
      setStats(s.data);
      setOpenOperations(o.data);
      setPendingInvoices(i.data);
      setMonthlyPayments(mp.data);
      // forecast now returns { months: [...], expected: N }
      const fcData = fc.data;
      setForecast(fcData.months ?? fcData); // fallback if old format
      setForecastExpected(fcData.expected ?? 0);
      setTonsYTD(ty.data.total_tons ?? 0);
      setPriorYearOverdue(pyo.data);
      setCustomerForecast(cf.data);
      setDemoExpensesMonthly(dem.data);
    }).catch((err) => console.error('[Dashboard] load failed:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;

  const fmt = (n: number) => `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtAxis = (n: number): string => {
    if (n === 0) return '0';
    if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `€${Math.round(n / 1_000)}k`;
    return `€${Math.round(n)}`;
  };
  const year = new Date().getFullYear();
  const paidYTD = stats?.paidYTD ?? 0;
  const pending = stats?.pendingAmount ?? 0;
  const expected = stats?.expectedAmount ?? 0;
  const totalYear = paidYTD + pending + expected;

  const expensesYTD = monthlyPayments.reduce((s: number, m: any) => s + (m.paid_out ?? 0), 0);
  const monthsElapsed = monthlyPayments.length;
  const expensesAvgPerMonth = monthsElapsed > 0 ? expensesYTD / monthsElapsed : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* ── Prior-year overdue banner ──────────────────────────────────────── */}
      {priorYearOverdue.invoices.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-800">
                {priorYearOverdue.invoices.length} overdue invoice{priorYearOverdue.invoices.length > 1 ? 's' : ''} from prior year{priorYearOverdue.invoices.length > 1 ? 's' : ''} — {fmt(priorYearOverdue.total)} outstanding
              </p>
              <p className="text-xs text-red-600 mt-0.5 mb-2">These invoices had a due date before {year} and remain unpaid.</p>
              <div className="flex flex-wrap gap-2">
                {priorYearOverdue.invoices.map((inv: any) => (
                  <Link
                    key={inv.id}
                    to={`/invoices/${inv.id}`}
                    className="inline-flex items-center gap-1.5 text-xs bg-white border border-red-200 text-red-800 rounded px-2 py-1 hover:bg-red-100 transition-colors"
                  >
                    <span className="font-medium">{inv.invoice_number}</span>
                    <span className="text-red-500">·</span>
                    <span>{inv.customer_name || '—'}</span>
                    <span className="text-red-500">·</span>
                    <span>Due {formatDate(inv.due_date)}</span>
                    <span className="text-red-500">·</span>
                    <span className="font-medium">€{(inv.eur_val ?? inv.amount)?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Financial summary ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Link to="/invoices">
          <Card className="p-3 sm:p-5 hover:shadow-md transition-shadow h-full">
            <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Paid YTD {year}</p>
            <p className="text-lg sm:text-2xl font-bold text-green-600 truncate">{fmt(paidYTD)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1 hidden sm:block">Payments received this year</p>
          </Card>
        </Link>
        <Link to="/invoices">
          <Card className="p-3 sm:p-5 hover:shadow-md transition-shadow h-full">
            <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Pending</p>
            <p className="text-lg sm:text-2xl font-bold text-amber-500 truncate">{fmt(pending)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1 hidden sm:block">Sent invoices with due date</p>
          </Card>
        </Link>
        <Link to="/invoices">
          <Card className="p-3 sm:p-5 hover:shadow-md transition-shadow h-full">
            <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Expected</p>
            <p className="text-lg sm:text-2xl font-bold text-blue-500 truncate">{fmt(expected)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1 hidden sm:block">Sent invoices without due date</p>
          </Card>
        </Link>
        <Link to="/invoices">
          <Card className="p-3 sm:p-5 hover:shadow-md transition-shadow h-full border-2 border-gray-200">
            <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total {year}</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{fmt(totalYear)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1 hidden sm:block">Paid + pending + expected</p>
          </Card>
        </Link>
      </div>

      {/* ── Expenses + Tons summary ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <Link to="/invoices?type=supplier">
          <Card className="p-3 sm:p-5 hover:shadow-md transition-shadow h-full">
            <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Expenses YTD {year}</p>
            <p className="text-lg sm:text-2xl font-bold text-red-600 truncate">{fmt(expensesYTD)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1 hidden sm:block">Total paid to suppliers this year</p>
          </Card>
        </Link>
        <Link to="/invoices?type=supplier">
          <Card className="p-3 sm:p-5 hover:shadow-md transition-shadow h-full">
            <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Avg / Month</p>
            <p className="text-lg sm:text-2xl font-bold text-orange-500 truncate">{fmt(expensesAvgPerMonth)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1 hidden sm:block">Average monthly expenses ({monthsElapsed} mo)</p>
          </Card>
        </Link>
        <Link to="/orders" className="col-span-2 sm:col-span-1">
          <Card className="p-3 sm:p-5 hover:shadow-md transition-shadow h-full">
            <div className="flex items-center gap-2 mb-1">
              <Scale size={14} className="text-indigo-500" />
              <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">Tons Sold {year}</p>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-indigo-600">
              {tonsYTD >= 1000
                ? `${(tonsYTD / 1000).toFixed(2)}k MT`
                : `${tonsYTD.toFixed(2)} MT`}
            </p>
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1 hidden sm:block">Total quantity from customer orders</p>
          </Card>
        </Link>
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
        <Card className="flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <h2 className="font-semibold text-gray-900">Pending Invoices</h2>
            <span className="text-xs text-gray-400">{pendingInvoices.length} total</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100">
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
                      €{(inv.live_eur_amount ?? inv.eur_amount ?? inv.amount)?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      {inv.currency && inv.currency !== 'EUR' && (
                        <span className="text-xs font-normal text-gray-400 ml-1">
                          ({inv.currency} {inv.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })})
                        </span>
                      )}
                    </span>
                    <StatusBadge status={inv.status} />
                  </div>
                </Link>
              );
            })}
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
                {/* Bar chart with Y-axis */}
                <div className="flex gap-2">
                  {/* Y-axis labels */}
                  <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: 165 }}>
                    {[maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0].map((v, i) => (
                      <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">
                        {fmtAxis(v)}
                      </span>
                    ))}
                  </div>
                  {/* Chart area */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="relative" style={{ height: 165 }}>
                      {/* Grid lines */}
                      {[0, 25, 50, 75, 100].map(pct => (
                        <div
                          key={pct}
                          className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                          style={{ bottom: `${(pct / 100) * 165}px` }}
                        />
                      ))}
                      {/* Bars */}
                      <div className="flex items-end gap-1.5 h-full">
                        {monthlyPayments.map((m: any) => (
                          <div key={m.month} className="flex-1 flex items-end justify-center gap-0.5 h-full">
                            <div className="flex-1 max-w-[14px] flex flex-col items-center">
                              {m.received > 0 && <span className="text-[10px] text-green-700 font-semibold tabular-nums whitespace-nowrap mb-0.5">{fmtAxis(m.received)}</span>}
                              <div
                                className="w-full bg-green-500 rounded-t transition-all"
                                style={{ height: `${m.received > 0 ? Math.max((m.received / maxVal) * 140, 2) : 0}px` }}
                                title={`Received: €${m.received.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                              />
                            </div>
                            <div className="flex-1 max-w-[14px] flex flex-col items-center">
                              {m.paid_out > 0 && <span className="text-[10px] text-red-600 font-semibold tabular-nums whitespace-nowrap mb-0.5">{fmtAxis(m.paid_out)}</span>}
                              <div
                                className="w-full bg-red-400 rounded-t transition-all"
                                style={{ height: `${m.paid_out > 0 ? Math.max((m.paid_out / maxVal) * 140, 2) : 0}px` }}
                                title={`Paid Out: €${m.paid_out.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                              />
                            </div>
                            {m.received === 0 && m.paid_out === 0 && (
                              <div className="w-full max-w-[28px] bg-gray-100 rounded-t" style={{ height: '2px' }} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* X-axis month labels */}
                    <div className="flex gap-1.5 mt-1">
                      {monthlyPayments.map((m: any) => (
                        <div key={m.month} className="flex-1 text-center">
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">
                            {new Date(m.month + '-01').toLocaleDateString(undefined, { month: 'short' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      </Card>

      {/* Revenue Forecast */}
      {forecast.length > 0 && (() => {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const maxBar = Math.max(...forecast.map((m: any) => m.paid + m.pending), 1);
        const totalPaid = forecast.reduce((s: number, m: any) => s + m.paid, 0);
        const totalPending = forecast.reduce((s: number, m: any) => s + m.pending, 0);
        const totalAll = totalPaid + totalPending + forecastExpected;
        return (
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Revenue Forecast {new Date().getFullYear()}</h2>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Pending (due date)</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-300 inline-block" /> Expected (no date)</span>
              </div>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-4 gap-3 pb-4 border-b border-gray-100 mb-4">
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Received YTD</p>
                  <p className="text-lg font-bold text-green-600">€{totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <div className="flex flex-wrap justify-center gap-1 mt-1.5">
                    {forecast.filter((m: any) => m.paid > 0).map((m: any) => (
                      <span key={m.month} className="text-[10px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 font-medium">
                        {new Date(m.month + '-02').toLocaleDateString('en-GB', { month: 'short' })}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Pending (w/ due date)</p>
                  <p className="text-lg font-bold text-amber-500">€{totalPending.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <div className="flex flex-wrap justify-center gap-1 mt-1.5">
                    {forecast.filter((m: any) => m.pending > 0).map((m: any) => (
                      <span key={m.month} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-medium">
                        {new Date(m.month + '-02').toLocaleDateString('en-GB', { month: 'short' })}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Expected (no date)</p>
                  <p className="text-lg font-bold text-blue-500">€{forecastExpected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <p className="text-[10px] text-gray-400 mt-1.5">No due date set</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Total Expected</p>
                  <p className="text-lg font-bold text-gray-900">€{totalAll.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
              <div className="flex items-end gap-1" style={{ height: 180 }}>
                {forecast.map((m: any) => {
                  const isCurrent = m.month === currentMonth;
                  const total = m.paid + m.pending;
                  const paidH = m.paid > 0 ? Math.max((m.paid / maxBar) * 140, 3) : 0;
                  const pendingH = m.pending > 0 ? Math.max((m.pending / maxBar) * 140, 3) : 0;
                  return (
                    <div key={m.month} className={`flex-1 flex flex-col items-center gap-0.5 h-full justify-end ${isCurrent ? 'relative' : ''}`}>
                      {isCurrent && <div className="absolute inset-x-0 inset-y-0 bg-primary-50 rounded pointer-events-none" />}
                      {total > 0 ? (
                        <span className={`text-[9px] relative z-10 tabular-nums leading-none mb-0.5 ${isCurrent ? 'font-bold text-primary-600' : 'text-gray-400'}`}>
                          {fmtAxis(total)}
                        </span>
                      ) : (
                        <span className="text-[9px] leading-none mb-0.5 invisible">0</span>
                      )}
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
                      <span className={`text-[10px] relative z-10 mt-0.5 ${isCurrent ? 'font-bold text-primary-600' : 'text-gray-400'}`}>
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

      {/* Per-Customer Revenue Breakdown — 3 panels */}
      {(customerForecast.received?.length > 0 || customerForecast.pending?.length > 0 || customerForecast.expected?.length > 0) && (() => {
        const fmt2 = (n: number) => `€${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

        function CustomerPanel({ title, accent, rows, emptyText }: {
          title: string; accent: string; rows: any[]; emptyText: string;
        }) {
          const total = rows.reduce((s: number, c: any) => s + c.total, 0);
          const maxRow = rows[0]?.total || 1;
          return (
            <Card>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Users size={15} className="text-gray-400" />
                  {title}
                </h2>
                {rows.length > 0 && (
                  <span className={`text-sm font-bold ${accent}`}>{fmt2(total)}</span>
                )}
              </div>
              {rows.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-gray-400">{emptyText}</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {rows.map((c: any) => (
                    <div key={c.customer_id} className="px-5 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-gray-900">{c.customer_name}</span>
                        <span className={`text-sm font-bold ${accent}`}>{fmt2(c.total)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full`}
                          style={{ width: `${Math.round((c.total / maxRow) * 100)}%`, background: accent.includes('green') ? '#22c55e' : accent.includes('amber') ? '#f59e0b' : '#3b82f6' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        }

        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <CustomerPanel
              title="Received YTD"
              accent="text-green-600"
              rows={customerForecast.received ?? []}
              emptyText="No payments received yet this year"
            />
            <CustomerPanel
              title="Pending (with due date)"
              accent="text-amber-600"
              rows={customerForecast.pending ?? []}
              emptyText="No pending invoices with a due date"
            />
            <CustomerPanel
              title="Expected (no due date)"
              accent="text-blue-600"
              rows={customerForecast.expected ?? []}
              emptyText="No invoices without a due date"
            />
          </div>
        );
      })()}

      {/* Demo Expenses Monthly Chart */}
      {demoExpensesMonthly.length > 0 && (() => {
        const maxVal = Math.max(...demoExpensesMonthly.map((m: any) => m.total), 1);
        const totalExpenses = demoExpensesMonthly.reduce((s: number, m: any) => s + m.total, 0);
        const totalVat = demoExpensesMonthly.reduce((s: number, m: any) => s + (m.vat_total || 0), 0);
        const totalInvoices = demoExpensesMonthly.reduce((s: number, m: any) => s + m.count, 0);
        const chartH = 180;
        return (
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Demo Expenses — Monthly Total ({year})</h2>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Total: <strong className="text-gray-900">{fmt(totalExpenses)}</strong></span>
                <span>VAT: <strong className="text-amber-600">{fmt(totalVat)}</strong></span>
                <span>{totalInvoices} invoices</span>
              </div>
            </div>
            <div className="p-5">
              <div className="flex gap-2">
                {/* Y-axis */}
                <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: chartH }}>
                  {[maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0].map((v, i) => (
                    <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">{fmtAxis(v)}</span>
                  ))}
                </div>
                {/* Chart */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="relative" style={{ height: chartH }}>
                    {[0, 25, 50, 75, 100].map(pct => (
                      <div key={pct} className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                        style={{ bottom: `${(pct / 100) * chartH}px` }} />
                    ))}
                    <div className="flex items-end gap-1.5 h-full">
                      {demoExpensesMonthly.map((m: any) => {
                        const barH = m.total > 0 ? Math.max((m.total / maxVal) * (chartH - 20), 3) : 0;
                        return (
                          <div key={m.month} className="flex-1 h-full flex flex-col items-center justify-end group relative">
                            {m.total > 0 && <span className="text-[10px] text-indigo-700 font-semibold tabular-nums whitespace-nowrap mb-0.5">{fmtAxis(m.total)}</span>}
                            <div className="w-full max-w-[32px] bg-indigo-500 rounded-t transition-all hover:bg-indigo-600 cursor-pointer"
                              style={{ height: `${barH}px` }}
                              title={`${m.month}: ${fmt(m.total)} (${m.count} invoices)`} />
                            {/* Tooltip on hover */}
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                              <div className="font-semibold">{new Date(m.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
                              <div>Amount: {fmt(m.total)}</div>
                              <div>VAT: {fmt(m.vat_total || 0)}</div>
                              <div>{m.count} invoice{m.count !== 1 ? 's' : ''}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    {demoExpensesMonthly.map((m: any) => (
                      <div key={m.month} className="flex-1 text-center text-[10px] text-gray-400 truncate">
                        {new Date(m.month + '-01').toLocaleDateString(undefined, { month: 'short' })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
