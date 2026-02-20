import { useState, useEffect } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Clock, RefreshCw } from 'lucide-react';

interface MonthData { month: string; received: number; paid_out: number; }
interface CustomerData { customer_id: number; customer_name: string; total: number; invoice_count: number; }
interface SupplierData { supplier_id: number; supplier_name: string; total: number; invoice_count: number; }
interface Summary {
  monthly: MonthData[];
  by_customer: CustomerData[];
  by_supplier: SupplierData[];
  totals: { received: number; paid_out: number; net: number; outstanding: number };
}

const QUARTER_LABELS = ['', 'Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];

function fmt(n: number) {
  return `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(m: string) {
  return new Date(m + '-02').toLocaleDateString('en-GB', { month: 'short' });
}

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear().toString();

  const [year, setYear] = useState(currentYear);
  const [quarter, setQuarter] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');

  const [years, setYears] = useState<string[]>([currentYear]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  // Load filter options once
  useEffect(() => {
    Promise.all([api.get('/analytics/years'), api.get('/analytics/filters')])
      .then(([y, f]) => {
        if (y.data.length) setYears(y.data);
        setCustomers(f.data.customers);
        setSuppliers(f.data.suppliers);
      })
      .catch(() => {});
  }, []);

  // Load data whenever filters change
  useEffect(() => {
    setLoading(true);
    api.get('/analytics/summary', {
      params: {
        year,
        quarter: quarter || undefined,
        customer_id: customerId || undefined,
        supplier_id: supplierId || undefined,
      },
    })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year, quarter, customerId, supplierId]);

  const maxBar = data ? Math.max(...data.monthly.map(m => Math.max(m.received, m.paid_out)), 1) : 1;
  const hasData = data && data.monthly.some(m => m.received > 0 || m.paid_out > 0);
  const isFiltered = year !== currentYear || quarter !== '' || customerId !== '' || supplierId !== '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 size={24} className="text-primary-600" />
          Analytics
        </h1>
        {isFiltered && (
          <button
            onClick={() => { setYear(currentYear); setQuarter(''); setCustomerId(''); setSupplierId(''); }}
            className="flex items-center gap-1 text-sm text-primary-600 hover:underline"
          >
            <RefreshCw size={14} /> Reset filters
          </button>
        )}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
            <select
              value={year}
              onChange={e => setYear(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Quarter</label>
            <select
              value={quarter}
              onChange={e => setQuarter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Full Year</option>
              {[1, 2, 3, 4].map(q => (
                <option key={q} value={q}>{QUARTER_LABELS[q]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
            <select
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Customers</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Suppliers</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                  <TrendingUp size={20} className="text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Total Received (EUR)</p>
                  <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.received)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                  <TrendingDown size={20} className="text-red-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Total Paid Out (EUR)</p>
                  <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.paid_out)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${data.totals.net >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                  <DollarSign size={20} className={data.totals.net >= 0 ? 'text-green-600' : 'text-red-500'} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Net Cash Flow</p>
                  <p className={`text-xl font-bold truncate ${data.totals.net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {data.totals.net >= 0 ? '+' : ''}{fmt(data.totals.net)}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center shrink-0">
                  <Clock size={20} className="text-yellow-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Outstanding (EUR)</p>
                  <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.outstanding)}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Monthly bar chart */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                Cash Flow — {year}{quarter ? ` · ${QUARTER_LABELS[parseInt(quarter)]}` : ''}
              </h2>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400 inline-block" /> Paid out</span>
              </div>
            </div>
            <div className="p-5">
              {!hasData ? (
                <p className="text-center text-sm text-gray-500 py-8">No payment data for this period</p>
              ) : (
                <div className="flex items-end gap-2" style={{ height: 200 }}>
                  {data.monthly.map(m => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <div className="w-full flex items-end justify-center gap-0.5">
                        <div
                          className="flex-1 max-w-[20px] bg-green-500 rounded-t transition-all"
                          style={{ height: `${m.received > 0 ? Math.max((m.received / maxBar) * 165, 2) : 0}px` }}
                          title={`Received: ${fmt(m.received)}`}
                        />
                        <div
                          className="flex-1 max-w-[20px] bg-red-400 rounded-t transition-all"
                          style={{ height: `${m.paid_out > 0 ? Math.max((m.paid_out / maxBar) * 165, 2) : 0}px` }}
                          title={`Paid out: ${fmt(m.paid_out)}`}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400">{monthLabel(m.month)}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Month value table below chart */}
              {hasData && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs text-center">
                    <thead>
                      <tr className="text-gray-400">
                        {data.monthly.map(m => (
                          <td key={m.month} className="px-1 pb-1">{monthLabel(m.month)}</td>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="text-green-600 font-medium">
                        {data.monthly.map(m => (
                          <td key={m.month} className="px-1">
                            {m.received > 0 ? `€${Math.round(m.received / 1000)}k` : '—'}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-red-400 font-medium">
                        {data.monthly.map(m => (
                          <td key={m.month} className="px-1">
                            {m.paid_out > 0 ? `€${Math.round(m.paid_out / 1000)}k` : '—'}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {/* By customer + By supplier */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Revenue by Customer</h2>
              </div>
              {data.by_customer.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-500">No data for this period</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {data.by_customer.map((c, i) => {
                    const maxC = data.by_customer[0]?.total || 1;
                    return (
                      <div key={c.customer_id} className="px-5 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-normal w-5">{i + 1}.</span>
                            {c.customer_name}
                          </span>
                          <div className="text-right shrink-0 ml-2">
                            <span className="text-sm font-bold text-gray-900">{fmt(c.total)}</span>
                            <span className="text-xs text-gray-400 ml-1">{c.invoice_count} inv</span>
                          </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-green-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${(c.total / maxC) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card>
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Expenses by Supplier</h2>
              </div>
              {data.by_supplier.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-500">No data for this period</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {data.by_supplier.map((s, i) => {
                    const maxS = data.by_supplier[0]?.total || 1;
                    return (
                      <div key={s.supplier_id} className="px-5 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-normal w-5">{i + 1}.</span>
                            {s.supplier_name}
                          </span>
                          <div className="text-right shrink-0 ml-2">
                            <span className="text-sm font-bold text-gray-900">{fmt(s.total)}</span>
                            <span className="text-xs text-gray-400 ml-1">{s.invoice_count} inv</span>
                          </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-red-400 h-1.5 rounded-full transition-all"
                            style={{ width: `${(s.total / maxS) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

        </>
      ) : (
        <p className="text-center text-gray-500 py-12">Failed to load analytics data.</p>
      )}
    </div>
  );
}
