import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { formatDate } from '../lib/dates';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Badge from '../components/ui/Badge';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import {
  ArrowLeft,
  FileText,
  Download,
  CreditCard,
  Clock,
  ArrowRight,
  Pencil,
  Calendar,
  User,
  Building,
  Hash,
  StickyNote,
  Landmark,
  Upload,
  Loader2,
  Eye,
  Trash2,
} from 'lucide-react';

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

const typeColors: Record<string, 'blue' | 'purple'> = {
  customer: 'blue',
  supplier: 'purple',
};

function isImage(filename: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(filename);
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Wire transfer inline form
  const [wirePaymentDate, setWirePaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [wireBankRef, setWireBankRef] = useState('');
  const [wireUploading, setWireUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Preview modal
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchInvoice = () => {
    setLoading(true);
    api.get(`/invoices/${id}`)
      .then(res => {
        setInvoice(res.data);
        setNewStatus(res.data.status);
        // Pre-fill payment date with invoice_date so historical uploads land in the right month
        if (res.data.invoice_date) {
          const match = res.data.invoice_date.match(/^(\d{4}-\d{2}-\d{2})/);
          if (match) setWirePaymentDate(match[1]);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchInvoice(); }, [id]);

  // ── Status update ──────────────────────────────────────────────────────────

  const handleStatusUpdate = async () => {
    if (newStatus === invoice.status) {
      addToast('Status is already set to this value', 'info');
      return;
    }
    setUpdatingStatus(true);
    try {
      await api.patch(`/invoices/${id}/status`, { status: newStatus });
      addToast('Status updated', 'success');
      fetchInvoice();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update status', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // ── Wire transfer upload ───────────────────────────────────────────────────

  const handleWireUpload = async (file: File) => {
    setWireUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('payment_date', wirePaymentDate);
      if (wireBankRef) formData.append('bank_reference', wireBankRef);
      await api.post(`/invoices/${id}/wire-transfers`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      addToast('Wire transfer uploaded — invoice marked as Paid', 'success');
      setWireBankRef('');
      fetchInvoice();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setWireUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleWireUpload(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleWireUpload(file);
    e.target.value = '';
  };

  // ── Wire transfer delete ───────────────────────────────────────────────────

  const handleDeleteWire = async (transferId: number) => {
    if (!confirm('Delete this wire transfer? The invoice will revert to Sent.')) return;
    try {
      await api.delete(`/invoices/${id}/wire-transfers/${transferId}`);
      addToast('Wire transfer deleted — invoice reverted to Sent', 'success');
      fetchInvoice();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  // ── File preview ──────────────────────────────────────────────────────────

  const openPreview = async (filePath: string, fileName: string, subfolder: string) => {
    setPreviewFileName(fileName);
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const resp = await api.get(`/files/${subfolder}/${filePath}`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] || 'application/octet-stream' });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      addToast('Failed to load preview', 'error');
      setPreviewFileName('');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewFileName('');
  };

  const downloadFile = async (apiPath: string, filename: string) => {
    try {
      const res = await api.get(apiPath, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast('Failed to download file', 'error');
    }
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = formatDate(dateStr);
    return d || '-';
  };

  const formatAmount = (amount: number, currency?: string) => {
    if (amount == null) return '-';
    const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!invoice) {
    return <p className="text-center py-20 text-gray-500">Invoice not found</p>;
  }

  const payments: any[] = invoice.payments || [];
  const statusHistory: any[] = invoice.status_history || [];
  const wireTransfers: any[] = invoice.wire_transfers || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/invoices" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> Back to Invoices
        </Link>
        <Link to={`/invoices/${id}/edit`}>
          <Button variant="secondary" size="sm"><Pencil size={14} /> Edit</Button>
        </Link>
      </div>

      {/* Invoice Info */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{invoice.invoice_number}</h1>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={typeColors[invoice.type] || 'gray'}>
                {invoice.type === 'customer' ? 'Customer Invoice' : 'Supplier Invoice'}
              </Badge>
              <StatusBadge status={invoice.status} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">
              {formatAmount(invoice.amount, invoice.currency)}
            </p>
            <p className="text-sm text-gray-500">{invoice.currency || 'USD'}</p>
            {invoice.eur_amount != null && invoice.currency !== 'EUR' && (
              <p className="text-sm text-gray-400">≈ €{invoice.eur_amount.toFixed(2)}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Hash size={16} className="text-gray-400 shrink-0" />
            <span className="font-medium text-gray-500">Invoice #:</span>
            <span>{invoice.invoice_number}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            {invoice.type === 'customer' ? (
              <User size={16} className="text-gray-400 shrink-0" />
            ) : (
              <Building size={16} className="text-gray-400 shrink-0" />
            )}
            <span className="font-medium text-gray-500">
              {invoice.type === 'customer' ? 'Customer:' : 'Supplier:'}
            </span>
            <span>{invoice.customer_name || invoice.supplier_name || '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar size={16} className="text-gray-400 shrink-0" />
            <span className="font-medium text-gray-500">Invoice Date:</span>
            <span>{formatDate(invoice.invoice_date) || '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar size={16} className="text-gray-400 shrink-0" />
            <span className="font-medium text-gray-500">Due Date:</span>
            <span>{formatDate(invoice.due_date) || '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar size={16} className="text-gray-400 shrink-0" />
            <span className="font-medium text-gray-500">Payment Date:</span>
            <span>{formatDate(invoice.payment_date) || '-'}</span>
          </div>
          {invoice.our_ref && (
            <div className="flex items-center gap-2 text-gray-600">
              <Hash size={16} className="text-gray-400 shrink-0" />
              <span className="font-medium text-gray-500">Our Ref:</span>
              <span>{invoice.our_ref}</span>
            </div>
          )}
          {invoice.po_number && (
            <div className="flex items-center gap-2 text-gray-600">
              <Hash size={16} className="text-gray-400 shrink-0" />
              <span className="font-medium text-gray-500">PO Number:</span>
              <span>{invoice.po_number}</span>
            </div>
          )}
        </div>

        {invoice.notes && (
          <div className="mt-4 flex items-start gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
            <StickyNote size={16} className="text-gray-400 shrink-0 mt-0.5" />
            <p>{invoice.notes}</p>
          </div>
        )}

        {invoice.file_path && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
            <FileText size={16} className="text-gray-400 shrink-0" />
            <span className="text-sm text-gray-700 flex-1 truncate">{invoice.file_name || invoice.file_path}</span>
            <button
              onClick={() => openPreview(invoice.file_path, invoice.file_name || invoice.file_path, 'invoices')}
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 font-medium"
            >
              <Eye size={14} /> View
            </button>
            <button
              onClick={() => downloadFile(`/files/invoices/${invoice.file_path}`, invoice.file_name || invoice.file_path)}
              className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              <Download size={14} /> Download
            </button>
          </div>
        )}
      </Card>

      {/* Status Update */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Update Status</h2>
        </div>
        <div className="p-5">
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <Select
                label="New Status"
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                options={statusOptions}
              />
            </div>
            <Button onClick={handleStatusUpdate} disabled={updatingStatus}>
              {updatingStatus ? 'Updating...' : 'Update Status'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payments Section */}
        {payments.length > 0 && (
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <CreditCard size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Payments ({payments.length})</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {payments.map((payment: any, idx: number) => (
                <div key={payment.id || idx} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {formatAmount(payment.amount, invoice.currency)}
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(payment.date || payment.payment_date) || '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Wire Transfers Section */}
        <Card className={payments.length > 0 ? '' : 'lg:col-span-2'}>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Landmark size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Wire Transfers ({wireTransfers.length})</h2>
          </div>

          {/* Drag-drop upload zone — visible when invoice is 'sent' */}
          {invoice.status === 'sent' && (
            <div className="px-5 pt-4 pb-2 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={wirePaymentDate}
                    onChange={e => setWirePaymentDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bank Reference <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={wireBankRef}
                    onChange={e => setWireBankRef(e.target.value)}
                    placeholder="e.g. TXN-12345"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div
                ref={dropZoneRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !wireUploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-6 transition-colors ${
                  wireUploading
                    ? 'border-primary-300 bg-primary-50 cursor-wait'
                    : isDragging
                      ? 'border-primary-400 bg-primary-50 cursor-copy'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer'
                }`}
              >
                {wireUploading ? (
                  <>
                    <Loader2 size={22} className="text-primary-500 animate-spin" />
                    <p className="text-sm font-medium text-primary-600">Uploading & converting to EUR...</p>
                  </>
                ) : (
                  <>
                    <Upload size={22} className={isDragging ? 'text-primary-500' : 'text-gray-400'} />
                    <p className="text-sm font-medium text-gray-600">
                      {isDragging ? 'Drop file to upload' : 'Drag & drop wire transfer proof, or click to browse'}
                    </p>
                    <p className="text-xs text-gray-400">PDF, JPEG, PNG, WebP · Immediately marks invoice as Paid</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </div>
            </div>
          )}

          {wireTransfers.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-gray-500">No wire transfers yet</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {wireTransfers.map((wt: any) => (
                <div key={wt.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <span className="text-sm font-medium text-gray-900">
                        {formatAmount(wt.amount, invoice.currency)}
                      </span>
                      {wt.eur_amount != null && (
                        <span className="ml-2 text-xs text-gray-500">
                          → €{wt.eur_amount.toFixed(2)}
                          {wt.fx_rate != null && wt.fx_rate !== 1 && (
                            <span className="ml-1 text-gray-400">(rate: {wt.fx_rate.toFixed(4)})</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                    <span>{formatDate(wt.transfer_date) || '-'}</span>
                    {wt.bank_reference && <span>Ref: {wt.bank_reference}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    {wt.file_path && (
                      <>
                        <button
                          onClick={() => openPreview(wt.file_path, wt.file_name || wt.file_path, 'wire-transfers')}
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium"
                        >
                          <Eye size={12} /> View
                        </button>
                        <button
                          onClick={() => downloadFile(`/files/wire-transfers/${wt.file_path}`, wt.file_name || wt.file_path)}
                          className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                        >
                          <Download size={12} /> Download
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDeleteWire(wt.id)}
                      className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Status History Section */}
        <Card className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <FileText size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Status History ({statusHistory.length})</h2>
          </div>
          {statusHistory.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">No status changes recorded</p>
          ) : (
            <div className="p-5">
              <div className="relative">
                <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-200" />
                <div className="space-y-5">
                  {statusHistory.map((entry: any, idx: number) => (
                    <div key={entry.id || idx} className="relative flex gap-3">
                      <div className="relative z-10 mt-1.5 w-[15px] h-[15px] rounded-full bg-white border-2 border-primary-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={entry.old_status} />
                          <ArrowRight size={14} className="text-gray-400 shrink-0" />
                          <StatusBadge status={entry.new_status} />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                          {entry.changed_by_name && (
                            <span className="font-medium">{entry.changed_by_name}</span>
                          )}
                          <span>{formatDateTime(entry.created_at || entry.date)}</span>
                        </div>
                        {entry.notes && (
                          <p className="mt-1 text-xs text-gray-500 bg-gray-50 rounded p-2">{entry.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Preview Modal */}
      <Modal
        open={!!previewFileName}
        onClose={closePreview}
        title={previewFileName}
        size="lg"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-500 truncate">{previewFileName}</span>
          {previewUrl && (
            <button
              onClick={() => downloadFile(previewUrl, previewFileName)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 shrink-0"
            >
              <Download size={14} /> Download
            </button>
          )}
        </div>
        <div className="flex items-center justify-center bg-gray-100 rounded-lg overflow-hidden" style={{ minHeight: '400px' }}>
          {previewLoading ? (
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
          ) : previewUrl ? (
            isImage(previewFileName) ? (
              <img src={previewUrl} alt={previewFileName} className="max-w-full max-h-[60vh] object-contain" />
            ) : (
              <iframe src={previewUrl} title={previewFileName} className="w-full rounded bg-white" style={{ height: '60vh' }} />
            )
          ) : (
            <p className="text-gray-500 text-sm">Unable to preview this file.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
