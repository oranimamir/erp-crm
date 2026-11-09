import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown, FileArchive, Search, X } from 'lucide-react';
import MenuPanel from './ui/MenuPanel';
import OutstandingBadge from './OutstandingBadge';
import api from '../lib/api';
import Card from './ui/Card';
import Button from './ui/Button';
import { formatDate, todayISO } from '../lib/dates';
import { downloadExcel } from '../lib/exportExcel';
import { invoiceExportDetails, invoiceDetailCells, INVOICE_DETAIL_HEADERS, fmtDate } from '../lib/invoiceExport';

interface RegisterRow {
  id: number;
  invoice_number: string;
  invoice_date: string | null;
  created_at: string;
  status: string;
  customer_name: string | null;
  country: string | null;
  order_id: number | null;
  order_number: string | null;
  po_number: string | null;
  operation_id: number | null;
  operation_number: string | null;
  category: 'blending' | 'trading' | 'technology' | null;
  technology_operation_id?: number | null;
  amount: number | null;
  currency: string | null;
  fx_rate: number | null;
  eur_amount: number | null;
  quantity_mt: number | null;
  due_date: string | null;
  payment_date: string | null;
  has_file: number;
  wire_files: number;
  paid_amount: number | null;
  outstanding: number | null;
  entity: string;
}

/** What the list is narrowed to (kept for the browser session). */
interface Filters { search: string; from: string; to: string; client: string; country: string; category: string; status: string }
const NO_FILTERS: Filters = { search: '', from: '', to: '', client: '', country: '', category: '', status: '' };
const FILTERS_KEY = 'invoiceRegisterFilters';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', paid: 'Paid', paid_with_other: 'Paid with other invoice', overdue: 'Overdue', cancelled: 'Cancelled',
};

/** Invoice-date ranges one click away. */
function periods(): Array<[string, string, string]> {
  const today = todayISO();
  const [y, m] = today.split('-').map(Number);
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const lastDay = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return [
    ['This month', iso(y, m, 1), iso(y, m, lastDay(y, m))],
    ['Last month', iso(py, pm, 1), iso(py, pm, lastDay(py, pm))],
    ['This quarter', iso(y, q, 1), iso(y, q + 2, lastDay(y, q + 2))],
    ['This year', iso(y, 1, 1), iso(y, 12, 31)],
    ['Last year', iso(y - 1, 1, 1), iso(y - 1, 12, 31)],
  ];
}

type Entity = '' | 'BE' | 'NL';
type SortKey = 'invoice_number' | 'created_at' | 'invoice_date' | 'customer_name' | 'country' | 'order' | 'operation_number' | 'category';

const COLUMNS: Array<[SortKey, string]> = [
  ['invoice_number', 'Invoice #'], ['created_at', 'Created'], ['invoice_date', 'Invoice date'], ['customer_name', 'Client'],
  ['country', 'Country'], ['order', 'Order #'], ['operation_number', 'Operation #'], ['category', 'Category'],
];

const sortValue = (r: RegisterRow, key: SortKey): string =>
  key === 'order' ? (r.order_number || r.po_number || '') : String(r[key] ?? '');

const categoryLabel = (c: string | null) =>
  (c === 'blending' ? 'Blending' : c === 'trading' ? 'Trading' : c === 'technology' ? 'Technology' : '');

/**
 * Every customer invoice in invoice-number order, to check the numbering runs
 * right — per TripleW entity (read off the operation number).
 */
