import { useState, useEffect } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import {
  BarChart3, TrendingUp, TrendingDown, DollarSign, Clock,
  RefreshCw, FileSpreadsheet, Users, Truck, Scale,
} from 'lucide-react';
import { downloadExcel } from '../lib/exportExcel';

interface MonthData { month: string; received: number; paid_out: number; }
interface CustomerData { customer_id: number; customer_name: string; total: number; invoice_count: number; }
interface SupplierData { supplier_id: number; supplier_name: string; category: string; total: number; invoice_count: number; }
interface Summary {
  monthly: MonthData[];
  by_customer: CustomerData[];
  by_supplier: SupplierData[];
  totals: { received: number; paid_out: number; net: number; outstanding: number; expected: number; outstanding_payable: number; };
}
interface QuantityData {
  monthly: { month: string; tons: number }[];
  total_tons: number;
  by_customer: { customer_id: number; customer_name: string; tons: number }[];
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

function fmtAxis(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `€${Math.round(n / 1_000)}k`;
  return `€${Math.round(n)}`;
}

function monthLabel(m: string) {
  return new Date(m + '-02').toLocaleDateString('en-GB', { month: 'short' });
}

function fmtTons(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k MT`;
  return `${n.toFixed(2)} MT`;
}

function fmtTonsAxis(n: number): string {
  if (n === 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n >= 10 ? Math.round(n).toString() : n.toFixed(1);
}

function periodLabel(year: string, monthFrom: string, monthTo: string) {
  const from = parseInt(monthFrom);
  const to = parseInt(monthTo);
  if (from === 1 && to === 12) return year;
  if (from === to) return `${MONTHS[from - 1]} ${year}`;
  return `${MONTHS[from - 1]}–${MONTHS[to - 1]} ${year}`;
}

function FinancialChart({ monthly, isCustomers, maxBar }: {
  monthly: MonthData[];
  isCustomers: boolean;
  maxBar: number;
}) {
  const hasData = monthly.some(m => isCustomers ? m.received > 0 : m.paid_out > 0);
  if (!hasData) {
    return <p className="text-center text-sm text-gray-500 py-8">No payment data for this period</p>;
  }
  const color = isCustomers ? 'bg-green-500' : 'bg-red-400';
  const textColor = isCustomers ? 'text-green-600' : 'text-red-400';
  return (
    <div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: 165 }}>
          {[maxBar, maxBar * 0.75, maxBar * 0.5, maxBar * 0.25, 0].map((v, i) => (
            <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">{fmtAxis(v)}</span>
          ))}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="relative" style={{ height: 165 }}>
            {[0, 25, 50, 75, 100].map(pct => (
              <div
                key={pct}
                className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                style={{ bottom: `${(pct / 100) * 165}px` }}
              />
            ))}
            <div className="flex items-end gap-1 h-full">
              {monthly.map(m => {
                const val = isCustomers ? m.received : m.paid_out;
                return (
                  <div key={m.month} className="flex-1 h-full flex items-end justify-center">
                    {val > 0 ? (
                      <div
                        className={`w-4/5 ${color} rounded-t transition-all`}
                        style={{ height: `${Math.max((val / maxBar) * 165, 2)}px` }}
                        title={`${isCustomers ? 'Received' : 'Paid out'}: ${fmt(val)}`}
                      />
                    ) : (
                      <div className="w-4/5 bg-gray-100 rounded-t" style={{ height: '2px' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-1 mt-1.5">
            {monthly.map(m => (
              <div key={m.month} className="flex-1 text-center">
                <span className="text-[10px] text-gray-400">{monthLabel(m.month)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="w-14 shrink-0" />
        <div className={`flex-1 flex gap-1 text-xs font-medium ${textColor}`}>
          {monthly.map(m => {
            const val = isCustomers ? m.received : m.paid_out;
            return (
              <div key={m.month} className="flex-1 text-center">
                {val > 0 ? `€${Math.round(val / 1000)}k` : '—'}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type View = 'customers' | 'suppliers' | 'tonnage';

const VIEW_OPTIONS: { value: View; label: string; active: string }[] = [
  { value: 'customers', label: 'Revenue',      active: 'bg-green-600 text-white' },
  { value: 'suppliers', label: 'Expenses',     active: 'bg-red-500 text-white' },
  { value: 'tonnage',   label: 'Tonnage Sold', active: 'bg-indigo-600 text-white' },
];

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear().toString();

  const [view, setView] = useState<View>('customers');
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
  const [quantityData, setQuantityData] = useState<QuantityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/analytics/years'), api.get('/analytics/filters')])
      .then(([y, f]) => {
        if (y.data.length) setYears(y.data);
        setCustomers(f.data.customers);
        setSuppliers(f.data.suppliers);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/analytics/summary', {
        params: {
          year,
          month_from: monthFrom,
          month_to: monthTo,
          customer_id: customerId || undefined,
          supplier_id: supplierId || undefined,
          supplier_category: supplierCategory || undefined,
        },
      }),
      api.get('/analytics/quantity', {
        params: {
          year,
          month_from: monthFrom,
          month_to: monthTo,
          customer_id: customerId || undefined,
        },
      }),
    ])
      .then(([summaryRes, quantityRes]) => {
        setData(summaryRes.data);
        setQuantityData(quantityRes.data);
      })
      .catch(() => { setData(null); setQuantityData(null); })
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
    if (val && supplierId) {
      const sup = suppliers.find(s => s.id === parseInt(supplierId));
      if (sup && sup.category !== val) setSupplierId('');
    }
  };

  const resetFilters = () => {
    setView('customers');
    setYear(currentYear);
    setMonthFrom('1');
    setMonthTo('12');
    setCustomerId('');
    setSupplierId('');
    setSupplierCategory('');
  };

  const isFiltered = view !== 'customers' || year !== currentYear || monthFrom !== '1' || monthTo !== '12'
    || customerId !== '' || supplierId !== '' || supplierCategory !== '';

  const filteredSuppliers = supplierCategory
    ? suppliers.filter(s => s.category === supplierCategory)
    : suppliers;

  const maxBarCustomers = data ? Math.max(...data.monthly.map(m => m.received), 1) : 1;
  const maxBarSuppliers = data ? Math.max(...data.monthly.map(m => m.paid_out), 1) : 1;

  const period = periodLabel(year, monthFrom, monthTo);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 size={24} className="text-primary-600" />
          Analytics
        </h1>
        <div className="flex items-center gap-3">
          {/* Export button */}
          {data && view === 'customers' && (
            <button
              onClick={() => {
                const rows = data.by_customer.map(c => [c.customer_name, c.total, c.invoice_count]);
                downloadExcel(`revenue-by-customer-${period}`, ['Customer', 'Total (EUR)', 'Invoices'], rows);
              }}
              className="flex items-center gap-1 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
            >
              <FileSpreadsheet size={14} /> Export Excel
            </button>
          )}
          {data && view === 'suppliers' && (
            <button
              onClick={() => {
                const rows = data.by_supplier.map(s => [s.supplier_name, s.category, s.total, s.invoice_count]);
                downloadExcel(`expenses-by-supplier-${period}`, ['Supplier', 'Category', 'Total (EUR)', 'Invoices'], rows);
              }}
              className="flex items-center gap-1 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
            >
              <FileSpreadsheet size={14} /> Export Excel
            </button>
          )}
          {quantityData && view === 'tonnage' && quantityData.by_customer.length > 0 && (
            <button
              onClick={() => {
                const rows = quantityData.by_customer.map(c => [c.customer_name, c.tons]);
                downloadExcel(`tonnage-by-customer-${period}`, ['Customer', 'Tons'], rows);
              }}
              className="flex items-center gap-1 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
            >
              <FileSpreadsheet size={14} /> Export Excel
            </button>
          )}
          {isFiltered && (
            <button onClick={resetFilters} className="flex items-center gap-1 text-sm text-primary-600 hover:underline">
              <RefreshCw size={14} /> Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* View toggle */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">View</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium">
              {VIEW_OPTIONS.map((opt, i) => (
                <button
                  key={opt.value}
                  onClick={() => setView(opt.value)}
                  className={`px-3 py-2 transition-colors ${
                    view === opt.value ? opt.active : 'bg-white text-gray-600 hover:bg-gray-50'
                  } ${i > 0 ? 'border-l border-gray-300' : ''}`}
                >
                  {opt.label}
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
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
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

        {/* Row 2: entity filters */}
        <div className="flex flex-wrap items-end gap-4 pt-1 border-t border-gray-100">
          {/* Customer filter — Revenue and Tonnage views */}
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

          {/* Supplier filters — Expenses view only */}
          {view === 'suppliers' && (
            <>
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
            </>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : data ? (
        <>
          {/* ── REVENUE VIEW ──────────────────────────────────────────────────── */}
          {view === 'customers' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                      <TrendingUp size={20} className="text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Revenue Received</p>
                      <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.received)}</p>
                    </div>
                  </div>
                </Card>
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                      <Clock size={20} className="text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Pending (w/ due date)</p>
                      <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.outstanding)}</p>
                    </div>
                  </div>
                </Card>
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                      <Clock size={20} className="text-blue-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Expected (no due date)</p>
                      <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.expected ?? 0)}</p>
                    </div>
                  </div>
                </Card>
              </div>

              <Card>
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Customer Revenue — {period}</h2>
                  <span className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received
                  </span>
                </div>
                <div className="p-5">
                  <FinancialChart monthly={data.monthly} isCustomers={true} maxBar={maxBarCustomers} />
                </div>
              </Card>

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
                            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${(c.total / maxC) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}

          {/* ── EXPENSES VIEW ─────────────────────────────────────────────────── */}
          {view === 'suppliers' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                      <TrendingDown size={20} className="text-red-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Total Expenses Paid</p>
                      <p className="text-xl font-bold text-gray-900 truncate">{fmt(data.totals.paid_out)}</p>
                    </div>
                  </div>
                </Card>
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
              </div>

              <Card>
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Supplier Expenses — {period}</h2>
                  <span className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-3 h-3 rounded bg-red-400 inline-block" /> Paid out
                  </span>
                </div>
                <div className="p-5">
                  <FinancialChart monthly={data.monthly} isCustomers={false} maxBar={maxBarSuppliers} />
                </div>
              </Card>

              {/* Expenses by Category */}
              {data.by_supplier.length > 0 && (() => {
                const byCategory = SUPPLIER_CATEGORIES.map(cat => {
                  const matching = data.by_supplier.filter(s => s.category === cat.value);
                  return {
                    label: cat.label,
                    value: cat.value,
                    total: matching.reduce((sum, s) => sum + s.total, 0),
                    count: matching.reduce((sum, s) => sum + s.invoice_count, 0),
                  };
                }).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

                if (byCategory.length === 0) return null;
                const maxCat = byCategory[0]?.total || 1;
                return (
                  <Card>
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Truck size={16} className="text-orange-500" /> Expenses by Category
                      </h2>
                      <span className="text-xs text-gray-400">{period}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {byCategory.map(cat => (
                        <div key={cat.value} className="px-5 py-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">{cat.label}</span>
                            <div className="text-right">
                              <span className="text-sm font-bold text-gray-900">{fmt(cat.total)}</span>
                              <span className="text-xs text-gray-400 ml-2">{cat.count} inv</span>
                            </div>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className="bg-orange-400 h-2 rounded-full" style={{ width: `${(cat.total / maxCat) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })()}

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
                            <div className="bg-red-400 h-1.5 rounded-full" style={{ width: `${(s.total / maxS) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}

          {/* ── TONNAGE VIEW ──────────────────────────────────────────────────── */}
          {view === 'tonnage' && quantityData && (
            quantityData.total_tons === 0 ? (
              <Card className="p-10 text-center">
                <Scale size={36} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No tonnage data for this period</p>
                <p className="text-xs text-gray-400 mt-1">
                  Tonnage is read from customer order line items (unit: tons / t / mt).
                </p>
              </Card>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4">
                  <Card className="p-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                        <Scale size={20} className="text-indigo-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">Total Tons Sold</p>
                        <p className="text-xl font-bold text-indigo-600 truncate">{fmtTons(quantityData.total_tons)}</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                        <TrendingUp size={20} className="text-green-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">Revenue (Period)</p>
                        <p className="text-xl font-bold text-green-600 truncate">{fmt(data.totals.received)}</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <DollarSign size={20} className="text-gray-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">EUR / Ton</p>
                        <p className="text-xl font-bold text-gray-900 truncate">
                          {data.totals.received > 0 && quantityData.total_tons > 0
                            ? fmt(data.totals.received / quantityData.total_tons)
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Monthly tons chart */}
                <Card>
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Scale size={16} className="text-indigo-500" /> Tons Sold per Month — {period}
                    </h2>
                  </div>
                  <div className="p-5">
                    {(() => {
                      const maxTons = Math.max(...quantityData.monthly.map(m => m.tons), 1);
                      return (
                        <>
                          <div className="flex gap-2">
                            <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: 165 }}>
                              {[maxTons, maxTons * 0.75, maxTons * 0.5, maxTons * 0.25, 0].map((v, i) => (
                                <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">
                                  {fmtTonsAxis(v)}
                                </span>
                              ))}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col">
                              <div className="relative" style={{ height: 165 }}>
                                {[0, 25, 50, 75, 100].map(pct => (
                                  <div
                                    key={pct}
                                    className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                                    style={{ bottom: `${(pct / 100) * 165}px` }}
                                  />
                                ))}
                                <div className="flex items-end gap-1 h-full">
                                  {quantityData.monthly.map(m => (
                                    <div key={m.month} className="flex-1 h-full flex items-end justify-center">
                                      {m.tons > 0 ? (
                                        <div
                                          className="w-4/5 bg-indigo-500 rounded-t transition-all"
                                          style={{ height: `${Math.max((m.tons / maxTons) * 165, 2)}px` }}
                                          title={fmtTons(m.tons)}
                                        />
                                      ) : (
                                        <div className="w-4/5 bg-gray-100 rounded-t" style={{ height: '2px' }} />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="flex gap-1 mt-1.5">
                                {quantityData.monthly.map(m => (
                                  <div key={m.month} className="flex-1 text-center">
                                    <span className="text-[10px] text-gray-400">{monthLabel(m.month)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <div className="w-14 shrink-0" />
                            <div className="flex-1 flex gap-1 text-xs font-medium text-indigo-600">
                              {quantityData.monthly.map(m => (
                                <div key={m.month} className="flex-1 text-center">
                                  {m.tons > 0 ? fmtTons(m.tons) : '—'}
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </Card>

                {/* Tonnage by customer */}
                {quantityData.by_customer.length > 0 && (
                  <Card>
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Users size={16} className="text-indigo-600" /> Tonnage by Customer
                      </h2>
                      <span className="text-xs text-gray-400">{period}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {quantityData.by_customer.map((c, i) => {
                        const maxC = quantityData.by_customer[0]?.tons || 1;
                        const pct = quantityData.total_tons > 0
                          ? Math.round((c.tons / quantityData.total_tons) * 100)
                          : 0;
                        return (
                          <div key={c.customer_id} className="px-5 py-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                <span className="text-xs text-gray-400 font-normal w-5">{i + 1}.</span>
                                {c.customer_name}
                              </span>
                              <div className="text-right shrink-0 ml-2">
                                <span className="text-sm font-bold text-indigo-700">{fmtTons(c.tons)}</span>
                                <span className="text-xs text-gray-400 ml-1">{pct}%</span>
                              </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(c.tons / maxC) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </>
            )
          )}
        </>
      ) : (
        <p className="text-center text-gray-500 py-12">Failed to load analytics data.</p>
      )}
    </div>
  );
}
