import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useToast } from '../contexts/ToastContext';
import {
  Trash2, FileSpreadsheet, Filter, X, ChevronUp, ChevronDown,
  Eye, AlertTriangle, Clock, ChevronLeft, Upload, Loader2,
  Pencil, Check, Plus, UserPlus, Flag, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../lib/dates';
import { useCategories } from '../lib/categories';
import SearchBar from '../components/ui/SearchBar';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const CAT_COLORS: Record<string, string> = {
  'Salaries': '#6366f1', 'Cars': '#8b5cf6', 'Overhead': '#3b82f6',
  'Consumables': '#f59e0b', 'Materials': '#10b981', 'Utilities and Maintenance': '#ef4444',
  'Feedstock': '#14b8a6', 'Subcontractors and Consultants': '#ec4899',
  'Regulatory': '#f97316', 'Equipment': '#0ea5e9', 'Couriers': '#84cc16', 'Other': '#6b7280',
  'Raw Materials': '#059669', 'Logistics': '#7c3aed', 'Blenders': '#db2777', 'Shipping': '#0284c7',
};

const DOMAIN_COLORS: Record<string, string> = {
  demo: 'bg-emerald-100 text-emerald-700',
  sales: 'bg-blue-100 text-blue-700',
};

const SUPPLIER_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6b7280', '#0ea5e9', '#d946ef',
  '#84cc16', '#a855f7', '#fb923c', '#22d3ee', '#e11d48', '#4ade80',
];

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface Invoice {
  id: number; invoice_id: string; issue_date: string; supplier: string;
  category: string; domain: string; amount: number; vat_amount: number; currency: string;
  month: string; xml_filename: string; duplicate_warning: number; flagged: number; flag_comment: string; created_at: string;
}

interface Batch {
  id: number; filename: string; month: string; domain: string;
  invoice_count: number; total_amount: number; uploaded_at: string;
  uploaded_by_name?: string; note?: string;
}

interface Summary {
  by_category: { category: string; total: number; vat_total: number }[];
  by_supplier: { supplier: string; total: number; vat_total: number }[];
  monthly_by_category: { month: string; category: string; total: number; vat_total: number }[];
  avg_by_category: { category: string; avg_total: number }[];
  months: string[]; suppliers: string[]; categories: string[];
  total_amount: number; total_vat: number; invoice_count: number;
}

interface MonthlySummary {
  by_month: { month: string; domain: string; total: number; vat_total: number; count: number }[];
  by_month_category: { month: string; domain: string; category: string; total: number; vat_total: number; count: number }[];
  grand_totals: { total_amount: number; total_vat: number; invoice_count: number };
  domain_totals: { domain: string; total: number; vat_total: number; count: number }[];
  months: string[];
}

interface SingleUploadPreview {
  invoiceId: string; date: string; supplier: string; amount: number; vatAmount: number;
  currency: string; domain: string; category: string; month: string; lineItems: string;
  pdfFilename: string | null; xmlFilename: string | null; embeddedPdf: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

function fmt(n: number, currency?: string) {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€';
  return `${symbol}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(mo) - 1]} ${y}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIE CHART
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// STACKED BAR CHART
// ═══════════════════════════════════════════════════════════════════════════════

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
                    {monthTotal > 0 && <span className="text-[10px] text-gray-600 font-semibold tabular-nums whitespace-nowrap mb-0.5">{fmtAxis(monthTotal)}</span>}
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

// ═══════════════════════════════════════════════════════════════════════════════
// AVG BAR CHART
// ═══════════════════════════════════════════════════════════════════════════════

function AvgBarChart({ data }: { data: { category: string; avg_total: number }[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d.avg_total), 1);
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Average Monthly Spend per Category</h3>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.category} className="flex items-center gap-3">
            <div className="w-40 text-xs text-gray-600 truncate text-right shrink-0">{d.category}</div>
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

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-SELECT DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICE VIEWER MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function InvoiceViewer({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const [inv, setInv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const modalRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/demo-expenses/invoices/${invoiceId}`).then(res => setInv(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [invoiceId]);

  const hasPdf = inv?.embedded_pdf;

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = modalRef.current;
    if (!el) return;
    dragging.current = { startX: e.clientX, startY: e.clientY, startW: el.offsetWidth, startH: el.offsetHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !modalRef.current) return;
      const w = Math.max(400, Math.min(window.innerWidth * 0.95, dragging.current.startW + (ev.clientX - dragging.current.startX)));
      const h = Math.max(300, Math.min(window.innerHeight * 0.95, dragging.current.startH + (ev.clientY - dragging.current.startY)));
      modalRef.current.style.width = w + 'px';
      modalRef.current.style.height = h + 'px';
    };
    const onUp = () => { dragging.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div ref={modalRef} className="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden relative"
        style={{ minWidth: 400, minHeight: 300, width: hasPdf ? '90vw' : 700, height: '90vh', maxWidth: '95vw', maxHeight: '95vh' }}
        onClick={e => e.stopPropagation()}>
        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
        ) : !inv ? (
          <div className="p-6"><p className="text-gray-500">Invoice not found</p><button onClick={onClose} className="mt-4 text-sm text-primary-600 hover:text-primary-700">Close</button></div>
        ) : (
          <>
            <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 truncate">{inv.invoice_id}</h3>
                <p className="text-sm text-gray-500">{inv.supplier}</p>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-hidden">
              {inv.embedded_pdf ? (
                <iframe src={`data:application/pdf;base64,${inv.embedded_pdf}`} className="w-full h-full border-0" title="Invoice PDF" />
              ) : (
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><p className="text-xs text-gray-400 mb-0.5">Invoice ID</p><p className="font-medium text-gray-900">{inv.invoice_id}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">Issue Date</p><p className="font-medium text-gray-900">{formatDate(inv.issue_date)}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">Supplier</p><p className="font-medium text-gray-900">{inv.supplier}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">Amount (excl. BTW)</p><p className="font-medium text-gray-900">{fmt(inv.amount, inv.currency)}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">VAT</p><p className="font-medium text-gray-900">{fmt(inv.vat_amount || 0)}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">Category</p><p className="font-medium text-gray-900">{inv.category}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">Domain</p><p className="font-medium text-gray-900 capitalize">{inv.domain}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">Month</p><p className="font-medium text-gray-900">{monthLabel(inv.month)}</p></div>
                  </div>
                  {(() => {
                    const lineItems = (() => { try { return typeof inv.line_items === 'string' ? JSON.parse(inv.line_items) : inv.line_items || []; } catch { return []; } })();
                    return lineItems.length > 0 ? (
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
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          </>
        )}
        {/* Drag-to-resize handle */}
        <div onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-10"
          style={{ background: 'linear-gradient(135deg, transparent 50%, #9ca3af 50%, transparent 52%, transparent 62%, #9ca3af 62%, transparent 64%, transparent 74%, #9ca3af 74%)' }}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

type SubTab = 'demo' | 'sales' | 'summary';

export default function SupplierInvoicesPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const { demoCategories, salesCategories, addCategory } = useCategories();
  const [searchParams, setSearchParams] = useSearchParams();

  // Sub-tab — default to 'demo' unless URL says otherwise
  const initialTab = (searchParams.get('tab') as SubTab) || 'demo';
  const [activeTab, setActiveTab] = useState<SubTab>(initialTab);

  // Data
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Single upload
  const singleInputRef = useRef<HTMLInputElement>(null);
  const [singleUploading, setSingleUploading] = useState(false);
  const [singlePreview, setSinglePreview] = useState<SingleUploadPreview | null>(null);

  // Search & Filters — when arriving via supplier link, drop all default
  // filters so every invoice for that supplier is visible.
  const initialSupplier = searchParams.get('supplier');
  const [search, setSearch] = useState('');
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterSuppliers, setFilterSuppliers] = useState<string[]>(initialSupplier ? [initialSupplier] : []);
  const [filterMonth, setFilterMonth] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState(initialSupplier ? '' : '2026-01-01');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  // Sort
  const [sortBy, setSortBy] = useState<string>('issue_date');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('DESC');

  // Invoice viewer
  const [viewingInvoice, setViewingInvoice] = useState<number | null>(null);

  // Category override
  const [overrideTarget, setOverrideTarget] = useState<{ id: number; supplier: string; category: string } | null>(null);

  // ZIP upload state
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [zipUploading, setZipUploading] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<any>(null);
  const [showUnknownModal, setShowUnknownModal] = useState(false);
  const [unknownAssignments, setUnknownAssignments] = useState<Record<string, { domain: string; category: string; remember: boolean }>>({});
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [amountOverrides, setAmountOverrides] = useState<Record<string, number>>({});
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({});
  const [previewingUnknown, setPreviewingUnknown] = useState<string | null>(null);
  const [skipIds, setSkipIds] = useState<string[]>([]);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [showReviewed, setShowReviewed] = useState(false);
  const [flagOverrides, setFlagOverrides] = useState<Record<string, boolean>>({});
  const [flagCommentModal, setFlagCommentModal] = useState<{ id: number; currentlyFlagged: boolean; fromVatAudit?: boolean } | null>(null);
  const [flagComment, setFlagComment] = useState('');

  // Check duplicates
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<any[] | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());
  const [deletingDuplicates, setDeletingDuplicates] = useState(false);

  // VAT audit
  const [runningVatAudit, setRunningVatAudit] = useState(false);
  const [vatIssues, setVatIssues] = useState<any[] | null>(null);
  const [showVatModal, setShowVatModal] = useState(false);
  const [fixingVat, setFixingVat] = useState(false);
  const [manualVatId, setManualVatId] = useState<number | null>(null);
  const [manualVatValue, setManualVatValue] = useState('');
  const [actionTakenIds, setActionTakenIds] = useState<Set<number>>(new Set());

  // Quick preview for duplicates / VAT audit modals
  const [previewInvoiceId, setPreviewInvoiceId] = useState<number | null>(null);
  const [previewPdf, setPreviewPdf] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // ZIP upload note
  const [zipNote, setZipNote] = useState('');
  const [showZipNoteModal, setShowZipNoteModal] = useState(false);
  const [pendingZipFile, setPendingZipFile] = useState<File | null>(null);

  // Delete invoice
  const [deletingInvoice, setDeletingInvoice] = useState<{ id: number; invoice_id: string; supplier: string } | null>(null);

  // Inline editing
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editSupplier, setEditSupplier] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDomain, setEditDomain] = useState<'demo' | 'sales'>('demo');
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editCurrency, setEditCurrency] = useState('EUR');
  const [editDate, setEditDate] = useState('');

