import { useState, useEffect } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import {
  BarChart3, TrendingUp, TrendingDown, DollarSign, Clock,
  RefreshCw, FileSpreadsheet, Users, Truck, Scale,
  ChevronDown, ChevronRight, Eye, EyeOff,
} from 'lucide-react';
import { downloadExcel } from '../lib/exportExcel';
import { useToast } from '../contexts/ToastContext';
import ExportReportModal from '../components/ExportReportModal';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface MonthData { month: string; received: number; paid_out: number; }
interface CustomerData { customer_id: number; customer_name: string; total: number; invoice_count: number; }
interface Summary {
  monthly: MonthData[];
  by_customer: CustomerData[];
  by_supplier: any[];
  totals: { received: number; paid_out: number; net: number; outstanding: number; expected: number; outstanding_payable: number; };
}
interface QuantityData {
  monthly: { month: string; tons: number }[];
  total_tons: number;
  by_customer: { customer_id: number; customer_name: string; tons: number }[];
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

const DEMO_CAT_COLORS: Record<string, string> = {
  'Salaries': '#6366f1', 'Cars': '#8b5cf6', 'Overhead': '#3b82f6',
  'Consumables': '#f59e0b', 'Materials': '#10b981', 'Utilities and Maintenance': '#ef4444',
  'Feedstock': '#14b8a6', 'Subcontractors and Consultants': '#ec4899',
  'Regulatory': '#f97316', 'Equipment': '#0ea5e9', 'Couriers': '#84cc16', 'Other': '#6b7280',
  'Raw Materials': '#059669', 'Logistics': '#7c3aed', 'Blenders': '#db2777', 'Shipping': '#0284c7',
};

const DONUT_COLORS = ['#22c55e', '#3b82f6', '#8b5cf6', '#06b6d4', '#14b8a6', '#f59e0b', '#6366f1', '#ec4899', '#f97316'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAxis(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `€${Math.round(n / 1_000)}k`;
  return `€${Math.round(n)}`;
}

function fmtTons(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k MT`;
  return `${n.toFixed(2)} MT`;
}

function fmtTonsAxis(n: number): string {
  if (n === 0) return '0';
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

// ── Chart components ──────────────────────────────────────────────────────────

function BarChartGrid({ height, maxVal, fmtFn, children }: {
  height: number;
  maxVal: number;
  fmtFn: (n: number) => string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height }}>
        {[maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0].map((v, i) => (
          <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">{fmtFn(v)}</span>
        ))}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="relative" style={{ height }}>
          {[0, 25, 50, 75, 100].map(pct => (
            <div key={pct} className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
              style={{ bottom: `${(pct / 100) * height}px` }} />
          ))}
          <div className="flex items-end gap-1 h-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthLabels({ months }: { months: string[] }) {
  return (
    <div className="flex gap-1 mt-1.5 ml-16">
      {months.map(m => (
        <div key={m} className="flex-1 text-center">
          <span className="text-[10px] text-gray-400">{monthLabel(m)}</span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ slices }: { slices: { label: string; value: number }[] }) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total === 0 || slices.length === 0) return null;
  const size = 140, r = 56, ir = 34, cx = 70, cy = 70;
  let angle = -Math.PI / 2;
  const paths = slices.map((s, i) => {
    const pct = s.value / total;
    const sweep = pct * 2 * Math.PI;
    const end = angle + sweep;
    const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    const [x2, y2] = [cx + r * Math.cos(end), cy + r * Math.sin(end)];
    const [ix1, iy1] = [cx + ir * Math.cos(end), cy + ir * Math.sin(end)];
    const [ix2, iy2] = [cx + ir * Math.cos(angle), cy + ir * Math.sin(angle)];
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r},0,${large},1,${x2.toFixed(2)},${y2.toFixed(2)} L${ix1.toFixed(2)},${iy1.toFixed(2)} A${ir},${ir},0,${large},0,${ix2.toFixed(2)},${iy2.toFixed(2)}Z`;
    angle = end;
    return { d, color: DONUT_COLORS[i % DONUT_COLORS.length], pct: Math.round(pct * 100), label: s.label };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.color} className="hover:opacity-75 transition-opacity cursor-pointer" stroke="white" strokeWidth="1.5">
          <title>{p.label}: {p.pct}%</title>
        </path>
      ))}
    </svg>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function ChartSection({ id, title, icon, visible, onToggle, children, badge }: {
  id: string;
  title: string;
  icon: React.ReactNode;
  visible: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Card>
      <div
        className="px-5 py-3 border-b border-gray-100 flex items-center justify-between cursor-pointer select-none hover:bg-gray-50 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          {collapsed ? <ChevronRight size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          {icon}
          {title}
          {badge}
        </h2>
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          className={`p-1 rounded transition-colors ${visible ? 'text-gray-500 hover:text-gray-700' : 'text-gray-300 hover:text-gray-500'}`}
          title={visible ? 'Hide section' : 'Show section'}
        >
          {visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
      {!collapsed && visible && <div className="p-5">{children}</div>}
    </Card>
  );
}

// ── Toggle button ─────────────────────────────────────────────────────────────

function ToggleBtn({ active, onClick, color, children }: {
  active: boolean; onClick: () => void; color: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
        active
          ? `${color} text-white shadow-sm`
          : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

// ── Main tabs ─────────────────────────────────────────────────────────────────

type View = 'revenue' | 'expenses' | 'tonnage';

const VIEW_OPTIONS: { value: View; label: string; active: string }[] = [
  { value: 'revenue',  label: 'Revenue',           active: 'bg-green-600 text-white' },
  { value: 'expenses', label: 'Supplier Expenses',  active: 'bg-indigo-600 text-white' },
  { value: 'tonnage',  label: 'Tonnage Sold',       active: 'bg-gray-700 text-white' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear().toString();
  const { addToast } = useToast();
  const [showExportModal, setShowExportModal] = useState(false);

  // ── Global filters ────────────────────────────────────────────────────────
  const [view, setView] = useState<View>('expenses');
  const [year, setYear] = useState(currentYear);
  const [monthFrom, setMonthFrom] = useState('1');
  const [monthTo, setMonthTo] = useState('12');
  const [customerId, setCustomerId] = useState('');

  // ── Expenses tab toggles ──────────────────────────────────────────────────
  const [showDemo, setShowDemo] = useState(true);
  const [showSales, setShowSales] = useState(true);
  const [compareRevenue, setCompareRevenue] = useState(false);

  // ── Expenses tab filters ──────────────────────────────────────────────────
  const [demoCategory, setDemoCategory] = useState('');
  const [demoSupplier, setDemoSupplier] = useState('');

  // ── Section visibility ────────────────────────────────────────────────────
  const [sections, setSections] = useState({
    monthlyTrend: true,
    revenueComparison: true,
    byCategory: true,
    bySupplier: true,
    summaryTable: true,
  });
  const toggleSection = (key: keyof typeof sections) =>
    setSections(s => ({ ...s, [key]: !s[key] }));

  // ── Data state ────────────────────────────────────────────────────────────
  const [years, setYears] = useState<string[]>([currentYear]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [data, setData] = useState<Summary | null>(null);
  const [quantityData, setQuantityData] = useState<QuantityData | null>(null);
  const [demoData, setDemoData] = useState<DemoExpensesData | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Load filter options ───────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.get('/analytics/years'), api.get('/analytics/filters')])
      .then(([y, f]) => {
        if (y.data.length) setYears(y.data);
        setCustomers(f.data.customers);
      })
      .catch(() => {});
  }, []);

  // ── Compute effective domain filter based on toggles ──────────────────────
  const effectiveDomain = showDemo && showSales ? '' : showDemo ? 'demo' : showSales ? 'sales' : '';

  // ── Load data ─────────────────────────────────────────────────────────────
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
    setView('expenses');
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
  const chartH = 180;
  const barH = chartH - 16;

  // ── Filtered supplier data ────────────────────────────────────────────────
  const filteredBySupplier = demoData?.by_supplier.filter(s =>
    (!demoSupplier || s.supplier.toLowerCase().includes(demoSupplier.toLowerCase()))
  ) || [];

  const filteredByCategory = demoData?.by_category || [];

  // ── Revenue data for comparison ───────────────────────────────────────────
  const revenueByMonth = data?.monthly || [];

  // ── Export handler ────────────────────────────────────────────────────────
  const handleExport = () => {
    if (view === 'revenue' && data) {
      downloadExcel(`revenue-by-customer-${period}`, ['Customer', 'Total (EUR)', 'Invoices'],
        data.by_customer.map(c => [c.customer_name, c.total, c.invoice_count]));
    } else if (view === 'expenses' && demoData) {
      const rows = filteredBySupplier.map(s => [s.supplier, s.domain, s.category, s.total, s.vat_total, s.count]);
      downloadExcel(`supplier-expenses-${period}`, ['Supplier', 'Domain', 'Category', 'Amount (excl. BTW)', 'VAT', 'Invoices'], rows);
    } else if (view === 'tonnage' && quantityData) {
      downloadExcel(`tonnage-by-customer-${period}`, ['Customer', 'Tons'],
        quantityData.by_customer.map(c => [c.customer_name, c.tons]));
    }
  };

  // ── Computed totals for KPI cards ─────────────────────────────────────────
  const demoTotal = demoData?.domain_totals.find(d => d.domain === 'demo');
  const salesTotal = demoData?.domain_totals.find(d => d.domain === 'sales');

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

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <Card className="p-4 space-y-4">
        {/* Row 1: View tabs + time filters */}
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
        </div>

        {/* Row 2: View-specific filters */}
        <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-gray-100">
          {/* Revenue / Tonnage: customer filter */}
          {(view === 'revenue' || view === 'tonnage') && (
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

          {/* Expenses: data series toggles */}
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

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (

      <>
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* REVENUE VIEW                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {view === 'revenue' && data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                  <TrendingUp size={20} className="text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Revenue Received</p>
                  <p className="text-xl font-bold text-green-700 truncate">{fmt(data.totals.received)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${data.totals.net >= 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
                  <DollarSign size={20} className={data.totals.net >= 0 ? 'text-emerald-600' : 'text-red-500'} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Net (Revenue − Expenses)</p>
                  <p className={`text-xl font-bold truncate ${data.totals.net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {data.totals.net >= 0 ? '+' : ''}{fmt(data.totals.net)}
                  </p>
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
                  <p className="text-xl font-bold text-amber-600 truncate">{fmt(data.totals.outstanding)}</p>
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
                  <p className="text-xl font-bold text-blue-600 truncate">{fmt(data.totals.expected ?? 0)}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Monthly revenue chart */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Revenue Received — {period}</h2>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-3 h-3 rounded bg-green-500 inline-block" /> Received
              </span>
            </div>
            <div className="p-5">
              {(() => {
                const maxBar = Math.max(...data.monthly.map(m => m.received), 1);
                return (
                  <>
                    <BarChartGrid height={chartH} maxVal={maxBar} fmtFn={fmtAxis}>
                      {data.monthly.map(m => (
                        <div key={m.month} className="flex-1 h-full flex flex-col items-center justify-end">
                          {m.received > 0 && (
                            <span className="text-[9px] tabular-nums leading-none mb-0.5 font-medium text-green-600">{fmtAxis(m.received)}</span>
                          )}
                          <div className={`w-4/5 rounded-t transition-all ${m.received > 0 ? 'bg-green-500' : 'bg-gray-100'}`}
                            style={{ height: `${m.received > 0 ? Math.max((m.received / maxBar) * barH, 2) : 2}px` }}
                            title={`Revenue: ${fmt(m.received)}`} />
                        </div>
                      ))}
                    </BarChartGrid>
                    <MonthLabels months={data.monthly.map(m => m.month)} />
                  </>
                );
              })()}
            </div>
          </Card>

          {/* Revenue by Customer — donut + bars */}
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
              <div className="p-5">
                <div className="flex gap-6 items-start mb-6">
                  <DonutChart slices={data.by_customer.map(c => ({ label: c.customer_name, value: c.total }))} />
                  <div className="flex-1 min-w-0 space-y-2">
                    {data.by_customer.map((c, i) => {
                      const totalAll = data.by_customer.reduce((s, x) => s + x.total, 0);
                      const pct = totalAll > 0 ? Math.round((c.total / totalAll) * 100) : 0;
                      return (
                        <div key={c.customer_id} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                          <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{c.customer_name}</span>
                          <span className="text-xs text-gray-400 shrink-0">{pct}%</span>
                          <span className="text-sm font-semibold text-gray-900 shrink-0 min-w-[80px] text-right">{fmt(c.total)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="divide-y divide-gray-100 border-t border-gray-100">
                  {data.by_customer.map((c, i) => {
                    const maxC = data.by_customer[0]?.total || 1;
                    const pct = maxC > 0 ? Math.round((c.total / maxC) * 100) : 0;
                    return (
                      <div key={c.customer_id} className="py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-normal w-5">{i + 1}.</span>
                            {c.customer_name}
                          </span>
                          <div className="text-right shrink-0 ml-2">
                            <span className="text-sm font-bold text-gray-900">{fmt(c.total)}</span>
                            <span className="text-xs text-gray-400 ml-1">{c.invoice_count} inv</span>
                          </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SUPPLIER EXPENSES VIEW  (modular)                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {view === 'expenses' && demoData && (
        <>
          {/* ── KPI cards ─────────────────────────────────────────────────── */}
          <div className={`grid gap-4 ${compareRevenue ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                  <TrendingDown size={20} className="text-orange-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Total Expenses (excl. BTW)</p>
                  <p className="text-xl font-bold text-gray-900 truncate">{fmt(demoData.totals.total_amount)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <Clock size={20} className="text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">VAT Total</p>
                  <p className="text-xl font-bold text-amber-600 truncate">{fmt(demoData.totals.total_vat)}</p>
                </div>
              </div>
            </Card>
            {showDemo && demoTotal && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                    <Truck size={20} className="text-indigo-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Demo Expenses</p>
                    <p className="text-xl font-bold text-indigo-700 truncate">{fmt(demoTotal.total)}</p>
                    <p className="text-xs text-gray-400">{demoTotal.count} invoices</p>
                  </div>
                </div>
              </Card>
            )}
            {showSales && salesTotal && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <Truck size={20} className="text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Sales Activities</p>
                    <p className="text-xl font-bold text-emerald-700 truncate">{fmt(salesTotal.total)}</p>
                    <p className="text-xs text-gray-400">{salesTotal.count} invoices</p>
                  </div>
                </div>
              </Card>
            )}
            {compareRevenue && data && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                    <TrendingUp size={20} className="text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Revenue</p>
                    <p className="text-xl font-bold text-green-700 truncate">{fmt(data.totals.received)}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* ── Monthly Trend ─────────────────────────────────────────────── */}
          <ChartSection
            id="monthlyTrend"
            title={`Monthly Expenses — ${period}`}
            icon={<BarChart3 size={16} className="text-indigo-500" />}
            visible={sections.monthlyTrend}
            onToggle={() => toggleSection('monthlyTrend')}
            badge={
              <div className="flex items-center gap-3 ml-4 text-xs text-gray-500 font-normal">
                {showDemo && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-indigo-500 inline-block" /> Demo</span>}
                {showSales && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" /> Sales</span>}
                {compareRevenue && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500 inline-block" /> Revenue</span>}
              </div>
            }
          >
            {(() => {
              // Build combined monthly data
              const months = demoData.monthly;
              const maxVal = Math.max(
                ...months.map(m => {
                  let v = 0;
                  if (showDemo) v = Math.max(v, m.demo);
                  if (showSales) v = Math.max(v, m.sales);
                  if (compareRevenue) {
                    const rev = revenueByMonth.find(r => r.month === m.month);
                    if (rev) v = Math.max(v, rev.received);
                  }
                  return v;
                }),
                1
              );

              // How many bars per month?
              const barCount = (showDemo ? 1 : 0) + (showSales ? 1 : 0) + (compareRevenue ? 1 : 0);
              if (barCount === 0) return <p className="text-center text-sm text-gray-500">Select at least one data series</p>;

              return (
                <>
                  <BarChartGrid height={chartH} maxVal={maxVal} fmtFn={fmtAxis}>
                    {months.map(m => {
                      const rev = revenueByMonth.find(r => r.month === m.month);
                      const bars: { val: number; color: string; label: string; textColor: string }[] = [];
                      if (showDemo) bars.push({ val: m.demo, color: 'bg-indigo-500', label: `Demo: ${fmt(m.demo)}`, textColor: 'text-indigo-600' });
                      if (showSales) bars.push({ val: m.sales, color: 'bg-emerald-500', label: `Sales: ${fmt(m.sales)}`, textColor: 'text-emerald-600' });
                      if (compareRevenue) bars.push({ val: rev?.received || 0, color: 'bg-green-500', label: `Revenue: ${fmt(rev?.received || 0)}`, textColor: 'text-green-600' });

                      return (
                        <div key={m.month} className="flex-1 h-full flex items-end justify-center gap-px group relative">
                          {bars.map((b, bi) => (
                            <div key={bi} className="flex-1 h-full flex flex-col items-center justify-end">
                              {b.val > 0 && barCount <= 2 && (
                                <span className={`text-[9px] tabular-nums leading-none mb-0.5 font-medium ${b.textColor}`}>
                                  {fmtAxis(b.val)}
                                </span>
                              )}
                              <div className={`w-full rounded-t transition-all ${b.val > 0 ? b.color : 'bg-gray-100'}`}
                                style={{ height: `${b.val > 0 ? Math.max((b.val / maxVal) * barH, 2) : 2}px` }}
                                title={b.label} />
                            </div>
                          ))}
                          {/* Hover tooltip with all values */}
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap">
                            <div className="bg-gray-800 text-white text-[10px] px-2 py-1 rounded shadow-lg flex gap-2">
                              {bars.map((b, bi) => (
                                <span key={bi}>{b.label.split(':')[0]}: {fmtAxis(b.val)}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </BarChartGrid>
                  <MonthLabels months={months.map(m => m.month)} />

                  {/* Totals summary below chart */}
                  <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-6 justify-center text-center">
                    {showDemo && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Demo Total</p>
                        <p className="text-base font-bold text-indigo-600">{fmt(demoTotal?.total || 0)}</p>
                      </div>
                    )}
                    {showSales && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Sales Total</p>
                        <p className="text-base font-bold text-emerald-600">{fmt(salesTotal?.total || 0)}</p>
                      </div>
                    )}
                    {showDemo && showSales && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Combined</p>
                        <p className="text-base font-bold text-gray-900">{fmt(demoData.totals.total_amount)}</p>
                      </div>
                    )}
                    {compareRevenue && data && (
                      <>
                        <div className="border-l border-gray-200 pl-6">
                          <p className="text-xs text-gray-400 mb-0.5">Revenue</p>
                          <p className="text-base font-bold text-green-600">{fmt(data.totals.received)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-0.5">Net (Rev − Exp)</p>
                          {(() => {
                            const net = data.totals.received - demoData.totals.total_amount;
                            return (
                              <p className={`text-base font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {net >= 0 ? '+' : ''}{fmt(net)}
                              </p>
                            );
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                </>
              );
            })()}
          </ChartSection>

          {/* ── Revenue vs Expenses Comparison (only when compare is on) ── */}
          {compareRevenue && data && (
            <ChartSection
              id="revenueComparison"
              title={`Revenue vs Supplier Expenses — ${period}`}
              icon={<DollarSign size={16} className="text-green-600" />}
              visible={sections.revenueComparison}
              onToggle={() => toggleSection('revenueComparison')}
              badge={
                <div className="flex items-center gap-3 ml-4 text-xs text-gray-500 font-normal">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500 inline-block" /> Revenue</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-orange-400 inline-block" /> Expenses</span>
                </div>
              }
            >
              {(() => {
                // Merge revenue + expenses by month
                const merged = demoData.monthly.map(m => {
                  const rev = revenueByMonth.find(r => r.month === m.month);
                  const exp = (showDemo ? m.demo : 0) + (showSales ? m.sales : 0);
                  return { month: m.month, revenue: rev?.received || 0, expenses: exp };
                });
                const maxVal = Math.max(...merged.map(m => Math.max(m.revenue, m.expenses)), 1);

                return (
                  <>
                    <BarChartGrid height={chartH} maxVal={maxVal} fmtFn={fmtAxis}>
                      {merged.map(m => {
                        const net = m.revenue - m.expenses;
                        return (
                          <div key={m.month} className="flex-1 h-full flex items-end justify-center gap-px group relative">
                            <div className="flex-1 h-full flex flex-col items-center justify-end">
                              {m.revenue > 0 && (
                                <span className="text-[9px] tabular-nums leading-none mb-0.5 font-medium text-green-600">{fmtAxis(m.revenue)}</span>
                              )}
                              <div className={`w-full rounded-t transition-all ${m.revenue > 0 ? 'bg-green-500' : 'bg-gray-100'}`}
                                style={{ height: `${m.revenue > 0 ? Math.max((m.revenue / maxVal) * barH, 2) : 2}px` }}
                                title={`Revenue: ${fmt(m.revenue)}`} />
                            </div>
                            <div className="flex-1 h-full flex flex-col items-center justify-end">
                              {m.expenses > 0 && (
                                <span className="text-[9px] tabular-nums leading-none mb-0.5 font-medium text-orange-500">{fmtAxis(m.expenses)}</span>
                              )}
                              <div className={`w-full rounded-t transition-all ${m.expenses > 0 ? 'bg-orange-400' : 'bg-gray-100'}`}
                                style={{ height: `${m.expenses > 0 ? Math.max((m.expenses / maxVal) * barH, 2) : 2}px` }}
                                title={`Expenses: ${fmt(m.expenses)}`} />
                            </div>
                            {/* Net hover tooltip */}
                            <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shadow ${net >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                Net: {net >= 0 ? '+' : ''}{fmtAxis(net)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </BarChartGrid>
                    <MonthLabels months={merged.map(m => m.month)} />

                    {/* Totals row */}
                    <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Total Revenue</p>
                        <p className="text-base font-bold text-green-600">{fmt(data.totals.received)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Total Expenses</p>
                        <p className="text-base font-bold text-orange-500">{fmt(demoData.totals.total_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Net</p>
                        {(() => {
                          const net = data.totals.received - demoData.totals.total_amount;
                          return (
                            <p className={`text-base font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {net >= 0 ? '+' : ''}{fmt(net)}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                );
              })()}
            </ChartSection>
          )}

          {/* ── By Category ───────────────────────────────────────────────── */}
          <ChartSection
            id="byCategory"
            title="Expenses by Category"
            icon={<Truck size={16} className="text-orange-500" />}
            visible={sections.byCategory}
            onToggle={() => toggleSection('byCategory')}
            badge={<span className="text-xs text-gray-400 font-normal ml-2">{period}</span>}
          >
            {filteredByCategory.length === 0 ? (
              <p className="text-center text-sm text-gray-500">No data for this period</p>
            ) : (() => {
              const maxCat = filteredByCategory[0]?.total || 1;
              // Group categories: show domain badge when both domains visible
              return (
                <div className="divide-y divide-gray-100">
                  {filteredByCategory.map(cat => (
                    <div key={`${cat.domain}-${cat.category}`} className="py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: DEMO_CAT_COLORS[cat.category] || '#6b7280' }} />
                          {cat.category}
                          {showDemo && showSales && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${cat.domain === 'demo' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>
                              {cat.domain === 'demo' ? 'Demo' : 'Sales'}
                            </span>
                          )}
                        </span>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-sm font-bold text-gray-900">{fmt(cat.total)}</span>
                          <span className="text-xs text-gray-400 ml-1">{cat.count} inv</span>
                          {cat.vat_total > 0 && (
                            <span className="text-xs text-amber-500 ml-1">(+{fmt(cat.vat_total)} VAT)</span>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="h-2 rounded-full transition-all" style={{
                          width: `${(cat.total / maxCat) * 100}%`,
                          background: DEMO_CAT_COLORS[cat.category] || '#6b7280',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </ChartSection>

          {/* ── By Supplier ───────────────────────────────────────────────── */}
          <ChartSection
            id="bySupplier"
            title={`Expenses by Supplier${demoSupplier ? ` (filtered: "${demoSupplier}")` : ''}`}
            icon={<Truck size={16} className="text-red-500" />}
            visible={sections.bySupplier}
            onToggle={() => toggleSection('bySupplier')}
            badge={<span className="text-xs text-gray-400 font-normal ml-2">{period} · {filteredBySupplier.length} suppliers</span>}
          >
            {filteredBySupplier.length === 0 ? (
              <p className="text-center text-sm text-gray-500">No data for this period</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredBySupplier.map((s, i) => {
                  const maxS = filteredBySupplier[0]?.total || 1;
                  return (
                    <div key={`${s.supplier}-${s.domain}`} className="py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                          <span className="text-xs text-gray-400 font-normal w-5">{i + 1}.</span>
                          {s.supplier}
                          {showDemo && showSales && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${s.domain === 'demo' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>
                              {s.domain === 'demo' ? 'Demo' : 'Sales'}
                            </span>
                          )}
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-normal">{s.category}</span>
                        </span>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-sm font-bold text-gray-900">{fmt(s.total)}</span>
                          <span className="text-xs text-gray-400 ml-1">{s.count} inv</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{
                          width: `${(s.total / maxS) * 100}%`,
                          background: DEMO_CAT_COLORS[s.category] || '#6b7280',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ChartSection>

          {/* ── Monthly Summary Table ─────────────────────────────────────── */}
          <ChartSection
            id="summaryTable"
            title="Monthly Summary Table"
            icon={<BarChart3 size={16} className="text-gray-500" />}
            visible={sections.summaryTable}
            onToggle={() => toggleSection('summaryTable')}
            badge={<span className="text-xs text-gray-400 font-normal ml-2">{period}</span>}
          >
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left text-xs font-medium text-gray-500 px-4 py-2">Month</th>
                    {showDemo && <th className="text-right text-xs font-medium text-indigo-600 px-4 py-2">Demo</th>}
                    {showSales && <th className="text-right text-xs font-medium text-emerald-600 px-4 py-2">Sales</th>}
                    <th className="text-right text-xs font-medium text-gray-700 px-4 py-2">Total Exp.</th>
                    <th className="text-right text-xs font-medium text-amber-600 px-4 py-2">VAT</th>
                    {compareRevenue && <th className="text-right text-xs font-medium text-green-600 px-4 py-2">Revenue</th>}
                    {compareRevenue && <th className="text-right text-xs font-medium text-gray-700 px-4 py-2">Net</th>}
                  </tr>
                </thead>
                <tbody>
                  {demoData.monthly.map(m => {
                    const totalExp = (showDemo ? m.demo : 0) + (showSales ? m.sales : 0);
                    const totalVat = (showDemo ? m.demo_vat : 0) + (showSales ? m.sales_vat : 0);
                    const rev = revenueByMonth.find(r => r.month === m.month);
                    const net = (rev?.received || 0) - totalExp;
                    return (
                      <tr key={m.month} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-700">{monthLabel(m.month)} {m.month.split('-')[0]}</td>
                        {showDemo && <td className="px-4 py-2 text-right tabular-nums text-indigo-600">{fmt(m.demo)}</td>}
                        {showSales && <td className="px-4 py-2 text-right tabular-nums text-emerald-600">{fmt(m.sales)}</td>}
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmt(totalExp)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-amber-600">{fmt(totalVat)}</td>
                        {compareRevenue && <td className="px-4 py-2 text-right tabular-nums text-green-600">{fmt(rev?.received || 0)}</td>}
                        {compareRevenue && (
                          <td className={`px-4 py-2 text-right tabular-nums font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {net >= 0 ? '+' : ''}{fmt(net)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                    <td className="px-4 py-2 text-gray-700">Total</td>
                    {showDemo && <td className="px-4 py-2 text-right tabular-nums text-indigo-700">{fmt(demoTotal?.total || 0)}</td>}
                    {showSales && <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(salesTotal?.total || 0)}</td>}
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(demoData.totals.total_amount)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">{fmt(demoData.totals.total_vat)}</td>
                    {compareRevenue && data && <td className="px-4 py-2 text-right tabular-nums text-green-700">{fmt(data.totals.received)}</td>}
                    {compareRevenue && data && (() => {
                      const net = data.totals.received - demoData.totals.total_amount;
                      return (
                        <td className={`px-4 py-2 text-right tabular-nums ${net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {net >= 0 ? '+' : ''}{fmt(net)}
                        </td>
                      );
                    })()}
                  </tr>
                </tfoot>
              </table>
            </div>
          </ChartSection>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TONNAGE VIEW                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
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
                      <BarChartGrid height={chartH} maxVal={maxTons} fmtFn={fmtTonsAxis}>
                        {quantityData.monthly.map(m => (
                          <div key={m.month} className="flex-1 h-full flex flex-col items-center justify-end">
                            {m.tons > 0 && (
                              <span className="text-[9px] tabular-nums leading-none mb-0.5 font-medium text-indigo-600">{fmtTons(m.tons)}</span>
                            )}
                            <div className={`w-4/5 rounded-t transition-all ${m.tons > 0 ? 'bg-indigo-500' : 'bg-gray-100'}`}
                              style={{ height: `${m.tons > 0 ? Math.max((m.tons / maxTons) * barH, 2) : 2}px` }}
                              title={fmtTons(m.tons)} />
                          </div>
                        ))}
                      </BarChartGrid>
                      <MonthLabels months={quantityData.monthly.map(m => m.month)} />
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
                    const pct = quantityData.total_tons > 0 ? Math.round((c.tons / quantityData.total_tons) * 100) : 0;
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

      {/* No data fallback */}
      {!data && !demoData && !quantityData && (
        <p className="text-center text-gray-500 py-12">Failed to load analytics data.</p>
      )}
      </>
      )}

      {/* Export Report Modal */}
      <ExportReportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        years={years}
        addToast={addToast}
      />
    </div>
  );
}
