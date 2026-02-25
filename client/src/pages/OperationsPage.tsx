import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import {
  Briefcase, Search, Plus, ChevronLeft, ChevronRight, FileText, Receipt,
  FileSpreadsheet, ChevronUp, ChevronDown, Eye, Download, X,
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
  doc_count: number;
  invoice_count: number;
  created_at: string;
}

interface PreviewItem {
  fileName: string;
  filePath: string;
  subfolder: string;
}

const STATUS_OPTIONS = ['pre-ordered', 'ordered', 'shipped', 'delivered'];

const STATUS_COLORS: Record<string, string> = {
  'pre-ordered': 'bg-purple-100 text-purple-800',
  ordered:       'bg-yellow-100 text-yellow-800',
  shipped:       'bg-blue-100   text-blue-800',
  delivered:     'bg-green-100  text-green-800',
};

type SortField = 'order_date' | 'status' | 'name';
type Tab = 'active' | 'completed';

export default function OperationsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>('active');
  const [operations, setOperations] = useState<Operation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('order_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  // Preview modal
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  const handleStatusChange = async (id: number, status: string) => {
    try {
      await api.patch(`/operations/${id}/status`, { status });
      // If the operation moved to/from 'delivered', refetch so it appears in the right tab
      const movedToCompleted = status === 'delivered' && activeTab === 'active';
      const movedToActive = status !== 'delivered' && activeTab === 'completed';
      if (movedToCompleted || movedToActive) {
        fetchOperations();
      } else {
        setOperations(prev => prev.map(op => op.id === id ? { ...op, status } : op));
      }
    } catch {
      addToast('Failed to update status', 'error');
    }
  };

  const fetchOperations = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20, sort_by: sortBy, sort_dir: sortDir, tab: activeTab };
      if (search) params.search = search;
      const { data } = await api.get('/operations', { params });
      setOperations(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      addToast('Failed to load operations', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, sortBy, sortDir, activeTab]);

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

  const thClass = (field: SortField) =>
    'text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Briefcase size={24} className="text-primary-600" />
            Operations
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} operation{total !== 1 ? 's' : ''}</p>
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
            onClick={async () => {
              const { data } = await api.get('/operations', { params: { page: 1, limit: 9999, search } });
              downloadExcel('operations',
                ['Operation #', 'Order #', 'Customer / Supplier', 'Status', 'Docs', 'Invoices', 'Order Date'],
                data.data.map((op: any) => [
                  op.operation_number, op.order_number || '',
                  op.customer_name || op.supplier_name || '',
                  op.status, op.doc_count, op.invoice_count,
                  formatDate(op.order_date || op.created_at) || '',
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
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Operation #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Order / Doc</th>
                <th
                  className={thClass('name')}
                  onClick={() => handleSort('name')}
                >
                  <span className="flex items-center gap-1">
                    Customer / Supplier <SortIcon field="name" />
                  </span>
                </th>
                <th
                  className={thClass('status')}
                  onClick={() => handleSort('status')}
                >
                  <span className="flex items-center gap-1">
                    Status <SortIcon field="status" />
                  </span>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Docs</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Invoices</th>
                <th
                  className={thClass('order_date')}
                  onClick={() => handleSort('order_date')}
                >
                  <span className="flex items-center gap-1">
                    Order Date <SortIcon field="order_date" />
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
                  <td className="px-4 py-3 text-gray-700" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {op.order_number && op.order_id ? (
                        <button
                          onClick={() => navigate(`/orders/${op.order_id}/edit`)}
                          className="font-medium text-primary-700 hover:underline"
                          title="Edit order"
                        >
                          {op.order_number}
                        </button>
                      ) : op.order_number ? (
                        <span className="font-medium">{op.order_number}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                      {op.order_file_path && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openPreview({ fileName: op.order_file_name!, filePath: op.order_file_path!, subfolder: 'orders' })}
                            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                            title="Preview order document"
                          >
                            <Eye size={13} />
                          </button>
                          <button
                            onClick={() => downloadFile(op.order_file_path!, op.order_file_name!, 'orders')}
                            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                            title="Download order document"
                          >
                            <Download size={13} />
                          </button>
                        </div>
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
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 text-gray-600">
                      <Receipt size={14} />
                      {op.invoice_count}
                      {op.invoice_count > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/operations/${op.id}`); }}
                          className="ml-1 p-0.5 text-gray-400 hover:text-primary-600"
                          title="View invoices"
                        >
                          <Eye size={13} />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate((op as any).order_date) || formatDate(op.created_at) || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
    </div>
  );
}
