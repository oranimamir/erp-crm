import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Briefcase, ShoppingCart, FileText, Upload, Trash2,
  Download, Eye, X, Plus, Receipt, ExternalLink, CheckCircle,
  AlertCircle, Loader2, Edit2, Link2, Search, Truck,
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
  due_date?: string;
  invoice_date?: string;
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
  ship_date?: string;
  notes?: string;
  created_at: string;
  documents: OperationDoc[];
  invoices: Invoice[];
  order_items: OrderItem[];
}

interface PreviewItem {
  fileName: string;
  filePath: string;
  subfolder: string;
  label?: string;
}

interface PendingUpload {
  id: string;
  file: File;
  categoryId: string;
  notes: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['pre-ordered', 'ordered', 'shipped', 'delivered'];
const STATUS_COLORS: Record<string, string> = {
  'pre-ordered': 'bg-purple-100 text-purple-800',
  ordered:       'bg-yellow-100 text-yellow-800',
  shipped:       'bg-blue-100   text-blue-800',
  delivered:     'bg-green-100  text-green-800',
};
const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft:     'bg-gray-100  text-gray-700',
  sent:      'bg-blue-100  text-blue-800',
  paid:      'bg-green-100 text-green-800',
  overdue:   'bg-red-100   text-red-800',
  cancelled: 'bg-gray-100  text-gray-500',
};
const ACCEPTED_EXTS = '.pdf,.jpg,.jpeg,.png,.webp';
const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = 'USD') {
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${sym}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function isImage(filename: string) { return /\.(jpg|jpeg|png|webp)$/i.test(filename); }
function uid() { return Math.random().toString(36).slice(2); }
function addDays(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
function todayISO() { return new Date().toISOString().split('T')[0]; }

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

  // Ship modal
  const [showShipModal, setShowShipModal] = useState(false);
  const [shipDate, setShipDate] = useState('');
  const [payDays, setPayDays] = useState(45);
  const [dueDate, setDueDate] = useState('');
  const [savingShip, setSavingShip] = useState(false);

  // Link Order modal
  const [showLinkOrder, setShowLinkOrder] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [availableOrders, setAvailableOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [linkingOrder, setLinkingOrder] = useState(false);

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
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  // ── Drag-and-drop ───────────────────────────────────────────────────────────

  function addFilesToQueue(files: FileList | File[]) {
    const arr = Array.from(files);
    const valid = arr.filter(f =>
      ACCEPTED_MIME.includes(f.type) ||
      ACCEPTED_EXTS.split(',').some(ext => f.name.toLowerCase().endsWith(ext.replace('.', '.')))
    );
    const invalid = arr.length - valid.length;
    if (invalid > 0) addToast(`${invalid} file(s) skipped — only PDF, JPEG, PNG, WebP allowed`, 'error');
    if (valid.length === 0) return;
    setPendingUploads(prev => [
      ...prev,
      ...valid.map(f => ({
        id: uid(), file: f,
        categoryId: categories[0] ? String(categories[0].id) : '',
        notes: '', status: 'pending' as const, progress: 0,
      })),
    ]);
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false); addFilesToQueue(e.dataTransfer.files);
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
      updatePending(pending.id, { status: 'error', error: err.response?.data?.error || 'Upload failed' });
    }
  }

  async function handleUploadAll() {
    const toUpload = pendingUploads.filter(p => p.status === 'pending' || p.status === 'error');
    if (toUpload.length === 0) return;
    setUploadingAll(true);
    await Promise.all(toUpload.map(uploadOne));
    setUploadingAll(false);
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
    if (newStatus === 'shipped') {
      // Intercept: open ship modal to confirm dates before saving
      const defaultDate = operation?.ship_date || todayISO();
      setShipDate(defaultDate);
      setPayDays(45);
      setDueDate(addDays(defaultDate, 45));
      setShowShipModal(true);
      return;
    }
    setSavingStatus(true);
    try {
      await api.patch(`/operations/${id}/status`, { status: newStatus });
      setOperation(prev => prev ? { ...prev, status: newStatus } : prev);
    } catch {
      addToast('Failed to update status', 'error');
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleConfirmShip() {
    if (!shipDate || !dueDate) return;
    setSavingShip(true);
    try {
      await api.post(`/operations/${id}/ship`, { ship_date: shipDate, due_date: dueDate });
      setShowShipModal(false);
      addToast('Operation marked as shipped — invoices updated', 'success');
      fetchOperation();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to mark as shipped', 'error');
    } finally {
      setSavingShip(false);
    }
  }

  // ── Delete invoice ───────────────────────────────────────────────────────────

  async function handleDeleteInvoice(invoiceId: number, invoiceNumber: string) {
    if (!confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) return;
    try {
      await api.delete(`/invoices/${invoiceId}`);
      addToast('Invoice deleted', 'success');
      fetchOperation();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Delete failed', 'error');
    }
  }

  // ── Delete order ─────────────────────────────────────────────────────────────

  async function handleDeleteOrder() {
    if (!operation?.order_id) return;
    if (!confirm(`Delete order ${operation.order_number}? This cannot be undone.`)) return;
    try {
      await api.delete(`/orders/${operation.order_id}`);
      addToast('Order deleted', 'success');
      fetchOperation();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Delete failed', 'error');
    }
  }

  // ── Link Order modal ─────────────────────────────────────────────────────────

  async function openLinkOrder() {
    setShowLinkOrder(true);
    setOrderSearch('');
    setLoadingOrders(true);
    try {
      const { data } = await api.get('/orders', { params: { limit: 50 } });
      setAvailableOrders(data.data || []);
    } catch {
      addToast('Failed to load orders', 'error');
    } finally {
      setLoadingOrders(false);
    }
  }

  async function handleOrderSearch(q: string) {
    setOrderSearch(q);
    setLoadingOrders(true);
    try {
      const { data } = await api.get('/orders', { params: { limit: 50, search: q } });
      setAvailableOrders(data.data || []);
    } catch { /* ignore */ } finally {
      setLoadingOrders(false);
    }
  }

  async function handleLinkOrder(orderId: number) {
    setLinkingOrder(true);
    try {
      await api.put(`/operations/${id}`, { order_id: orderId });
      addToast('Order linked to operation', 'success');
      setShowLinkOrder(false);
      fetchOperation();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to link order', 'error');
    } finally {
      setLinkingOrder(false);
    }
  }

  async function handleUnlinkOrder() {
    if (!confirm('Unlink this order from the operation?')) return;
    try {
      await api.put(`/operations/${id}`, { order_id: null });
      addToast('Order unlinked', 'success');
      fetchOperation();
    } catch {
      addToast('Failed to unlink order', 'error');
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
              value={STATUS_OPTIONS.includes(operation.status) ? operation.status : ''}
              onChange={e => handleStatusChange(e.target.value)}
              disabled={savingStatus}
              className={`text-xs font-medium px-2 py-1 rounded-full border-0 focus:ring-2 focus:ring-primary-500 cursor-pointer ${STATUS_COLORS[operation.status] || 'bg-gray-100 text-gray-700'}`}
            >
              {!STATUS_OPTIONS.includes(operation.status) && (
                <option value="">{operation.status.charAt(0).toUpperCase() + operation.status.slice(1)}</option>
              )}
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            {(operation.status === 'shipped' || operation.status === 'delivered') && (
              <button
                onClick={() => {
                  const today = operation.ship_date || todayISO();
                  setShipDate(today);
                  setPayDays(45);
                  setDueDate(addDays(today, 45));
                  setShowShipModal(true);
                }}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 bg-blue-50 rounded-lg px-2 py-1"
                title="Edit shipment date / invoice due date"
              >
                <Truck size={12} /> {operation.ship_date ? `Shipped ${formatDate(operation.ship_date)}` : 'Set ship dates'}
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {operation.customer_name || operation.supplier_name || '—'} · Created {formatDate(operation.created_at) || '-'}
          </p>
        </div>
      </div>

      {/* ── Linked Order ───────────────────────────────────────────────────── */}
      {operation.order_id ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <ShoppingCart size={16} className="text-gray-500" />
              Linked Order
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/orders/${operation.order_id}/edit`)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1"
              >
                <Edit2 size={13} /> Edit
              </button>
              <button
                onClick={handleUnlinkOrder}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1"
                title="Unlink order from this operation"
              >
                <X size={13} /> Unlink
              </button>
              <button
                onClick={handleDeleteOrder}
                className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2 py-1"
              >
                <Trash2 size={13} /> Delete
              </button>
              <Link to={`/orders/${operation.order_id}`} className="flex items-center gap-1 text-sm text-primary-600 hover:underline ml-1">
                View <ExternalLink size={13} />
              </Link>
            </div>
          </div>

          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {([
              ['Order #', operation.order_number],
              ['Type', operation.order_type],
              ['Status', operation.order_status?.replace(/_/g, ' ')],
              operation.order_date    ? ['Order Date', formatDate(operation.order_date)] : null,
              operation.destination   ? ['Destination', operation.destination] : null,
              operation.inco_terms    ? ['Inco Terms', operation.inco_terms] : null,
              operation.transport     ? ['Transport', operation.transport] : null,
              operation.delivery_date ? ['Delivery Date', formatDate(operation.delivery_date)] : null,
              operation.payment_terms ? ['Payment Terms', operation.payment_terms] : null,
              operation.order_total !== undefined ? ['Total', formatCurrency(operation.order_total)] : null,
            ] as ([string, string] | null)[]).filter((x): x is [string, string] => Boolean(x)).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className="font-medium text-gray-900 capitalize">{value || '—'}</p>
              </div>
            ))}
          </div>

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
      ) : (
        /* No order linked */
        <div className="bg-white rounded-xl border border-dashed border-gray-300 shadow-sm p-6 flex flex-col sm:flex-row items-center gap-4">
          <ShoppingCart size={28} className="text-gray-300 flex-shrink-0" />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-sm font-medium text-gray-700">No order linked yet</p>
            <p className="text-xs text-gray-500 mt-0.5">Create a new order or link an existing one to this operation.</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => navigate(`/orders/new?operation_number=${encodeURIComponent(operation.operation_number)}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus size={14} /> New Order
            </button>
            <button
              onClick={openLinkOrder}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              <Link2 size={14} /> Link Existing
            </button>
          </div>
        </div>
      )}

      {/* ── Linked Invoices ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Receipt size={16} className="text-gray-500" />
            Invoices ({operation.invoices.length})
          </h2>
          <button
            onClick={() => navigate(`/invoices/new?operation_id=${operation.id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus size={13} /> New Invoice
          </button>
        </div>

        {operation.invoices.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">
            No invoices yet.{' '}
            <button
              onClick={() => navigate(`/invoices/new?operation_id=${operation.id}`)}
              className="text-primary-600 hover:underline"
            >
              Create one
            </button>
          </div>
        ) : (
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
                            className="p-0.5 text-xs text-gray-400 hover:text-gray-600"
                          >
                            <Download size={13} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => navigate(`/invoices/${inv.id}/edit`)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <Edit2 size={13} /> Edit
                      </button>
                      <button
                        onClick={() => handleDeleteInvoice(inv.id, inv.invoice_number)}
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600"
                      >
                        <Trash2 size={13} />
                      </button>
                      <Link to={`/invoices/${inv.id}`} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                        Open <ExternalLink size={11} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Documents ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <FileText size={16} className="text-gray-500" />
            Documents ({operation.documents.length})
          </h2>
          <button
            type="button"
            onClick={() => setShowAddCat(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1"
          >
            <Plus size={12} /> Add category
          </button>
        </div>

        {showAddCat && (
          <form onSubmit={handleAddCategory} className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex gap-2 items-center">
            <input
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="New category name…"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
            <button type="submit" disabled={addingCat || !newCatName.trim()}
              className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
              {addingCat ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setShowAddCat(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </form>
        )}

        <div
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mx-5 my-4 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-6 cursor-pointer transition-colors ${
            isDragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={22} className={isDragging ? 'text-primary-500' : 'text-gray-400'} />
          <p className="text-sm font-medium text-gray-600">
            {isDragging ? 'Drop files here' : 'Drag & drop files here, or click to browse'}
          </p>
          <p className="text-xs text-gray-400">PDF, JPEG, PNG, WebP · max 10 MB each</p>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTS} multiple className="hidden" onChange={handleFileInputChange} />
        </div>

        {pendingUploads.length > 0 && (
          <div className="px-5 pb-4 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Upload queue</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPendingUploads([])} className="text-xs text-gray-400 hover:text-gray-600">Clear all</button>
                {pendingCount > 0 && (
                  <button type="button" onClick={handleUploadAll} disabled={uploadingAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60">
                    {uploadingAll ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Upload {pendingCount} file{pendingCount !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </div>
            {pendingUploads.map(p => (
              <div key={p.id} className="border border-gray-200 rounded-lg px-3 py-2.5 bg-white space-y-2">
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
                {p.status === 'uploading' && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div className="bg-primary-500 h-1.5 rounded-full transition-all duration-200" style={{ width: `${p.progress}%` }} />
                  </div>
                )}
                {p.status === 'error' && p.error && <p className="text-xs text-red-600">{p.error}</p>}
                {(p.status === 'pending' || p.status === 'error') && (
                  <div className="flex gap-2">
                    <select
                      value={p.categoryId}
                      onChange={e => updatePending(p.id, { categoryId: e.target.value })}
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">Select category *</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input
                      value={p.notes}
                      onChange={e => updatePending(p.id, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}
                {p.status === 'done' && <p className="text-xs text-green-600 font-medium">Uploaded successfully</p>}
              </div>
            ))}
          </div>
        )}

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
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">{doc.category_name}</span>
                    )}
                    {doc.notes && <span className="text-xs text-gray-500 truncate">{doc.notes}</span>}
                    <span className="text-xs text-gray-400">{formatDate(doc.created_at) || '-'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openPreview({ fileName: doc.file_name, filePath: doc.file_path, subfolder: 'operation-docs', label: doc.category_name || undefined })}
                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="Preview">
                    <Eye size={15} />
                  </button>
                  <button onClick={() => downloadFile(doc.file_path, doc.file_name)}
                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="Download">
                    <Download size={15} />
                  </button>
                  <button onClick={() => handleDeleteDoc(doc.id)}
                    className="p-1.5 rounded-lg hover:bg-red-100 text-gray-400 hover:text-red-600" title="Delete">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closePreview}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{previewItem.fileName}</p>
                {previewItem.label && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">{previewItem.label}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => downloadFile(previewItem.filePath, previewItem.fileName, previewItem.subfolder)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
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
      {showShipModal && operation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !savingShip && setShowShipModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Truck size={17} className="text-blue-500" />
                Mark as Shipped — {operation.operation_number}
              </h3>
              <button
                onClick={() => !savingShip && setShowShipModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-4">

              {/* Shipment date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shipment Date</label>
                <input
                  type="date"
                  value={shipDate}
                  onChange={e => {
                    setShipDate(e.target.value);
                    setDueDate(addDays(e.target.value, payDays));
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Payment terms (days) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={payDays}
                    onChange={e => {
                      const d = Math.max(1, parseInt(e.target.value) || 1);
                      setPayDays(d);
                      setDueDate(addDays(shipDate, d));
                    }}
                    className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-500">days after shipment</span>
                </div>
              </div>

              {/* Due date — auto-calculated from ship date, manually overridable */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invoice Due Date
                  <span className="text-xs text-gray-400 font-normal ml-1.5">shipment date + {payDays} days · editable</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Invoice preview */}
              {(() => {
                const custInvoices = operation.invoices.filter(inv => inv.type === 'customer');
                if (custInvoices.length === 0) {
                  return (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                      No customer invoices linked — status will be updated but no invoice dates will be set.
                    </div>
                  );
                }
                return (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                    <p className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">
                      {custInvoices.length} customer invoice{custInvoices.length > 1 ? 's' : ''} will be updated
                    </p>
                    <ul className="space-y-2">
                      {custInvoices.map(inv => (
                        <li key={inv.id} className="text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-blue-900">{inv.invoice_number}</span>
                            {inv.status === 'draft' && (
                              <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">draft → sent</span>
                            )}
                          </div>
                          <div className="text-xs text-blue-700 mt-0.5">
                            Due date will be set to: <strong>{dueDate ? formatDate(dueDate) : '—'}</strong>
                          </div>
                          {inv.invoice_date && (
                            <div className="text-xs text-blue-500 mt-0.5">
                              Invoice date (unchanged): {formatDate(inv.invoice_date)}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowShipModal(false)}
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

      {/* ── Link Order Modal ───────────────────────────────────────────────── */}
      {showLinkOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowLinkOrder(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Link2 size={16} className="text-primary-600" /> Link Existing Order
              </h3>
              <button onClick={() => setShowLinkOrder(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Search by order #, customer, supplier..."
                  value={orderSearch}
                  onChange={e => handleOrderSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '340px' }}>
              {loadingOrders ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
                </div>
              ) : availableOrders.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">No orders found</p>
              ) : (
                <ul className="divide-y divide-gray-100 px-2 py-2">
                  {availableOrders.map(order => (
                    <li key={order.id}>
                      <button
                        onClick={() => handleLinkOrder(order.id)}
                        disabled={linkingOrder}
                        className="w-full text-left px-3 py-3 rounded-lg hover:bg-gray-50 flex items-center justify-between gap-4 disabled:opacity-60"
                      >
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{order.order_number}</p>
                          <p className="text-xs text-gray-500">{order.customer_name || order.supplier_name || '—'}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-gray-500">{formatDate(order.order_date) || '—'}</p>
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded capitalize">{order.status?.replace(/_/g, ' ')}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
