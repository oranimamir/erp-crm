import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Badge from '../components/ui/Badge';
import StatusBadge from '../components/ui/StatusBadge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import FileUpload from '../components/ui/FileUpload';
import {
  ArrowLeft,
  FileText,
  Download,
  CreditCard,
  Clock,
  ArrowRight,
  Pencil,
  DollarSign,
  Calendar,
  User,
  Building,
  Hash,
  StickyNote,
  Landmark,
  Check,
  XCircle,
  Plus,
  Upload,
  Loader2,
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

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showWireModal, setShowWireModal] = useState(false);
  const [wireForm, setWireForm] = useState({ amount: '', transfer_date: '', bank_reference: '', notes: '' });
  const [wireFile, setWireFile] = useState<File | null>(null);
  const [wireSaving, setWireSaving] = useState(false);
  const [wireScanning, setWireScanning] = useState(false);

  const scanWireTransfer = async (file: File) => {
    setWireScanning(true);
    try {
      const scanData = new FormData();
      scanData.append('file', file);
      const res = await api.post('/wire-transfers/scan', scanData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = res.data;
      setWireForm(prev => ({
        ...prev,
        ...(data.amount != null ? { amount: String(data.amount) } : {}),
        ...(data.transfer_date ? { transfer_date: data.transfer_date } : {}),
        ...(data.bank_reference ? { bank_reference: data.bank_reference } : {}),
        ...(data.notes ? { notes: data.notes } : {}),
      }));
      addToast('Wire transfer scanned and fields auto-filled', 'success');
    } catch (err: any) {
      const detail = err.response?.data?.error || '';
      const msg = detail.toLowerCase().includes('credit balance')
        ? 'AI scanning unavailable: Anthropic API credits depleted. Fill in fields manually.'
        : detail
          ? `${detail}. You can fill in the fields manually.`
          : 'Could not auto-scan wire transfer. You can fill in the fields manually.';
      addToast(msg, 'info');
    } finally {
      setWireScanning(false);
    }
  };

  const handleWireFileSelect = (file: File | null) => {
    setWireFile(file);
    if (file) {
      scanWireTransfer(file);
    }
  };

  const fetchInvoice = () => {
    setLoading(true);
    api.get(`/invoices/${id}`)
      .then(res => {
        setInvoice(res.data);
        setNewStatus(res.data.status);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchInvoice(); }, [id]);

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

  const handleSubmitWire = async () => {
    if (!wireForm.amount || !wireForm.transfer_date) { addToast('Amount and date are required', 'error'); return; }
    setWireSaving(true);
    try {
      const formData = new FormData();
      formData.append('amount', wireForm.amount);
      formData.append('transfer_date', wireForm.transfer_date);
      formData.append('bank_reference', wireForm.bank_reference);
      formData.append('notes', wireForm.notes);
      if (wireFile) formData.append('file', wireFile);
      await api.post(`/invoices/${id}/wire-transfers`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      addToast('Wire transfer submitted', 'success');
      setShowWireModal(false);
      setWireForm({ amount: '', transfer_date: '', bank_reference: '', notes: '' });
      setWireFile(null);
      fetchInvoice();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to submit', 'error');
    } finally { setWireSaving(false); }
  };

  const handleApproveWire = async (transferId: number) => {
    try {
      await api.patch(`/invoices/${id}/wire-transfers/${transferId}/approve`, { mark_paid: true });
      addToast('Wire transfer approved', 'success');
      fetchInvoice();
    } catch (err: any) { addToast(err.response?.data?.error || 'Failed to approve', 'error'); }
  };

  const handleRejectWire = async (transferId: number) => {
    const reason = prompt('Rejection reason:');
    if (reason === null) return;
    try {
      await api.patch(`/invoices/${id}/wire-transfers/${transferId}/reject`, { rejection_reason: reason });
      addToast('Wire transfer rejected', 'success');
      fetchInvoice();
    } catch (err: any) { addToast(err.response?.data?.error || 'Failed to reject', 'error'); }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const formatAmount = (amount: number, currency?: string) => {
    if (amount == null) return '-';
    const symbol = currency === 'EUR' ? '\u20AC' : currency === 'GBP' ? '\u00A3' : '$';
    return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
            <span>{formatDate(invoice.invoice_date)}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar size={16} className="text-gray-400 shrink-0" />
            <span className="font-medium text-gray-500">Due Date:</span>
            <span>{formatDate(invoice.due_date)}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar size={16} className="text-gray-400 shrink-0" />
            <span className="font-medium text-gray-500">Payment Date:</span>
            <span>{formatDate(invoice.payment_date)}</span>
          </div>
        </div>

        {invoice.notes && (
          <div className="mt-4 flex items-start gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
            <StickyNote size={16} className="text-gray-400 shrink-0 mt-0.5" />
            <p>{invoice.notes}</p>
          </div>
        )}

        {invoice.file_path && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={() => {
                const filename = invoice.file_path.split('/').pop() || 'invoice';
                downloadFile(`/files/invoices/${filename}`, filename);
              }}
              className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              <Download size={16} />
              Download Invoice File
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
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <CreditCard size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Payments ({payments.length})</h2>
          </div>
          {payments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">No payments recorded</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {payments.map((payment: any, idx: number) => (
                <div key={payment.id || idx} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {formatAmount(payment.amount, invoice.currency)}
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(payment.date || payment.payment_date)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {payment.method && (
                      <span className="flex items-center gap-1">
                        <DollarSign size={12} />
                        {payment.method}
                      </span>
                    )}
                    {payment.reference && (
                      <span>Ref: {payment.reference}</span>
                    )}
                  </div>
                  {payment.proof_path && (
                    <button
                      onClick={() => {
                        const fn = payment.proof_path.split('/').pop() || 'proof';
                        downloadFile(`/files/payments/${fn}`, fn);
                      }}
                      className="inline-flex items-center gap-1 mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      <Download size={12} />
                      Download Proof
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Wire Transfers Section */}
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Landmark size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Wire Transfers ({wireTransfers.length})</h2>
            </div>
            <Button size="sm" onClick={() => { setWireForm({ amount: String(invoice.amount || ''), transfer_date: new Date().toISOString().split('T')[0], bank_reference: '', notes: '' }); setWireFile(null); setShowWireModal(true); }}>
              <Plus size={14} /> Submit Transfer
            </Button>
          </div>
          {wireTransfers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">No wire transfers</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {wireTransfers.map((wt: any) => (
                <div key={wt.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{formatAmount(wt.amount, invoice.currency)}</span>
                    <StatusBadge status={wt.status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-1">
                    <span>{formatDate(wt.transfer_date)}</span>
                    {wt.bank_reference && <span>Ref: {wt.bank_reference}</span>}
                    {wt.approved_by_name && <span>By: {wt.approved_by_name}</span>}
                  </div>
                  {wt.rejection_reason && <p className="text-xs text-red-600 mb-1">Reason: {wt.rejection_reason}</p>}
                  {wt.notes && <p className="text-xs text-gray-500 mb-1">{wt.notes}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    {wt.file_path && (
                      <button
                        onClick={() => {
                          const fn = wt.file_path.split('/').pop() || 'transfer';
                          downloadFile(`/files/wire-transfers/${fn}`, fn);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                      >
                        <Download size={12} /> Download
                      </button>
                    )}
                    {wt.status === 'pending' && (
                      <>
                        <button onClick={() => handleApproveWire(wt.id)} className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium"><Check size={12} /> Approve</button>
                        <button onClick={() => handleRejectWire(wt.id)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"><XCircle size={12} /> Reject</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Status History Section */}
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <FileText size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Status History ({statusHistory.length})</h2>
          </div>
          {statusHistory.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">No status changes recorded</p>
          ) : (
            <div className="p-5">
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-200" />

                <div className="space-y-5">
                  {statusHistory.map((entry: any, idx: number) => (
                    <div key={entry.id || idx} className="relative flex gap-3">
                      {/* Timeline dot */}
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

      {/* Wire Transfer Modal */}
      <Modal open={showWireModal} onClose={() => setShowWireModal(false)} title="Submit Wire Transfer" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Amount *" type="number" step="0.01" value={wireForm.amount} onChange={e => setWireForm({ ...wireForm, amount: e.target.value })} />
            <Input label="Transfer Date *" type="date" value={wireForm.transfer_date} onChange={e => setWireForm({ ...wireForm, transfer_date: e.target.value })} />
          </div>
          <Input label="Bank Reference" value={wireForm.bank_reference} onChange={e => setWireForm({ ...wireForm, bank_reference: e.target.value })} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Proof of Transfer</label>
            <FileUpload onFileSelect={handleWireFileSelect} />
            {wireScanning && (
              <div className="flex items-center gap-2 text-sm text-primary-600 mt-2">
                <Loader2 size={16} className="animate-spin" />
                Scanning with AI...
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={wireForm.notes} onChange={e => setWireForm({ ...wireForm, notes: e.target.value })} rows={2} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowWireModal(false)}>Cancel</Button>
            <Button onClick={handleSubmitWire} disabled={wireSaving}>{wireSaving ? 'Submitting...' : 'Submit'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
