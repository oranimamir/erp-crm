import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import {
  Briefcase, Search, Plus, ChevronLeft, ChevronRight, FileText, Receipt,
  FileSpreadsheet, ChevronUp, ChevronDown, Download, X, Truck, Loader2, ArrowLeftRight, Landmark, Filter, XCircle,
} from 'lucide-react';
import { formatDate } from '../lib/dates';
import { downloadExcel } from '../lib/exportExcel';

interface Operation {
  id: number;
  operation_number: string;
  order_id?: number;
  order_number?: string;
  order_type?: string;
  order_date?: string;
  order_file_path?: string;
  order_file_name?: string;
  customer_name?: string;
  supplier_name?: string;
  status: string;
  ship_date?: string;
  doc_count: number;
  invoice_count: number;
  invoice_total: number;
  quantity_mt: number;
  quantity_raw: number;
  quantity_unit?: string;
  invoice_amount_raw: number;
  invoice_currency?: string;
  wire_transfer_count: number;
  order_total_eur: number;
  invoice_date?: string;
  wire_transfer_date?: string;
  created_at: string;
}

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
function todayISO() { return new Date().toISOString().split('T')[0]; }

interface PreviewItem {
  fileName: string;
  filePath: string;
  subfolder: string;
}

const STATUS_OPTIONS = ['pre-ordered', 'ordered', 'shipped', 'in clearance', 'delivered', 'completed'];

const STATUS_COLORS: Record<string, string> = {
  'pre-ordered':   'bg-purple-100 text-purple-800',
  ordered:         'bg-yellow-100 text-yellow-800',
  shipped:         'bg-blue-100   text-blue-800',
  'in clearance':  'bg-orange-100 text-orange-800',
  delivered:       'bg-green-100  text-green-800',
  completed:       'bg-emerald-100 text-emerald-800',
};

type SortField = 'order_date' | 'invoice_date' | 'wire_transfer_date' | 'status' | 'name';
type DateFilterField = 'order_date' | 'invoice_date' | 'wire_transfer_date';
type Tab = 'active' | 'completed';

