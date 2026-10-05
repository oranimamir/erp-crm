import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import api from '../lib/api';
import Card from './ui/Card';
import Button from './ui/Button';
import { formatDate } from '../lib/dates';
import { downloadExcel } from '../lib/exportExcel';

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
  category: 'blending' | 'trading' | null;
  entity: string;
}

type Entity = '' | 'BE' | 'NL';
type SortKey = 'invoice_number' | 'created_at' | 'invoice_date' | 'customer_name' | 'country' | 'order' | 'operation_number' | 'category';

const COLUMNS: Array<[SortKey, string]> = [
  ['invoice_number', 'Invoice #'], ['created_at', 'Created'], ['invoice_date', 'Invoice date'], ['customer_name', 'Client'],
  ['country', 'Country'], ['order', 'Order #'], ['operation_number', 'Operation #'], ['category', 'Blending / Trading'],
];

const sortValue = (r: RegisterRow, key: SortKey): string =>
  key === 'order' ? (r.order_number || r.po_number || '') : String(r[key] ?? '');

const categoryLabel = (c: string | null) => (c === 'blending' ? 'Blending' : c === 'trading' ? 'Trading' : '');

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
  const sorted = [...rows].sort((a, b) => {
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

  const handleExport = () => {
    downloadExcel(`invoice-list${entity ? `-${entity}` : ''}`,
      ['Invoice #', 'Created', 'Invoice date', 'Client', 'Country', 'Order #', 'Operation #', 'Category'],
      sorted.map(r => [
        r.invoice_number, formatDate(r.created_at) || '', formatDate(r.invoice_date || '') || '', r.customer_name || '', r.country || '',
        r.order_number || r.po_number || '', r.operation_number || '', categoryLabel(r.category),
      ]));
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
          {!loading && <span className="text-xs text-gray-500">{rows.length} invoices</span>}
        </div>
        <Button variant="secondary" size="sm" onClick={handleExport} disabled={!rows.length}>
          <FileSpreadsheet size={14} /> Export Excel
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No customer invoices{entity && ` for ${entity}`}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                  <tr key={r.id} className={`hover:bg-gray-50 ${r.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>
                    <td className="px-4 py-2.5 font-medium">
                      <Link to={`/invoices/${r.id}`} className="text-primary-600 hover:underline">{r.invoice_number}</Link>
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
                        : dash}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.category ? (
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.category === 'blending' ? 'bg-purple-50 text-purple-700' : 'bg-sky-50 text-sky-700'
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
