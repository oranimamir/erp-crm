import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Briefcase, ShoppingCart, FileText, Upload, Trash2,
  Download, Eye, X, Plus, Receipt, ExternalLink, CheckCircle,
  AlertCircle, Loader2
} from 'lucide-react';
import { formatDate } from '../lib/dates';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category { id: number; name: string; }

interface OperationDoc {
  id: number;
  file_path: string;
  file_name: string;
  category_id: number | null;
  category_name: string | null;
  notes: string | null;
  created_at: string;
}

interface Invoice {
  id: number;
  invoice_number: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  file_path: string | null;
  file_name: string | null;
  customer_name?: string;
  supplier_name?: string;
}

interface OrderItem {
  id: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  currency: string;
  total: number;
}

interface Operation {
  id: number;
  operation_number: string;
  order_id: number | null;
  order_number?: string;
  order_type?: string;
  order_status?: string;
  order_total?: number;
  order_date?: string;
  inco_terms?: string;
  destination?: string;
  transport?: string;
  delivery_date?: string;
  payment_terms?: string;
  order_description?: string;
  order_file_path?: string;
  order_file_name?: string;
  customer_name?: string;
  supplier_name?: string;
  status: string;
  notes?: string;
  created_at: string;
  documents: OperationDoc[];
  invoices: Invoice[];
  order_items: OrderItem[];
}

// Generic preview target — works for all file sources
interface PreviewItem {
  fileName: string;
  filePath: string;
  subfolder: string;
  label?: string;
}