export default function OperationsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>('active');
  const [operations, setOperations] = useState<Operation[]>([]);
  const [total, setTotal] = useState(0);
  const [tabTotals, setTabTotals] = useState<{ quantity_mt: number; invoice_eur: number; order_eur: number } | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('order_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateField, setFilterDateField] = useState<DateFilterField>('order_date');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const hasActiveFilters = !!(filterCustomer || filterStatus || filterDateFrom || filterDateTo);

  const clearFilters = () => {
    setFilterCustomer('');
    setFilterStatus('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPage(1);
  };

  // Preview modal
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // View toggle: false = MT + EUR (default), true = raw original values
  const [showRaw, setShowRaw] = useState(false);

  // Order preview loading
  const [loadingOrders, setLoadingOrders] = useState<Set<number>>(new Set());
  // Invoice preview loading
  const [loadingInvoices, setLoadingInvoices] = useState<Set<number>>(new Set());
  const [loadingWireTransfers, setLoadingWireTransfers] = useState<Set<number>>(new Set());

  const previewOrder = (op: Operation) => {
    if (!op.order_file_path) return;
    if (loadingOrders.has(op.id)) return;
    openPreview({ fileName: op.order_file_name!, filePath: op.order_file_path!, subfolder: 'orders' });
  };

  const previewInvoice = async (opId: number) => {
    if (loadingInvoices.has(opId)) return;
    setLoadingInvoices(prev => new Set(prev).add(opId));
    try {
      const { data } = await api.get(`/operations/${opId}`);
      const inv = (data.invoices || []).find((i: any) => i.file_path);
      if (inv) {
        openPreview({ fileName: inv.file_name, filePath: inv.file_path, subfolder: 'invoices' });
      } else if (data.invoices?.[0]) {
        navigate(`/invoices/${data.invoices[0].id}`);
      }
    } catch {
      addToast('Failed to load invoice', 'error');
    } finally {
      setLoadingInvoices(prev => { const s = new Set(prev); s.delete(opId); return s; });
    }
  };

  const previewWireTransfer = async (opId: number) => {
    if (loadingWireTransfers.has(opId)) return;
    setLoadingWireTransfers(prev => new Set(prev).add(opId));
    try {
      const { data } = await api.get(`/operations/${opId}`);
      const wt = (data.wire_transfers || []).find((w: any) => w.file_path);
      if (wt) {
        openPreview({ fileName: wt.file_name, filePath: wt.file_path, subfolder: 'wire-transfers' });
      } else if (data.invoices?.[0]) {
        navigate(`/invoices/${data.invoices[0].id}`);
      }
    } catch {
      addToast('Failed to load wire transfer', 'error');
    } finally {
      setLoadingWireTransfers(prev => { const s = new Set(prev); s.delete(opId); return s; });
    }
  };

  // Ship modal
  const [shipTarget, setShipTarget] = useState<Operation | null>(null);
  const [shipDate, setShipDate] = useState('');
  const [payDays, setPayDays] = useState(45);
  const [dueDate, setDueDate] = useState('');
  const [savingShip, setSavingShip] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <ChevronDown size={12} className="text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-primary-600" />
      : <ChevronDown size={12} className="text-primary-600" />;
  };

  const handleStatusChange = (id: number, newStatus: string) => {
    if (newStatus === 'shipped') {
      const op = operations.find(o => o.id === id) || null;
      const defaultDate = op?.ship_date || todayISO();
      setShipTarget(op);
      setShipDate(defaultDate);
      setPayDays(45);
      setDueDate(addDays(defaultDate, 45));
      return;
    }
    applyStatus(id, newStatus);
  };

  const applyStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/operations/${id}/status`, { status });
      const movedToCompleted = status === 'completed' && activeTab === 'active';
      const movedToActive = status !== 'completed' && activeTab === 'completed';
      if (movedToCompleted || movedToActive) {
        fetchOperations();
      } else {
        setOperations(prev => prev.map(op => op.id === id ? { ...op, status } : op));
      }
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update status', 'error');
    }
  };

  const handleConfirmShip = async () => {
    if (!shipTarget || !shipDate || !dueDate) return;
    setSavingShip(true);
    try {
      await api.post(`/operations/${shipTarget.id}/ship`, { ship_date: shipDate, due_date: dueDate });
      setOperations(prev => prev.map(op => op.id === shipTarget.id ? { ...op, status: 'shipped', ship_date: shipDate } : op));
      setShipTarget(null);
      addToast('Operation marked as shipped — invoices updated', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to mark as shipped', 'error');
    } finally {
      setSavingShip(false);
    }
  };

  const fetchOperations = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20, sort_by: sortBy, sort_dir: sortDir, tab: activeTab };
      if (search) params.search = search;
      if (filterCustomer) params.customer = filterCustomer;
      if (filterStatus) params.status = filterStatus;
      if (filterDateFrom || filterDateTo) {
        params.date_field = filterDateField;
        if (filterDateFrom) params.date_from = filterDateFrom;
        if (filterDateTo) params.date_to = filterDateTo;
      }
      const { data } = await api.get('/operations', { params });
      setOperations(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setTabTotals(data.totals ?? null);
    } catch {
      addToast('Failed to load operations', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, sortBy, sortDir, activeTab, filterCustomer, filterStatus, filterDateField, filterDateFrom, filterDateTo]);

  useEffect(() => { setPage(1); }, [activeTab]);
  useEffect(() => { fetchOperations(); }, [fetchOperations]);

  // Preview
  async function openPreview(item: PreviewItem) {
    setPreviewItem(item);
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const resp = await api.get(`/files/${item.subfolder}/${item.filePath}`, { responseType: 'blob' });
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

  async function downloadFile(filePath: string, fileName: string, subfolder: string) {
    try {
      const resp = await api.get(`/files/${subfolder}/${filePath}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  function isImage(filename: string) {
    return /\.(jpg|jpeg|png|webp)$/i.test(filename);
  }

  const thSortable = 'text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Briefcase size={22} className="text-primary-600" />
            Operations
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{total} operation{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="sm:ml-auto flex gap-2 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Search operations..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${showFilters || hasActiveFilters ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            title="Toggle filters"
          >
            <Filter size={15} />
            Filters
            {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-primary-500" />}
          </button>
          <button
            onClick={() => setShowRaw(r => !r)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${showRaw ? 'border-indigo-400 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            title={showRaw ? 'Switch to MT / EUR view' : 'Switch to original units / currency'}
          >
            <ArrowLeftRight size={15} />
            {showRaw ? 'Original' : 'MT / EUR'}
          </button>
          <button
            onClick={async () => {
              const { data } = await api.get('/operations', { params: { page: 1, limit: 9999, search } });
              downloadExcel('operations',
                ['Operation #', 'Order #', 'Customer / Supplier', 'Status', 'Docs', 'Invoices', 'Quantity (MT)', 'Invoice Total (EUR)', 'Order Date', 'Invoice Date', 'Wire Transfer Date'],
                data.data.map((op: any) => [
                  op.operation_number, op.order_number || '',
                  op.customer_name || op.supplier_name || '',
                  op.status, op.doc_count, op.invoice_count,
                  op.quantity_mt > 0 ? Number(op.quantity_mt).toFixed(2) : '',
                  op.invoice_total > 0 ? Number(op.invoice_total).toFixed(2) : '',
                  formatDate(op.order_date || op.created_at) || '',
                  formatDate(op.invoice_date) || '',
                  formatDate(op.wire_transfer_date) || '',
                ]));
            }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <FileSpreadsheet size={16} />
            Export Excel
          </button>
          {activeTab === 'active' && (
            <>
              <button
                onClick={() => navigate('/operations/new')}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                <Plus size={16} />
                New Operation
              </button>
              <button
                onClick={() => navigate('/orders/new')}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
              >
                <Plus size={16} />
                New Order
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Client Name</label>
            <input
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-44"
              placeholder="Search client..."
              value={filterCustomer}
              onChange={e => { setFilterCustomer(e.target.value); setPage(1); }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Status</label>
            <select
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-40"
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Date Field</label>
            <select
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-40"
              value={filterDateField}
              onChange={e => setFilterDateField(e.target.value as DateFilterField)}
            >
              <option value="order_date">Order Date</option>
              <option value="invoice_date">Invoice Date</option>
              <option value="wire_transfer_date">Wire Transfer Date</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input
              type="date"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={filterDateFrom}
              onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input
              type="date"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={filterDateTo}
              onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
            />
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <XCircle size={14} />
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['active', 'completed'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab === 'active' ? 'Active Operations' : 'Completed'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : operations.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Briefcase size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No operations yet</p>
            <p className="text-sm mt-1">Create a new operation, or save an order with an Operation # to auto-create one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Operation #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Preview</th>
                <th
                  className={thSortable}
                  onClick={() => handleSort('name')}
                >
                  <span className="flex items-center gap-1">
                    Customer / Supplier <SortIcon field="name" />
                  </span>
                </th>
                <th
                  className={thSortable}
                  onClick={() => handleSort('status')}
                >
                  <span className="flex items-center gap-1">
                    Status <SortIcon field="status" />
                  </span>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Docs</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">{showRaw ? 'Quantity' : 'Quantity (MT)'}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">{showRaw ? 'Invoice Total' : 'Invoice Total (EUR)'}</th>
                <th
                  className={thSortable}
                  onClick={() => handleSort('order_date')}
                >
                  <span className="flex items-center gap-1">
                    Dates <SortIcon field="order_date" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {operations.map(op => (
                <tr
                  key={op.id}
                  onClick={() => navigate(`/operations/${op.id}`)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-semibold text-primary-700">{op.operation_number}</span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {/* Order preview */}
                      {op.order_file_path ? (
                        <button
                          onClick={() => previewOrder(op)}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-blue-600"
                          title={`Preview order${op.order_number ? ` ${op.order_number}` : ''}`}
                        >
                          {loadingOrders.has(op.id)
                            ? <Loader2 size={14} className="animate-spin" />
                            : <FileSpreadsheet size={14} />}
                        </button>
                      ) : op.order_id ? (
                        <button
                          onClick={() => navigate(`/orders/${op.order_id}/edit`)}
                          className="p-1 rounded hover:bg-gray-200 text-gray-300 hover:text-blue-600"
                          title={`Edit order${op.order_number ? ` ${op.order_number}` : ''}`}
                        >
                          <FileSpreadsheet size={14} />
                        </button>
                      ) : null}
                      {/* Invoice preview */}
                      {op.invoice_count > 0 && (
                        <button
                          onClick={() => previewInvoice(op.id)}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-green-600"
                          title="Preview invoice"
                        >
                          {loadingInvoices.has(op.id)
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Receipt size={14} />}
                        </button>
                      )}
                      {/* Wire transfer preview */}
                      {op.wire_transfer_count > 0 && (
                        <button
                          onClick={() => previewWireTransfer(op.id)}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-indigo-600"
                          title="Preview wire transfer"
                        >
                          {loadingWireTransfers.has(op.id)
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Landmark size={14} />}
                        </button>
                      )}
                      {!op.order_file_path && !op.order_id && op.invoice_count === 0 && op.wire_transfer_count === 0 && (
                        <span className="text-gray-300">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {op.customer_name || op.supplier_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <select
                      value={op.status}
                      onChange={e => handleStatusChange(op.id, e.target.value)}
                      className={`text-xs rounded-full px-2 py-0.5 font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500 ${STATUS_COLORS[op.status] || 'bg-gray-100 text-gray-700'}`}
                    >
                      {STATUS_OPTIONS.map(s => (
                        <option key={s} value={s} className="bg-white text-gray-900">
                          {s.charAt(0).toUpperCase() + s.slice(1).replace('-', '-')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 text-gray-600">
                      <FileText size={14} />
                      {op.doc_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {showRaw
                      ? (op.quantity_raw > 0 && op.quantity_unit
                          ? <span className="font-medium text-gray-900">{Number(op.quantity_raw).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {op.quantity_unit}</span>
                          : <span className="text-gray-400">—</span>)
                      : (op.quantity_mt > 0
                          ? <span className="font-medium text-gray-900">{op.quantity_mt >= 1000 ? `${(op.quantity_mt / 1000).toFixed(2)}k` : op.quantity_mt.toFixed(2)} MT</span>
                          : <span className="text-gray-400">—</span>)
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    {showRaw
                      ? (op.invoice_count > 0 && op.invoice_amount_raw > 0
                          ? <span className="font-medium text-gray-900">{op.invoice_currency || ''} {Number(op.invoice_amount_raw).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          : <span className="text-gray-400">—</span>)
                      : (op.invoice_count > 0 && op.invoice_total > 0
                          ? <span className="font-medium text-gray-900">{Number(op.invoice_total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          : op.order_total_eur > 0
                            ? <span className="font-medium text-amber-600 italic" title="Based on order (no invoice)">{Number(op.order_total_eur).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            : <span className="text-gray-400">—</span>)
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="leading-tight">
                      <div className="text-gray-700">{formatDate(op.order_date) || formatDate(op.created_at) || '—'}</div>
                      {op.invoice_date && (
                        <div className="text-[11px] text-gray-400 mt-0.5">Inv: {formatDate(op.invoice_date)}</div>
                      )}
                      {op.wire_transfer_date && (
                        <div className="text-[11px] text-gray-400">WT: {formatDate(op.wire_transfer_date)}</div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Totals summary */}
      {tabTotals && (tabTotals.quantity_mt > 0 || tabTotals.invoice_eur > 0 || tabTotals.order_eur > 0) && (
        <div className="flex items-center justify-end gap-6 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm">
          <span className="text-gray-500 font-medium mr-auto">
            {activeTab === 'active' ? 'Active operations total' : 'Completed operations total'} ({total})
          </span>
          {tabTotals.quantity_mt > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Total MT:</span>
              <span className="font-bold text-indigo-700">
                {tabTotals.quantity_mt >= 1000
                  ? `${(tabTotals.quantity_mt / 1000).toFixed(2)}k MT`
                  : `${tabTotals.quantity_mt.toFixed(2)} MT`}
              </span>
            </div>
          )}
          {tabTotals.invoice_eur > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Invoiced:</span>
              <span className="font-bold text-green-700">
                {tabTotals.invoice_eur.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {tabTotals.order_eur > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Expected (order):</span>
              <span className="font-bold text-amber-600">
                {tabTotals.order_eur.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={closePreview}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <p className="font-medium text-gray-900 truncate">{previewItem.fileName}</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => downloadFile(previewItem.filePath, previewItem.fileName, previewItem.subfolder)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <Download size={14} /> Download
                </button>
                <button onClick={closePreview} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto min-h-0 bg-gray-100 flex items-center justify-center p-4">
              {previewLoading ? (
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
              ) : previewUrl ? (
                isImage(previewItem.fileName) ? (
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

      {/* ── Ship Modal ─────────────────────────────────────────────────────── */}
      {shipTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !savingShip && setShipTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Truck size={17} className="text-blue-500" />
                Mark as Shipped — {shipTarget.operation_number}
              </h3>
              <button onClick={() => !savingShip && setShipTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shipment Date</label>
                <input
                  type="date"
                  value={shipDate}
                  onChange={e => { setShipDate(e.target.value); setDueDate(addDays(e.target.value, payDays)); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={payDays}
                    onChange={e => { const d = Math.max(1, parseInt(e.target.value) || 1); setPayDays(d); setDueDate(addDays(shipDate, d)); }}
                    className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-500">days after shipment</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invoice Due Date
                  <span className="text-xs text-gray-400 font-normal ml-1.5">shipment + {payDays} days · editable</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShipTarget(null)}
                disabled={savingShip}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmShip}
                disabled={savingShip || !shipDate || !dueDate}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
              >
                {savingShip ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />}
                {savingShip ? 'Saving...' : 'Confirm Shipment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
