import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import { useToast } from '../contexts/ToastContext';
import {
  Trash2, FileSpreadsheet, Filter, X, ChevronUp, ChevronDown,
  Eye, AlertTriangle, Clock, ChevronLeft,
} from 'lucide-react';
import { formatDate } from '../lib/dates';

const SALES_CATEGORIES = ['Raw Materials', 'Logistics', 'Blenders', 'Shipping'];

const CAT_COLORS: Record<string, string> = {
  'Raw Materials': '#f59e0b',
  'Logistics': '#3b82f6',
  'Blenders': '#8b5cf6',
  'Shipping': '#10b981',
};

const SUPPLIER_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6b7280', '#0ea5e9', '#d946ef',
  '#84cc16', '#a855f7', '#fb923c', '#22d3ee', '#e11d48', '#4ade80',
];

interface Invoice {
  id: number; invoice_id: string; issue_date: string; supplier: string;
  category: string; amount: number; currency: string; month: string;
  xml_filename: string; duplicate_warning: number; created_at: string; domain: string;
}

interface Batch {
  id: number; filename: string; month: string; invoice_count: number;
  total_amount: number; uploaded_at: string;
}

interface Summary {
  by_category: { category: string; total: number }[];
  by_supplier: { supplier: string; total: number }[];
  monthly_by_category: { month: string; category: string; total: number }[];
  avg_by_category: { category: string; avg_total: number }[];
  months: string[];
  suppliers: string[];
  categories: string[];
}

function fmt(n: number) {
  return `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(mo) - 1]} ${y}`;
}

// ═══ PIE CHART ════════════════════════════════════════════════════════════════

