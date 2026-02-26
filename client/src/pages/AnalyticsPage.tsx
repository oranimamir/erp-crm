import { useState, useEffect } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import {
  BarChart3, TrendingUp, TrendingDown, DollarSign, Clock,
  RefreshCw, FileSpreadsheet, Users, Truck,
} from 'lucide-react';
import { downloadExcel } from '../lib/exportExcel';

interface MonthData { month: string; received: number; paid_out: number; }
interface CustomerData { customer_id: number; customer_name: string; total: number; invoice_count: number; }
interface SupplierData { supplier_id: number; supplier_name: string; category: string; total: number; invoice_count: number; }
interface Summary {
  monthly: MonthData[];
  by_customer: CustomerData[];
  by_supplier: SupplierData[];
  totals: { received: number; paid_out: number; net: number; outstanding: number; outstanding_payable: number; };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SUPPLIER_CATEGORIES = [
  { value: 'logistics',     label: 'Logistics' },
  { value: 'blenders',      label: 'Blenders' },
  { value: 'raw_materials', label: 'Raw Materials' },
  { value: 'shipping',      label: 'Shipping' },
];

function fmt(n: number) {
  return `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(m: string) {
  return new Date(m + '-02').toLocaleDateString('en-GB', { month: 'short' });
}

function periodLabel(year: string, monthFrom: string, monthTo: string) {
  const from = parseInt(monthFrom);
  const to = parseInt(monthTo);
  if (from === 1 && to === 12) return year;
  if (from === to) return `${MONTHS[from - 1]} ${year}`;
  return `${MONTHS[from - 1]}–${MONTHS[to - 1]} ${year}`;
}

type View = 'both' | 'customers' | 'suppliers';

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear().toString();

  const [view, setView] = useState<View>('both');
  const [year, setYear] = useState(currentYear);
  const [monthFrom, setMonthFrom] = useState('1');
  const [monthTo, setMonthTo] = useState('12');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierCategory, setSupplierCategory] = useState('');

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
        month_from: monthFrom,
        month_to: monthTo,
        customer_id: customerId || undefined,
        supplier_id: supplierId || undefined,
        supplier_category: supplierCategory || undefined,
      },
    })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year, monthFrom, monthTo, customerId, supplierId, supplierCategory]);

  const handleMonthFromChange = (val: string) => {
    setMonthFrom(val);
    if (parseInt(val) > parseInt(monthTo)) setMonthTo(val);
  };

  const handleMonthToChange = (val: string) => {
    setMonthTo(val);
    if (parseInt(val) < parseInt(monthFrom)) setMonthFrom(val);
  };

  const handleCategoryChange = (val: string) => {
    setSupplierCategory(val);
    // If the selected supplier is not in the new category, clear it
    if (val && supplierId) {
      const sup = suppliers.find(s => s.id === parseInt(supplierId));
      if (sup && sup.category !== val) setSupplierId('');
    }
  };

  const resetFilters = () => {
    setView('both');
    setYear(currentYear);
    setMonthFrom('1');
    setMonthTo('12');
    setCustomerId('');
    setSupplierId('');
    setSupplierCategory('');
  };

  const isFiltered = view !== 'both' || year !== currentYear || monthFrom !== '1' || monthTo !== '12'
    || customerId !== '' || supplierId !== '' || supplierCategory !== '';

  // Suppliers filtered by selected category (for supplier dropdown)
  const filteredSuppliers = supplierCategory
    ? suppliers.filter(s => s.category === supplierCategory)
    : suppliers;

  const maxBar = data ? Math.max(...data.monthly.map(m => Math.max(
    view === 'suppliers' ? 0 : m.received,
    view === 'customers' ? 0 : m.paid_out,
  )), 1) : 1;

  const hasData = data && data.monthly.some(m =>
    (view !== 'suppliers' && m.received > 0) || (view !== 'customers' && m.paid_out > 0)
  );

  const period = periodLabel(year, monthFrom, monthTo);

  const chartTitle = view === 'customers' ? `Customer Revenue — ${period}`
    : view === 'suppliers' ? `Supplier Expenses — ${period}`
    : `Cash Flow — ${period}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 size={24} className="text-primary-600" />
          Analytics
        </h1>
        <div className="flex items-center gap-3">
          {data && (
            <button
              onClick={() => {
                if (view !== 'suppliers') {
                  const rows = data.by_customer.map(c => [c.customer_name, c.total, c.invoice_count]);
                  downloadExcel(`revenue-by-customer-${period}`, ['Customer', 'Total (EUR)', 'Invoices'], rows);
                } else {
                  const rows = data.by_supplier.map(s => [s.supplier_name, s.category, s.total, s.invoice_count]);
                  downloadExcel(`expenses-by-supplier-${period}`, ['Supplier', 'Category', 'Total (EUR)', 'Invoices'], rows);
                }
              }}
              className="flex items-center gap-1 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
            >
              <FileSpreadsheet size={14} /> Export Excel
            </button>
          )}
          {isFiltered && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 text-sm text-primary-600 hover:underline"
            >
              <RefreshCw size={14} /> Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 space-y-4">
        {/* Row 1: View toggle + date range */}
        <div className="flex flex-wrap items-end gap-4">
          {/* View toggle */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Show</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium">
              {(['both', 'customers', 'suppliers'] as View[]).map((v, i) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-2 transition-colors ${
                    view === v
                      ? 'bg-primary-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  } ${i > 0 ? 'border-l border-gray-300' : ''}`}
                >
                  {v === 'both' ? 'Both' : v === 'customers' ? 'Customers' : 'Suppliers'}
                </button>
              ))}
            </div>
          </div>

          {/* Year */}
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

          {/* From month */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <select
              value={monthFrom}
              onChange={e => handleMonthFromChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          {/* To month */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <select
              value={monthTo}
              onChange={e => handleMonthToChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1} disabled={i + 1 < parseInt(monthFrom)}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Entity filters (conditionally shown) */}
        {(view === 'both' || view === 'customers' || view === 'suppliers') && (
          <div className="flex flex-wrap items-end gap-4 pt-1 border-t border-gray-100">
            {/* Customer filter */}
            {view !== 'suppliers' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                  <Users size={11} /> Customer
                </label>
                <select
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">All Customers</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {/* Supplier category filter */}
            {view !== 'customers' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                  <Truck size={11} /> Category
                </label>
                <select
                  value={supplierCategory}
                  onChange={e => handleCategoryChange(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">All Categories</option>
                  {SUPPLIER_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Supplier filter (filtered by category) */}
            {view !== 'customers' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                  <Truck size={11} /> Supplier
                </label>
                <select
                  value={supplierId}
                  onChange={e => setSupplierId(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">All Suppliers{supplierCategory ? ` (${SUPPLIER_CATEGORIES.find(c => c.value === supplierCategory)?.label})` : ''}</option>
                  {filteredSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </Card>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className={`grid gap-4 ${
            view === 'both'
              ? 'grid-cols-2 lg:grid-cols-4'
              : 'grid-cols-2 lg:grid-cols-2'
          }`}>
            {view !== 'suppliers' && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                    <TrendingUp size={20} className="text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{view === 'customers' ? 'Revenue' : 'Total Received'} (EUR)</p>
                    <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.received)}</p>
                  </div>
                </div>
              </Card>
            )}

            {view !== 'customers' && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <TrendingDown size={20} className="text-red-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{view === 'suppliers' ? 'Total Expenses' : 'Total Paid Out'} (EUR)</p>
                    <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.paid_out)}</p>
                  </div>
                </div>
              </Card>
            )}

            {view === 'both' && (
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
            )}

            {view !== 'suppliers' && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center shrink-0">
                    <Clock size={20} className="text-yellow-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Outstanding Receivable</p>
                    <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.outstanding)}</p>
                  </div>
                </div>
              </Card>
            )}

            {view !== 'customers' && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                    <Clock size={20} className="text-orange-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Outstanding Payable</p>
                    <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.outstanding_payable)}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Bar chart */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{chartTitle}</h2>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                {view !== 'suppliers' && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received
                  </span>
                )}
                {view !== 'customers' && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-red-400 inline-block" /> Paid out
                  </span>
                )}
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
                        {view !== 'suppliers' && (
                          <div
                            className="flex-1 max-w-[20px] bg-green-500 rounded-t transition-all"
                            style={{ height: `${m.received > 0 ? Math.max((m.received / maxBar) * 165, 2) : 0}px` }}
                            title={`Received: ${fmt(m.received)}`}
                          />
                        )}
                        {view !== 'customers' && (
                          <div
                            className="flex-1 max-w-[20px] bg-red-400 rounded-t transition-all"
                            style={{ height: `${m.paid_out > 0 ? Math.max((m.paid_out / maxBar) * 165, 2) : 0}px` }}
                            title={`Paid out: ${fmt(m.paid_out)}`}
                          />
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400">{monthLabel(m.month)}</span>
                    </div>
                  ))}
                </div>
              )}
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
                      {view !== 'suppliers' && (
                        <tr className="text-green-600 font-medium">
                          {data.monthly.map(m => (
                            <td key={m.month} className="px-1">
                              {m.received > 0 ? `€${Math.round(m.received / 1000)}k` : '—'}
                            </td>
                          ))}
                        </tr>
                      )}
                      {view !== 'customers' && (
                        <tr className="text-red-400 font-medium">
                          {data.monthly.map(m => (
                            <td key={m.month} className="px-1">
                              {m.paid_out > 0 ? `€${Math.round(m.paid_out / 1000)}k` : '—'}
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {/* Breakdowns */}
          <div className={`grid gap-6 ${view === 'both' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>

            {/* By Customer */}
            {view !== 'suppliers' && (
              <Card>
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Users size={16} className="text-green-600" /> Revenue by Customer
                  </h2>
                  <span className="text-xs text-gray-400">{period}</span>
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
            )}

            {/* By Supplier */}
            {view !== 'customers' && (
              <Card>
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Truck size={16} className="text-red-500" /> Expenses by Supplier
                    {supplierCategory && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-normal">
                        {SUPPLIER_CATEGORIES.find(c => c.value === supplierCategory)?.label}
                      </span>
                    )}
                  </h2>
                  <span className="text-xs text-gray-400">{period}</span>
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
                              {!supplierCategory && s.category && (
                                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded capitalize">
                                  {s.category.replace('_', ' ')}
                                </span>
                              )}
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
            )}
          </div>
        </>
      ) : (
        <p className="text-center text-gray-500 py-12">Failed to load analytics data.</p>
      )}
    </div>
  );
}
