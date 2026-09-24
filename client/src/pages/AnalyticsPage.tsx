import { useState, useEffect } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import {
  BarChart3, TrendingUp, TrendingDown, DollarSign, Clock,
  RefreshCw, FileSpreadsheet, Users, Truck, Scale, ShoppingCart, Receipt, Landmark, Info,
} from 'lucide-react';
import { downloadExcel } from '../lib/exportExcel';
import { useToast } from '../contexts/ToastContext';
import ExportReportModal from '../components/ExportReportModal';
import ColumnChart from '../components/charts/ColumnChart';
import { PanelCard, PeriodPanel, BreakdownPanel, StatTile, VizRow } from '../components/charts/Panels';
import TimelineScatter from '../components/charts/TimelineScatter';
import TradingComparison from '../components/analytics/TradingComparison';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface MonthData { month: string; received: number; paid_out: number; }
interface CustomerData { customer_id: number; customer_name: string; total: number; invoice_count: number; }
interface RegionData { region: string; total: number; invoice_count: number; }
interface Summary {
  monthly: MonthData[];
  by_customer: CustomerData[];
  by_region: RegionData[];
  by_supplier: any[];
  totals: { received: number; paid_out: number; net: number; outstanding: number; expected: number; outstanding_payable: number; };
}
interface BreakdownSummary {
  monthly: { month: string; total: number }[];
  by_customer: { customer_id: number; customer_name: string; total: number; count: number }[];
  by_region: { region: string; total: number; count: number }[];
  total: number;
}
interface RevenueBreakdown { orders: BreakdownSummary; invoices: BreakdownSummary; }
interface QuantityData {
  monthly: { month: string; tons: number }[];
  total_tons: number;
  by_customer: { customer_id: number; customer_name: string; tons: number }[];
  by_region: { region: string; tons: number }[];
}
interface DemoExpensesData {
  monthly: { month: string; demo: number; sales: number; demo_vat: number; sales_vat: number }[];
  by_category: { category: string; domain: string; total: number; vat_total: number; count: number }[];
  by_supplier: { supplier: string; domain: string; category: string; total: number; vat_total: number; count: number }[];
  domain_totals: { domain: string; total: number; vat_total: number; count: number }[];
  totals: { total_amount: number; total_vat: number; invoice_count: number };
  years: string[];
  categories: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Categorical slots, assigned by measure and never by rank, so a filter can
// never repaint a series. Every combination used together on one chart was run
// through the palette validator (see components/charts/viz.ts).
const C_ORDERS   = 'var(--viz-1)'; // blue
const C_EXPENSE  = 'var(--viz-2)'; // orange
const C_INVOICES = 'var(--viz-3)'; // aqua
const C_CASH     = 'var(--viz-6)'; // green
const C_TONS     = 'var(--viz-7)'; // violet

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAxis(n: number): string {
  if (!n) return '0';
  if (Math.abs(n) >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `€${Math.round(n / 1_000)}k`;
  return `€${Math.round(n)}`;
}

function fmtTons(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k MT`;
  return `${n.toFixed(2)} MT`;
}

function fmtTonsAxis(n: number): string {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n >= 10 ? Math.round(n).toString() : n.toFixed(1);
}

function monthLabel(m: string) {
  const idx = parseInt(m.split('-')[1]) - 1;
  return MONTHS[idx] || m;
}

function periodLabel(year: string, monthFrom: string, monthTo: string) {
  const from = parseInt(monthFrom);
  const to = parseInt(monthTo);
  if (from === 1 && to === 12) return year;
  if (from === to) return `${MONTHS[from - 1]} ${year}`;
  return `${MONTHS[from - 1]}–${MONTHS[to - 1]} ${year}`;
}

// ── Period rollup (Month / Quarter / Year) ────────────────────────────────────
type GroupBy = 'month' | 'quarter' | 'year';

function rollupByPeriod<T extends { month: string }>(rows: T[], groupBy: GroupBy, keys: (keyof T)[]): Array<{ period: string } & Record<string, number>> {
  if (groupBy === 'month') {
    return rows.map(r => {
      const out: any = { period: monthLabel(r.month) };
      for (const k of keys) out[k as string] = Number(r[k]) || 0;
      return out;
    });
  }
  const buckets = new Map<string, any>();
  const order: string[] = [];
  for (const r of rows) {
    const [y, m] = r.month.split('-');
    const period = groupBy === 'year' ? y : `Q${Math.floor((parseInt(m) - 1) / 3) + 1} ${y}`;
    if (!buckets.has(period)) {
      const init: any = { period };
      for (const k of keys) init[k as string] = 0;
      buckets.set(period, init);
      order.push(period);
    }
    const b = buckets.get(period);
    for (const k of keys) b[k as string] += Number(r[k]) || 0;
  }
  return order.map(p => buckets.get(p));
}

/** Align a rolled-up series onto a shared period axis. */
function alignTo(periods: string[], rows: Array<{ period: string } & Record<string, number>>, key: string): number[] {
  const byPeriod = new Map(rows.map(r => [r.period, r[key] || 0]));
  return periods.map(p => byPeriod.get(p) ?? 0);
}

// ── Main tabs ─────────────────────────────────────────────────────────────────

type View = 'revenue' | 'expenses' | 'tonnage' | 'trading';

const VIEW_OPTIONS: { value: View; label: string; active: string }[] = [
  { value: 'revenue',  label: 'Revenue',          active: 'bg-green-600 text-white' },
  { value: 'expenses', label: 'Supplier Expenses', active: 'bg-indigo-600 text-white' },
  { value: 'tonnage',  label: 'Tonnage Sold',      active: 'bg-gray-700 text-white' },
  { value: 'trading',  label: 'Trading: Sale vs Purchase', active: 'bg-sky-600 text-white' },
];

function ToggleBtn({ active, onClick, color, children }: {
  active: boolean; onClick: () => void; color: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
        active ? `${color} text-white shadow-sm` : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear().toString();
  const { addToast } = useToast();
  const [showExportModal, setShowExportModal] = useState(false);

  // ── Global filters ────────────────────────────────────────────────────────
  const [view, setView] = useState<View>('revenue');
  const [year, setYear] = useState(currentYear);
  const [monthFrom, setMonthFrom] = useState('1');
  const [monthTo, setMonthTo] = useState('12');
  const [customerId, setCustomerId] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('month');

  // ── Revenue sub-tabs ──────────────────────────────────────────────────────
  const [revenueTab, setRevenueTab] = useState<'summary' | 'orders' | 'invoices'>('summary');
  const [revenueRows, setRevenueRows] = useState<{ customer_invoices: any[]; orders: any[] } | null>(null);
  const [breakdown, setBreakdown] = useState<RevenueBreakdown | null>(null);

  // ── Expenses tab toggles / filters ────────────────────────────────────────
  const [showDemo, setShowDemo] = useState(true);
  const [showSales, setShowSales] = useState(true);
  const [compareRevenue, setCompareRevenue] = useState(false);
  const [demoCategory, setDemoCategory] = useState('');
  const [demoSupplier, setDemoSupplier] = useState('');

  // ── Data state ────────────────────────────────────────────────────────────
  const [years, setYears] = useState<string[]>([currentYear]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [data, setData] = useState<Summary | null>(null);
  const [quantityData, setQuantityData] = useState<QuantityData | null>(null);
  const [demoData, setDemoData] = useState<DemoExpensesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/analytics/years'), api.get('/analytics/filters')])
      .then(([y, f]) => {
        if (y.data.length) setYears(y.data);
        setCustomers(f.data.customers);
      })
      .catch(() => {});
  }, []);

  const effectiveDomain = showDemo && showSales ? '' : showDemo ? 'demo' : showSales ? 'sales' : '';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/analytics/summary', {
        params: { year, month_from: monthFrom, month_to: monthTo, customer_id: customerId || undefined },
      }),
      api.get('/analytics/quantity', {
        params: { year, month_from: monthFrom, month_to: monthTo, customer_id: customerId || undefined },
      }),
      api.get('/analytics/demo-expenses', {
        params: {
          year, month_from: monthFrom, month_to: monthTo,
          domain: effectiveDomain || undefined,
          category: demoCategory || undefined,
        },
      }),
    ])
      .then(([summaryRes, quantityRes, demoRes]) => {
        setData(summaryRes.data);
        setQuantityData(quantityRes.data);
        setDemoData(demoRes.data);
      })
      .catch(() => { setData(null); setQuantityData(null); setDemoData(null); })
      .finally(() => setLoading(false));
  }, [year, monthFrom, monthTo, customerId, effectiveDomain, demoCategory]);

  // Row-level revenue data for the Orders / Invoices sub-tabs
  useEffect(() => {
    if (view !== 'revenue') return;
    api.get('/analytics/export-data', {
      params: { type: 'revenue', year_from: year, year_to: year, month_from: monthFrom, month_to: monthTo, customer_id: customerId || undefined },
    })
      .then(res => setRevenueRows({ customer_invoices: res.data.customer_invoices || [], orders: res.data.orders || [] }))
      .catch(() => setRevenueRows(null));
  }, [view, year, monthFrom, monthTo, customerId]);

  // Orders and invoices arrive as two independent summaries and stay that way:
  // an order becomes an invoice, so adding them would count the same sale twice.
  useEffect(() => {
    if (view !== 'revenue') return;
    api.get('/analytics/revenue-breakdown', {
      params: { year, month_from: monthFrom, month_to: monthTo, customer_id: customerId || undefined },
    })
      .then(res => setBreakdown(res.data))
      .catch(() => setBreakdown(null));
  }, [view, year, monthFrom, monthTo, customerId]);

  // ── Misc handlers ─────────────────────────────────────────────────────────
  const handleMonthFromChange = (val: string) => {
    setMonthFrom(val);
    if (parseInt(val) > parseInt(monthTo)) setMonthTo(val);
  };
  const handleMonthToChange = (val: string) => {
    setMonthTo(val);
    if (parseInt(val) < parseInt(monthFrom)) setMonthFrom(val);
  };

  const resetFilters = () => {
    setView('revenue');
    setYear(currentYear);
    setMonthFrom('1');
    setMonthTo('12');
    setCustomerId('');
    setShowDemo(true);
    setShowSales(true);
    setCompareRevenue(false);
    setDemoCategory('');
    setDemoSupplier('');
  };

  const isFiltered = year !== currentYear || monthFrom !== '1' || monthTo !== '12'
    || customerId !== '' || !showDemo || !showSales || compareRevenue
    || demoCategory !== '' || demoSupplier !== '';

  const period = periodLabel(year, monthFrom, monthTo);
  const groupHeader = groupBy === 'month' ? 'Month' : groupBy === 'quarter' ? 'Quarter' : 'Year';

  const filteredBySupplier = demoData?.by_supplier.filter(s =>
    (!demoSupplier || s.supplier.toLowerCase().includes(demoSupplier.toLowerCase()))
  ) || [];

  const demoTotal = demoData?.domain_totals.find(d => d.domain === 'demo');
  const salesTotal = demoData?.domain_totals.find(d => d.domain === 'sales');

  const handleExport = () => {
    if (view === 'revenue' && breakdown) {
      downloadExcel(`revenue-by-customer-${period}`,
        ['Customer', 'Orders (EUR)', 'Invoices (EUR)'],
        mergedCustomerRows.map(r => [r.label, r.values[0], r.values[1]]));
    } else if (view === 'expenses' && demoData) {
      downloadExcel(`supplier-expenses-${period}`,
        ['Supplier', 'Domain', 'Category', 'Amount (excl. BTW)', 'VAT', 'Invoices'],
        filteredBySupplier.map(s => [s.supplier, s.domain, s.category, s.total, s.vat_total, s.count]));
    } else if (view === 'tonnage' && quantityData) {
      downloadExcel(`tonnage-by-customer-${period}`, ['Customer', 'Tons'],
        quantityData.by_customer.map(c => [c.customer_name, c.tons]));
    }
  };

  // ── Revenue: shared period axis for orders vs invoices ────────────────────
  const ordersPeriods = breakdown ? rollupByPeriod(breakdown.orders.monthly, groupBy, ['total']) : [];
  const invoicePeriods = breakdown ? rollupByPeriod(breakdown.invoices.monthly, groupBy, ['total']) : [];
  const revPeriodLabels = ordersPeriods.map(r => r.period);
  const ordersByPeriod = alignTo(revPeriodLabels, ordersPeriods, 'total');
  const invoicesByPeriod = alignTo(revPeriodLabels, invoicePeriods, 'total');

  const cashPeriods = data ? rollupByPeriod(data.monthly, groupBy, ['received']) : [];

  // Customers and regions unioned across both measures — one row per entity,
  // one column per measure, never a combined column.
  const mergedCustomerRows: VizRow[] = (() => {
    if (!breakdown) return [];
    const map = new Map<string, VizRow>();
    for (const c of breakdown.orders.by_customer) {
      map.set(String(c.customer_id), { key: String(c.customer_id), label: c.customer_name || 'Unknown', values: [c.total, 0], count: c.count });
    }
    for (const c of breakdown.invoices.by_customer) {
      const k = String(c.customer_id);
      const row = map.get(k) ?? { key: k, label: c.customer_name || 'Unknown', values: [0, 0], count: 0 };
      row.values[1] = c.total;
      row.count = (row.count || 0) + c.count;
      map.set(k, row);
    }
    return [...map.values()];
  })();

  const mergedRegionRows: VizRow[] = (() => {
    if (!breakdown) return [];
    const map = new Map<string, VizRow>();
    for (const r of breakdown.orders.by_region) {
      map.set(r.region, { key: r.region, label: r.region, values: [r.total, 0], count: r.count });
    }
    for (const r of breakdown.invoices.by_region) {
      const row = map.get(r.region) ?? { key: r.region, label: r.region, values: [0, 0], count: 0 };
      row.values[1] = r.total;
      row.count = (row.count || 0) + r.count;
      map.set(r.region, row);
    }
    return [...map.values()];
  })();

  const ordersSeries = [{ name: 'Orders', color: C_ORDERS }];
  const invoicesSeries = [{ name: 'Invoices', color: C_INVOICES }];
  const bothSeries = [{ name: 'Orders', color: C_ORDERS }, { name: 'Invoices', color: C_INVOICES }];

  // Single-measure rows for the Orders / Invoices sub-tabs
  const singleRows = (summary: BreakdownSummary | undefined, dim: 'by_customer' | 'by_region'): VizRow[] => {
    if (!summary) return [];
    return dim === 'by_customer'
      ? summary.by_customer.map(c => ({ key: String(c.customer_id), label: c.customer_name || 'Unknown', values: [c.total], count: c.count }))
      : summary.by_region.map(r => ({ key: r.region, label: r.region, values: [r.total], count: r.count }));
  };

  // ── Expenses monthly series ───────────────────────────────────────────────
  const expenseRollup = demoData
    ? rollupByPeriod(
        demoData.monthly.map(m => {
          const rev = data?.monthly.find(r => r.month === m.month);
          return { ...m, received: rev?.received || 0 };
        }),
        groupBy,
        ['demo', 'sales', 'demo_vat', 'sales_vat', 'received'],
      )
    : [];
  const expenseSeries = [
    ...(showDemo ? [{ name: 'Demo expenses', color: C_ORDERS, values: expenseRollup.map(r => r.demo) }] : []),
    ...(showSales ? [{ name: 'Sales activities', color: C_EXPENSE, values: expenseRollup.map(r => r.sales) }] : []),
    ...(compareRevenue ? [{ name: 'Revenue received', color: C_INVOICES, values: expenseRollup.map(r => r.received) }] : []),
  ];

  const categoryRows: VizRow[] = (() => {
    if (!demoData) return [];
    const map = new Map<string, VizRow>();
    for (const c of demoData.by_category) {
      const row = map.get(c.category) ?? { key: c.category, label: c.category, values: [0], count: 0 };
      row.values[0] += c.total;
      row.count = (row.count || 0) + c.count;
      map.set(c.category, row);
    }
    return [...map.values()];
  })();

  const supplierRows: VizRow[] = filteredBySupplier.map(s => ({
    key: `${s.supplier}-${s.domain}`, label: s.supplier, values: [s.total], count: s.count,
  }));

  // ── Tonnage series ────────────────────────────────────────────────────────
  const tonsRollup = quantityData ? rollupByPeriod(quantityData.monthly, groupBy, ['tons']) : [];

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 size={24} className="text-primary-600" />
          Analytics
        </h1>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1 text-sm text-white bg-primary-600 rounded-lg px-3 py-1.5 hover:bg-primary-700 font-medium">
            <FileSpreadsheet size={14} /> Full Report
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            <FileSpreadsheet size={14} /> Quick Export
          </button>
          {isFiltered && (
            <button onClick={resetFilters} className="flex items-center gap-1 text-sm text-primary-600 hover:underline">
              <RefreshCw size={14} /> Reset filters
            </button>
          )}
        </div>
      </div>

      {/* ── Filters — one row above everything they scope ───────────────────── */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">View</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium">
              {VIEW_OPTIONS.map((opt, i) => (
                <button key={opt.value}
                  onClick={() => setView(opt.value)}
                  className={`px-3 py-2 transition-colors ${
                    view === opt.value ? opt.active : 'bg-white text-gray-600 hover:bg-gray-50'
                  } ${i > 0 ? 'border-l border-gray-300' : ''}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
            <select value={year} onChange={e => setYear(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <select value={monthFrom} onChange={e => handleMonthFromChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <select value={monthTo} onChange={e => handleMonthToChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1} disabled={i + 1 < parseInt(monthFrom)}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Group by</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium">
              {(['month', 'quarter', 'year'] as GroupBy[]).map((g, i) => (
                <button key={g}
                  onClick={() => setGroupBy(g)}
                  className={`px-3 py-2 capitalize transition-colors ${
                    groupBy === g ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  } ${i > 0 ? 'border-l border-gray-300' : ''}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-gray-100">
          {(view === 'revenue' || view === 'tonnage' || view === 'trading') && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                <Users size={11} /> Customer
              </label>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {view === 'expenses' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Data Series</label>
                <div className="flex gap-2">
                  <ToggleBtn active={showDemo} onClick={() => { if (showDemo && !showSales) return; setShowDemo(d => !d); }}
                    color="bg-indigo-600 border-indigo-600">
                    Demo Expenses
                  </ToggleBtn>
                  <ToggleBtn active={showSales} onClick={() => { if (showSales && !showDemo) return; setShowSales(s => !s); }}
                    color="bg-emerald-600 border-emerald-600">
                    Sales Activities
                  </ToggleBtn>
                  <ToggleBtn active={compareRevenue} onClick={() => setCompareRevenue(c => !c)}
                    color="bg-green-600 border-green-600">
                    + Revenue
                  </ToggleBtn>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                  <Truck size={11} /> Category
                </label>
                <select value={demoCategory} onChange={e => setDemoCategory(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="">All Categories</option>
                  {(demoData?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                  <Truck size={11} /> Supplier search
                </label>
                <input type="text" value={demoSupplier} onChange={e => setDemoSupplier(e.target.value)}
                  placeholder="Filter suppliers..."
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-48" />
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Hold the previous render at reduced opacity instead of a skeleton flash */}
      <div className={loading ? 'opacity-50 transition-opacity pointer-events-none' : 'transition-opacity'}>
        <div className="space-y-6">

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* REVENUE                                                            */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {view === 'revenue' && data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <StatTile
                label="Orders placed" color={C_ORDERS} icon={<ShoppingCart size={18} />}
                value={fmt(breakdown?.orders.total ?? 0)} hint={period}
              />
              <StatTile
                label="Invoices issued" color={C_INVOICES} icon={<Receipt size={18} />}
                value={fmt(breakdown?.invoices.total ?? 0)} hint={period}
              />
              <StatTile
                label="Cash received" color={C_CASH} icon={<Landmark size={18} />}
                value={fmt(data.totals.received)} hint="Wire transfers & payments"
              />
              <StatTile
                label="Pending (w/ due date)" color="var(--viz-4)" icon={<Clock size={18} />}
                value={fmt(data.totals.outstanding)}
              />
              <StatTile
                label="Expected (no due date)" color="var(--viz-5)" icon={<Clock size={18} />}
                value={fmt(data.totals.expected ?? 0)}
              />
            </div>

            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 text-xs text-blue-700 flex items-start gap-2">
              <Info size={14} className="mt-px shrink-0" />
              <span>
                Orders and invoices are three separate measures of the same pipeline and are never added together —
                an order becomes an invoice, and the invoice becomes cash. Each column below totals on its own.
              </span>
            </div>

            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium w-fit">
              {(['summary', 'orders', 'invoices'] as const).map((t, i) => (
                <button key={t}
                  onClick={() => setRevenueTab(t)}
                  className={`px-4 py-2 capitalize transition-colors ${
                    revenueTab === t ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  } ${i > 0 ? 'border-l border-gray-300' : ''}`}>
                  {t}
                </button>
              ))}
            </div>

            {/* ── Summary: orders and invoices side by side ─────────────────── */}
            {revenueTab === 'summary' && (
              <div className="space-y-6">
                <PeriodPanel
                  title="Orders vs Invoices"
                  subtitle={`${groupHeader} breakdown — ${period}`}
                  icon={<BarChart3 size={16} className="text-gray-400" />}
                  periodHeader={groupHeader}
                  categories={revPeriodLabels}
                  series={[
                    { name: 'Orders', color: C_ORDERS, values: ordersByPeriod },
                    { name: 'Invoices', color: C_INVOICES, values: invoicesByPeriod },
                  ]}
                  format={fmt}
                  formatAxis={fmtAxis}
                  onExport={() => downloadExcel(`revenue-${groupBy}-${period}`,
                    [groupHeader, 'Orders (EUR)', 'Invoices (EUR)'],
                    revPeriodLabels.map((p, i) => [p, ordersByPeriod[i], invoicesByPeriod[i]]))}
                />

                <BreakdownPanel
                  title="By Customer"
                  subtitle={`Orders and invoices per customer — ${period}`}
                  icon={<Users size={16} className="text-gray-400" />}
                  dimensionHeader="Customer"
                  rows={mergedCustomerRows}
                  series={bothSeries}
                  format={fmt}
                  countLabel="Docs"
                  onExport={() => downloadExcel(`revenue-by-customer-${period}`,
                    ['Customer', 'Orders (EUR)', 'Invoices (EUR)'],
                    mergedCustomerRows.map(r => [r.label, r.values[0], r.values[1]]))}
                />

                <BreakdownPanel
                  title="By Region"
                  subtitle={`Destination country of the operation — ${period}`}
                  icon={<Truck size={16} className="text-gray-400" />}
                  dimensionHeader="Region"
                  rows={mergedRegionRows}
                  series={bothSeries}
                  format={fmt}
                  countLabel="Docs"
                  onExport={() => downloadExcel(`revenue-by-region-${period}`,
                    ['Region', 'Orders (EUR)', 'Invoices (EUR)'],
                    mergedRegionRows.map(r => [r.label, r.values[0], r.values[1]]))}
                />

                <PeriodPanel
                  title="Cash Received"
                  subtitle={`Wire transfers and payments actually banked — ${period}`}
                  icon={<Landmark size={16} className="text-gray-400" />}
                  periodHeader={groupHeader}
                  categories={cashPeriods.map(r => r.period)}
                  series={[{ name: 'Received', color: C_CASH, values: cashPeriods.map(r => r.received) }]}
                  format={fmt}
                  formatAxis={fmtAxis}
                  onExport={() => downloadExcel(`cash-received-${period}`,
                    [groupHeader, 'Received (EUR)'],
                    cashPeriods.map(r => [r.period, r.received]))}
                />
              </div>
            )}

            {/* ── Orders only ───────────────────────────────────────────────── */}
            {revenueTab === 'orders' && breakdown && (
              <div className="space-y-6">
                <PeriodPanel
                  title="Orders per Period"
                  subtitle={`Customer orders allocated to an operation — ${period}`}
                  icon={<ShoppingCart size={16} className="text-gray-400" />}
                  periodHeader={groupHeader}
                  categories={revPeriodLabels}
                  series={[{ name: 'Orders', color: C_ORDERS, values: ordersByPeriod }]}
                  format={fmt}
                  formatAxis={fmtAxis}
                />
                <BreakdownPanel
                  title="Orders by Customer" dimensionHeader="Customer"
                  icon={<Users size={16} className="text-gray-400" />}
                  subtitle={period}
                  rows={singleRows(breakdown.orders, 'by_customer')}
                  series={ordersSeries} format={fmt} countLabel="Orders"
                />
                <BreakdownPanel
                  title="Orders by Region" dimensionHeader="Region"
                  icon={<Truck size={16} className="text-gray-400" />}
                  subtitle={period} chart="donut"
                  rows={singleRows(breakdown.orders, 'by_region')}
                  series={ordersSeries} format={fmt} countLabel="Orders"
                />
                <PanelCard
                  title="Order Detail"
                  subtitle={`Every customer order allocated to an operation — ${period}`}
                  icon={<ShoppingCart size={16} className="text-gray-400" />}
                  onExport={() => downloadExcel(`revenue-orders-${period}`,
                    ['Order #', 'Party', 'Operation #', 'Status', 'Quantity (MT)', 'Total (EUR)', 'Date'],
                    (revenueRows?.orders || []).map(r => [r.order_number, r.party_name, r.operation_number, r.status, r.quantity_mt, r.total_eur, r.order_date]))}
                >
                  <TimelineScatter
                    points={(revenueRows?.orders || []).map(r => ({
                      key: r.order_number, date: r.order_date, value: Number(r.total_eur) || 0,
                      label: r.order_number, sublabel: r.party_name, tag: r.operation_number,
                    }))}
                    color={C_ORDERS}
                    format={fmt}
                  />
                  <div className="overflow-x-auto -mx-5 mt-5 border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500">
                          <th className="text-left px-4 py-2 font-medium">Order #</th>
                          <th className="text-left px-4 py-2 font-medium">Party</th>
                          <th className="text-left px-4 py-2 font-medium">Operation #</th>
                          <th className="text-left px-4 py-2 font-medium">Status</th>
                          <th className="text-right px-4 py-2 font-medium">MT</th>
                          <th className="text-right px-4 py-2 font-medium">Total (EUR)</th>
                          <th className="text-left px-4 py-2 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(revenueRows?.orders || []).length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No orders in this period</td></tr>
                        ) : revenueRows!.orders.map((r, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-800">{r.order_number}</td>
                            <td className="px-4 py-2 text-gray-600">{r.party_name || '—'}</td>
                            <td className="px-4 py-2 text-gray-600">{r.operation_number || '—'}</td>
                            <td className="px-4 py-2 text-gray-600 capitalize">{String(r.status || '').replace(/_/g, ' ')}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{r.quantity_mt ? Number(r.quantity_mt).toFixed(2) : '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(r.total_eur)}</td>
                            <td className="px-4 py-2 text-gray-600">{r.order_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </PanelCard>
              </div>
            )}

            {/* ── Invoices only ─────────────────────────────────────────────── */}
            {revenueTab === 'invoices' && breakdown && (
              <div className="space-y-6">
                <PeriodPanel
                  title="Invoices per Period"
                  subtitle={`Customer invoices by invoice date — ${period}`}
                  icon={<Receipt size={16} className="text-gray-400" />}
                  periodHeader={groupHeader}
                  categories={revPeriodLabels}
                  series={[{ name: 'Invoices', color: C_INVOICES, values: invoicesByPeriod }]}
                  format={fmt}
                  formatAxis={fmtAxis}
                />
                <BreakdownPanel
                  title="Invoices by Customer" dimensionHeader="Customer"
                  icon={<Users size={16} className="text-gray-400" />}
                  subtitle={period}
                  rows={singleRows(breakdown.invoices, 'by_customer')}
                  series={invoicesSeries} format={fmt} countLabel="Invoices"
                />
                <BreakdownPanel
                  title="Invoices by Region" dimensionHeader="Region"
                  icon={<Truck size={16} className="text-gray-400" />}
                  subtitle={period} chart="donut"
                  rows={singleRows(breakdown.invoices, 'by_region')}
                  series={invoicesSeries} format={fmt} countLabel="Invoices"
                />
                <PanelCard
                  title="Invoice Detail"
                  subtitle={`Customer invoices — ${period}`}
                  icon={<Receipt size={16} className="text-gray-400" />}
                  onExport={() => downloadExcel(`revenue-invoices-${period}`,
                    ['Invoice #', 'Customer', 'Operation #', 'Quantity (MT)', 'Amount', 'Currency', 'EUR', 'Date'],
                    (revenueRows?.customer_invoices || []).map(r => [r.invoice_number, r.customer_name, r.operation_number, r.quantity_mt, r.amount, r.currency, r.eur_amount, r.invoice_date]))}
                >
                  <TimelineScatter
                    points={(revenueRows?.customer_invoices || []).map(r => ({
                      key: r.invoice_number, date: r.invoice_date, value: Number(r.eur_amount) || 0,
                      label: r.invoice_number, sublabel: r.customer_name, tag: r.operation_number,
                    }))}
                    color={C_INVOICES}
                    format={fmt}
                  />
                  <div className="overflow-x-auto -mx-5 mt-5 border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500">
                          <th className="text-left px-4 py-2 font-medium">Invoice #</th>
                          <th className="text-left px-4 py-2 font-medium">Customer</th>
                          <th className="text-left px-4 py-2 font-medium">Operation #</th>
                          <th className="text-right px-4 py-2 font-medium">MT</th>
                          <th className="text-right px-4 py-2 font-medium">Amount</th>
                          <th className="text-right px-4 py-2 font-medium">EUR</th>
                          <th className="text-left px-4 py-2 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(revenueRows?.customer_invoices || []).length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No invoices in this period</td></tr>
                        ) : revenueRows!.customer_invoices.map((r, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-800">{r.invoice_number}</td>
                            <td className="px-4 py-2 text-gray-600">{r.customer_name || '—'}</td>
                            <td className="px-4 py-2 text-gray-600">{r.operation_number || '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{r.quantity_mt ? Number(r.quantity_mt).toFixed(2) : '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{Number(r.amount).toLocaleString()} {r.currency}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(r.eur_amount)}</td>
                            <td className="px-4 py-2 text-gray-600">{r.invoice_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </PanelCard>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SUPPLIER EXPENSES                                                  */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {view === 'expenses' && demoData && (
          <>
            <div className={`grid gap-4 ${compareRevenue ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
              <StatTile label="Total expenses (excl. BTW)" color={C_EXPENSE} icon={<TrendingDown size={18} />}
                value={fmt(demoData.totals.total_amount)} hint={`${demoData.totals.invoice_count} invoices`} />
              <StatTile label="VAT total" color="var(--viz-4)" icon={<Clock size={18} />}
                value={fmt(demoData.totals.total_vat)} />
              {showDemo && demoTotal && (
                <StatTile label="Demo expenses" color={C_ORDERS} icon={<Truck size={18} />}
                  value={fmt(demoTotal.total)} hint={`${demoTotal.count} invoices`} />
              )}
              {showSales && salesTotal && (
                <StatTile label="Sales activities" color={C_EXPENSE} icon={<Truck size={18} />}
                  value={fmt(salesTotal.total)} hint={`${salesTotal.count} invoices`} />
              )}
              {compareRevenue && data && (
                <StatTile label="Revenue received" color={C_INVOICES} icon={<TrendingUp size={18} />}
                  value={fmt(data.totals.received)}
                  hint={`Net ${data.totals.received - demoData.totals.total_amount >= 0 ? '+' : ''}${fmt(data.totals.received - demoData.totals.total_amount)}`} />
              )}
            </div>

            {/* Monthly — chart plus its detailed twin (VAT and net live here) */}
            <PanelCard
              title="Expenses per Period"
              subtitle={`${groupHeader} breakdown — ${period}`}
              icon={<BarChart3 size={16} className="text-gray-400" />}
              onExport={() => downloadExcel(`expenses-${groupBy}-${period}`,
                [groupHeader, 'Demo', 'Sales', 'VAT'],
                expenseRollup.map(r => [r.period, r.demo, r.sales, r.demo_vat + r.sales_vat]))}
            >
              {expenseSeries.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-6">Select at least one data series</p>
              ) : (
                <ColumnChart
                  categories={expenseRollup.map(r => r.period)}
                  series={expenseSeries}
                  format={fmt}
                  formatAxis={fmtAxis}
                />
              )}
              <div className="overflow-x-auto -mx-5 mt-5 border-t border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500">
                      <th className="text-left px-5 py-2 font-medium">{groupHeader}</th>
                      {showDemo && <th className="text-right px-3 py-2 font-medium">Demo</th>}
                      {showSales && <th className="text-right px-3 py-2 font-medium">Sales</th>}
                      <th className="text-right px-3 py-2 font-medium">Total exp.</th>
                      <th className="text-right px-3 py-2 font-medium">VAT</th>
                      {compareRevenue && <th className="text-right px-3 py-2 font-medium">Revenue</th>}
                      {compareRevenue && <th className="text-right px-5 py-2 font-medium">Net</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {expenseRollup.map(r => {
                      const totalExp = (showDemo ? r.demo : 0) + (showSales ? r.sales : 0);
                      const totalVat = (showDemo ? r.demo_vat : 0) + (showSales ? r.sales_vat : 0);
                      const net = r.received - totalExp;
                      return (
                        <tr key={r.period} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-5 py-2 font-medium text-gray-700">{r.period}</td>
                          {showDemo && <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmt(r.demo)}</td>}
                          {showSales && <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmt(r.sales)}</td>}
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{fmt(totalExp)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(totalVat)}</td>
                          {compareRevenue && <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmt(r.received)}</td>}
                          {compareRevenue && (
                            <td className={`px-5 py-2 text-right tabular-nums font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {net >= 0 ? '+' : ''}{fmt(net)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                      <td className="px-5 py-2 text-gray-700">Total</td>
                      {showDemo && <td className="px-3 py-2 text-right tabular-nums">{fmt(demoTotal?.total || 0)}</td>}
                      {showSales && <td className="px-3 py-2 text-right tabular-nums">{fmt(salesTotal?.total || 0)}</td>}
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(demoData.totals.total_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(demoData.totals.total_vat)}</td>
                      {compareRevenue && data && <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.received)}</td>}
                      {compareRevenue && data && (() => {
                        const net = data.totals.received - demoData.totals.total_amount;
                        return (
                          <td className={`px-5 py-2 text-right tabular-nums ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {net >= 0 ? '+' : ''}{fmt(net)}
                          </td>
                        );
                      })()}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </PanelCard>

            <BreakdownPanel
              title="Expenses by Category"
              subtitle={period}
              icon={<Truck size={16} className="text-gray-400" />}
              dimensionHeader="Category"
              chart="donut"
              rows={categoryRows}
              series={[{ name: 'Expenses', color: C_EXPENSE }]}
              format={fmt}
              countLabel="Invoices"
              onExport={() => downloadExcel(`expenses-by-category-${period}`,
                ['Category', 'Invoices', 'Total (EUR)'],
                categoryRows.map(r => [r.label, r.count, r.values[0]]))}
            />

            <BreakdownPanel
              title="Expenses by Supplier"
              subtitle={`${filteredBySupplier.length} suppliers — ${period}${demoSupplier ? ` · filtered: "${demoSupplier}"` : ''}`}
              icon={<Truck size={16} className="text-gray-400" />}
              dimensionHeader="Supplier"
              rows={supplierRows}
              series={[{ name: 'Expenses', color: C_EXPENSE }]}
              format={fmt}
              countLabel="Invoices"
              onExport={() => downloadExcel(`expenses-by-supplier-${period}`,
                ['Supplier', 'Invoices', 'Total (EUR)'],
                supplierRows.map(r => [r.label, r.count, r.values[0]]))}
            />
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TONNAGE                                                            */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {view === 'trading' && (
          <TradingComparison year={year} monthFrom={monthFrom} monthTo={monthTo} customerId={customerId} />
        )}

        {view === 'tonnage' && quantityData && data && (
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatTile label="Total tons sold" color={C_TONS} icon={<Scale size={18} />}
                  value={fmtTons(quantityData.total_tons)} hint={period} />
                <StatTile label="Cash received" color={C_CASH} icon={<TrendingUp size={18} />}
                  value={fmt(data.totals.received)} hint={period} />
                <StatTile label="EUR per ton" color={C_INVOICES} icon={<DollarSign size={18} />}
                  value={data.totals.received > 0 && quantityData.total_tons > 0
                    ? fmt(data.totals.received / quantityData.total_tons)
                    : '—'} />
              </div>

              <PeriodPanel
                title="Tons Sold per Period"
                subtitle={`${groupHeader} breakdown — ${period}`}
                icon={<Scale size={16} className="text-gray-400" />}
                periodHeader={groupHeader}
                categories={tonsRollup.map(r => r.period)}
                series={[{ name: 'Tons', color: C_TONS, values: tonsRollup.map(r => r.tons) }]}
                format={fmtTons}
                formatAxis={fmtTonsAxis}
                onExport={() => downloadExcel(`tonnage-${groupBy}-${period}`,
                  [groupHeader, 'Tons (MT)'], tonsRollup.map(r => [r.period, r.tons]))}
              />

              <BreakdownPanel
                title="Tonnage by Customer"
                subtitle={period}
                icon={<Users size={16} className="text-gray-400" />}
                dimensionHeader="Customer"
                rows={quantityData.by_customer.map(c => ({
                  key: String(c.customer_id), label: c.customer_name || 'Unknown', values: [c.tons],
                }))}
                series={[{ name: 'Tons', color: C_TONS }]}
                format={fmtTons}
                onExport={() => downloadExcel(`tonnage-by-customer-${period}`,
                  ['Customer', 'Tons'], quantityData.by_customer.map(c => [c.customer_name, c.tons]))}
              />

              <BreakdownPanel
                title="Tonnage by Region"
                subtitle={period}
                icon={<Truck size={16} className="text-gray-400" />}
                dimensionHeader="Region"
                chart="donut"
                rows={(quantityData.by_region || []).map(r => ({ key: r.region, label: r.region, values: [r.tons] }))}
                series={[{ name: 'Tons', color: C_TONS }]}
                format={fmtTons}
                onExport={() => downloadExcel(`tonnage-by-region-${period}`,
                  ['Region', 'Tons'], (quantityData.by_region || []).map(r => [r.region, r.tons]))}
              />
            </>
          )
        )}

        {!loading && !data && !demoData && !quantityData && (
          <p className="text-center text-gray-500 py-12">Failed to load analytics data.</p>
        )}
        </div>
      </div>

      <ExportReportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        years={years}
        addToast={addToast}
      />
    </div>
  );
}