  // Add supplier modal
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierCategory, setNewSupplierCategory] = useState('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDomain, setNewCatDomain] = useState<'demo' | 'sales'>('demo');

  // Summary search & filter
  const [summarySearch, setSummarySearch] = useState('');
  const [summaryFromMonth, setSummaryFromMonth] = useState('2026-01');

  const domainCategories = activeTab === 'demo' ? demoCategories : salesCategories;

  // Reset filters when switching tabs
  const handleTabChange = (tab: SubTab) => {
    setActiveTab(tab);
    setSearch('');
    setFilterCategories([]);
    setFilterSuppliers([]);
    setFilterMonth('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setViewingInvoice(null);
  };

  // ─── FETCH HELPERS ──────────────────────────────────────────────────────────

  const buildFilterParams = useCallback(() => {
    const params: Record<string, string> = {};
    // When filtering by supplier, show all domains; otherwise filter by active tab
    if (filterSuppliers.length === 0) params.domain = activeTab;
    if (search) params.search = search;
    if (filterCategories.length > 0) params.categories = filterCategories.join(',');
    if (filterSuppliers.length > 0) params.suppliers = filterSuppliers.join('|');
    if (filterMonth) params.month = filterMonth;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo;
    if (filterFlagged) params.flagged = '1';
    return params;
  }, [activeTab, search, filterCategories, filterSuppliers, filterMonth, filterDateFrom, filterDateTo, filterFlagged]);

  const fetchMonthlySummary = useCallback(async () => {
    try {
      const res = await api.get('/demo-expenses/monthly-summary');
      setMonthlySummary(res.data);
    } catch {
      addToast('Failed to load monthly summary', 'error');
    }
  }, [addToast]);

  const fetchAll = useCallback(async () => {
    try {
      if (activeTab === 'summary') {
        const [, batRes] = await Promise.all([
          fetchMonthlySummary(),
          api.get('/demo-expenses/batches'),
        ]);
        setBatches(batRes.data);
      } else {
        const params = buildFilterParams();
        const [invRes, sumRes, batRes] = await Promise.all([
          api.get('/demo-expenses/invoices', { params: { ...params, sort_by: sortBy, sort_dir: sortDir } }),
          api.get('/demo-expenses/summary', { params }),
          api.get('/demo-expenses/batches', { params: { domain: activeTab } }),
        ]);
        setInvoices(invRes.data);
        setSummary(sumRes.data);
        setBatches(batRes.data);
      }
    } catch {
      addToast('Failed to load supplier invoices', 'error');
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, sortBy, sortDir, activeTab, addToast, fetchMonthlySummary]);

  useEffect(() => { setLoading(true); fetchAll(); }, [fetchAll]);

  // ─── SORT ──────────────────────────────────────────────────────────────────

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'ASC' ? 'DESC' : 'ASC');
    else { setSortBy(col); setSortDir('DESC'); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ChevronDown size={12} className="text-gray-300" />;
    return sortDir === 'ASC' ? <ChevronUp size={12} className="text-primary-600" /> : <ChevronDown size={12} className="text-primary-600" />;
  };

  // ─── CATEGORY OVERRIDE ──────────────────────────────────────────────────────

  const handleCategoryChange = (id: number, supplier: string, newCategory: string) => {
    setOverrideTarget({ id, supplier, category: newCategory });
  };

  const applyCategoryOverride = async (applyToAll: boolean) => {
    if (!overrideTarget) return;
    try {
      await api.patch(`/demo-expenses/invoices/${overrideTarget.id}/category`, {
        category: overrideTarget.category,
        applyToAll,
      });
      addToast(`Category updated${applyToAll ? ` for all ${overrideTarget.supplier} invoices` : ''}`, 'success');
      setOverrideTarget(null);
      fetchAll();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to update category', 'error');
    }
  };

  // ─── INLINE EDIT (supplier + category) ─────────────────────────────────────

  const handleSaveEdit = async (id: number, originalSupplier: string) => {
    try {
      const inv = invoices.find(i => i.id === id);
      const promises: Promise<any>[] = [];
      if (editSupplier !== originalSupplier) {
        promises.push(api.patch(`/demo-expenses/invoices/${id}/supplier`, { supplier: editSupplier }));
      }
      if (editDomain !== inv?.domain || editCategory !== inv?.category) {
        // Always send both domain and category together to avoid race conditions
        promises.push(api.patch(`/demo-expenses/invoices/${id}/category`, { category: editCategory, domain: editDomain }));
      }
      if (editAmount !== inv?.amount || editCurrency !== inv?.currency) {
        promises.push(api.patch(`/demo-expenses/invoices/${id}/amount`, { amount: editAmount, currency: editCurrency }));
      }
      if (editDate !== (inv?.issue_date || '')) {
        promises.push(api.patch(`/demo-expenses/invoices/${id}/date`, { issue_date: editDate }));
      }
      if (promises.length > 0) {
        await Promise.all(promises);
        addToast('Invoice updated', 'success');
        fetchAll();
      }
      setEditingRow(null);
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to update', 'error');
    }
  };

  // ─── ADD SUPPLIER ────────────────────────────────────────────────────────

  const handleAddSupplier = async () => {
    if (!newSupplierName.trim() || !newSupplierCategory || addingSupplier) return;
    setAddingSupplier(true);
    try {
      await api.post('/demo-expenses/supplier-mappings', {
        supplierName: newSupplierName.trim(),
        category: newSupplierCategory,
        domain: activeTab,
      });
      addToast(`Supplier "${newSupplierName.trim()}" added to ${activeTab === 'demo' ? 'Demo Expenses' : 'Sales Activities'}`, 'success');
      setShowAddSupplier(false);
      setNewSupplierName('');
      setNewSupplierCategory('');
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to add supplier', 'error');
    } finally {
      setAddingSupplier(false);
    }
  };

  // ─── DELETE BATCH ──────────────────────────────────────────────────────────

  const handleDeleteBatch = async (batch: Batch) => {
    if (!confirm(`Delete upload "${batch.filename}" (${monthLabel(batch.month)}, ${batch.invoice_count} invoices)?`)) return;
    try {
      await api.delete(`/demo-expenses/batches/${batch.id}`);
      addToast(`Deleted ${batch.filename}`, 'success');
      fetchAll();
    } catch {
      addToast('Delete failed', 'error');
    }
  };

  // ─── DELETE SINGLE INVOICE ─────────────────────────────────────────────

  const handleDeleteInvoice = async () => {
    if (!deletingInvoice) return;
    try {
      await api.delete(`/demo-expenses/invoices/${deletingInvoice.id}`);
      addToast(`Deleted invoice ${deletingInvoice.invoice_id}`, 'success');
      fetchAll();
    } catch {
      addToast('Failed to delete invoice', 'error');
    } finally {
      setDeletingInvoice(null);
    }
  };

  // ─── ZIP UPLOAD HANDLERS ────────────────────────────────────────────────

  const handleZipFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!file.name.toLowerCase().endsWith('.zip')) { addToast('Please upload a .zip file', 'error'); return; }
    setPendingZipFile(file);
    setZipNote('');
    setShowZipNoteModal(true);
  };

  const handleZipUpload = async () => {
    if (!pendingZipFile) return;
    setShowZipNoteModal(false);

    setZipUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', pendingZipFile);
      const res = await api.post('/demo-expenses/upload-zip', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPendingUpload(res.data);

      // Show reconciliation summary
      const recon = res.data.reconciliation;
      if (recon) {
        addToast(
          `ZIP scan: ${recon.totalFilesInZip} files (${recon.xmlFiles} XML + ${recon.pdfFiles} PDF) → ${recon.totalParsed} invoices parsed (${recon.pairedXmlPdf} paired, ${recon.xmlOnly} XML-only, ${recon.pdfOnly} PDF-only) → ${recon.readyToImport} ready to import. DB has ${recon.existingDbTotal} existing invoices.`,
          'info'
        );
        if (recon.failedToParse > 0) {
          const failedNames = (recon.failedFiles || []).map((f: any) => f.name).join(', ');
          addToast(`⚠ ${recon.failedToParse} file(s) FAILED to parse and will be SKIPPED: ${failedNames}`, 'error');
        }
      }
      if (res.data.duplicatesSkipped > 0) {
        addToast(`${res.data.duplicatesSkipped} duplicate(s) already in system — skipped`, 'info');
      }
      if (res.data.inZipDuplicatesRemoved > 0) {
        addToast(`${res.data.inZipDuplicatesRemoved} duplicate(s) within the ZIP removed`, 'info');
      }
      if (res.data.warnings?.length > 0) {
        const zeroAmt = res.data.warnings.filter((w: any) => w.issues.includes('amount_zero')).length;
        const badDate = res.data.warnings.filter((w: any) => w.issues.includes('date_uncertain')).length;
        const badSupplier = res.data.warnings.filter((w: any) => w.issues.includes('supplier_uncertain')).length;
        const ownCompany = res.data.warnings.filter((w: any) => w.issues.includes('own_company')).length;
        const parts: string[] = [];
        if (zeroAmt > 0) parts.push(`${zeroAmt} with amount €0`);
        if (badDate > 0) parts.push(`${badDate} with uncertain date`);
        if (badSupplier > 0) parts.push(`${badSupplier} with unrecognised supplier`);
        if (ownCompany > 0) parts.push(`${ownCompany} flagged as own-company (review to keep or skip)`);
        if (parts.length > 0) {
          addToast(`Needs review: ${parts.join(', ')}. Check the review list below.`, 'error');
        }
      }

      // Show category conflicts
      if (res.data.categoryConflicts?.length > 0) {
        for (const c of res.data.categoryConflicts) {
          const existing = c.existingCategories.map((e: any) => `${e.category} (${e.domain}, ${e.count} inv.)`).join(', ');
          addToast(`Category conflict: "${c.supplier}" is being imported as ${c.newCategory} (${c.newDomain}), but already has: ${existing}. Review in the list below.`, 'error');
        }
      }

      if (res.data.parsed.length === 0) {
        addToast('All invoices in this ZIP already exist in the system. Nothing to import.', 'error');
        setPendingUpload(null);
        return;
      }

      // Merge warning invoices (amount=0, bad date, unknown supplier) into unknownSuppliers
      // so user MUST review them before import
      const warningInvoiceIds = new Set((res.data.warnings || []).map((w: any) => w.invoiceId));
      const extraUnknowns: any[] = [];
      for (const inv of res.data.parsed) {
        if (warningInvoiceIds.has(inv.invoiceId) && !res.data.unknownSuppliers.some((u: any) => u.invoiceId === inv.invoiceId)) {
          // Get embeddedPdf from _fullData since parsed only has hasPdf flag
          const fullEntry = (res.data._fullData || []).find((f: any) => f.invoiceId === inv.invoiceId);
          extraUnknowns.push({
            supplier: inv.supplier,
            amount: inv.amount,
            vatAmount: inv.vatAmount || 0,
            date: inv.issueDate,
            invoiceId: inv.invoiceId,
            currency: inv.currency,
            lineItems: inv.lineItems,
            embeddedPdf: fullEntry?.embeddedPdf || null,
          });
        }
      }
      const allUnknowns = [...res.data.unknownSuppliers, ...extraUnknowns];

      if (allUnknowns.length > 0) {
        // Update pendingUpload with merged unknowns
        setPendingUpload({ ...res.data, unknownSuppliers: allUnknowns });
        setUnknownAssignments(Object.fromEntries(allUnknowns.map((u: any) => {
          // For warning invoices that already have domain/category, pre-fill them
          const existing = res.data.parsed.find((p: any) => p.invoiceId === u.invoiceId);
          return [u.supplier, {
            domain: existing?.domain || 'demo',
            category: existing?.category || 'Other',
            remember: false,
          }];
        })));
        // Auto-skip own-company and duplicate invoices by default (user can un-skip)
        const autoSkipIds = (res.data.warnings || [])
          .filter((w: any) => w.issues.includes('own_company'))
          .map((w: any) => w.invoiceId);
        if (autoSkipIds.length > 0) setSkipIds(autoSkipIds);
        setShowUnknownModal(true);
      } else {
        await finalizeZipImport(res.data, {}, [], false, false);
      }
    } catch (err: any) {
      console.error('[ZIP upload] Error:', err?.response?.data || err);
      addToast(err?.response?.data?.error || 'ZIP upload failed', 'error');
    } finally {
      setZipUploading(false);
    }
  };

  const finalizeZipImport = async (upload: any, catOverrides: Record<string, { domain: string; category: string; remember: boolean }>, skipInvoiceIds: string[], replaceDemo: boolean, replaceSales: boolean) => {
    try {
      const categoryOverrides: Record<string, { domain: string; category: string }> = {};
      const domainOverrides: Record<string, string> = {};
      const rememberSuppliers: string[] = [];
      for (const [supplier, { domain, category, remember }] of Object.entries(catOverrides)) {
        categoryOverrides[supplier] = { domain, category };
        domainOverrides[supplier] = domain;
        if (remember) rememberSuppliers.push(supplier);
      }

      // Only include name overrides that actually changed
      const activeNameOverrides: Record<string, string> = {};
      for (const [original, corrected] of Object.entries(nameOverrides)) {
        if (corrected && corrected !== original) {
          activeNameOverrides[original] = corrected;
        }
      }

      // Apply amount/date/flag overrides to _fullData before sending
      const patchedData = upload._fullData.map((inv: any) => {
        const patched = { ...inv };
        if (amountOverrides[inv.invoiceId] !== undefined) patched.amount = amountOverrides[inv.invoiceId];
        if (dateOverrides[inv.invoiceId]) patched.issueDate = dateOverrides[inv.invoiceId];
        if (flagOverrides[inv.invoiceId]) patched.flagged = true;
        return patched;
      });

      const res = await api.post('/demo-expenses/confirm-import', {
        invoices: patchedData,
        month: upload.inferredMonth,
        filename: upload.filename,
        categoryOverrides,
        domainOverrides,
        nameOverrides: activeNameOverrides,
        rememberSuppliers,
        skipInvoiceIds,
        replaceDemoMonth: replaceDemo,
        replaceSalesMonth: replaceSales,
        duplicateInvoiceIds: upload.duplicates.map((d: any) => d.new.invoiceId),
        note: zipNote,
      });

      if (res.data.message) {
        addToast(res.data.message, 'info');
      } else {
        const results = res.data.results || [];
        const demoCount = results.find((r: any) => r.domain === 'demo')?.count || 0;
        const salesCount = results.find((r: any) => r.domain === 'sales')?.count || 0;
        const parts = [];
        if (demoCount > 0) parts.push(`${demoCount} to Demo Expenses`);
        if (salesCount > 0) parts.push(`${salesCount} to Sales Activities`);
        addToast(`Imported ${parts.join(', ') || 'invoices'}`, 'success');
      }

      // Show post-import reconciliation
      const recon = res.data.reconciliation;
      if (recon) {
        const skipParts: string[] = [];
        if (recon.skippedByUser > 0) skipParts.push(`${recon.skippedByUser} skipped by you`);
        if (recon.skippedAsDuplicate > 0) {
          skipParts.push(`${recon.skippedAsDuplicate} duplicate(s) caught`);
          const skipped = res.data.skippedDetails || [];
          if (skipped.length > 0) {
            const names = skipped.map((s: any) => s.invoiceId).slice(0, 5).join(', ');
            addToast(`Duplicates skipped: ${names}${skipped.length > 5 ? '...' : ''}`, 'info');
          }
        }
        const skipMsg = skipParts.length > 0 ? ` (${skipParts.join(', ')})` : '';
        addToast(`DB total: ${recon.dbTotalAfterImport} invoices (${recon.dbDemoCount} demo, ${recon.dbSalesCount} sales)${skipMsg}`, 'info');
      }

      setPendingUpload(null);
      setPendingZipFile(null);
      setShowUnknownModal(false);
      setUnknownAssignments({});
      setAmountOverrides({});
      setDateOverrides({});
      setSkipIds([]);
      setZipNote('');
      setReviewedIds(new Set());
      setShowReviewed(false);
      setFlagOverrides({});
      fetchAll();
    } catch (err: any) {
      console.error('[ZIP import] Error:', err?.response?.data || err);
      addToast(err?.response?.data?.error || 'Import failed', 'error');
    }
  };

  const cancelZipUpload = () => {
    setPendingUpload(null);
    setPendingZipFile(null);
    setShowUnknownModal(false);
    setUnknownAssignments({});
    setNameOverrides({});
    setAmountOverrides({});
    setDateOverrides({});
    setPreviewingUnknown(null);
    setSkipIds([]);
    setZipNote('');
  };

  // ─── CHECK DUPLICATES ───────────────────────────────────────────────────────
  const handleCheckDuplicates = async () => {
    setCheckingDuplicates(true);
    try {
      const res = await api.get('/demo-expenses/check-duplicates');
      if (res.data.totalGroups === 0) {
        addToast('No duplicates found', 'success');
      } else {
        setDuplicateGroups(res.data.groups);
        setSelectedForDelete(new Set());
        setShowDuplicateModal(true);
      }
    } catch {
      addToast('Failed to check for duplicates', 'error');
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const handleDeleteDuplicates = async () => {
    if (selectedForDelete.size === 0) return;
    setDeletingDuplicates(true);
    let deleted = 0;
    for (const id of selectedForDelete) {
      try {
        await api.delete(`/demo-expenses/invoices/${id}`);
        deleted++;
      } catch {
        addToast(`Failed to delete invoice #${id}`, 'error');
      }
    }
    addToast(`Deleted ${deleted} duplicate invoice(s)`, 'success');
    setShowDuplicateModal(false); setPreviewInvoiceId(null); setPreviewPdf(null);
    setDuplicateGroups(null);
    setSelectedForDelete(new Set());
    setDeletingDuplicates(false);
    fetchAll();
  };

  const toggleDeleteSelection = (id: number) => {
    setSelectedForDelete(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectNewerInGroup = (invoices: any[]) => {
    // Keep the oldest (lowest id), select all others for deletion
    const sorted = [...invoices].sort((a, b) => a.id - b.id);
    setSelectedForDelete(prev => {
      const next = new Set(prev);
      for (let i = 1; i < sorted.length; i++) next.add(sorted[i].id);
      return next;
    });
  };

  // ─── VAT AUDIT ─────────────────────────────────────────────────────────────
  const handleVatAudit = async () => {
    setRunningVatAudit(true);
    try {
      const res = await api.get('/demo-expenses/vat-audit');
      if (res.data.issuesFound === 0) {
        addToast(`VAT audit complete — no issues found (${res.data.totalInvoices} invoices checked)`, 'success');
      } else {
        setVatIssues(res.data.issues);
        setShowVatModal(true);
      }
    } catch {
      addToast('Failed to run VAT audit', 'error');
    } finally {
      setRunningVatAudit(false);
    }
  };

  const handleFixVat = async (id: number, newVat: number, action: string = 'set_to_0') => {
    setFixingVat(true);
    try {
      await api.patch(`/demo-expenses/invoices/${id}/vat`, { vat_amount: newVat, audit_action: action });
      addToast('VAT updated', 'success');
      setActionTakenIds(prev => new Set(prev).add(id));
      setManualVatId(null);
      fetchAll();
    } catch {
      addToast('Failed to update VAT', 'error');
    } finally {
      setFixingVat(false);
    }
  };

  const handleKeepVat = async (issue: any) => {
    setFixingVat(true);
    try {
      await api.post(`/demo-expenses/invoices/${issue.id}/vat-keep`);
      addToast('VAT kept as-is', 'success');
      setActionTakenIds(prev => new Set(prev).add(issue.id));
    } catch {
      addToast('Failed to log action', 'error');
    } finally {
      setFixingVat(false);
    }
  };

  const handleManualVatSubmit = async (id: number) => {
    const val = Number(manualVatValue);
    if (isNaN(val) || val < 0) { addToast('Enter a valid VAT amount', 'error'); return; }
    await handleFixVat(id, val, 'manual_insert');
  };

  const handleFlagForLater = (id: number, fromVatAudit = false) => {
    setFlagCommentModal({ id, currentlyFlagged: false, fromVatAudit });
    setFlagComment('');
  };

  const submitFlag = async () => {
    if (!flagCommentModal) return;
    const { id, currentlyFlagged, fromVatAudit } = flagCommentModal;
    const newFlagged = !currentlyFlagged;
    try {
      await api.patch(`/demo-expenses/invoices/${id}/flag`, {
        flagged: newFlagged,
        comment: newFlagged ? flagComment : '',
        from_vat_audit: fromVatAudit,
      });
      addToast(newFlagged ? 'Flagged for later' : 'Flag removed', 'success');
      if (fromVatAudit) {
        setActionTakenIds(prev => new Set(prev).add(id));
      }
      fetchAll();
    } catch {
      addToast('Failed to update flag', 'error');
    } finally {
      setFlagCommentModal(null);
      setFlagComment('');
    }
  };

  const handleMarkReviewed = async (id: number) => {
    try {
      await api.patch(`/demo-expenses/invoices/${id}/vat-review`);
      setVatIssues(prev => prev ? prev.filter(i => i.id !== id) : null);
      setActionTakenIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      if (vatIssues && vatIssues.length <= 1) { setShowVatModal(false); setPreviewInvoiceId(null); setPreviewPdf(null); }
      addToast('Marked as reviewed', 'success');
    } catch {
      addToast('Failed to mark as reviewed', 'error');
    }
  };

  // ─── QUICK PREVIEW (for duplicate / VAT modals) ─────────────────────────────
  const toggleQuickPreview = async (id: number) => {
    if (previewInvoiceId === id) {
      setPreviewInvoiceId(null);
      setPreviewPdf(null);
      return;
    }
    setPreviewInvoiceId(id);
    setPreviewPdf(null);
    setLoadingPreview(true);
    try {
      const res = await api.get(`/demo-expenses/invoices/${id}`);
      setPreviewPdf(res.data.embedded_pdf || null);
    } catch {
      addToast('Failed to load invoice preview', 'error');
    } finally {
      setLoadingPreview(false);
    }
  };

  // ─── SINGLE UPLOAD HANDLERS ────────────────────────────────────────────────

  const handleSingleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xml') && !name.endsWith('.pdf')) {
      addToast('Please upload an XML or PDF file', 'error');
      return;
    }
    setSingleUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/demo-expenses/upload-single', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSinglePreview(res.data.invoice);
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setSingleUploading(false);
    }
  };

  const confirmSingleUpload = async () => {
    if (!singlePreview) return;
    try {
      await api.post('/demo-expenses/confirm-single', { invoice: singlePreview });
      addToast(`Invoice ${singlePreview.invoiceId || singlePreview.supplier} imported`, 'success');
      setSinglePreview(null);
      fetchAll();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Import failed', 'error');
    }
  };

  // ─── CHART DATA ─────────────────────────────────────────────────────────────

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
    if (!summary) return domainCategories;
    return [...new Set([...domainCategories, ...summary.categories])];
  }, [summary, domainCategories]);

  const supplierColorMap = useMemo(() => {
    if (!summary) return {};
    return Object.fromEntries(summary.by_supplier.map((s, i) => [s.supplier, SUPPLIER_COLORS[i % SUPPLIER_COLORS.length]]));
  }, [summary]);

  const grandTotal = summary?.by_category.reduce((s, c) => s + c.total, 0) || 0;
  const hasFilters = search !== '' || filterCategories.length > 0 || filterSuppliers.length > 0 || filterMonth || filterDateFrom || filterDateTo || filterFlagged;

  const clearFilters = () => {
    setSearch('');
    setFilterCategories([]);
    setFilterSuppliers([]);
    setFilterMonth('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterFlagged(false);
  };

  // Filtered summary data for search on Summary tab
  const filteredMonthlySummary = useMemo(() => {
    if (!monthlySummary || !summarySearch.trim()) return monthlySummary;
    const q = summarySearch.toLowerCase();
    return {
      ...monthlySummary,
      by_month: monthlySummary.by_month.filter(r =>
        r.month.includes(q) || r.domain.includes(q) || String(r.total).includes(q)
      ),
      by_month_category: monthlySummary.by_month_category.filter(r =>
        r.month.includes(q) || r.domain.includes(q) || r.category.toLowerCase().includes(q) || String(r.total).includes(q)
      ),
    };
  }, [monthlySummary, summarySearch]);

  const filteredBatches = useMemo(() => {
    if (!summarySearch.trim() || activeTab !== 'summary') return batches;
    const q = summarySearch.toLowerCase();
    return batches.filter(b =>
      b.filename.toLowerCase().includes(q) || b.domain.includes(q) || b.month.includes(q) ||
      (b.note && b.note.toLowerCase().includes(q)) ||
      (b.uploaded_by_name && b.uploaded_by_name.toLowerCase().includes(q))
    );
  }, [batches, summarySearch, activeTab]);

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Supplier Invoices</h1>
            <p className="text-sm text-gray-500 mt-1">
              Track supplier spending by domain, category, and supplier
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-56">
                {activeTab === 'summary' ? (
                  <SearchBar value={summarySearch} onChange={setSummarySearch} placeholder="Search summary..." />
                ) : (
                  <SearchBar value={search} onChange={setSearch} placeholder="Search invoices..." />
                )}
              </div>
              {activeTab === 'summary' && (
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-500 whitespace-nowrap">From:</label>
                  <input type="month" value={summaryFromMonth} onChange={e => setSummaryFromMonth(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                </div>
              )}
            </div>
            {activeTab !== 'summary' && (
              <>
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
                <button
                  onClick={() => { setShowAddSupplier(true); setNewSupplierCategory(domainCategories[0]); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <UserPlus size={16} />
                  Add Supplier
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-0 -mb-px">
            <button
              onClick={() => handleTabChange('demo')}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'demo'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Demo Expenses
            </button>
            <button
              onClick={() => handleTabChange('sales')}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'sales'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Sales Activities
            </button>
            <button
              onClick={() => handleTabChange('summary')}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'summary'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Monthly Summary
            </button>
          </nav>
        </div>

        {/* Filters */}
        {showFilters && activeTab !== 'summary' && (
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <MultiSelect label="Categories" options={allCategories} selected={filterCategories} onChange={setFilterCategories} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Add Category</label>
                <div className="flex gap-1">
                  <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                    placeholder="New category..."
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-32"
                    onKeyDown={e => { if (e.key === 'Enter' && newCatName.trim()) { addCategory(newCatName.trim(), newCatDomain); setNewCatName(''); addToast(`Added "${newCatName.trim()}" to ${newCatDomain}`, 'success'); } }}
                  />
                  <select value={newCatDomain} onChange={e => setNewCatDomain(e.target.value as 'demo' | 'sales')}
                    className="border border-gray-300 rounded-lg px-1 py-1.5 text-xs w-16">
                    <option value="demo">Demo</option>
                    <option value="sales">Sales</option>
                  </select>
                  <button onClick={() => { if (newCatName.trim()) { addCategory(newCatName.trim(), newCatDomain); setNewCatName(''); addToast(`Added "${newCatName.trim()}" to ${newCatDomain}`, 'success'); } }}
                    className="px-2 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700">+</button>
                </div>
              </div>
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
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Flagged</label>
                <button onClick={() => setFilterFlagged(!filterFlagged)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${filterFlagged ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                  <Flag size={14} className={filterFlagged ? 'fill-amber-500' : ''} />
                  {filterFlagged ? 'Showing flagged' : 'All'}
                </button>
              </div>
              {hasFilters && (
                <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-2 py-1.5">
                  <X size={14} /> Clear
                </button>
              )}
            </div>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : activeTab === 'summary' ? (
          /* ─── MONTHLY SUMMARY TAB ──────────────────────────────────────────── */
          <div className="space-y-6">
            {/* Upload buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <input ref={zipInputRef} type="file" accept=".zip" onChange={handleZipFileSelected} className="hidden" />
              <Button variant="secondary" onClick={() => zipInputRef.current?.click()} disabled={zipUploading}>
                {zipUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {zipUploading ? 'Processing...' : 'Upload ZIP'}
              </Button>
              <input ref={singleInputRef} type="file" accept=".xml,.pdf" onChange={handleSingleUpload} className="hidden" />
              <Button variant="secondary" onClick={() => singleInputRef.current?.click()} disabled={singleUploading}>
                {singleUploading ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                {singleUploading ? 'Parsing...' : 'Upload Single Invoice'}
              </Button>
              <Button variant="secondary" onClick={handleCheckDuplicates} disabled={checkingDuplicates}>
                {checkingDuplicates ? <Loader2 size={16} className="animate-spin" /> : <AlertTriangle size={16} />}
                {checkingDuplicates ? 'Scanning...' : 'Check Duplicates'}
              </Button>
              <Button variant="secondary" onClick={handleVatAudit} disabled={runningVatAudit}>
                {runningVatAudit ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                {runningVatAudit ? 'Auditing...' : 'VAT Audit'}
              </Button>
            </div>

            {monthlySummary && (
              <>
                {/* Grand totals */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Card className="p-4">
                    <p className="text-xs text-gray-500">Total Expenses (excl. BTW)</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{fmt(monthlySummary.grand_totals.total_amount)}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-xs text-gray-500">VAT Reimbursement Outstanding</p>
                    <p className="text-lg font-bold text-amber-600 mt-1">{fmt(monthlySummary.grand_totals.total_vat)}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-xs text-gray-500">Total Invoices</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{monthlySummary.grand_totals.invoice_count}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-xs text-gray-500">Months Covered</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{monthlySummary.months.length}</p>
                  </Card>
                </div>

                {/* Domain breakdown */}
                {monthlySummary.domain_totals.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {monthlySummary.domain_totals.map(dt => (
                      <Card key={dt.domain} className="p-4">
                        <h3 className="text-sm font-semibold text-gray-900 capitalize mb-2">{dt.domain === 'demo' ? 'Demo Expenses' : 'Sales Activities'}</h3>
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-gray-400">Amount</p>
                            <p className="font-medium text-gray-900">{fmt(dt.total)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400">VAT</p>
                            <p className="font-medium text-amber-600">{fmt(dt.vat_total)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400">Invoices</p>
                            <p className="font-medium text-gray-900">{dt.count}</p>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Monthly Expenses Table (Demo | Sales columns) */}
                {(filteredMonthlySummary?.by_month || []).length > 0 && (() => {
                  const rows = filteredMonthlySummary?.by_month || [];
                  const byMonth: Record<string, { demo: number; sales: number; demoCnt: number; salesCnt: number }> = {};
                  for (const r of rows) {
                    if (!byMonth[r.month]) byMonth[r.month] = { demo: 0, sales: 0, demoCnt: 0, salesCnt: 0 };
                    if (r.domain === 'demo') { byMonth[r.month].demo += r.total; byMonth[r.month].demoCnt += r.count; }
                    else { byMonth[r.month].sales += r.total; byMonth[r.month].salesCnt += r.count; }
                  }
                  const allSorted = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
                  // Default start from 2026-01 but allow override via summaryFromMonth
                  const sorted = allSorted.filter(([m]) => m >= summaryFromMonth);
                  let tDemo = 0, tSales = 0;
                  for (const [, v] of sorted) { tDemo += v.demo; tSales += v.sales; }

                  // VAT table data
                  const vatByMonth: Record<string, { demo: number; sales: number }> = {};
                  for (const r of rows) {
                    if (!vatByMonth[r.month]) vatByMonth[r.month] = { demo: 0, sales: 0 };
                    if (r.domain === 'demo') vatByMonth[r.month].demo += r.vat_total;
                    else vatByMonth[r.month].sales += r.vat_total;
                  }
                  const vatSorted = Object.entries(vatByMonth).sort((a, b) => a[0].localeCompare(b[0])).filter(([m]) => m >= summaryFromMonth);
                  let vtDemo = 0, vtSales = 0;
                  for (const [, v] of vatSorted) { vtDemo += v.demo; vtSales += v.sales; }

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card className="overflow-hidden">
                        <div className="p-4 border-b bg-gray-50">
                          <h3 className="text-sm font-semibold text-gray-900">Monthly Expenses (excl. BTW)</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b">
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Month</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-emerald-600 uppercase">Demo</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-blue-600 uppercase">Sales</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-gray-700 uppercase">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {sorted.map(([m, v]) => (
                                <tr key={m} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-700 font-medium">{monthLabel(m)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(v.demo)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(v.sales)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{fmt(v.demo + v.sales)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                <td className="px-4 py-2 text-gray-900">Total</td>
                                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(tDemo)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(tSales)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-gray-900">{fmt(tDemo + tSales)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </Card>

                      <Card className="overflow-hidden">
                        <div className="p-4 border-b bg-gray-50">
                          <h3 className="text-sm font-semibold text-gray-900">Monthly VAT (BTW)</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b">
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Month</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-emerald-600 uppercase">Demo</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-blue-600 uppercase">Sales</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-gray-700 uppercase">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {vatSorted.map(([m, v]) => (
                                <tr key={m} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-700 font-medium">{monthLabel(m)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(v.demo)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(v.sales)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{fmt(v.demo + v.sales)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                <td className="px-4 py-2 text-gray-900">Total</td>
                                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(vtDemo)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(vtSales)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-gray-900">{fmt(vtDemo + vtSales)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </Card>
                    </div>
                  );
                })()}

                {/* Quarterly Expenses & VAT */}
                {(filteredMonthlySummary?.by_month || []).length > 0 && (() => {
                  const rows = filteredMonthlySummary?.by_month || [];
                  // Build quarter → { demo, sales, demoVat, salesVat } map
                  const byQ: Record<string, { demo: number; sales: number; demoVat: number; salesVat: number; demoCnt: number; salesCnt: number }> = {};
                  for (const r of rows) {
                    if (r.month < summaryFromMonth) continue;
                    const [y, mo] = r.month.split('-');
                    const q = `${y}-Q${Math.ceil(parseInt(mo) / 3)}`;
                    if (!byQ[q]) byQ[q] = { demo: 0, sales: 0, demoVat: 0, salesVat: 0, demoCnt: 0, salesCnt: 0 };
                    if (r.domain === 'demo') { byQ[q].demo += r.total; byQ[q].demoVat += r.vat_total; byQ[q].demoCnt += r.count; }
                    else { byQ[q].sales += r.total; byQ[q].salesVat += r.vat_total; byQ[q].salesCnt += r.count; }
                  }
                  const qSorted = Object.entries(byQ).sort((a, b) => a[0].localeCompare(b[0]));
                  if (qSorted.length === 0) return null;
                  let tDemo = 0, tSales = 0, vtDemo = 0, vtSales = 0;
                  for (const [, v] of qSorted) { tDemo += v.demo; tSales += v.sales; vtDemo += v.demoVat; vtSales += v.salesVat; }

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card className="overflow-hidden">
                        <div className="p-4 border-b bg-gray-50">
                          <h3 className="text-sm font-semibold text-gray-900">Quarterly Expenses (excl. BTW)</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b">
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Quarter</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-emerald-600 uppercase">Demo</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-blue-600 uppercase">Sales</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-gray-700 uppercase">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {qSorted.map(([q, v]) => (
                                <tr key={q} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-700 font-medium">{q}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(v.demo)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(v.sales)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{fmt(v.demo + v.sales)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                <td className="px-4 py-2 text-gray-900">Total</td>
                                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(tDemo)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(tSales)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-gray-900">{fmt(tDemo + tSales)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </Card>

                      <Card className="overflow-hidden">
                        <div className="p-4 border-b bg-gray-50">
                          <h3 className="text-sm font-semibold text-gray-900">Quarterly VAT (BTW)</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b">
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Quarter</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-emerald-600 uppercase">Demo</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-blue-600 uppercase">Sales</th>
                                <th className="text-right px-4 py-2 text-xs font-medium text-gray-700 uppercase">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {qSorted.map(([q, v]) => (
                                <tr key={q} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-700 font-medium">{q}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(v.demoVat)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(v.salesVat)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{fmt(v.demoVat + v.salesVat)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                <td className="px-4 py-2 text-gray-900">Total</td>
                                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(vtDemo)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-blue-700">{fmt(vtSales)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-gray-900">{fmt(vtDemo + vtSales)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </Card>
                    </div>
                  );
                })()}

                {/* Demo vs Sales side-by-side monthly chart */}
                {(() => {
                  const byMonth = monthlySummary.by_month;
                  if (byMonth.length === 0) return null;
                  // Build month → { demo, sales } map
                  const monthMap: Record<string, { demo: number; sales: number }> = {};
                  for (const r of byMonth) {
                    if (!monthMap[r.month]) monthMap[r.month] = { demo: 0, sales: 0 };
                    if (r.domain === 'demo') monthMap[r.month].demo = r.total;
                    else monthMap[r.month].sales = r.total;
                  }
                  const months = Object.keys(monthMap).sort().filter(m => m >= summaryFromMonth);
                  if (months.length === 0) return null;
                  const maxVal = Math.max(...months.map(m => Math.max(monthMap[m].demo, monthMap[m].sales)), 1);
                  const chartH = 220;

                  function fmtAxis(n: number): string {
                    if (n === 0) return '0';
                    if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
                    if (n >= 1_000) return `€${Math.round(n / 1_000)}k`;
                    return `€${Math.round(n)}`;
                  }

                  return (
                    <Card className="p-5">
                      <h3 className="text-sm font-semibold text-gray-900 mb-1">Demo Expenses vs Sales Activities — Monthly</h3>
                      <div className="flex items-center gap-5 text-xs text-gray-500 mb-4">
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-500 inline-block" /> Demo Expenses</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Sales Activities</span>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex flex-col justify-between items-end shrink-0 w-14" style={{ height: chartH }}>
                          {[maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0].map((v, i) => (
                            <span key={i} className="text-[10px] text-gray-400 leading-none tabular-nums">{fmtAxis(v)}</span>
                          ))}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <div className="relative" style={{ height: chartH }}>
                            {[0, 25, 50, 75, 100].map(pct => (
                              <div key={pct} className={`absolute left-0 right-0 pointer-events-none ${pct === 0 ? 'border-t border-gray-300' : 'border-t border-gray-100'}`}
                                style={{ bottom: `${(pct / 100) * chartH}px` }} />
                            ))}
                            <div className="flex items-end gap-1.5 h-full">
                              {months.map(m => {
                                const d = monthMap[m];
                                const demoH = d.demo > 0 ? Math.max((d.demo / maxVal) * (chartH - 16), 2) : 0;
                                const salesH = d.sales > 0 ? Math.max((d.sales / maxVal) * (chartH - 16), 2) : 0;
                                return (
                                  <div key={m} className="flex-1 h-full flex items-end justify-center gap-0.5 group relative">
                                    <div className="flex-1 max-w-[18px] flex flex-col items-center justify-end">
                                      {d.demo > 0 && <span className="text-[10px] text-indigo-700 font-semibold tabular-nums whitespace-nowrap mb-0.5">{fmtAxis(d.demo)}</span>}
                                      <div className="w-full bg-indigo-500 rounded-t transition-all hover:bg-indigo-600"
                                        style={{ height: `${demoH}px` }} title={`Demo: ${fmt(d.demo)}`} />
                                    </div>
                                    <div className="flex-1 max-w-[18px] flex flex-col items-center justify-end">
                                      {d.sales > 0 && <span className="text-[10px] text-emerald-700 font-semibold tabular-nums whitespace-nowrap mb-0.5">{fmtAxis(d.sales)}</span>}
                                      <div className="w-full bg-emerald-500 rounded-t transition-all hover:bg-emerald-600"
                                        style={{ height: `${salesH}px` }} title={`Sales: ${fmt(d.sales)}`} />
                                    </div>
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                                      <div className="font-semibold mb-1">{monthLabel(m)}</div>
                                      <div className="text-indigo-300">Demo: {fmt(d.demo)}</div>
                                      <div className="text-emerald-300">Sales: {fmt(d.sales)}</div>
                                      <div className="border-t border-gray-700 mt-1 pt-1">Total: {fmt(d.demo + d.sales)}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex gap-1.5 mt-1">
                            {months.map(m => (
                              <div key={m} className="flex-1 text-center text-[10px] text-gray-500 truncate">{monthLabel(m)}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })()}

                {/* Per-domain category breakdown — side by side */}
                {(() => {
                  const catData = monthlySummary.by_month_category;
                  if (catData.length === 0) return null;

                  // Aggregate by domain + category
                  const domainCats: Record<string, Record<string, number>> = { demo: {}, sales: {} };
                  for (const r of catData) {
                    const dom = r.domain === 'demo' ? 'demo' : 'sales';
                    domainCats[dom][r.category] = (domainCats[dom][r.category] || 0) + r.total;
                  }

                  const demoEntries = Object.entries(domainCats.demo).sort((a, b) => b[1] - a[1]);
                  const salesEntries = Object.entries(domainCats.sales).sort((a, b) => b[1] - a[1]);
                  const demoTotal = demoEntries.reduce((s, [, v]) => s + v, 0);
                  const salesTotal = salesEntries.reduce((s, [, v]) => s + v, 0);

                  function DomainBreakdown({ title, entries, total, accent }: { title: string; entries: [string, number][]; total: number; accent: string }) {
                    if (entries.length === 0) return null;
                    const max = entries[0]?.[1] || 1;
                    return (
                      <Card className="p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                          <span className={`text-sm font-bold ${accent}`}>{fmt(total)}</span>
                        </div>
                        <div className="space-y-2.5">
                          {entries.map(([cat, val]) => (
                            <div key={cat}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-700 flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-sm" style={{ background: CAT_COLORS[cat] || '#6b7280' }} />
                                  {cat}
                                </span>
                                <span className="text-xs tabular-nums text-gray-500">{fmt(val)} ({total > 0 ? ((val / total) * 100).toFixed(1) : 0}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2">
                                <div className="h-2 rounded-full transition-all" style={{ width: `${(val / max) * 100}%`, background: CAT_COLORS[cat] || '#6b7280' }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <DomainBreakdown title="Demo Expenses — by Category" entries={demoEntries} total={demoTotal} accent="text-indigo-600" />
                      <DomainBreakdown title="Sales Activities — by Category" entries={salesEntries} total={salesTotal} accent="text-emerald-600" />
                    </div>
                  );
                })()}
              </>
            )}

            {/* Upload History */}
            {filteredBatches.length > 0 && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Clock size={16} className="text-gray-400" />
                  Upload History
                </h3>
                <div className="space-y-2">
                  {filteredBatches.map(b => (
                    <div key={b.id} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-4">
                        <FileSpreadsheet size={16} className="text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{b.filename}</p>
                          <p className="text-xs text-gray-500">
                            {b.domain === 'demo' ? 'Demo' : 'Sales'} &middot; {monthLabel(b.month)} &middot; {b.invoice_count} invoices &middot; {fmt(b.total_amount)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-gray-400">
                            {new Date(b.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {b.uploaded_by_name && (
                            <p className="text-xs text-gray-500">by {b.uploaded_by_name}</p>
                          )}
                        </div>
                        <button onClick={() => handleDeleteBatch(b)} className="text-gray-400 hover:text-red-500 transition-colors shrink-0" title="Delete this upload">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {b.note && (
                        <p className="text-xs text-gray-600 mt-2 ml-8 italic bg-white rounded px-2 py-1 border border-gray-100">{b.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {!monthlySummary && batches.length === 0 && (
              <Card className="p-12 text-center">
                <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No invoice data yet</h3>
                <p className="text-sm text-gray-500">Upload a ZIP or single invoice file to get started.</p>
              </Card>
            )}
          </div>
        ) : (
          <>
            {/* Summary cards */}
            {grandTotal > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <Card className="p-4">
                  <p className="text-xs text-gray-500">Total Expenses (excl. BTW)</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{fmt(grandTotal)}</p>
                  {hasFilters && <p className="text-[10px] text-primary-600 mt-0.5">filtered</p>}
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-gray-500">VAT Reimbursement Outstanding</p>
                  <p className="text-lg font-bold text-amber-600 mt-1">{fmt(summary?.total_vat || 0)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-gray-500">Invoices</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{invoices.length}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-gray-500">Suppliers</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{summary?.suppliers.length || 0}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-gray-500">Months Uploaded</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{summary?.months.length || 0}</p>
                </Card>
              </div>
            )}

            {/* Charts */}
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

            {/* Quick Category Filter */}
            {(summary?.categories || []).length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-500">Category:</span>
                <button
                  onClick={() => setFilterCategories([])}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filterCategories.length === 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >All</button>
                {allCategories.filter(c => (summary?.categories || []).includes(c)).map(cat => {
                  const isActive = filterCategories.includes(cat);
                  return (
                    <button key={cat}
                      onClick={() => setFilterCategories(isActive ? filterCategories.filter(c => c !== cat) : [...filterCategories, cat])}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${isActive ? 'text-white' : 'text-gray-600 hover:bg-gray-200'}`}
                      style={isActive ? { background: CAT_COLORS[cat] || '#6b7280' } : { background: (CAT_COLORS[cat] || '#6b7280') + '18' }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: isActive ? 'white' : CAT_COLORS[cat] || '#6b7280' }} />
                      {cat}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Invoice Table */}
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
                          { key: 'domain', label: 'Domain' },
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
                      {invoices.map(inv => {
                        const acerta = inv.supplier.toLowerCase().includes('acerta');
                        const isEditing = editingRow === inv.id;
                        return (
                          <tr key={inv.id} className={`hover:bg-gray-50 transition-colors ${isEditing ? 'bg-primary-50/30' : ''}`}>
                            <td className="px-4 py-3">
                              <button onClick={() => setViewingInvoice(inv.id)} className="text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1">
                                {inv.duplicate_warning ? <AlertTriangle size={14} className="text-amber-500" /> : null}
                                {inv.flagged ? <span title={inv.flag_comment || 'Flagged'}><Flag size={12} className="text-amber-500 fill-amber-500" /></span> : null}
                                {inv.invoice_id}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              {new Date(inv.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {isEditing ? (
                                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                                  className="border border-gray-300 rounded px-2 py-0.5 text-xs w-32 focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                              ) : formatDate(inv.issue_date)}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {isEditing ? (
                                <input type="text" value={editSupplier} onChange={e => setEditSupplier(e.target.value)}
                                  className="border border-gray-300 rounded px-2 py-0.5 text-sm w-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                              ) : inv.supplier}
                            </td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                <select value={editDomain} onChange={e => {
                                  const d = e.target.value as 'demo' | 'sales';
                                  setEditDomain(d);
                                  const cats = d === 'sales' ? salesCategories : demoCategories;
                                  if (!cats.includes(editCategory)) setEditCategory(cats[0] || 'Other');
                                }}
                                  className="border border-gray-300 rounded px-2 py-0.5 text-xs bg-white focus:ring-2 focus:ring-primary-500">
                                  <option value="demo">Demo</option>
                                  <option value="sales">Sales</option>
                                </select>
                              ) : (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DOMAIN_COLORS[inv.domain] || 'bg-gray-100 text-gray-700'}`}>
                                  {inv.domain === 'demo' ? 'Demo' : inv.domain === 'sales' ? 'Sales' : inv.domain}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                                  className="border border-gray-300 rounded px-2 py-0.5 text-xs bg-white focus:ring-2 focus:ring-primary-500">
                                  {(editDomain === 'sales' ? salesCategories : demoCategories).map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: (CAT_COLORS[inv.category] || '#6b7280') + '18', color: CAT_COLORS[inv.category] || '#6b7280' }}>
                                  {inv.category}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-900 tabular-nums font-medium">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <select value={editCurrency} onChange={e => setEditCurrency(e.target.value)}
                                    className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white focus:ring-2 focus:ring-primary-500 w-16">
                                    <option value="EUR">EUR</option>
                                    <option value="GBP">GBP</option>
                                    <option value="USD">USD</option>
                                  </select>
                                  <input type="number" step="0.01" value={editAmount}
                                    onChange={e => setEditAmount(parseFloat(e.target.value) || 0)}
                                    className="border border-gray-300 rounded px-2 py-0.5 text-sm w-28 focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                                </div>
                              ) : fmt(inv.amount, inv.currency)}
                            </td>
                            <td className="px-4 py-3 text-gray-500">{monthLabel(inv.month)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                {isEditing ? (
                                  <>
                                    <button onClick={() => handleSaveEdit(inv.id, inv.supplier)} className="text-green-600 hover:text-green-700 transition-colors" title="Save">
                                      <Check size={16} />
                                    </button>
                                    <button onClick={() => setEditingRow(null)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Cancel">
                                      <X size={16} />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                      <button onClick={() => { setEditingRow(inv.id); setEditSupplier(inv.supplier); setEditCategory(inv.category); setEditDomain((inv.domain as 'demo' | 'sales') || 'demo'); setEditAmount(inv.amount); setEditCurrency(inv.currency || 'EUR'); setEditDate(inv.issue_date || ''); }}
                                        className="text-gray-400 hover:text-primary-600 transition-colors" title="Edit invoice">
                                        <Pencil size={14} />
                                      </button>
                                    <button onClick={() => {
                                      if (inv.flagged) {
                                        // Unflag directly (no comment needed)
                                        api.patch(`/demo-expenses/invoices/${inv.id}/flag`, { flagged: false, comment: '' })
                                          .then(() => fetchAll())
                                          .catch(() => addToast('Failed to update flag', 'error'));
                                      } else {
                                        setFlagCommentModal({ id: inv.id, currentlyFlagged: false });
                                        setFlagComment('');
                                      }
                                    }} className={`transition-colors ${inv.flagged ? 'text-amber-500 hover:text-amber-600' : 'text-gray-400 hover:text-amber-500'}`}
                                      title={inv.flagged ? (inv.flag_comment ? `Flagged: ${inv.flag_comment}` : 'Remove flag') : 'Flag for later'}>
                                      <Flag size={14} className={inv.flagged ? 'fill-amber-500' : ''} />
                                    </button>
                                    <button onClick={() => setViewingInvoice(inv.id)} className="text-gray-400 hover:text-primary-600 transition-colors" title="View invoice">
                                      <Eye size={16} />
                                    </button>
                                    <button onClick={() => setDeletingInvoice({ id: inv.id, invoice_id: inv.invoice_id, supplier: inv.supplier })}
                                      className="text-gray-400 hover:text-red-500 transition-colors" title="Delete invoice">
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200">
                        <td colSpan={5} className="px-4 py-3 text-sm font-medium text-gray-700 text-right">
                          Total ({invoices.length} invoices)
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">
                          {fmt(invoices.reduce((s, inv) => s + inv.amount, 0))}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )}

            {/* Empty state */}
            {invoices.length === 0 && (
              <Card className="p-12 text-center">
                <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No {activeTab === 'demo' ? 'demo expense' : 'sales activity'} invoices yet
                </h3>
                <p className="text-sm text-gray-500">
                  Upload a ZIP file from the Monthly Summary tab. Invoices will be automatically classified by supplier.
                </p>
              </Card>
            )}
          </>
        )}

      {/* Invoice Viewer Modal */}
      {viewingInvoice && <InvoiceViewer invoiceId={viewingInvoice} onClose={() => setViewingInvoice(null)} />}

      {/* Delete Invoice Confirm */}
      <ConfirmDialog
        open={!!deletingInvoice}
        onClose={() => setDeletingInvoice(null)}
        onConfirm={handleDeleteInvoice}
        title="Delete Invoice"
        message={deletingInvoice ? `Delete invoice ${deletingInvoice.invoice_id} from ${deletingInvoice.supplier}?` : ''}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Category Override Confirm */}
      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Apply Category Change</h2>
            <p className="text-sm text-gray-600 mb-4">
              Apply <strong>{overrideTarget.category}</strong> to all future invoices from <strong>{overrideTarget.supplier}</strong>?
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setOverrideTarget(null)} className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => applyCategoryOverride(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">This invoice only</button>
              <button onClick={() => applyCategoryOverride(true)} className="px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">All from {overrideTarget.supplier}</button>
            </div>
          </div>
        </div>
      )}

      {/* Unknown Supplier Modal */}
      {showUnknownModal && pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col" style={{ resize: 'both', overflow: 'auto', minWidth: 400, minHeight: 300 }}>
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">Review & Classify Invoices</h2>
              <p className="text-sm text-gray-500 mt-1">
                Review each invoice, correct the supplier name if needed, and classify into <strong>Demo Expenses</strong> or <strong>Sales Activities</strong>.
                {(pendingUpload.warnings?.length > 0) && <span className="text-amber-600 font-medium"> Some invoices need attention — check the warning badges below.</span>}
              </p>
              {reviewedIds.size > 0 && (
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-green-600 font-medium">{reviewedIds.size} reviewed</span>
                  <button onClick={() => setShowReviewed(!showReviewed)}
                    className="text-xs text-primary-600 hover:underline">
                    {showReviewed ? 'Hide reviewed' : 'Show reviewed'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {pendingUpload.unknownSuppliers.map((u: any) => {
                const isReviewed = reviewedIds.has(u.invoiceId);
                if (isReviewed && !showReviewed) {
                  const isSkipped = skipIds.includes(u.invoiceId);
                  return (
                    <div key={u.supplier} className={`border rounded-lg px-4 py-2 flex items-center justify-between ${isSkipped ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                      <div className="flex items-center gap-2">
                        {isSkipped ? <X size={14} className="text-red-500" /> : <Check size={14} className="text-green-500" />}
                        <span className={`text-sm font-medium ${isSkipped ? 'text-red-700' : 'text-green-700'}`}>{u.invoiceId || 'no ID'}</span>
                        <span className={`text-xs ${isSkipped ? 'text-red-600' : 'text-green-600'}`}>{isSkipped ? '— Will not upload' : '— Reviewed'}</span>
                        {flagOverrides[u.invoiceId] && <Flag size={12} className="text-amber-500 fill-amber-500" />}
                      </div>
                      <button onClick={() => setReviewedIds(prev => { const next = new Set(prev); next.delete(u.invoiceId); return next; })}
                        className="text-xs text-gray-500 hover:text-gray-700">Undo</button>
                    </div>
                  );
                }
                const a = unknownAssignments[u.supplier] || { domain: 'demo', category: 'Other', remember: false };
                const cats = a.domain === 'sales' ? salesCategories : demoCategories;
                const isPreviewing = previewingUnknown === u.supplier;
                return (
                  <div key={u.supplier} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className={`p-4 ${skipIds.includes(u.invoiceId) ? 'opacity-50' : ''}`}>
                      {/* Warning badges for flagged invoices */}
                      {(() => {
                        const w = (pendingUpload.warnings || []).find((w: any) => w.invoiceId === u.invoiceId);
                        if (!w) return null;
                        const isSkipped = skipIds.includes(u.invoiceId);
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            {w.issues.includes('own_company') && (
                              <>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">Own-company name detected</span>
                                <button onClick={() => setSkipIds(prev => isSkipped ? prev.filter(id => id !== u.invoiceId) : [...prev, u.invoiceId])}
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${isSkipped ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-600 border-green-200'}`}>
                                  {isSkipped ? 'Will skip — click to include' : 'Will include — click to skip'}
                                </button>
                              </>
                            )}
                            {w.issues.includes('amount_zero') && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Amount is €0 — please verify</span>}
                            {w.issues.includes('date_uncertain') && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Date could not be read — please verify</span>}
                            {w.issues.includes('date_future') && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Date is in the future — please correct</span>}
                            {w.issues.includes('date_illogical') && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Date looks wrong (illogical year) — please correct</span>}
                            {w.issues.includes('supplier_uncertain') && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Supplier not recognised — please verify</span>}
                          </div>
                        );
                      })()}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-400 mb-0.5">Invoice ID</p>
                          <p className="font-medium text-gray-900">{u.invoiceId || 'no ID'}</p>
                        </div>
                        <button
                          onClick={() => setPreviewingUnknown(isPreviewing ? null : u.supplier)}
                          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Eye size={14} />
                          {isPreviewing ? 'Hide' : 'Preview'}
                        </button>
                      </div>

                      {/* Editable fields for all invoices */}
                      {(() => {
                        const w = (pendingUpload.warnings || []).find((w: any) => w.invoiceId === u.invoiceId);
                        const hasAmountIssue = w?.issues.includes('amount_zero');
                        const hasDateIssue = w?.issues.includes('date_uncertain');
                        const currentAmount = amountOverrides[u.invoiceId] ?? u.amount;
                        const amountModified = amountOverrides[u.invoiceId] !== undefined && amountOverrides[u.invoiceId] !== u.amount;
                        const currentDate = dateOverrides[u.invoiceId] || u.date || '';
                        const dateModified = dateOverrides[u.invoiceId] !== undefined && dateOverrides[u.invoiceId] !== (u.date || '');
                        // Parse date into day/month/year
                        const dateParts = currentDate ? currentDate.split('-') : ['', '', ''];
                        const dateYear = dateParts[0] || '';
                        const dateMonth = dateParts[1] || '';
                        const dateDay = dateParts[2] || '';
                        const setDatePart = (part: 'y' | 'm' | 'd', val: string) => {
                          const y = part === 'y' ? val : dateYear;
                          const m = part === 'm' ? val : dateMonth;
                          const d = part === 'd' ? val : dateDay;
                          if (y && m && d) {
                            setDateOverrides(prev => ({ ...prev, [u.invoiceId]: `${y}-${m}-${d}` }));
                          } else {
                            setDateOverrides(prev => ({ ...prev, [u.invoiceId]: '' }));
                          }
                        };
                        return (
                          <div className="flex flex-wrap items-end gap-3 mt-3">
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${hasAmountIssue ? 'text-red-600' : 'text-gray-500'}`}>
                                Amount {amountModified && <Check size={12} className="inline text-green-500" />}
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={currentAmount}
                                onChange={e => setAmountOverrides(prev => ({ ...prev, [u.invoiceId]: parseFloat(e.target.value) || 0 }))}
                                className={`w-36 border rounded-lg px-3 py-1.5 text-sm focus:ring-2 ${hasAmountIssue ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-primary-500'}`}
                              />
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${hasDateIssue ? 'text-amber-600' : 'text-gray-500'}`}>
                                Date {dateModified && <Check size={12} className="inline text-green-500" />}
                              </label>
                              <div className="flex items-center gap-1">
                                <select value={dateDay} onChange={e => setDatePart('d', e.target.value)}
                                  className={`w-16 border rounded-lg px-1.5 py-1.5 text-sm ${hasDateIssue ? 'border-amber-300' : 'border-gray-300'}`}>
                                  <option value="">DD</option>
                                  {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(d => (
                                    <option key={d} value={d}>{d}</option>
                                  ))}
                                </select>
                                <span className="text-gray-400">/</span>
                                <select value={dateMonth} onChange={e => setDatePart('m', e.target.value)}
                                  className={`w-16 border rounded-lg px-1.5 py-1.5 text-sm ${hasDateIssue ? 'border-amber-300' : 'border-gray-300'}`}>
                                  <option value="">MM</option>
                                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                                <span className="text-gray-400">/</span>
                                <select value={dateYear} onChange={e => setDatePart('y', e.target.value)}
                                  className={`w-20 border rounded-lg px-1.5 py-1.5 text-sm ${hasDateIssue ? 'border-amber-300' : 'border-gray-300'}`}>
                                  <option value="">YYYY</option>
                                  {[2024, 2025, 2026, 2027].map(y => (
                                    <option key={y} value={String(y)}>{y}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Editable supplier name */}
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Correct supplier name</label>
                        <input
                          type="text"
                          value={nameOverrides[u.supplier] ?? u.supplier}
                          onChange={e => setNameOverrides(prev => ({ ...prev, [u.supplier]: e.target.value }))}
                          placeholder={u.supplier}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                        {nameOverrides[u.supplier] && nameOverrides[u.supplier] !== u.supplier && (
                          <p className="text-xs text-primary-600 mt-1">
                            Will rename "{u.supplier}" to "{nameOverrides[u.supplier]}"
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-3 mt-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Domain</label>
                          <select value={a.domain}
                            onChange={e => setUnknownAssignments(prev => {
                              const cur = prev[u.supplier] || { domain: 'demo', category: 'Other', remember: false };
                              return { ...prev, [u.supplier]: { ...cur, domain: e.target.value, category: e.target.value === 'sales' ? 'Raw Materials' : 'Other' } };
                            })}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                            <option value="demo">Demo Expenses</option>
                            <option value="sales">Sales Activities</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                          <select value={a.category}
                            onChange={e => setUnknownAssignments(prev => {
                              const cur = prev[u.supplier] || { domain: 'demo', category: 'Other', remember: false };
                              return { ...prev, [u.supplier]: { ...cur, category: e.target.value } };
                            })}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                            {cats.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 mt-3 text-sm text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={a.remember}
                          onChange={e => setUnknownAssignments(prev => {
                            const cur = prev[u.supplier] || { domain: 'demo', category: 'Other', remember: false };
                            return { ...prev, [u.supplier]: { ...cur, remember: e.target.checked } };
                          })}
                          className="rounded border-gray-300" />
                        Remember this supplier for future uploads
                      </label>
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <button
                          onClick={() => setSkipIds(prev => prev.includes(u.invoiceId) ? prev.filter(id => id !== u.invoiceId) : [...prev, u.invoiceId])}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${skipIds.includes(u.invoiceId) ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                        >
                          <X size={12} />
                          {skipIds.includes(u.invoiceId) ? 'Will not upload' : 'Do not upload'}
                        </button>
                        <button
                          onClick={() => setFlagOverrides(prev => ({ ...prev, [u.invoiceId]: !prev[u.invoiceId] }))}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${flagOverrides[u.invoiceId] ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                          title={flagOverrides[u.invoiceId] ? 'Remove flag' : 'Flag for later review'}
                        >
                          <Flag size={12} className={flagOverrides[u.invoiceId] ? 'fill-amber-500' : ''} />
                          {flagOverrides[u.invoiceId] ? 'Flagged' : 'Flag for later'}
                        </button>
                        <button
                          onClick={() => setReviewedIds(prev => { const next = new Set(prev); next.add(u.invoiceId); return next; })}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-green-300 text-green-700 bg-green-50 hover:bg-green-100 transition-colors"
                        >
                          <Check size={12} />
                          Mark as reviewed
                        </button>
                      </div>
                    </div>

                    {/* Invoice preview */}
                    {isPreviewing && (
                      <div className="border-t border-gray-200 bg-gray-50">
                        {u.embeddedPdf ? (
                          <iframe src={`data:application/pdf;base64,${u.embeddedPdf}`} className="w-full h-[400px]" title="Invoice preview" />
                        ) : u.lineItems && (() => {
                          const items = typeof u.lineItems === 'string' ? (() => { try { return JSON.parse(u.lineItems); } catch { return []; } })() : u.lineItems || [];
                          return items.length > 0 ? (
                            <div className="p-4 space-y-2">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase">Line Items</h4>
                              <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                                {items.map((li: any, i: number) => (
                                  <div key={i} className="px-3 py-2 flex justify-between gap-3 text-sm">
                                    <span className="text-gray-700">{li.description || '(no description)'}</span>
                                    <span className="text-gray-500 tabular-nums shrink-0">{fmt(li.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="p-4 text-sm text-gray-400">No preview available for this invoice</p>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={cancelZipUpload} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => {
                setShowUnknownModal(false);
                finalizeZipImport(pendingUpload, unknownAssignments, skipIds, false, false);
              }} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">Continue</button>
            </div>
          </div>
        </div>
      )}


      {/* VAT Audit Modal */}
      {showVatModal && vatIssues && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-7xl w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">VAT Audit Results</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Found {vatIssues.length} invoice(s) with potential VAT issues. Review and fix as needed.
                </p>
              </div>
              <button onClick={() => { setShowVatModal(false); setPreviewInvoiceId(null); setPreviewPdf(null); setActionTakenIds(new Set()); setManualVatId(null); }} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm table-fixed">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b">
                    <th className="text-left px-3 py-3 font-medium text-gray-600 w-[110px]">Invoice ID</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-600 w-[160px]">Supplier</th>
                    <th className="text-center px-2 py-3 font-medium text-gray-600 w-[60px]">Country</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-600 w-[90px]">Amount</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-600 w-[90px]">Current VAT</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-600 w-[80px]">Suggested</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-600">Issue</th>
                    <th className="text-center px-2 py-3 font-medium text-gray-600 w-[340px]">Action</th>
                    <th className="w-10 px-2 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vatIssues.map((issue: any) => (
                    <React.Fragment key={issue.id}>
                      <tr className={`hover:bg-gray-50 ${actionTakenIds.has(issue.id) ? 'bg-green-50/50' : ''}`}>
                        <td className="px-3 py-3 font-medium text-gray-900 truncate" title={issue.invoice_id}>{issue.invoice_id}</td>
                        <td className="px-3 py-3 text-gray-600 truncate" title={issue.supplier}>{issue.supplier}</td>
                        <td className="px-2 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            issue.country === 'BE' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {issue.country || '??'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-medium whitespace-nowrap">
                          {issue.currency === 'GBP' ? '\u00A3' : issue.currency === 'USD' ? '$' : '\u20AC'}
                          {issue.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className={`px-3 py-3 text-right font-medium whitespace-nowrap ${issue.suggested_vat === 0 && issue.current_vat > 0 ? 'text-red-600' : ''}`}>
                          {issue.current_vat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-3 text-right font-medium text-green-600 whitespace-nowrap">
                          {issue.suggested_vat != null ? issue.suggested_vat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500 truncate" title={issue.issue}>{issue.issue}</td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-1 justify-center">
                            {actionTakenIds.has(issue.id) ? (
                              <button
                                onClick={() => handleMarkReviewed(issue.id)}
                                disabled={fixingVat}
                                className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 whitespace-nowrap"
                              >
                                ✓ Mark as reviewed
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleKeepVat(issue)}
                                  disabled={fixingVat}
                                  className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium disabled:opacity-50 whitespace-nowrap"
                                  title="Keep current VAT — no changes"
                                >
                                  Keep as is
                                </button>
                                <button
                                  onClick={() => handleFixVat(issue.id, 0, 'set_to_0')}
                                  disabled={fixingVat}
                                  className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 font-medium disabled:opacity-50 whitespace-nowrap"
                                  title="Set VAT to 0"
                                >
                                  VAT = 0
                                </button>
                                <button
                                  onClick={() => {
                                    const calculatedVat = Math.round((issue.amount - issue.amount / 1.21) * 100) / 100;
                                    handleFixVat(issue.id, calculatedVat, 'calculate_vat');
                                  }}
                                  disabled={fixingVat}
                                  className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium disabled:opacity-50 whitespace-nowrap"
                                  title={`Calculate 21% VAT: €${(Math.round((issue.amount - issue.amount / 1.21) * 100) / 100).toFixed(2)}`}
                                >
                                  Calc 21%
                                </button>
                                {manualVatId === issue.id ? (
                                  <form onSubmit={(e) => { e.preventDefault(); handleManualVatSubmit(issue.id); }} className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={manualVatValue}
                                      onChange={e => setManualVatValue(e.target.value)}
                                      className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                                      placeholder="VAT"
                                      autoFocus
                                    />
                                    <button type="submit" disabled={fixingVat} className="px-1.5 py-0.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50">OK</button>
                                    <button type="button" onClick={() => setManualVatId(null)} className="px-1 py-0.5 text-xs text-gray-400 hover:text-gray-600">✕</button>
                                  </form>
                                ) : (
                                  <button
                                    onClick={() => { setManualVatId(issue.id); setManualVatValue(''); }}
                                    disabled={fixingVat}
                                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium disabled:opacity-50 whitespace-nowrap"
                                    title="Manually insert VAT amount"
                                  >
                                    Manual
                                  </button>
                                )}
                                <button
                                  onClick={() => handleFlagForLater(issue.id, true)}
                                  disabled={fixingVat}
                                  className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 font-medium disabled:opacity-50 whitespace-nowrap"
                                  title="Flag for later review"
                                >
                                  Flag
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={() => toggleQuickPreview(issue.id)}
                            className={`p-1 rounded hover:bg-gray-100 ${previewInvoiceId === issue.id ? 'text-primary-600' : 'text-gray-400 hover:text-gray-600'}`}
                            title="Preview invoice PDF"
                          >
                            {loadingPreview && previewInvoiceId === issue.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                          </button>
                        </td>
                      </tr>
                      {previewInvoiceId === issue.id && (
                        <tr>
                          <td colSpan={9} className="p-0">
                            <div className="bg-gray-50 border-t border-b border-gray-200 p-3">
                              {loadingPreview ? (
                                <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 size={20} className="animate-spin mr-2" /> Loading preview...</div>
                              ) : previewPdf ? (
                                <iframe src={`data:application/pdf;base64,${previewPdf}`} className="w-full h-[400px] rounded-lg border border-gray-200 bg-white" title="Invoice preview" />
                              ) : (
                                <p className="text-center py-6 text-sm text-gray-400">No PDF preview available for this invoice</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t flex items-center justify-between">
              <span className="text-sm text-gray-500">{vatIssues.length} issue(s) remaining</span>
              <button onClick={() => { setShowVatModal(false); setPreviewInvoiceId(null); setPreviewPdf(null); setActionTakenIds(new Set()); setManualVatId(null); }} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag Comment Modal */}
      {flagCommentModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="p-5 border-b">
              <h3 className="text-base font-bold text-gray-900">Flag Invoice</h3>
              <p className="text-sm text-gray-500 mt-1">Add a reason for flagging this invoice (optional).</p>
            </div>
            <div className="p-5">
              <textarea
                value={flagComment}
                onChange={e => setFlagComment(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                rows={3}
                placeholder="e.g. Need to verify VAT number with supplier..."
                autoFocus
              />
            </div>
            <div className="p-4 border-t flex items-center justify-end gap-2">
              <button
                onClick={() => { setFlagCommentModal(null); setFlagComment(''); }}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitFlag}
                className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium"
              >
                Flag Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Check Modal */}
      {showDuplicateModal && duplicateGroups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Suspected Duplicates</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Found {duplicateGroups.length} group(s) with potential duplicates. Select invoices to delete.
                </p>
              </div>
              <button onClick={() => { setShowDuplicateModal(false); setPreviewInvoiceId(null); setPreviewPdf(null); }} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {duplicateGroups.map((group, gi) => {
                const reasonLabel = group.reason === 'exact_id' ? 'Exact ID Match'
                  : group.reason === 'copy_suffix' ? 'Copy Suffix Match'
                  : 'Same Supplier + Amount + Date';
                const reasonColor = group.reason === 'exact_id' ? 'bg-red-100 text-red-700'
                  : group.reason === 'copy_suffix' ? 'bg-orange-100 text-orange-700'
                  : 'bg-yellow-100 text-yellow-700';
                return (
                  <div key={gi} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${reasonColor}`}>
                        {reasonLabel}
                      </span>
                      <button
                        onClick={() => selectNewerInGroup(group.invoices)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium hover:underline"
                      >
                        Select newer
                      </button>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50/50">
                          <th className="w-10 px-3 py-2"></th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Invoice ID</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Supplier</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600">Amount</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Date</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Domain</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Category</th>
                          <th className="w-10 px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {group.invoices.map((inv: any) => (
                          <React.Fragment key={inv.id}>
                            <tr className={`hover:bg-gray-50 ${selectedForDelete.has(inv.id) ? 'bg-red-50' : ''}`}>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedForDelete.has(inv.id)}
                                  onChange={() => toggleDeleteSelection(inv.id)}
                                  className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                />
                              </td>
                              <td className="px-3 py-2 font-medium text-gray-900">{inv.invoice_id}</td>
                              <td className="px-3 py-2 text-gray-600">{inv.supplier}</td>
                              <td className="px-3 py-2 text-right font-medium text-gray-900">
                                {inv.currency === 'GBP' ? '\u00A3' : inv.currency === 'USD' ? '$' : '\u20AC'}
                                {inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-3 py-2 text-gray-600">{formatDate(inv.issue_date)}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DOMAIN_COLORS[inv.domain] || 'bg-gray-100 text-gray-700'}`}>
                                  {inv.domain}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-600 text-xs">{inv.category}</td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  onClick={() => toggleQuickPreview(inv.id)}
                                  className={`p-1 rounded hover:bg-gray-100 ${previewInvoiceId === inv.id ? 'text-primary-600' : 'text-gray-400 hover:text-gray-600'}`}
                                  title="Preview invoice PDF"
                                >
                                  {loadingPreview && previewInvoiceId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                                </button>
                              </td>
                            </tr>
                            {previewInvoiceId === inv.id && (
                              <tr>
                                <td colSpan={8} className="p-0">
                                  <div className="bg-gray-50 border-t border-b border-gray-200 p-3">
                                    {loadingPreview ? (
                                      <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 size={20} className="animate-spin mr-2" /> Loading preview...</div>
                                    ) : previewPdf ? (
                                      <iframe src={`data:application/pdf;base64,${previewPdf}`} className="w-full h-[400px] rounded-lg border border-gray-200 bg-white" title="Invoice preview" />
                                    ) : (
                                      <p className="text-center py-6 text-sm text-gray-400">No PDF preview available for this invoice</p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {selectedForDelete.size > 0 ? `${selectedForDelete.size} invoice(s) selected for deletion` : 'Select invoices to delete'}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowDuplicateModal(false); setPreviewInvoiceId(null); setPreviewPdf(null); }}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteDuplicates}
                  disabled={selectedForDelete.size === 0 || deletingDuplicates}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {deletingDuplicates ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Delete Selected ({selectedForDelete.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single Upload Preview Modal */}
      {singlePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">Review Invoice Before Import</h2>
              <p className="text-sm text-gray-500 mt-1">Preview the invoice and edit fields as needed before importing.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex gap-6">
                {/* PDF Preview */}
                {singlePreview.embeddedPdf && (
                  <div className="flex-1 min-w-0">
                    <iframe src={`data:application/pdf;base64,${singlePreview.embeddedPdf}`} className="w-full h-[500px] rounded-lg border border-gray-200" title="Invoice Preview" />
                  </div>
                )}
                {/* Editable fields */}
                <div className={`${singlePreview.embeddedPdf ? 'w-80 shrink-0' : 'w-full'} space-y-4`}>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Invoice ID</label>
                    <p className="font-medium text-gray-900 text-sm">{singlePreview.invoiceId || '—'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Issue Date</label>
                    <p className="font-medium text-gray-900 text-sm">{singlePreview.date ? formatDate(singlePreview.date) : '—'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Supplier Name</label>
                    <input type="text" value={singlePreview.supplier}
                      onChange={e => setSinglePreview(prev => prev ? { ...prev, supplier: e.target.value } : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Amount (excl. BTW)</label>
                    <input type="number" step="0.01" value={singlePreview.amount}
                      onChange={e => setSinglePreview(prev => prev ? { ...prev, amount: parseFloat(e.target.value) || 0 } : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">VAT Amount</label>
                      <p className="font-medium text-amber-600 text-sm">{fmt(singlePreview.vatAmount)}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
                      <p className="font-medium text-gray-900 text-sm">{singlePreview.currency}</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
                    <p className="font-medium text-gray-900 text-sm">{singlePreview.month ? monthLabel(singlePreview.month) : '—'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Domain</label>
                    <select value={singlePreview.domain}
                      onChange={e => setSinglePreview(prev => prev ? { ...prev, domain: e.target.value, category: e.target.value === 'sales' ? 'Raw Materials' : 'Other' } : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                      <option value="demo">Demo Expenses</option>
                      <option value="sales">Sales Activities</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                    <select value={singlePreview.category}
                      onChange={e => setSinglePreview(prev => prev ? { ...prev, category: e.target.value } : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                      {(singlePreview.domain === 'sales' ? salesCategories : demoCategories).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6 border-t flex gap-3 justify-end">
              <button onClick={() => setSinglePreview(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={confirmSingleUpload} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">Import Invoice</button>
            </div>
          </div>
        </div>
      )}

      {/* ZIP Note Modal */}
      {showZipNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Upload ZIP File</h2>
            <p className="text-sm text-gray-500 mb-4">
              Uploading <strong>{pendingZipFile?.name}</strong>{user ? <> as <strong>{user.username}</strong></> : null}
            </p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
              <input type="text" value={zipNote} onChange={e => setZipNote(e.target.value)}
                placeholder="e.g. Invoices Jan 2026"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                onKeyDown={e => { if (e.key === 'Enter') handleZipUpload(); }}
                autoFocus />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setShowZipNoteModal(false); setPendingZipFile(null); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleZipUpload} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">Upload</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Supplier Modal */}
      {showAddSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Add Supplier</h2>
            <p className="text-sm text-gray-500 mb-4">
              Add a new supplier to <strong>{activeTab === 'demo' ? 'Demo Expenses' : 'Sales Activities'}</strong>. Future invoice uploads will automatically classify invoices from this supplier.
            </p>
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Supplier Name</label>
                <input type="text" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select value={newSupplierCategory} onChange={e => setNewSupplierCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select category...</option>
                  {domainCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setShowAddSupplier(false); setNewSupplierName(''); setNewSupplierCategory(''); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleAddSupplier} disabled={!newSupplierName.trim() || !newSupplierCategory || addingSupplier}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">{addingSupplier ? 'Adding…' : 'Add Supplier'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
