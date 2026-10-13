import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, X, Search, Flag, Calendar, Euro } from 'lucide-react';
import { todayISO, formatDate } from '../lib/dates';

/**
 * Supplier Invoices filter bar: period chips (years with invoices, this / last
 * month, this quarter, custom range), searchable supplier and category pickers,
 * an amount range, flagged, and the active filters as removable chips.
 */

export interface InvoiceFilters {
  dateFrom: string; dateTo: string;
  suppliers: string[]; categories: string[];
  amountMin: string; amountMax: string;
  flagged: boolean;
}

interface Period { key: string; label: string; from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();   // m = 1..12
const monthRange = (y: number, m: number) => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The current year as a range — the default period. */
export function currentYearRange() {
  const y = todayISO().slice(0, 4);
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

function quickPeriods(): Period[] {
  const [y, m] = todayISO().split('-').map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const q = Math.floor((m - 1) / 3);
  return [
    { key: 'this-month', label: 'This month', ...monthRange(y, m) },
    { key: 'last-month', label: `Last month`, ...monthRange(prev.y, prev.m) },
    { key: 'this-quarter', label: `Q${q + 1} ${y}`, from: monthRange(y, q * 3 + 1).from, to: monthRange(y, q * 3 + 3).to },
  ];
}

const fmtEur = (n: number) => `€${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtEur2 = (n: number) => `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);
  return ref;
}

const triggerCls = (active: boolean) =>
  `flex items-center gap-2 border rounded-lg px-3 py-1.5 text-sm bg-white transition-colors ${active ? 'border-primary-400 text-primary-700 bg-primary-50' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`;

/** Multi-select with a search box; ticked options listed first; optional counts and footer. */
export function SearchableMultiSelect({ label, options, selected, onChange, counts, footer }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
  counts?: Record<string, number>; footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useOutsideClose(open, () => setOpen(false));
  const toggle = (val: string) => onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  const query = q.trim().toLowerCase();
  const shown = [...selected.filter(s => !options.includes(s)), ...options]
    .filter(o => !query || o.toLowerCase().includes(query))
    .sort((a, b) => Number(selected.includes(b)) - Number(selected.includes(a)));
  const text = selected.length === 0 ? `All ${label.toLowerCase()}` : selected.length === 1 ? selected[0] : `${selected.length} ${label.toLowerCase()}`;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className={triggerCls(selected.length > 0)}>
        <span className="text-xs text-gray-500">{label}:</span>
        <span className="truncate max-w-[180px]">{text}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg w-72">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`}
                onKeyDown={e => { if (e.key === 'Enter' && shown.length === 1) toggle(shown[0]); if (e.key === 'Escape') setOpen(false); }}
                className="w-full border border-gray-200 rounded-md pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No match</p>}
            {shown.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="rounded border-gray-300" />
                <span className="truncate text-gray-700 flex-1">{opt}</span>
                {counts?.[opt] != null && <span className="text-xs text-gray-400 tabular-nums">{counts[opt]}</span>}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="w-full text-left px-3 py-1.5 text-xs text-primary-600 hover:bg-primary-50 border-t border-gray-100">Clear {label.toLowerCase()}</button>
          )}
          {footer && <div className="border-t border-gray-100 p-2">{footer}</div>}
        </div>
      )}
    </div>
  );
}

const AMOUNT_PRESETS: { label: string; min: string; max: string }[] = [
  { label: 'Under €100', min: '', max: '100' },
  { label: '€100 – €1,000', min: '100', max: '1000' },
  { label: '€1,000 – €10,000', min: '1000', max: '10000' },
  { label: 'Over €10,000', min: '10000', max: '' },
];

export function amountLabel(min: string, max: string) {
  if (min && max) return `${fmtEur(Number(min))} – ${fmtEur(Number(max))}`;
  if (min) return `≥ ${fmtEur(Number(min))}`;
  if (max) return `≤ ${fmtEur(Number(max))}`;
  return '';
}

