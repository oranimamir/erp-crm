import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '../lib/api';
import Card from '../components/ui/Card';
import { useToast } from '../contexts/ToastContext';
import { Upload, Trash2, FileSpreadsheet, Filter, X } from 'lucide-react';

const CATEGORIES = [
  'Overhead', 'Demo Consumables', 'Demo Equipment', 'Demo Maintenance',
  'Demo Materials', 'Cars', 'Regulation', 'Salaries', 'Couriers', 'Other',
];

const CAT_COLORS: Record<string, string> = {
  'Overhead':           '#6366f1',
  'Demo Consumables':   '#f59e0b',
  'Demo Equipment':     '#10b981',
  'Demo Maintenance':   '#ef4444',
  'Demo Materials':     '#3b82f6',
  'Cars':               '#8b5cf6',
  'Regulation':         '#ec4899',
  'Salaries':           '#14b8a6',
  'Couriers':           '#f97316',
  'Other':              '#6b7280',
};

interface Summary {
  by_category: { category: string; total: number }[];
  by_supplier: { supplier: string; total: number }[];
  monthly_by_category: { month: string; category: string; total: number }[];
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

// SVG Pie Chart component
function PieChart({ data, colorMap }: { data: { label: string; value: number }[]; colorMap: Record<string, string> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="text-center text-sm text-gray-400 py-8">No data</p>;

  const [hovered, setHovered] = useState<number | null>(null);
  let cumAngle = 0;
  const slices = data.map((d, i) => {
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
    const large = end - start > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
  }

  return (
    <div className="flex items-start gap-4">
      <svg viewBox="0 0 200 200" className="w-48 h-48 shrink-0">
        {slices.map((s) => (
          <path
            key={s.label}
            d={s.angle >= 359.99
              ? `M 100 0 A 100 100 0 1 1 99.99 0 Z`
              : arcPath(100, 100, 100, s.startAngle, s.startAngle + s.angle)}
            fill={colorMap[s.label] || '#6b7280'}
            stroke="white"
            strokeWidth={1.5}
            opacity={hovered === null || hovered === s.index ? 1 : 0.4}
            onMouseEnter={() => setHovered(s.index)}
            onMouseLeave={() => setHovered(null)}
            className="transition-opacity cursor-pointer"
          />
        ))}
      </svg>
      <div className="flex flex-col gap-1 text-xs max-h-48 overflow-y-auto flex-1 min-w-0">
        {slices.map(s => (
          <div
            key={s.label}
            className={`flex items-center gap-2 px-1.5 py-0.5 rounded transition-colors cursor-default ${hovered === s.index ? 'bg-gray-100' : ''}`}
            onMouseEnter={() => setHovered(s.index)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colorMap[s.label] || '#6b7280' }} />
            <span className="truncate text-gray-700">{s.label}</span>
            <span className="ml-auto tabular-nums text-gray-500 whitespace-nowrap">{fmt(s.value)}</span>
            <span className="text-gray-400 tabular-nums whitespace-nowrap">({((s.value / total) * 100).toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Stacked bar chart component
function StackedBarChart({ data, categories }: {
  data: { month: string; values: Record<string, number> }[];
  categories: string[];
}) {
  if (data.length === 0) return <p className="text-center text-sm text-gray-400 py-8">No data</p>;

  const maxTotal = Math.max(...data.map(d => Object.values(d.values).reduce((a, b) => a + b, 0)), 1);
  const chartH = 200;
  const [hovered, setHovered] = useState<{ month: string; cat: string } | null>(null);

  function fmtAxis(n: number): string {
    if (n === 0) return '0';
    if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `€${Math.round(n / 1_000)}k`;
    return `€${Math.round(n)}`;
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: chartH }}>
          {[maxTotal, maxTotal * 0.75, maxTotal * 0.5, maxTotal * 0.25, 0].map((v, i) => (
            <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">{fmtAxis(v)}</span>
          ))}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="relative" style={{ height: chartH }}>
            {[0, 25, 50, 75, 100].map(pct => (
              <div
                key={pct}
                className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                style={{ bottom: `${(pct / 100) * chartH}px` }}
              />
            ))}
            <div className="flex items-end gap-1 h-full">
              {data.map(d => {
                const monthTotal = Object.values(d.values).reduce((a, b) => a + b, 0);
                let cumH = 0;
                return (
                  <div key={d.month} className="flex-1 h-full flex flex-col items-center justify-end group relative">
                    <div className="w-full max-w-12 flex flex-col-reverse">
                      {categories.filter(c => (d.values[c] || 0) > 0).map(cat => {
                        const h = Math.max((d.values[cat] / maxTotal) * (chartH - 16), 1);
                        cumH += h;
                        return (
                          <div
                            key={cat}
                            className="w-full transition-opacity cursor-pointer"
                            style={{
                              height: `${h}px`,
                              background: CAT_COLORS[cat] || '#6b7280',
                              opacity: hovered && hovered.month === d.month && hovered.cat !== cat ? 0.4 : 1,
                            }}
                            onMouseEnter={() => setHovered({ month: d.month, cat })}
                            onMouseLeave={() => setHovered(null)}
                          />
                        );
                      })}
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
            <div className="w-14 shrink-0" />
            {data.map(d => (
              <div key={d.month} className="flex-1 text-center text-[10px] text-gray-500 truncate">
                {monthLabel(d.month)}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
        {categories.filter(c => data.some(d => (d.values[c] || 0) > 0)).map(cat => (
          <div key={cat} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: CAT_COLORS[cat] }} />
            <span className="text-gray-600">{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DemoExpensesPage() {
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMonth, setUploadMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Filters
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterMonthFrom, setFilterMonthFrom] = useState('');
  const [filterMonthTo, setFilterMonthTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (filterCategory) params.category = filterCategory;
      if (filterSupplier) params.supplier = filterSupplier;
      if (filterMonthFrom) params.month_from = filterMonthFrom;
      if (filterMonthTo) params.month_to = filterMonthTo;
      const res = await api.get('/demo-expenses/summary', { params });
      setSummary(res.data);
    } catch {
      addToast('Failed to load expenses', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterSupplier, filterMonthFrom, filterMonthTo, addToast]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        addToast('Excel file is empty', 'error');
        setUploading(false);
        return;
      }

      // Map rows — first column is supplier, remaining are categories
      const expenses = rows.map(row => {
        const keys = Object.keys(row);
        const supplierKey = keys[0]; // First column is supplier name
        const entry: Record<string, any> = { supplier: row[supplierKey] };

        for (const cat of CATEGORIES) {
          // Try exact match first, then case-insensitive
          const matchKey = keys.find(k =>
            k.trim().toLowerCase() === cat.toLowerCase()
          );
          if (matchKey) {
            entry[cat] = parseFloat(row[matchKey]) || 0;
          }
        }
        return entry;
      });

      await api.post('/demo-expenses/upload', { month: uploadMonth, expenses });
      addToast(`Uploaded ${expenses.length} rows for ${monthLabel(uploadMonth)}`, 'success');
      fetchSummary();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMonth = async (month: string) => {
    if (!confirm(`Delete all expenses for ${monthLabel(month)}?`)) return;
    try {
      await api.delete(`/demo-expenses/month/${month}`);
      addToast(`Deleted expenses for ${monthLabel(month)}`, 'success');
      fetchSummary();
    } catch {
      addToast('Delete failed', 'error');
    }
  };

  const clearFilters = () => {
    setFilterCategory('');
    setFilterSupplier('');
    setFilterMonthFrom('');
    setFilterMonthTo('');
  };

  const hasFilters = filterCategory || filterSupplier || filterMonthFrom || filterMonthTo;

  // Build stacked chart data
  const stackedData = (() => {
    if (!summary) return [];
    const monthMap: Record<string, Record<string, number>> = {};
    for (const row of summary.monthly_by_category) {
      if (!monthMap[row.month]) monthMap[row.month] = {};
      monthMap[row.month][row.category] = row.total;
    }
    return Object.keys(monthMap).sort().map(m => ({ month: m, values: monthMap[m] }));
  })();

  const grandTotal = summary?.by_category.reduce((s, c) => s + c.total, 0) || 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Demo Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload monthly expense reports and track spending by category and supplier
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
              hasFilters ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter size={16} />
            Filters
            {hasFilters && <span className="w-2 h-2 rounded-full bg-primary-500" />}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">All Categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Supplier</label>
              <select
                value={filterSupplier}
                onChange={e => setFilterSupplier(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">All Suppliers</option>
                {(summary?.suppliers || []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From Month</label>
              <input
                type="month"
                value={filterMonthFrom}
                onChange={e => setFilterMonthFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To Month</label>
              <input
                type="month"
                value={filterMonthTo}
                onChange={e => setFilterMonthTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-2 py-1.5"
              >
                <X size={14} />
                Clear
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Upload section */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
            <input
              type="month"
              value={uploadMonth}
              onChange={e => setUploadMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-2">
              Upload an Excel file with supplier names in the first column and category amounts in subsequent columns.
              Expected categories: {CATEGORIES.join(', ')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Upload size={16} />
              )}
              {uploading ? 'Uploading...' : 'Upload Excel'}
            </button>
          </div>
        </div>
      </Card>

      {/* Grand total */}
      {grandTotal > 0 && (
        <div className="text-right text-sm text-gray-600">
          Total expenses{hasFilters ? ' (filtered)' : ''}: <span className="font-semibold text-gray-900">{fmt(grandTotal)}</span>
        </div>
      )}

      {/* Charts */}
      {summary && grandTotal > 0 && (
        <>
          {/* Pie charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Total per Category</h3>
              <PieChart
                data={summary.by_category.map(c => ({ label: c.category, value: c.total }))}
                colorMap={CAT_COLORS}
              />
            </Card>
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Total per Supplier</h3>
              <PieChart
                data={summary.by_supplier.map(s => ({ label: s.supplier, value: s.total }))}
                colorMap={Object.fromEntries(
                  summary.by_supplier.map((s, i) => [
                    s.supplier,
                    ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6b7280', '#0ea5e9', '#d946ef', '#84cc16', '#a855f7', '#fb923c'][i % 15],
                  ])
                )}
              />
            </Card>
          </div>

          {/* Stacked bar chart */}
          {stackedData.length > 0 && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Monthly Expenses by Category</h3>
              <StackedBarChart data={stackedData} categories={CATEGORIES} />
            </Card>
          )}
        </>
      )}

      {/* Uploaded months list */}
      {summary && summary.months.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Uploaded Months</h3>
          <div className="flex flex-wrap gap-2">
            {summary.months.map(m => (
              <div key={m} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                <FileSpreadsheet size={14} className="text-gray-400" />
                <span className="text-gray-700">{monthLabel(m)}</span>
                <button
                  onClick={() => handleDeleteMonth(m)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title={`Delete ${monthLabel(m)}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Empty state */}
      {summary && grandTotal === 0 && (
        <Card className="p-12 text-center">
          <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No expenses uploaded yet</h3>
          <p className="text-sm text-gray-500">
            Select a month and upload an Excel file to get started.
          </p>
        </Card>
      )}
    </div>
  );
}
