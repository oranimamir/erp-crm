import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Briefcase, ShoppingCart, FileText, Upload, Trash2,
  Download, Eye, X, Plus, Receipt, ExternalLink
} from 'lucide-react';

interface Category { id: number; name: string; }
interface Document {
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
  documents: Document[];
  invoices: Invoice[];
  order_items: OrderItem[];
}

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

function formatCurrency(amount: number, currency = 'USD') {
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${sym}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isImage(filename: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(filename);
}

export default function OperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [operation, setOperation] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategoryId, setUploadCategoryId] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // New category
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [showAddCat, setShowAddCat] = useState(false);

  // Preview
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Status editing
  const [savingStatus, setSavingStatus] = useState(false);

  async function fetchOperation() {
    try {
      const { data } = await api.get(`/operations/${id}`);
      setOperation(data);
    } catch {
      addToast('Operation not found', 'error');
      navigate('/operations');
    } finally {
      setLoading(false);
    }
  }

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

  // Preview helpers
  async function openPreview(doc: Document) {
    setPreviewDoc(doc);
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const resp = await api.get(`/files/operation-docs/${doc.file_path}`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] || 'application/octet-stream' });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      addToast('Failed to load preview', 'error');
      setPreviewDoc(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewDoc(null);
    setPreviewUrl(null);
  }

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

  async function downloadOrderFile() {
    if (!operation?.order_file_path || !operation?.order_file_name) return;
    await downloadFile(operation.order_file_path, operation.order_file_name, 'orders');
  }

  // Upload document
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) { addToast('Please select a file', 'error'); return; }
    if (!uploadCategoryId) { addToast('Please select a category', 'error'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('category_id', uploadCategoryId);
      if (uploadNotes) fd.append('notes', uploadNotes);
      await api.post(`/operations/${id}/documents`, fd);
      addToast('Document uploaded', 'success');
      setUploadFile(null);
      setUploadCategoryId('');
      setUploadNotes('');
      setShowUpload(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchOperation();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

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

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setAddingCat(true);
    try {
      const { data } = await api.post('/operations/categories', { name: newCatName.trim() });
      setCategories(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setUploadCategoryId(String(data.id));
      setNewCatName('');
      setShowAddCat(false);
      addToast('Category added', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to add category', 'error');
    } finally {
      setAddingCat(false);
    }
  }

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!operation) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
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
            {operation.customer_name || operation.supplier_name || '—'} · Created {new Date(operation.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Linked Order */}
      {operation.order_id && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <ShoppingCart size={16} className="text-gray-500" />
              Linked Order
            </h2>
            <Link
              to={`/orders/${operation.order_id}`}
              className="flex items-center gap-1 text-sm text-primary-600 hover:underline"
            >
              View order <ExternalLink size={13} />
            </Link>
          </div>
          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Order #</p>
              <p className="font-medium text-gray-900">{operation.order_number}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Type</p>
              <p className="font-medium text-gray-900 capitalize">{operation.order_type}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Status</p>
              <p className="font-medium text-gray-900 capitalize">{operation.order_status?.replace(/_/g, ' ')}</p>
            </div>
            {operation.order_date && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Order Date</p>
                <p className="font-medium text-gray-900">{operation.order_date}</p>
              </div>
            )}
            {operation.destination && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Destination</p>
                <p className="font-medium text-gray-900">{operation.destination}</p>
              </div>
            )}
            {operation.inco_terms && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Inco Terms</p>
                <p className="font-medium text-gray-900">{operation.inco_terms}</p>
              </div>
            )}
            {operation.transport && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Transport</p>
                <p className="font-medium text-gray-900">{operation.transport}</p>
              </div>
            )}
            {operation.delivery_date && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Delivery Date</p>
                <p className="font-medium text-gray-900">{operation.delivery_date}</p>
              </div>
            )}
            {operation.payment_terms && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Payment Terms</p>
                <p className="font-medium text-gray-900">{operation.payment_terms}</p>
              </div>
            )}
            {operation.order_total !== undefined && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Total Amount</p>
                <p className="font-semibold text-gray-900">{formatCurrency(operation.order_total)}</p>
              </div>
            )}
          </div>

          {/* Order Items */}
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

          {/* Order file download */}
          {operation.order_file_path && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
              <FileText size={15} className="text-gray-400" />
              <span className="text-sm text-gray-700 flex-1 truncate">{operation.order_file_name}</span>
              <button
                onClick={downloadOrderFile}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
              >
                <Download size={14} /> Download
              </button>
            </div>
          )}
        </div>
      )}

      {/* Linked Invoices */}
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
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {operation.invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-primary-700">{inv.invoice_number}</td>
                  <td className="px-4 py-2.5 text-gray-700">{inv.customer_name || inv.supplier_name || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900 font-medium">{formatCurrency(inv.amount, inv.currency)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${INVOICE_STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link to={`/invoices/${inv.id}`} className="text-xs text-primary-600 hover:underline flex items-center justify-end gap-1">
                      View <ExternalLink size={11} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Documents */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <FileText size={16} className="text-gray-500" />
            Documents ({operation.documents.length})
          </h2>
          <button
            onClick={() => setShowUpload(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Upload size={14} /> Upload
          </button>
        </div>

        {/* Upload form */}
        {showUpload && (
          <form onSubmit={handleUpload} className="px-5 py-4 bg-gray-50 border-b border-gray-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">File *</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  required
                  onChange={e => setUploadFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
                <div className="flex gap-2">
                  <select
                    value={uploadCategoryId}
                    onChange={e => setUploadCategoryId(e.target.value)}
                    required
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select category…</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddCat(v => !v)}
                    className="p-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-600"
                    title="Add new category"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {showAddCat && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      placeholder="New category name"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      disabled={addingCat || !newCatName.trim()}
                      className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <input
                value={uploadNotes}
                onChange={e => setUploadNotes(e.target.value)}
                placeholder="Optional notes"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </form>
        )}

        {/* Documents list */}
        {operation.documents.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            No documents yet. Click Upload to add files.
          </div>
        ) : (
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
                    {doc.notes && (
                      <span className="text-xs text-gray-500 truncate">{doc.notes}</span>
                    )}
                    <span className="text-xs text-gray-400">{new Date(doc.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openPreview(doc)}
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
        )}
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closePreview}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{previewDoc.file_name}</p>
                {previewDoc.category_name && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                    {previewDoc.category_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => downloadFile(previewDoc.file_path, previewDoc.file_name)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <Download size={14} /> Download
                </button>
                <button
                  onClick={closePreview}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-auto min-h-0 bg-gray-100 flex items-center justify-center p-4">
              {previewLoading ? (
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
              ) : previewUrl ? (
                isImage(previewDoc.file_name) ? (
                  <img
                    src={previewUrl}
                    alt={previewDoc.file_name}
                    className="max-w-full max-h-full object-contain rounded-lg shadow"
                  />
                ) : (
                  <iframe
                    src={previewUrl}
                    title={previewDoc.file_name}
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