export default function InvoiceRegister() {
  const [entity, setEntity] = useState<Entity>(() => {
    try { return (localStorage.getItem('invoiceRegisterEntity') as Entity) || ''; } catch { return ''; }
  });
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Newest created first until a heading is clicked
  const [sortBy, setSortBy] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const sortOn = (key: SortKey) => {
    if (key === sortBy) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir(key === 'created_at' || key === 'invoice_date' ? 'desc' : 'asc'); }
  };
  const [filters, setFilters] = useState<Filters>(() => {
    try { return { ...NO_FILTERS, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '{}') }; } catch { return NO_FILTERS; }
  });
  const setFilter = (key: keyof Filters, value: string) => setFilters(f => ({ ...f, [key]: value }));
  useEffect(() => { try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* private mode */ } }, [filters]);
  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return rows.filter(r => {
      if (term && ![r.invoice_number, r.customer_name, r.country, r.order_number, r.po_number, r.operation_number]
        .some(v => String(v || '').toLowerCase().includes(term))) return false;
      const date = String(r.invoice_date || '').slice(0, 10);
      if (filters.from && (!date || date < filters.from)) return false;
      if (filters.to && (!date || date > filters.to)) return false;
      if (filters.client && (r.customer_name || '') !== filters.client) return false;
      if (filters.country && (r.country || '') !== filters.country) return false;
      if (filters.category && (filters.category === 'none' ? !!r.category : r.category !== filters.category)) return false;
      if (filters.status === 'outstanding' ? !r.outstanding : filters.status && r.status !== filters.status) return false;
      return true;
    });
  }, [rows, filters]);
  const options = (pick: (r: RegisterRow) => string | null) =>
    [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const activeFilters = (Object.keys(NO_FILTERS) as Array<keyof Filters>).filter(k => filters[k]).length;

  // Ticked rows; none ticked = everything shown
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => { setPicked(prev => new Set([...prev].filter(id => filtered.some(r => r.id === id)))); }, [filtered]);
  const togglePick = (id: number) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPicked = filtered.length > 0 && filtered.every(r => picked.has(r.id));

  const sorted = [...filtered].sort((a, b) => {
    const x = sortValue(a, sortBy), y = sortValue(b, sortBy);
    // Blanks always last, whichever way
    if (!x !== !y) return x ? -1 : 1;
    const c = x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
      || String(a.invoice_number).localeCompare(String(b.invoice_number), undefined, { numeric: true });
    return sortDir === 'asc' ? c : -c;
  });

  useEffect(() => {
    try { localStorage.setItem('invoiceRegisterEntity', entity); } catch { /* private mode */ }
    setLoading(true);
    api.get('/invoices/register', { params: { entity: entity || undefined } })
      .then(res => setRows(res.data.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [entity]);

  // What the buttons act on: the ticked rows, else every row shown
  const chosen = picked.size ? sorted.filter(r => picked.has(r.id)) : sorted;

  const [zipFolders, setZipFolders] = useState<'none' | 'client' | 'month' | 'operation'>('none');
  const [zipWires, setZipWires] = useState(false);
  const [zipping, setZipping] = useState(false);
  const withFile = chosen.filter(r => r.has_file).length;
  const wireCount = chosen.reduce((n, r) => n + (r.wire_files || 0), 0);
  const downloadZip = async () => {
    setZipping(true);
    try {
      const res = await api.post('/invoices/bulk-download',
        { ids: chosen.map(r => r.id), folders: zipFolders, include_wire_transfers: zipWires }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices${entity ? `-${entity}` : ''}-${todayISO()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      let msg = 'Could not build the ZIP — please try again';
      try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* keep the default */ }
      window.alert(msg);
    } finally {
      setZipping(false);
    }
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const details = await invoiceExportDetails(chosen.map(r => r.id));
      await downloadExcel(`invoice-list${entity ? `-${entity}` : ''}`,
        ['Invoice #', 'Created', 'Invoice date', 'Due date', 'Client', 'Country', 'Order #', 'Customer PO #', 'Operation #', 'Category',
          ...INVOICE_DETAIL_HEADERS, 'Status', 'Payment date'],
        chosen.map(r => {
          const d = details[r.id];
          return [
            r.invoice_number, fmtDate(r.created_at), fmtDate(r.invoice_date), fmtDate(r.due_date), r.customer_name || '', r.country || '',
            r.order_number || '', d?.po_number || r.po_number || '', r.operation_number || '', categoryLabel(r.category),
            ...invoiceDetailCells(r, d), r.status, fmtDate(r.payment_date),
          ];
        }));
    } catch {
      window.alert('Could not build the export — please try again');
    } finally {
      setExporting(false);
    }
  };

  const dash = <span className="text-gray-300">—</span>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {([['', 'All'], ['BE', 'BE'], ['NL', 'NL']] as const).map(([code, label]) => (
            <button
              key={label}
              onClick={() => setEntity(code)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                entity === code
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
          {!loading && (
            <span className="text-xs text-gray-500">
              {filtered.length === rows.length ? `${rows.length} invoices` : `${filtered.length} of ${rows.length} invoices`}
              {picked.size > 0 && <> · <strong className="text-gray-800">{picked.size} ticked</strong></>}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MenuPanel label={zipping ? 'Preparing ZIP…' : 'Download ZIP'} icon={zipping ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
            disabled={!chosen.length || zipping} width={340} align="right"
            title="Download the invoice files as one ZIP">
            {close => (
              <div className="p-4 space-y-3 text-sm">
                <div>
                  <p className="font-semibold text-gray-900">
                    {picked.size ? `${chosen.length} ticked invoice${chosen.length === 1 ? '' : 's'}` : `All ${chosen.length} invoice${chosen.length === 1 ? '' : 's'} shown`}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {withFile} with a PDF{withFile < chosen.length ? ` · ${chosen.length - withFile} without a file (left out)` : ''}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Folders in the ZIP</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([['none', 'All in one folder'], ['client', 'A folder per client'], ['month', 'A folder per month'], ['operation', 'A folder per operation']] as const).map(([key, label]) => (
                      <button key={key} type="button" onClick={() => setZipFolders(key)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs text-left ${zipFolders === key ? 'border-primary-500 bg-primary-50 text-primary-700 font-semibold' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={zipWires} onChange={e => setZipWires(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span>
                    <span className="block text-gray-800">Include the wire transfers</span>
                    <span className="block text-xs text-gray-500">{wireCount ? `${wireCount} payment file${wireCount === 1 ? '' : 's'}, next to their invoice` : 'None of these invoices has one'}</span>
                  </span>
                </label>
                <Button size="sm" className="w-full justify-center" disabled={!withFile && !(zipWires && wireCount)}
                  onClick={() => { close(); downloadZip(); }}>
                  <FileArchive size={14} /> Download {withFile + (zipWires ? wireCount : 0)} file{withFile + (zipWires ? wireCount : 0) === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </MenuPanel>
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={!chosen.length || exporting}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Export Excel{picked.size ? ` (${picked.size})` : ''}
          </Button>
        </div>
      </div>

      {/* Filters: what is shown is what the ZIP / Excel take (or only the ticked rows) */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={filters.search} onChange={e => setFilter('search', e.target.value)}
              placeholder="Search invoice, client, order, operation…"
              className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          {([
            ['client', 'All clients', options(r => r.customer_name).map(v => [v, v])],
            ['country', 'All countries', options(r => r.country).map(v => [v, v])],
            ['category', 'All categories', [['blending', 'Blending'], ['trading', 'Trading'], ['technology', 'Technology'], ['none', 'No category']]],
            ['status', 'All statuses', [...options(r => r.status).map(v => [v, STATUS_LABELS[v] || v]),
              ...(rows.some(r => r.outstanding) ? [['outstanding', 'Outstanding balance']] : [])]],
          ] as Array<[keyof Filters, string, string[][]]>).map(([key, all, list]) => (
            <select key={key} value={filters[key]} onChange={e => setFilter(key, e.target.value)}
              className={`rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 max-w-[200px] ${filters[key] ? 'border-primary-400 bg-primary-50 text-primary-800' : 'border-gray-300 bg-white text-gray-700'}`}>
              <option value="">{all}</option>
              {list.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Invoice date</span>
          <input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          {periods().map(([label, from, to]) => (
            <button key={label} type="button" onClick={() => setFilters(f => ({ ...f, from, to }))}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${filters.from === from && filters.to === to ? 'border-primary-500 bg-primary-50 text-primary-700 font-semibold' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
          {activeFilters > 0 && (
            <button type="button" onClick={() => setFilters(NO_FILTERS)}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800">
              <X size={12} /> Clear filters ({activeFilters})
            </button>
          )}
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No customer invoices{entity && ` for ${entity}`}.</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No invoice matches these filters. <button type="button" onClick={() => setFilters(NO_FILTERS)} className="text-primary-600 hover:underline">Clear filters</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="w-10 pl-4 py-3">
                    <input type="checkbox" checked={allPicked} aria-label="Tick every invoice shown"
                      ref={el => { if (el) el.indeterminate = picked.size > 0 && !allPicked; }}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(filtered.map(r => r.id)))}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  </th>
                  {COLUMNS.map(([key, label]) => (
                    <th key={key} className="px-4 py-3">
                      <button type="button" onClick={() => sortOn(key)}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-800 ${sortBy === key ? 'text-gray-900' : ''}`}>
                        {label}
                        {sortBy !== key ? <ChevronsUpDown size={12} className="text-gray-300" />
                          : sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(r => (
                  <tr key={r.id} className={`hover:bg-gray-50 ${picked.has(r.id) ? 'bg-primary-50/50' : ''} ${r.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>
                    <td className="w-10 pl-4 py-2.5">
                      <input type="checkbox" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} aria-label={`Tick ${r.invoice_number}`}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      <Link to={`/invoices/${r.id}`} className="text-primary-600 hover:underline">{r.invoice_number}</Link>
                      {r.outstanding ? <div className="mt-0.5"><OutstandingBadge outstanding={r.outstanding} currency={r.currency} /></div> : null}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{formatDate(r.created_at) || dash}</td>
                    <td className="px-4 py-2.5 text-gray-600">{formatDate(r.invoice_date || '') || dash}</td>
                    <td className="px-4 py-2.5 text-gray-900">{r.customer_name || dash}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.country || dash}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {r.order_number && r.order_id
                        ? <Link to={`/orders/${r.order_id}`} className="hover:underline">{r.order_number}</Link>
                        : r.po_number || dash}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {r.operation_number && r.operation_id
                        ? <Link to={`/operations/${r.operation_id}`} className="hover:underline">{r.operation_number}</Link>
                        : r.operation_number && r.technology_operation_id
                          ? <Link to={`/technology-operations/${r.technology_operation_id}`} className="hover:underline">{r.operation_number}</Link>
                          : dash}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.category ? (
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.category === 'blending' ? 'bg-purple-50 text-purple-700'
                            : r.category === 'technology' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'
                        }`}>{categoryLabel(r.category)}</span>
                      ) : dash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