// A file waiting to be uploaded (multi-file queue)
interface PendingUpload {
  id: string;           // local unique id
  file: File;
  categoryId: string;
  notes: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;     // 0-100
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['active', 'completed', 'on_hold', 'cancelled'];
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
  on_hold: 'bg-yellow-100 text-yellow-800',
};
const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-500',
};
const ACCEPTED_EXTS = '.pdf,.jpg,.jpeg,.png,.webp';
const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = 'USD') {
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${sym}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isImage(filename: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(filename);
}

function uid() {
  return Math.random().toString(36).slice(2);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const [operation, setOperation] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);

  // Multi-file upload queue
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingAll, setUploadingAll] = useState(false);

  // Add-category inline
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [showAddCat, setShowAddCat] = useState(false);

  // Generic preview
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Status
  const [savingStatus, setSavingStatus] = useState(false);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchOperation = useCallback(async () => {
    try {
      const { data } = await api.get(`/operations/${id}`);
      setOperation(data);
    } catch {
      addToast('Operation not found', 'error');
      navigate('/operations');
    } finally {
      setLoading(false);
    }
  }, [id]);

  async function fetchCategories() {
    try {
      const { data } = await api.get('/operations/categories');
      setCategories(data);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchOperation();
    fetchCategories();
  }, [id]);

  // ── Preview ─────────────────────────────────────────────────────────────────

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

  // ── Download ────────────────────────────────────────────────────────────────

  async function downloadFile(filePath: string, fileName: string, subfolder = 'operation-docs') {
    try {
      const resp = await api.get(`/files/${subfolder}/${filePath}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  // ── Drag-and-drop ───────────────────────────────────────────────────────────

  function addFilesToQueue(files: FileList | File[]) {
    const arr = Array.from(files);
    const valid = arr.filter(f => ACCEPTED_MIME.includes(f.type) || ACCEPTED_EXTS.split(',').some(ext => f.name.toLowerCase().endsWith(ext.replace('.', '.'))));
    const invalid = arr.length - valid.length;
    if (invalid > 0) addToast(`${invalid} file(s) skipped — only PDF, JPEG, PNG, WebP allowed`, 'error');
    if (valid.length === 0) return;
    setPendingUploads(prev => [
      ...prev,
      ...valid.map(f => ({
        id: uid(),
        file: f,
        categoryId: categories[0] ? String(categories[0].id) : '',
        notes: '',
        status: 'pending' as const,
        progress: 0,
      })),
    ]);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    // Only clear if leaving the drop zone entirely
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    addFilesToQueue(e.dataTransfer.files);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFilesToQueue(e.target.files);
    e.target.value = '';
  }

  function updatePending(uid: string, patch: Partial<PendingUpload>) {
    setPendingUploads(prev => prev.map(p => p.id === uid ? { ...p, ...patch } : p));
  }

  function removePending(uid: string) {
    setPendingUploads(prev => prev.filter(p => p.id !== uid));
  }

  // Upload a single pending file
  async function uploadOne(pending: PendingUpload): Promise<void> {
    if (!pending.categoryId) {
      updatePending(pending.id, { status: 'error', error: 'Category required' });
      return;
    }
    updatePending(pending.id, { status: 'uploading', progress: 0 });
    try {
      const fd = new FormData();
      fd.append('file', pending.file);
      fd.append('category_id', pending.categoryId);
      if (pending.notes) fd.append('notes', pending.notes);
      await api.post(`/operations/${id}/documents`, fd, {
        onUploadProgress: (evt) => {
          const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
          updatePending(pending.id, { progress: pct });
        },
      });
      updatePending(pending.id, { status: 'done', progress: 100 });
    } catch (err: any) {
      updatePending(pending.id, {
        status: 'error',
        error: err.response?.data?.error || 'Upload failed',
      });
    }
  }

  async function handleUploadAll() {
    const toUpload = pendingUploads.filter(p => p.status === 'pending' || p.status === 'error');
    if (toUpload.length === 0) return;
    setUploadingAll(true);
    // Upload concurrently
    await Promise.all(toUpload.map(uploadOne));
    setUploadingAll(false);
    // Refresh and clear done items
    await fetchOperation();
    setPendingUploads(prev => prev.filter(p => p.status !== 'done'));
  }

  // ── Add category ────────────────────────────────────────────────────────────

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setAddingCat(true);
    try {
      const { data } = await api.post('/operations/categories', { name: newCatName.trim() });
      const sorted = [...categories, data].sort((a, b) => a.name.localeCompare(b.name));
      setCategories(sorted);
      // Auto-assign to pending uploads that have no category yet
      setPendingUploads(prev => prev.map(p => p.categoryId ? p : { ...p, categoryId: String(data.id) }));
      setNewCatName('');
      setShowAddCat(false);
      addToast('Category added', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to add category', 'error');
    } finally {
      setAddingCat(false);
    }
  }

  // ── Delete doc ──────────────────────────────────────────────────────────────

  async function handleDeleteDoc(docId: number) {
    if (!confirm('Delete this document?')) return;
    try {
      await api.delete(`/operations/${id}/documents/${docId}`);
      addToast('Document deleted', 'success');
      fetchOperation();
    } catch {
      addToast('Delete failed', 'error');
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  async function handleStatusChange(newStatus: string) {
    setSavingStatus(true);
    try {
      await api.put(`/operations/${id}`, { status: newStatus });
      setOperation(prev => prev ? { ...prev, status: newStatus } : prev);
    } catch {
      addToast('Failed to update status', 'error');
    } finally {
      setSavingStatus(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }
  if (!operation) return null;

  const pendingCount = pendingUploads.filter(p => p.status === 'pending' || p.status === 'error').length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/operations')} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Briefcase size={22} className="text-primary-600" />
              {operation.operation_number}
            </h1>
            <select
              value={operation.status}
              onChange={e => handleStatusChange(e.target.value)}
              disabled={savingStatus}
              className={`text-xs font-medium px-2 py-1 rounded-full border-0 focus:ring-2 focus:ring-primary-500 cursor-pointer ${STATUS_COLORS[operation.status] || 'bg-gray-100 text-gray-700'}`}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {operation.customer_name || operation.supplier_name || '—'} · Created {formatDate(operation.created_at) || '-'}
          </p>
        </div>
      </div>

      {/* ── Linked Order ───────────────────────────────────────────────────── */}
      {operation.order_id && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <ShoppingCart size={16} className="text-gray-500" />
              Linked Order
            </h2>
            <Link to={`/orders/${operation.order_id}`} className="flex items-center gap-1 text-sm text-primary-600 hover:underline">
              View order <ExternalLink size={13} />
            </Link>
          </div>

          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {[
              ['Order #', operation.order_number],
              ['Type', operation.order_type],
              ['Status', operation.order_status?.replace(/_/g, ' ')],
              operation.order_date    ? ['Order Date', operation.order_date] : null,
              operation.destination   ? ['Destination', operation.destination] : null,
              operation.inco_terms    ? ['Inco Terms', operation.inco_terms] : null,
              operation.transport     ? ['Transport', operation.transport] : null,
              operation.delivery_date ? ['Delivery Date', operation.delivery_date] : null,
              operation.payment_terms ? ['Payment Terms', operation.payment_terms] : null,
              operation.order_total !== undefined ? ['Total', formatCurrency(operation.order_total)] : null,
            ].filter((x): x is [string, string] => Boolean(x)).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className="font-medium text-gray-900 capitalize">{value || '—'}</p>
              </div>
            ))}
          </div>

          {/* Order items */}
          {operation.order_items.length > 0 && (
            <div className="border-t border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-medium text-gray-500">Product</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Qty</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Unit Price</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {operation.order_items.map(item => (
                    <tr key={item.id}>
                      <td className="px-5 py-2 text-gray-800">{item.description}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{item.quantity} {item.unit}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{formatCurrency(item.unit_price, item.currency)}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.total, item.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Order file row */}
          {operation.order_file_path && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
              <FileText size={15} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 flex-1 truncate">{operation.order_file_name}</span>
              <button
                onClick={() => openPreview({ fileName: operation.order_file_name!, filePath: operation.order_file_path!, subfolder: 'orders', label: 'Order document' })}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <Eye size={14} /> View
              </button>
              <button
                onClick={() => downloadFile(operation.order_file_path!, operation.order_file_name!, 'orders')}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
              >
                <Download size={14} /> Download
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Linked Invoices ─────────────────────────────────────────────────── */}
      {operation.invoices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Receipt size={16} className="text-gray-500" />
              Linked Invoices ({operation.invoices.length})
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-5 py-2 text-xs font-medium text-gray-500">Invoice #</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Party</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Amount</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Status</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {operation.invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-primary-700">{inv.invoice_number}</td>
                  <td className="px-4 py-2.5 text-gray-700">{inv.customer_name || inv.supplier_name || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">{formatCurrency(inv.amount, inv.currency)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${INVOICE_STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      {inv.file_path && (
                        <>
                          <button
                            onClick={() => openPreview({ fileName: inv.file_name!, filePath: inv.file_path!, subfolder: 'invoices', label: inv.invoice_number })}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            <Eye size={13} /> View
                          </button>
                          <button
                            onClick={() => downloadFile(inv.file_path!, inv.file_name!, 'invoices')}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            <Download size={13} />
                          </button>
                        </>
                      )}
                      <Link to={`/invoices/${inv.id}`} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                        Open <ExternalLink size={11} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Documents ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <FileText size={16} className="text-gray-500" />
            Documents ({operation.documents.length})
          </h2>
          {/* Add category button lives here so it's always accessible */}
          <button
            type="button"
            onClick={() => setShowAddCat(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1"
          >
            <Plus size={12} /> Add category
          </button>
        </div>

        {/* Add-category inline */}
        {showAddCat && (
          <form onSubmit={handleAddCategory} className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex gap-2 items-center">
            <input
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="New category name…"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
            <button
              type="submit"
              disabled={addingCat || !newCatName.trim()}
              className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {addingCat ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setShowAddCat(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </form>
        )}

        {/* ── Drop zone ─────────────────────────────────────────────────────── */}
        <div
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mx-5 my-4 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-6 cursor-pointer transition-colors ${
            isDragging
              ? 'border-primary-400 bg-primary-50'
              : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={22} className={isDragging ? 'text-primary-500' : 'text-gray-400'} />
          <p className="text-sm font-medium text-gray-600">
            {isDragging ? 'Drop files here' : 'Drag & drop files here, or click to browse'}
          </p>
          <p className="text-xs text-gray-400">PDF, JPEG, PNG, WebP · max 10 MB each</p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTS}
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>

        {/* ── Pending uploads queue ──────────────────────────────────────────── */}
        {pendingUploads.length > 0 && (
          <div className="px-5 pb-4 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Upload queue</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPendingUploads([])}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear all
                </button>
                {pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={handleUploadAll}
                    disabled={uploadingAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60"
                  >
                    {uploadingAll ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Upload {pendingCount} file{pendingCount !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </div>

            {pendingUploads.map(p => (
              <div key={p.id} className="border border-gray-200 rounded-lg px-3 py-2.5 bg-white space-y-2">
                {/* File name + status icon + remove */}
                <div className="flex items-center gap-2">
                  {p.status === 'done'      && <CheckCircle size={15} className="text-green-500 flex-shrink-0" />}
                  {p.status === 'error'     && <AlertCircle size={15} className="text-red-500 flex-shrink-0" />}
                  {p.status === 'uploading' && <Loader2 size={15} className="text-primary-500 animate-spin flex-shrink-0" />}
                  {p.status === 'pending'   && <FileText size={15} className="text-gray-400 flex-shrink-0" />}

                  <span className="text-sm text-gray-800 truncate flex-1">{p.file.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{(p.file.size / 1024).toFixed(0)} KB</span>

                  {p.status !== 'uploading' && (
                    <button onClick={() => removePending(p.id)} className="p-0.5 text-gray-300 hover:text-gray-500">
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Progress bar (while uploading) */}
                {p.status === 'uploading' && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-primary-500 h-1.5 rounded-full transition-all duration-200"
                      style={{ width: `${p.progress}%` }}
                    />
                  </div>
                )}

                {/* Error message */}
                {p.status === 'error' && p.error && (
                  <p className="text-xs text-red-600">{p.error}</p>
                )}

                {/* Category + notes (only when pending or error) */}
                {(p.status === 'pending' || p.status === 'error') && (
                  <div className="flex gap-2">
                    <select
                      value={p.categoryId}
                      onChange={e => updatePending(p.id, { categoryId: e.target.value })}
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">Select category *</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <input
                      value={p.notes}
                      onChange={e => updatePending(p.id, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}

                {/* Done badge */}
                {p.status === 'done' && (
                  <p className="text-xs text-green-600 font-medium">Uploaded successfully</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Saved documents list ───────────────────────────────────────────── */}
        {operation.documents.length === 0 && pendingUploads.length === 0 ? (
          <div className="text-center pb-8 pt-2 text-gray-400 text-sm">
            No documents yet — drag files above or click to upload.
          </div>
        ) : operation.documents.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {operation.documents.map(doc => (
              <li key={doc.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                <FileText size={18} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {doc.category_name && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                        {doc.category_name}
                      </span>
                    )}
                    {doc.notes && <span className="text-xs text-gray-500 truncate">{doc.notes}</span>}
                    <span className="text-xs text-gray-400">{formatDate(doc.created_at) || '-'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openPreview({ fileName: doc.file_name, filePath: doc.file_path, subfolder: 'operation-docs', label: doc.category_name || undefined })}
                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 hover:text-gray-700"
                    title="Preview"
                  >
                    <Eye size={15} />
                  </button>
                  <button
                    onClick={() => downloadFile(doc.file_path, doc.file_name)}
                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 hover:text-gray-700"
                    title="Download"
                  >
                    <Download size={15} />
                  </button>
                  <button
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="p-1.5 rounded-lg hover:bg-red-100 text-gray-400 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ── Preview Modal ──────────────────────────────────────────────────── */}
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
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{previewItem.fileName}</p>
                {previewItem.label && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                    {previewItem.label}
                  </span>
                )}
              </div>
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

            {/* Modal body */}
            <div className="flex-1 overflow-auto min-h-0 bg-gray-100 flex items-center justify-center p-4">
              {previewLoading ? (
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
              ) : previewUrl ? (
                isImage(previewItem.fileName) ? (
                  <img
                    src={previewUrl}
                    alt={previewItem.fileName}
                    className="max-w-full max-h-full object-contain rounded-lg shadow"
                  />
                ) : (
                  <iframe
                    src={previewUrl}
                    title={previewItem.fileName}
                    className="w-full rounded-lg shadow bg-white"
                    style={{ height: '70vh' }}
                  />
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