function AmountFilter({ min, max, onChange }: { min: string; max: string; onChange: (min: string, max: string) => void }) {
  const [open, setOpen] = useState(false);
  const [dMin, setDMin] = useState(min);
  const [dMax, setDMax] = useState(max);
  const ref = useOutsideClose(open, () => setOpen(false));
  useEffect(() => { setDMin(min); setDMax(max); }, [min, max, open]);
  const apply = (a = dMin, b = dMax) => { onChange(a.trim(), b.trim()); setOpen(false); };
  const active = !!(min || max);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className={triggerCls(active)}>
        <Euro size={14} className="text-gray-400" />
        <span className="text-xs text-gray-500">Amount:</span>
        <span>{active ? amountLabel(min, max) : 'Any'}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg w-64 p-3 space-y-3">
          <p className="text-xs text-gray-500">Net amount in EUR (excl. VAT)</p>
          <div className="flex items-center gap-2">
            <input type="number" min={0} value={dMin} onChange={e => setDMin(e.target.value)} placeholder="Min"
              onKeyDown={e => e.key === 'Enter' && apply()}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            <span className="text-gray-400">–</span>
            <input type="number" min={0} value={dMax} onChange={e => setDMax(e.target.value)} placeholder="Max"
              onKeyDown={e => e.key === 'Enter' && apply()}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AMOUNT_PRESETS.map(p => (
              <button key={p.label} onClick={() => apply(p.min, p.max)}
                className={`px-2 py-1 rounded-full text-xs border ${p.min === min && p.max === max ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <button onClick={() => apply('', '')} className="text-xs text-gray-500 hover:text-gray-700">Any amount</button>
            <button onClick={() => apply()} className="px-3 py-1 text-xs bg-primary-600 text-white rounded-md hover:bg-primary-700">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm border transition-colors ${active ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
      {children}
    </button>
  );
}

function Chip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-primary-50 border border-primary-200 text-xs text-primary-700">
      {children}
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-primary-100" title="Remove"><X size={12} /></button>
    </span>
  );
}

export default function InvoiceFilterBar({ value, onChange, years, suppliers, supplierCounts, categories, categoryFooter, resultCount, resultTotal, onClear }: {
  value: InvoiceFilters;
  onChange: (patch: Partial<InvoiceFilters>) => void;
  years: string[];
  suppliers: string[];
  supplierCounts?: Record<string, number>;
  categories: string[];
  categoryFooter?: ReactNode;
  resultCount: number;
  resultTotal: number;
  onClear: () => void;
}) {
  const { dateFrom, dateTo } = value;
  const yearPeriods: Period[] = [...new Set([...years, todayISO().slice(0, 4)])].sort().map(y => ({ key: y, label: y, from: `${y}-01-01`, to: `${y}-12-31` }));
  const periods = [...yearPeriods, ...quickPeriods()];
  const activePeriod = periods.find(p => p.from === dateFrom && p.to === dateTo);
  const [customOpen, setCustomOpen] = useState(false);
  const isCustom = customOpen || (!activePeriod && !!(dateFrom || dateTo));
  const setPeriod = (from: string, to: string) => { setCustomOpen(false); onChange({ dateFrom: from, dateTo: to }); };

  const periodText = activePeriod
    ? (activePeriod.key.length === 4 ? activePeriod.label
      : activePeriod.key === 'this-quarter' ? activePeriod.label
      : `${MONTHS[Number(activePeriod.from.slice(5, 7)) - 1]} ${activePeriod.from.slice(0, 4)}`)
    : dateFrom && dateTo ? `${formatDate(dateFrom)} – ${formatDate(dateTo)}`
    : dateFrom ? `From ${formatDate(dateFrom)}` : dateTo ? `Until ${formatDate(dateTo)}` : '';

  const chips: { key: string; label: ReactNode; remove: () => void }[] = [];
  if (periodText) chips.push({ key: 'period', label: <><Calendar size={11} /> {periodText}</>, remove: () => setPeriod('', '') });
  for (const s of value.suppliers) chips.push({ key: `s:${s}`, label: s, remove: () => onChange({ suppliers: value.suppliers.filter(x => x !== s) }) });
  for (const c of value.categories) chips.push({ key: `c:${c}`, label: c, remove: () => onChange({ categories: value.categories.filter(x => x !== c) }) });
  if (value.amountMin || value.amountMax) chips.push({ key: 'amount', label: amountLabel(value.amountMin, value.amountMax), remove: () => onChange({ amountMin: '', amountMax: '' }) });
  if (value.flagged) chips.push({ key: 'flagged', label: <><Flag size={11} /> Flagged</>, remove: () => onChange({ flagged: false }) });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
      {/* Period */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-gray-500 mr-1 w-14">Period</span>
        <Pill active={!dateFrom && !dateTo && !customOpen} onClick={() => setPeriod('', '')}>All</Pill>
        {yearPeriods.map(p => <Pill key={p.key} active={activePeriod?.key === p.key && !customOpen} onClick={() => setPeriod(p.from, p.to)}>{p.label}</Pill>)}
        <span className="w-px h-5 bg-gray-200 mx-1" />
        {quickPeriods().map(p => <Pill key={p.key} active={activePeriod?.key === p.key && !customOpen} onClick={() => setPeriod(p.from, p.to)}>{p.label}</Pill>)}
        <Pill active={isCustom} onClick={() => setCustomOpen(true)}>Custom…</Pill>
        {isCustom && (
          <span className="flex items-center gap-1.5 ml-1">
            <input type="date" value={dateFrom} onChange={e => onChange({ dateFrom: e.target.value })}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
            <span className="text-gray-400">–</span>
            <input type="date" value={dateTo} onChange={e => onChange({ dateTo: e.target.value })}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          </span>
        )}
      </div>

      {/* Supplier / category / amount / flagged */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 mr-1 w-14">Filter</span>
        <SearchableMultiSelect label="Suppliers" options={suppliers} selected={value.suppliers} counts={supplierCounts}
          onChange={v => onChange({ suppliers: v })} />
        <SearchableMultiSelect label="Categories" options={categories} selected={value.categories}
          onChange={v => onChange({ categories: v })} footer={categoryFooter} />
        <AmountFilter min={value.amountMin} max={value.amountMax} onChange={(amountMin, amountMax) => onChange({ amountMin, amountMax })} />
        <button onClick={() => onChange({ flagged: !value.flagged })} className={triggerCls(value.flagged)}>
          <Flag size={14} className={value.flagged ? 'fill-amber-500 text-amber-500' : 'text-gray-400'} />
          Flagged only
        </button>
      </div>

      {/* Active filters + result */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-gray-100">
        {chips.length === 0
          ? <span className="text-xs text-gray-400">No filters — showing every invoice</span>
          : chips.map(c => <Chip key={c.key} onRemove={c.remove}>{c.label}</Chip>)}
        {chips.length > 1 && (
          <button onClick={onClear} className="text-xs text-gray-500 hover:text-gray-700 ml-1">Clear all</button>
        )}
        <span className="ml-auto text-xs text-gray-600">
          <span className="font-semibold text-gray-900">{resultCount}</span> invoice{resultCount === 1 ? '' : 's'} · <span className="font-semibold text-gray-900">{fmtEur2(resultTotal)}</span> net
        </span>
      </div>
    </div>
  );
}
