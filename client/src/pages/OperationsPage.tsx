import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { Briefcase, Search, Plus, ChevronLeft, ChevronRight, FileText, Receipt } from 'lucide-react';

interface Operation {
  id: number;
  operation_number: string;
  order_number?: string;
  order_type?: string;
  customer_name?: string;
  supplier_name?: string;
  status: string;
  doc_count: number;
  invoice_count: number;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
  on_hold: 'bg-yellow-100 text-yellow-800',
};

export default function OperationsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [operations, setOperations] = useState<Operation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchOperations = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20 };
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
  }, [page, search, addToast]);

  useEffect(() => { fetchOperations(); }, [fetchOperations]);

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
        <div className="sm:ml-auto flex gap-2">
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
            onClick={() => navigate('/orders/new')}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
          >
            <Plus size={16} />
            New Order
          </button>
        </div>
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
            <p className="text-sm mt-1">Operations are created automatically when you save an order with an Operation #.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Operation #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Order</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Customer / Supplier</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Docs</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Invoices</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
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
                  <td className="px-4 py-3 text-gray-700">
                    {op.order_number ? (
                      <span className="font-medium">{op.order_number}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {op.customer_name || op.supplier_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[op.status] || 'bg-gray-100 text-gray-700'}`}>
                      {op.status.replace('_', ' ')}
                    </span>
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
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(op.created_at).toLocaleDateString()}
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
    </div>
  );
}