function PieChart({ data, colorMap, title }: { data: { label: string; value: number }[]; colorMap: Record<string, string>; title: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="text-center text-sm text-gray-400 py-8">No data</p>;
  const [hovered, setHovered] = useState<number | null>(null);
  let cumAngle = 0;
  const slices = data.filter(d => d.value > 0).map((d, i) => {
    const angle = (d.value / total) * 360;
    const startAngle = cumAngle;
    cumAngle += angle;
    return { ...d, startAngle, angle, index: i };
  });

  function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
    const s = polarToCartesian(cx, cy, r, start);
    const e = polarToCartesian(cx, cy, r, end);
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${e.x} ${e.y} Z`;
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="flex items-start gap-4">
        <svg viewBox="0 0 200 200" className="w-44 h-44 shrink-0">
          {slices.map(s => (
            <path key={s.label}
              d={s.angle >= 359.99 ? `M 100 0 A 100 100 0 1 1 99.99 0 Z` : arcPath(100, 100, 100, s.startAngle, s.startAngle + s.angle)}
              fill={colorMap[s.label] || '#6b7280'} stroke="white" strokeWidth={1.5}
              opacity={hovered === null || hovered === s.index ? 1 : 0.4}
              onMouseEnter={() => setHovered(s.index)} onMouseLeave={() => setHovered(null)}
              className="transition-opacity cursor-pointer" />
          ))}
        </svg>
        <div className="flex flex-col gap-1 text-xs max-h-44 overflow-y-auto flex-1 min-w-0">
          {slices.map(s => (
            <div key={s.label}
              className={`flex items-center gap-2 px-1.5 py-0.5 rounded transition-colors cursor-default ${hovered === s.index ? 'bg-gray-100' : ''}`}
              onMouseEnter={() => setHovered(s.index)} onMouseLeave={() => setHovered(null)}>
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colorMap[s.label] || '#6b7280' }} />
              <span className="truncate text-gray-700">{s.label}</span>
              <span className="ml-auto tabular-nums text-gray-500 whitespace-nowrap">{fmt(s.value)}</span>
              <span className="text-gray-400 tabular-nums whitespace-nowrap">({((s.value / total) * 100).toFixed(1)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ═══ STACKED BAR ═════════════════════════════════════════════════════════════

function StackedBarChart({ data, categories, title }: {
  data: { month: string; values: Record<string, number> }[];
  categories: string[];
  title: string;
}) {
  if (data.length === 0) return null;
  const maxTotal = Math.max(...data.map(d => Object.values(d.values).reduce((a, b) => a + b, 0)), 1);
  const chartH = 220;
  const [hovered, setHovered] = useState<{ month: string; cat: string } | null>(null);

  function fmtAxis(n: number): string {
    if (n === 0) return '0';
    if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `€${Math.round(n / 1_000)}k`;
    return `€${Math.round(n)}`;
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: chartH }}>
          {[maxTotal, maxTotal * 0.75, maxTotal * 0.5, maxTotal * 0.25, 0].map((v, i) => (
            <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">{fmtAxis(v)}</span>
          ))}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="relative" style={{ height: chartH }}>
            {[0, 25, 50, 75, 100].map(pct => (
              <div key={pct} className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                style={{ bottom: `${(pct / 100) * chartH}px` }} />
            ))}
            <div className="flex items-end gap-1 h-full">
              {data.map(d => {
                const monthTotal = Object.values(d.values).reduce((a, b) => a + b, 0);
                return (
                  <div key={d.month} className="flex-1 h-full flex flex-col items-center justify-end group relative">
                    <div className="w-full max-w-14 flex flex-col-reverse">
                      {categories.filter(c => (d.values[c] || 0) > 0).map(cat => (
                        <div key={cat} className="w-full transition-opacity cursor-pointer"
                          style={{ height: `${Math.max((d.values[cat] / maxTotal) * (chartH - 16), 1)}px`, background: CAT_COLORS[cat] || '#6b7280', opacity: hovered && hovered.month === d.month && hovered.cat !== cat ? 0.4 : 1 }}
                          onMouseEnter={() => setHovered({ month: d.month, cat })} onMouseLeave={() => setHovered(null)} />
                      ))}
                    </div>
                    {hovered?.month === d.month && (
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap z-10 pointer-events-none shadow-lg">
                        <div className="font-semibold mb-1">{monthLabel(d.month)}</div>
                        {hovered.cat && <div>{hovered.cat}: {fmt(d.values[hovered.cat] || 0)}</div>}
                        <div className="border-t border-gray-700 mt-1 pt-1">Total: {fmt(monthTotal)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-1 mt-1">
            {data.map(d => (
              <div key={d.month} className="flex-1 text-center text-[10px] text-gray-500 truncate">{monthLabel(d.month)}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
        {categories.filter(c => data.some(d => (d.values[c] || 0) > 0)).map(cat => (
          <div key={cat} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: CAT_COLORS[cat] || '#6b7280' }} />
            <span className="text-gray-600">{cat}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ═══ AVG BAR ═════════════════════════════════════════════════════════════════

function AvgBarChart({ data }: { data: { category: string; avg_total: number }[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d.avg_total), 1);
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Average Monthly Spend per Category</h3>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.category} className="flex items-center gap-3">
            <div className="w-28 text-xs text-gray-600 truncate text-right shrink-0">{d.category}</div>
            <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
              <div className="h-full rounded transition-all" style={{ width: `${(d.avg_total / max) * 100}%`, background: CAT_COLORS[d.category] || '#6b7280' }} />
            </div>
            <span className="text-xs tabular-nums text-gray-500 w-24 text-right shrink-0">{fmt(d.avg_total)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ═══ MULTI-SELECT ════════════════════════════════════════════════════════════

function MultiSelect({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const toggle = (val: string) => onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <button onClick={() => setOpen(!open)}
        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-left min-w-[160px] flex items-center justify-between gap-2 bg-white">
        <span className="truncate text-gray-700">{selected.length === 0 ? `All ${label}` : `${selected.length} selected`}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto min-w-[200px]">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="rounded border-gray-300" />
              <span className="truncate text-gray-700">{opt}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="w-full text-left px-3 py-1.5 text-xs text-primary-600 hover:bg-primary-50 border-t border-gray-100">Clear all</button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══ INVOICE VIEWER ══════════════════════════════════════════════════════════

function InvoiceViewer({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const [inv, setInv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get(`/demo-expenses/invoices/${invoiceId}`).then(res => setInv(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [invoiceId]);

  if (loading) return <div className="w-[480px] border-l border-gray-200 bg-white flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  if (!inv) return <div className="w-[480px] border-l border-gray-200 bg-white p-6"><button onClick={onClose} className="mb-4 text-gray-500 hover:text-gray-700"><ChevronLeft size={20} /></button><p className="text-gray-500">Invoice not found</p></div>;

  const lineItems = (() => { try { return typeof inv.line_items === 'string' ? JSON.parse(inv.line_items) : inv.line_items || []; } catch { return []; } })();

  return (
    <div className="w-[480px] border-l border-gray-200 bg-white flex flex-col shrink-0 overflow-hidden">
      <div className="p-4 border-b flex items-center gap-3">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><ChevronLeft size={20} /></button>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{inv.invoice_id}</h3>
          <p className="text-xs text-gray-500">{inv.supplier}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {inv.embedded_pdf ? (
          <iframe src={`data:application/pdf;base64,${inv.embedded_pdf}`} className="w-full h-full min-h-[600px]" title="Invoice PDF" />
        ) : (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-400 mb-0.5">Invoice ID</p><p className="font-medium text-gray-900">{inv.invoice_id}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Issue Date</p><p className="font-medium text-gray-900">{formatDate(inv.issue_date)}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Supplier</p><p className="font-medium text-gray-900">{inv.supplier}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Amount (excl. BTW)</p><p className="font-medium text-gray-900">{fmt(inv.amount)}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Category</p><p className="font-medium text-gray-900">{inv.category}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Month</p><p className="font-medium text-gray-900">{monthLabel(inv.month)}</p></div>
            </div>
            {lineItems.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Line Items</h4>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {lineItems.map((li: any, i: number) => (
                    <div key={i} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
                      <span className="text-gray-700 min-w-0">{li.description || '(no description)'}</span>
                      <span className="text-gray-500 tabular-nums shrink-0">{fmt(li.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function SalesActivitiesPage() {
  const { addToast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterSuppliers, setFilterSuppliers] = useState<string[]>([]);
  const [filterMonth, setFilterMonth] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [sortBy, setSortBy] = useState<string>('issue_date');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('DESC');

  const [viewingInvoice, setViewingInvoice] = useState<number | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<{ id: number; supplier: string; category: string } | null>(null);

  const buildFilterParams = useCallback(() => {
    const params: Record<string, string> = { domain: 'sales' };
    if (filterCategories.length > 0) params.categories = filterCategories.join(',');
    if (filterSuppliers.length > 0) params.suppliers = filterSuppliers.join(',');
    if (filterMonth) params.month = filterMonth;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo;
    return params;
  }, [filterCategories, filterSuppliers, filterMonth, filterDateFrom, filterDateTo]);

  const fetchAll = useCallback(async () => {
    try {
      const params = buildFilterParams();
      const [invRes, sumRes, batRes] = await Promise.all([
        api.get('/demo-expenses/invoices', { params: { ...params, sort_by: sortBy, sort_dir: sortDir } }),
        api.get('/demo-expenses/summary', { params }),
        api.get('/demo-expenses/batches', { params: { domain: 'sales' } }),
      ]);
      setInvoices(invRes.data);
      setSummary(sumRes.data);
      setBatches(batRes.data);
    } catch { addToast('Failed to load sales activities', 'error'); }
    finally { setLoading(false); }
  }, [buildFilterParams, sortBy, sortDir, addToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'ASC' ? 'DESC' : 'ASC');
    else { setSortBy(col); setSortDir('DESC'); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ChevronDown size={12} className="text-gray-300" />;
    return sortDir === 'ASC' ? <ChevronUp size={12} className="text-primary-600" /> : <ChevronDown size={12} className="text-primary-600" />;
  };

  const handleCategoryChange = (id: number, supplier: string, newCategory: string) => {
    setOverrideTarget({ id, supplier, category: newCategory });
  };

  const applyCategoryOverride = async (applyToAll: boolean) => {
    if (!overrideTarget) return;
    try {
      await api.patch(`/demo-expenses/invoices/${overrideTarget.id}/category`, { category: overrideTarget.category, domain: 'sales', applyToAll });
      addToast(`Category updated${applyToAll ? ` for all ${overrideTarget.supplier} invoices` : ''}`, 'success');
      setOverrideTarget(null);
      fetchAll();
    } catch (err: any) { addToast(err?.response?.data?.error || 'Failed', 'error'); }
  };

  const handleDeleteBatch = async (batch: Batch) => {
    if (!confirm(`Delete upload "${batch.filename}" (${monthLabel(batch.month)}, ${batch.invoice_count} invoices)?`)) return;
    try { await api.delete(`/demo-expenses/batches/${batch.id}`); addToast(`Deleted ${batch.filename}`, 'success'); fetchAll(); }
    catch { addToast('Delete failed', 'error'); }
  };

  const stackedData = useMemo(() => {
    if (!summary) return [];
    const monthMap: Record<string, Record<string, number>> = {};
    for (const row of summary.monthly_by_category) {
      if (!monthMap[row.month]) monthMap[row.month] = {};
      monthMap[row.month][row.category] = row.total;
    }
    return Object.keys(monthMap).sort().map(m => ({ month: m, values: monthMap[m] }));
  }, [summary]);

  const allCategories = useMemo(() => {
    if (!summary) return SALES_CATEGORIES;
    return [...new Set([...SALES_CATEGORIES, ...summary.categories])];
  }, [summary]);

  const supplierColorMap = useMemo(() => {
    if (!summary) return {};
    return Object.fromEntries(summary.by_supplier.map((s, i) => [s.supplier, SUPPLIER_COLORS[i % SUPPLIER_COLORS.length]]));
  }, [summary]);

  const grandTotal = summary?.by_category.reduce((s, c) => s + c.total, 0) || 0;
  const hasFilters = filterCategories.length > 0 || filterSuppliers.length > 0 || filterMonth || filterDateFrom || filterDateTo;

  const clearFilters = () => { setFilterCategories([]); setFilterSuppliers([]); setFilterMonth(''); setFilterDateFrom(''); setFilterDateTo(''); };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sales Activities</h1>
            <p className="text-sm text-gray-500 mt-1">Track sales-related expenses by category and supplier. Upload invoices via the Invoices tab.</p>
          </div>
          <button onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${hasFilters ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            <Filter size={16} /> Filters {hasFilters && <span className="w-2 h-2 rounded-full bg-primary-500" />}
          </button>
        </div>

        {showFilters && (
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <MultiSelect label="Categories" options={allCategories} selected={filterCategories} onChange={setFilterCategories} />
              <MultiSelect label="Suppliers" options={summary?.suppliers || []} selected={filterSuppliers} onChange={setFilterSuppliers} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">All Months</option>
                  {(summary?.months || []).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              {hasFilters && <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-2 py-1.5"><X size={14} /> Clear</button>}
            </div>
          </Card>
        )}

        {grandTotal > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4"><p className="text-xs text-gray-500">Total Expenses</p><p className="text-lg font-bold text-gray-900 mt-1">{fmt(grandTotal)}</p></Card>
            <Card className="p-4"><p className="text-xs text-gray-500">Invoices</p><p className="text-lg font-bold text-gray-900 mt-1">{invoices.length}</p></Card>
            <Card className="p-4"><p className="text-xs text-gray-500">Suppliers</p><p className="text-lg font-bold text-gray-900 mt-1">{summary?.suppliers.length || 0}</p></Card>
            <Card className="p-4"><p className="text-xs text-gray-500">Months</p><p className="text-lg font-bold text-gray-900 mt-1">{summary?.months.length || 0}</p></Card>
          </div>
        )}

        {summary && grandTotal > 0 && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PieChart title="Total per Supplier" data={summary.by_supplier.map(s => ({ label: s.supplier, value: s.total }))} colorMap={supplierColorMap} />
              <PieChart title="Total per Category" data={summary.by_category.map(c => ({ label: c.category, value: c.total }))} colorMap={CAT_COLORS} />
            </div>
            <StackedBarChart title="Expenses per Category per Month" data={stackedData} categories={allCategories} />
            {summary.avg_by_category.length > 0 && <AvgBarChart data={summary.avg_by_category} />}
          </>
        )}

        {invoices.length > 0 && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {[
                      { key: 'invoice_id', label: 'Invoice ID' },
                      { key: 'created_at', label: 'Upload Date' },
                      { key: 'issue_date', label: 'Invoice Date' },
                      { key: 'supplier', label: 'Supplier' },
                      { key: 'category', label: 'Category' },
                      { key: 'amount', label: 'Amount (excl. BTW)' },
                      { key: 'month', label: 'Month' },
                    ].map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)}
                        className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none">
                        <div className="flex items-center gap-1">{col.label} <SortIcon col={col.key} /></div>
                      </th>
                    ))}
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <button onClick={() => setViewingInvoice(inv.id)} className="text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1">
                          {inv.duplicate_warning ? <AlertTriangle size={14} className="text-amber-500" /> : null}
                          {inv.invoice_id}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(inv.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(inv.issue_date)}</td>
                      <td className="px-4 py-3 text-gray-700">{inv.supplier}</td>
                      <td className="px-4 py-3">
                        <select value={inv.category} onChange={e => handleCategoryChange(inv.id, inv.supplier, e.target.value)}
                          className="border border-gray-200 rounded px-2 py-0.5 text-xs bg-white hover:border-gray-400 transition-colors">
                          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-gray-900 tabular-nums font-medium">{fmt(inv.amount)}</td>
                      <td className="px-4 py-3 text-gray-500">{monthLabel(inv.month)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setViewingInvoice(inv.id)} className="text-gray-400 hover:text-primary-600 transition-colors" title="View invoice"><Eye size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td colSpan={5} className="px-4 py-3 text-sm font-medium text-gray-700 text-right">Total ({invoices.length} invoices)</td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">{fmt(invoices.reduce((s, inv) => s + inv.amount, 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}

        {batches.length > 0 && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Clock size={16} className="text-gray-400" /> Upload History</h3>
            <div className="space-y-2">
              {batches.map(b => (
                <div key={b.id} className="flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <FileSpreadsheet size={16} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{b.filename}</p>
                    <p className="text-xs text-gray-500">{monthLabel(b.month)} &middot; {b.invoice_count} invoices &middot; {fmt(b.total_amount)}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{new Date(b.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <button onClick={() => handleDeleteBatch(b)} className="text-gray-400 hover:text-red-500 transition-colors shrink-0" title="Delete"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {invoices.length === 0 && !loading && (
          <Card className="p-12 text-center">
            <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No sales activity invoices yet</h3>
            <p className="text-sm text-gray-500">Upload a ZIP file via the Invoices tab to get started. Invoices from known Sales Activities suppliers will appear here automatically.</p>
          </Card>
        )}
      </div>

      {viewingInvoice && <InvoiceViewer invoiceId={viewingInvoice} onClose={() => setViewingInvoice(null)} />}

      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Apply Category Change</h2>
            <p className="text-sm text-gray-600 mb-4">Apply <strong>{overrideTarget.category}</strong> to all future invoices from <strong>{overrideTarget.supplier}</strong>?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setOverrideTarget(null)} className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => applyCategoryOverride(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">This invoice only</button>
              <button onClick={() => applyCategoryOverride(true)} className="px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">All from {overrideTarget.supplier}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
