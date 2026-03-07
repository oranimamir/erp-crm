import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import StatusBadge from '../components/ui/StatusBadge';
import SearchBar from '../components/ui/SearchBar';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Plus, FileText, Eye, Trash2, FileDown, ChevronUp, ChevronDown, FileSpreadsheet, Landmark, Download, X, Loader2 } from 'lucide-react';
import { formatDate } from '../lib/dates';
import { downloadExcel } from '../lib/exportExcel';

const statusBadgeClasses: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-700 border-gray-200',
  sent:      'bg-blue-100 text-blue-700 border-blue-200',
  paid:      'bg-green-100 text-green-700 border-green-200',
  overdue:   'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

const typeOptions = [
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
];

const typeColors: Record<string, 'blue' | 'purple'> = {
  customer: 'blue',
  supplier: 'purple',
};

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function InvoicesPage() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [yearFilter,  setYearFilter]  = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [wireFilter,  setWireFilter]  = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Preview modal
  const [previewItem, setPreviewItem] = useState<{ fileName: string; filePath: string; subfolder: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadingWirePreview, setLoadingWirePreview] = useState<Set<number>>(new Set());

  async function openPreview(fileName: string, filePath: string, subfolder: string) {
    setPreviewItem({ fileName, filePath, subfolder });
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const resp = await api.get(`/files/${subfolder}/${filePath}`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] || 'application/octet-stream' });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      addToast('Failed to load preview', 'error');
      setPreviewItem(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewItem(null);
    setPreviewUrl(null);
  }

  async function previewWire(invId: number) {
    if (loadingWirePreview.has(invId)) return;
    setLoadingWirePreview(prev => new Set(prev).add(invId));
    try {
      const { data } = await api.get(`/invoices/${invId}/wire-transfers`);
      const wt = data.find((w: any) => w.file_path);
      if (wt) {
        openPreview(wt.file_name || wt.file_path, wt.file_path, 'wire-transfers');
      } else {
        navigate(`/invoices/${invId}`);
      }
    } catch {
      addToast('Failed to load wire transfer', 'error');
    } finally {
      setLoadingWirePreview(prev => { const s = new Set(prev); s.delete(invId); return s; });
    }
  }

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <ChevronDown size={12} className="opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-primary-600" /> : <ChevronDown size={12} className="text-primary-600" />;
  };

  const fetchInvoices = () => {
    setLoading(true);
    api.get('/invoices', {
      params: {
        page,
        limit: 20,
        search,
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        year:  yearFilter  || undefined,
        month: monthFilter || undefined,
        wire:  wireFilter  || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
      },
    })
      .then(res => {
        setInvoices(res.data.data);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchInvoices(); }, [page, search, statusFilter, typeFilter, yearFilter, monthFilter, wireFilter, sortBy, sortDir]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/invoices/${deleteId}`);
      addToast('Invoice deleted', 'success');
      fetchInvoices();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete invoice', 'error');
    }
    setDeleteId(null);
  };

  const handleStatusChange = async (invoiceId: number, newStatus: string) => {
    try {
      await api.patch(`/invoices/${invoiceId}/status`, { status: newStatus });
      setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, status: newStatus } : inv));
      addToast('Status updated', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update status', 'error');
    }
  };

  const formatDateOrDash = (dateStr: string) => formatDate(dateStr) || '-';

  const handleExport = async () => {
    const res = await api.get('/invoices', { params: { page: 1, limit: 9999, search, status: statusFilter || undefined, type: typeFilter || undefined, year: yearFilter || undefined, month: monthFilter || undefined } });
    const rows = res.data.data.map((inv: any) => [
      inv.invoice_number,
      inv.customer_name || inv.supplier_name || '',
      inv.type,
      inv.amount,
      inv.currency,
      inv.eur_amount ?? '',
      inv.status,
      formatDateOrDash(inv.invoice_date),
      formatDateOrDash(inv.due_date),
    ]);
    downloadExcel('invoices', ['Invoice #', 'Customer / Supplier', 'Type', 'Amount', 'Currency', 'EUR Amount', 'Status', 'Invoice Date', 'Due Date'], rows);
  };

  const formatAmount = (amount: number, currency?: string) => {
    if (amount == null) return '-';
    const symbol = currency === 'EUR' ? '\u20AC' : currency === 'GBP' ? '\u00A3' : '$';
    return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}><FileSpreadsheet size={16} /> Export Excel</Button>
          <Link to="/invoices/generate">
            <Button variant="secondary"><FileDown size={16} /> Generate PDF</Button>
          </Link>
          <Link to="/invoices/new">
            <Button><Plus size={16} /> New Invoice</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search invoices..." />
            </div>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              {typeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={yearFilter}
              onChange={e => { setYearFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Years</option>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select
              value={monthFilter}
              onChange={e => { setMonthFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Months</option>
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select
              value={wireFilter}
              onChange={e => { setWireFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All (Wire)</option>
              <option value="yes">Wire Transfer: Yes</option>
              <option value="no">Wire Transfer: No</option>
            </select>
            <span className="text-sm text-gray-500">{total} invoices</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<FileText size={24} />}
            title="No invoices found"
            description="Get started by creating your first invoice."
            action={<Link to="/invoices/new"><Button size="sm"><Plus size={14} /> New Invoice</Button></Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Invoice #</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => handleSort('name')}
                  >
                    <span className="flex items-center gap-1">Customer / Supplier <SortIcon field="name" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th
                    className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => handleSort('amount')}
                  >
                    <span className="flex items-center justify-end gap-1">Amount <SortIcon field="amount" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Wire</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => handleSort('date')}
                  >
                    <span className="flex items-center gap-1">Date <SortIcon field="date" /></span>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-1.5">
                        {inv.invoice_number}
                        {inv.file_path && (
                          <button
                            onClick={e => { e.stopPropagation(); openPreview(inv.file_name || inv.file_path, inv.file_path, 'invoices'); }}
                            className="p-0.5 text-gray-400 hover:text-primary-600 rounded"
                            title="Preview invoice file"
                          >
                            <Eye size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(inv.customer_id || inv.supplier_id) ? (
                        <Link
                          to={inv.type === 'customer' ? `/customers/${inv.customer_id}` : `/suppliers/${inv.supplier_id}`}
                          className="text-primary-600 hover:text-primary-700 hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          {inv.customer_name || inv.supplier_name}
                        </Link>
                      ) : (
                        inv.customer_name || inv.supplier_name || '-'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={typeColors[inv.type] || 'gray'}>
                        {inv.type === 'customer' ? 'Customer' : 'Supplier'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {formatAmount(inv.amount, inv.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={inv.status}
                        onChange={e => handleStatusChange(inv.id, e.target.value)}
                        className={`text-xs rounded-full px-2 py-0.5 font-medium border cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500 ${statusBadgeClasses[inv.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}
                      >
                        {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      {inv.wire_transfer_count > 0 ? (
                        <div className="flex items-center gap-1 text-indigo-600">
                          <Landmark size={14} />
                          <span className="text-xs font-medium">{inv.wire_transfer_count}</span>
                          <button
                            onClick={() => previewWire(inv.id)}
                            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600"
                            title="Preview wire transfer"
                          >
                            {loadingWirePreview.has(inv.id)
                              ? <Loader2 size={13} className="animate-spin" />
                              : <Eye size={13} />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDateOrDash(inv.invoice_date || inv.due_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/invoices/${inv.id}`} className="p-1.5 text-gray-400 hover:text-primary-600 rounded"><Eye size={16} /></Link>
                        <button onClick={() => setDeleteId(inv.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Invoice"
        message="Are you sure you want to delete this invoice? This action cannot be undone."
        confirmLabel="Delete"
      />

      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closePreview}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <p className="font-medium text-gray-900 truncate">{previewItem.fileName}</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                {previewUrl && (
                  <a href={previewUrl} download={previewItem.fileName} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                    <Download size={14} /> Download
                  </a>
                )}
                <button onClick={closePreview} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto min-h-0 bg-gray-100 flex items-center justify-center p-4">
              {previewLoading ? (
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
              ) : previewUrl ? (
                /\.(jpg|jpeg|png|webp)$/i.test(previewItem.fileName) ? (
                  <img src={previewUrl} alt={previewItem.fileName} className="max-w-full max-h-full object-contain rounded-lg shadow" />
                ) : (
                  <iframe src={previewUrl} title={previewItem.fileName} className="w-full rounded-lg shadow bg-white" style={{ height: '70vh' }} />
                )
              ) : (
                <p className="text-gray-500">Unable to preview this file.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
