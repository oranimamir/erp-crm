import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import FilePreviewModal from '../components/ui/FilePreviewModal';
import {
  Briefcase, Search, Plus, ChevronLeft, ChevronRight, FileText, Receipt,
  FileSpreadsheet, ChevronUp, ChevronDown, Download, X, Truck, Loader2, ArrowLeftRight, Landmark, Filter, XCircle, Trash2, Pencil, Upload, RotateCcw,
} from 'lucide-react';
import { formatDate } from '../lib/dates';
import { paymentTermsDays, paymentTermsMentionsBL, paymentTermsEndOfMonth, computeEstimatedPaymentDate } from '../lib/paymentTerms';
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
  country?: string;
  country_suggested?: string;
  order_destination?: string;
  order_payment_terms?: string;
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
  etd?: string;
  eta?: string;
  estimated_payment_date?: string;
  /** 'auto' = derived from payment terms, 'manual' = typed by the user. */
  estimated_payment_date_source?: 'auto' | 'manual' | null;
  bl_date?: string;
  created_at: string;
}

// Resolve a country guess for an operation. The server already runs the
// freeform destination through a port→country table (e.g. "Puerto Quetzal" →
// Guatemala), so prefer that. Fall back to the raw last-chunk if the server
// didn't send a suggestion (older payloads).
function suggestedCountry(op: { country_suggested?: string; order_destination?: string }): string {
  if (op.country_suggested) return op.country_suggested;
  const dest = op.order_destination || '';
  const parts = dest.split(',').map(p => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || '';
}

// Detect if payment terms reference a BL date (e.g. "60 days from BL", "30d B/L")
/** Local helper for the shipment form's due-date field — plain calendar maths. */
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

const STATUS_OPTIONS = ['pre-ordered', 'ordered', 'in production', 'shipped', 'in clearance', 'delivered', 'completed'];

const STATUS_COLORS: Record<string, string> = {
  'pre-ordered':   'bg-purple-100 text-purple-800',
  ordered:         'bg-yellow-100 text-yellow-800',
  'in production': 'bg-pink-100   text-pink-800',
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
  const [completedYear, setCompletedYear] = useState<string>(''); // '' = all years
  const [completedYears, setCompletedYears] = useState<string[]>([]);

  // Wire-transfer upload + auto-match ("associate to operation" flow)
  const [wireModalOpen, setWireModalOpen] = useState(false);
  const [wireFile, setWireFile] = useState<File | null>(null);
  const [wireScanning, setWireScanning] = useState(false);
  const [wireScan, setWireScan] = useState<{ amount: number | null; date: string; reference: string | null; payer: string | null; currency: string | null }>({ amount: null, date: '', reference: null, payer: null, currency: null });
  const [wireCandidates, setWireCandidates] = useState<any[]>([]);
  const [wireSelectedInvoice, setWireSelectedInvoice] = useState<number | null>(null);
  const [wireSubmitting, setWireSubmitting] = useState(false);
  // Manual fallback: search every operation invoice when the ranking misses
  const [wireManual, setWireManual] = useState(false);
  const [wireSearch, setWireSearch] = useState('');
  const [wireSearchResults, setWireSearchResults] = useState<any[]>([]);
  const [wireSearching, setWireSearching] = useState(false);
  const [wireDragging, setWireDragging] = useState(false);
  const wireFileRef = useRef<HTMLInputElement>(null);
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

  // Inline edit mode for the estimated payment date (must click the edit button — no accidental edits)
  const [editingEpdId, setEditingEpdId] = useState<number | null>(null);

  // BL-date prompt for payment terms like "60 days from BL"
  const [blPrompt, setBlPrompt] = useState<{ opId: number; opNumber: string; days: number; terms: string } | null>(null);
  const [blDate, setBlDate] = useState('');
  const [blFile, setBlFile] = useState<File | null>(null);
  const [blScanning, setBlScanning] = useState(false);
  const [savingBl, setSavingBl] = useState(false);
  const blFileRef = useRef<HTMLInputElement>(null);

  /**
   * Stores a manual estimated payment date, or clears the override when `val` is
   * empty — the server then re-derives the date from the payment terms, so the
   * response is what gets applied rather than the value typed here.
   */
  const saveEstimatedPaymentDate = async (opId: number, val: string) => {
    try {
      const { data } = await api.patch(`/operations/${opId}/dates`, { estimated_payment_date: val });
      setOperations(prev => prev.map(o => o.id === opId ? {
        ...o,
        estimated_payment_date: data.estimated_payment_date || undefined,
        estimated_payment_date_source: data.estimated_payment_date_source ?? null,
      } : o));
      if (!val) {
        addToast(data.estimated_payment_date
          ? 'Reset to the date derived from the payment terms'
          : 'Override cleared — payment terms do not yet give a date', 'info');
      }
    } catch {
      addToast('Failed to update estimated payment date', 'error');
    }
  };

  const openBlPrompt = (op: Operation) => {
    const days = paymentTermsDays(op.order_payment_terms);
    if (days == null) return;
    setBlPrompt({ opId: op.id, opNumber: op.operation_number, days, terms: op.order_payment_terms || '' });
    setBlDate(op.bl_date || todayISO());
    setBlFile(null);
  };

  const closeBlPrompt = () => {
    setBlPrompt(null);
    setBlFile(null);
    setBlScanning(false);
  };

  // Upload a BL document and read its date — the date payment terms count from.
  const scanBlFile = async (file: File) => {
    setBlFile(file);
    setBlScanning(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/bl-scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (data.bl_date) {
        setBlDate(data.bl_date);
        addToast('BL date detected from document', 'success');
      } else {
        addToast('Could not read a date from the BL — enter it manually', 'error');
      }
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to read BL', 'error');
    } finally {
      setBlScanning(false);
    }
  };

  const submitBlPrompt = async () => {
    if (!blPrompt || !blDate) return;
    setSavingBl(true);
    try {
      // Send only the BL date: the terms say how many days follow it, so the
      // server derives the estimate and keeps it auto — a later correction to
      // the BL date or the terms then flows through on its own.
      const { data } = await api.patch(`/operations/${blPrompt.opId}/dates`, { bl_date: blDate });
      setOperations(prev => prev.map(o => o.id === blPrompt.opId ? {
        ...o,
        estimated_payment_date: data.estimated_payment_date || undefined,
        estimated_payment_date_source: data.estimated_payment_date_source ?? null,
        bl_date: blDate,
      } : o));
      // Store the BL document on the operation (best-effort) so the proof is kept
      if (blFile) {
        const fd = new FormData();
        fd.append('file', blFile);
        fd.append('notes', `Bill of Lading — BL date ${formatDate(blDate)}`);
        try { await api.post(`/operations/${blPrompt.opId}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
        catch { /* document upload is best-effort */ }
      }
      closeBlPrompt();
    } catch {
      addToast('Failed to save estimated payment date', 'error');
    } finally {
      setSavingBl(false);
    }
  };

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

  const handleDelete = async (op: Operation) => {
    const ok = confirm(
      `Delete Operation ${op.operation_number}?\n\n` +
      `This will also remove the linked order, all invoices, wire transfers, and uploaded documents. ` +
      `This cannot be undone.`
    );
    if (!ok) return;
    try {
      await api.delete(`/operations/${op.id}`);
      setOperations(prev => prev.filter(o => o.id !== op.id));
      addToast('Operation deleted', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete operation', 'error');
    }
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
      if (activeTab === 'completed' && completedYear) params.year = completedYear;
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
  }, [page, search, sortBy, sortDir, activeTab, completedYear, filterCustomer, filterStatus, filterDateField, filterDateFrom, filterDateTo]);

  useEffect(() => { setPage(1); }, [activeTab, completedYear]);
  useEffect(() => { fetchOperations(); }, [fetchOperations]);

  // Load distinct completion years when the Completed tab is active
  useEffect(() => {
    if (activeTab !== 'completed') return;
    api.get('/operations/completed-years')
      .then(r => setCompletedYears(r.data || []))
      .catch(() => setCompletedYears([]));
  }, [activeTab]);

  // ── Wire-transfer upload → scan → auto-match → approve ──────────────────────
  const startWireUpload = async (file: File) => {
    setWireFile(file);
    setWireModalOpen(true);
    setWireScanning(true);
    setWireCandidates([]);
    setWireSelectedInvoice(null);
    setWireManual(false);
    setWireSearch('');
    setWireSearchResults([]);
    // 1. Scan the document — payer, amount, currency, date and every reference
    let scan: any = {};
    try {
      const scanForm = new FormData();
      scanForm.append('file', file);
      const scanRes = await api.post('/wire-transfers/scan', scanForm, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      scan = scanRes.data || {};
    } catch {
      // scan failed — fall back to manual selection with today's date
    }
    const amount = scan.amount != null && !Number.isNaN(Number(scan.amount)) ? Number(scan.amount) : null;
    const date = scan.transfer_date || todayISO();
    const reference = scan.payment_reference || scan.bank_reference || null;
    setWireScan({ amount, date, reference, payer: scan.payer_name || null, currency: scan.currency || null });
    // 2. Rank operations on payer name + references + amount together
    try {
      const { data } = await api.post('/operations/wire-match', {
        amount,
        currency: scan.currency ?? null,
        transfer_date: scan.transfer_date ?? null,
        payer_name: scan.payer_name ?? null,
        bank_reference: scan.bank_reference ?? null,
        payment_reference: scan.payment_reference ?? null,
        references: scan.references ?? [],
        notes: scan.notes ?? null,
        raw_text: scan.raw_text ?? null,
      });
      const candidates = data.candidates || [];
      setWireCandidates(candidates);
      // Only preselect when the match is unambiguous — otherwise make the user choose.
      setWireSelectedInvoice(data.confident ? candidates[0]?.invoice_id ?? null : null);
      if (!candidates.length) setWireManual(true);
    } catch {
      setWireCandidates([]);
      setWireManual(true);
    } finally {
      setWireScanning(false);
    }
  };

  const runWireSearch = async (q: string) => {
    setWireSearching(true);
    try {
      const { data } = await api.get('/operations/wire-match/search', { params: { q } });
      setWireSearchResults(data.candidates || []);
    } catch {
      setWireSearchResults([]);
    } finally {
      setWireSearching(false);
    }
  };

  // Debounced manual search over all operations
  useEffect(() => {
    if (!wireModalOpen || !wireManual) return;
    const t = setTimeout(() => runWireSearch(wireSearch), 250);
    return () => clearTimeout(t);
  }, [wireModalOpen, wireManual, wireSearch]);

  const closeWireModal = () => {
    setWireModalOpen(false);
    setWireFile(null);
    setWireScanning(false);
    setWireCandidates([]);
    setWireSelectedInvoice(null);
    setWireScan({ amount: null, date: '', reference: null, payer: null, currency: null });
    setWireManual(false);
    setWireSearch('');
    setWireSearchResults([]);
  };

  const confirmWireAssociation = async () => {
    if (!wireFile || !wireSelectedInvoice) return;
    setWireSubmitting(true);
    try {
      const form = new FormData();
      form.append('file', wireFile);
      form.append('payment_date', wireScan.date || todayISO());
      if (wireScan.amount != null) form.append('amount', String(wireScan.amount));
      if (wireScan.currency) form.append('currency', wireScan.currency);
      if (wireScan.reference) form.append('bank_reference', wireScan.reference);
      await api.post(`/invoices/${wireSelectedInvoice}/wire-transfers`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      addToast('Wire transfer associated — invoice marked as Paid', 'success');
      closeWireModal();
      fetchOperations();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to associate wire transfer', 'error');
    } finally {
      setWireSubmitting(false);
    }
  };

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
                ['Operation #', 'Order #', 'Country', 'Customer / Supplier', 'Status', 'ETD', 'ETA', 'Docs', 'Invoices', 'Quantity (MT)', 'Invoice Total (EUR)', 'Order Date', 'Invoice Date', 'Est. Payment Date', 'Wire Transfer Date'],
                data.data.map((op: any) => [
                  op.operation_number, op.order_number || '',
                  op.country || '',
                  op.customer_name || op.supplier_name || '',
                  op.status,
                  formatDate(op.etd) || '',
                  formatDate(op.eta) || '',
                  op.doc_count, op.invoice_count,
                  op.quantity_mt > 0 ? Number(op.quantity_mt).toFixed(2) : '',
                  op.invoice_total > 0 ? Number(op.invoice_total).toFixed(2) : '',
                  formatDate(op.order_date || op.created_at) || '',
                  formatDate(op.invoice_date) || '',
                  formatDate(op.estimated_payment_date) || '',
                  formatDate(op.wire_transfer_date) || '',
                ]));
            }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <FileSpreadsheet size={16} />
            Export Excel
          </button>
          {/* Upload a wire transfer and auto-associate it to the right operation */}
          <input
            ref={wireFileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) startWireUpload(f); e.target.value = ''; }}
          />
          <button
            onClick={() => wireFileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setWireDragging(true); }}
            onDragLeave={() => setWireDragging(false)}
            onDrop={e => { e.preventDefault(); setWireDragging(false); const f = e.dataTransfer.files[0]; if (f) startWireUpload(f); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              wireDragging ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
            title="Drag a wire transfer here, or click to upload"
          >
            <Landmark size={16} />
            Upload Wire Transfer
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

      {/* Completed sub-tabs: divide by completion year */}
      {activeTab === 'completed' && completedYears.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCompletedYear('')}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              completedYear === ''
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            All years
          </button>
          {completedYears.map(y => (
            <button
              key={y}
              onClick={() => setCompletedYear(y)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                completedYear === y
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

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
                <th
                  className={thSortable}
                  onClick={() => handleSort('name')}
                >
                  <span className="flex items-center gap-1">
                    Customer / Supplier <SortIcon field="name" />
                  </span>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Order #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Country</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Preview</th>
                <th
                  className={thSortable}
                  onClick={() => handleSort('status')}
                >
                  <span className="flex items-center gap-1">
                    Status <SortIcon field="status" />
                  </span>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ETD</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ETA</th>
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
                <th className="text-right px-2 py-3 font-medium text-gray-600 w-10"></th>
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
                    {op.customer_name || op.supplier_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {op.order_number || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      defaultValue={op.country || suggestedCountry(op)}
                      placeholder="—"
                      title={op.order_destination ? `Order destination: ${op.order_destination}` : ''}
                      onBlur={async e => {
                        const val = e.target.value.trim();
                        const current = op.country || suggestedCountry(op);
                        if (val === current) return;
                        setOperations(prev => prev.map(o => o.id === op.id ? { ...o, country: val } : o));
                        try { await api.patch(`/operations/${op.id}/country`, { country: val }); }
                        catch { addToast('Failed to update country', 'error'); }
                      }}
                      className="w-32 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
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
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="date"
                      value={op.etd || ''}
                      onChange={async e => {
                        const val = e.target.value;
                        setOperations(prev => prev.map(o => o.id === op.id ? { ...o, etd: val } : o));
                        try { await api.patch(`/operations/${op.id}/dates`, { etd: val }); }
                        catch { addToast('Failed to update ETD', 'error'); }
                      }}
                      className="w-[130px] border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="date"
                      value={op.eta || ''}
                      onChange={async e => {
                        const val = e.target.value;
                        setOperations(prev => prev.map(o => o.id === op.id ? { ...o, eta: val } : o));
                        try { await api.patch(`/operations/${op.id}/dates`, { eta: val }); }
                        catch { addToast('Failed to update ETA', 'error'); }
                      }}
                      className="w-[130px] border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
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
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="leading-tight space-y-0.5">
                      <div className="text-gray-700">{formatDate(op.order_date) || formatDate(op.created_at) || '—'}</div>
                      {op.invoice_date && (
                        <div className="text-[11px] text-gray-400">Inv: {formatDate(op.invoice_date)}</div>
                      )}
                      {(() => {
                        // The date is derived and stored server-side when the
                        // invoice lands, so this only displays what is on record
                        // — no browser-only value the dashboard cannot see.
                        const days = paymentTermsDays(op.order_payment_terms);
                        const isBL = paymentTermsMentionsBL(op.order_payment_terms);
                        const blBased = isBL && days != null;
                        const hasInvoice = op.invoice_count > 0;
                        const value = op.estimated_payment_date || '';
                        const isManual = op.estimated_payment_date_source === 'manual';
                        const isAuto = !!value && !isManual;
                        // BL-based terms cannot resolve until the BL date is known.
                        const needsBL = !value && hasInvoice && blBased && !op.bl_date;
                        const editing = editingEpdId === op.id;
                        return (
                          <div className="flex items-center gap-1 text-[11px] text-gray-500">
                            <span>Est. Pay:</span>
                            {editing ? (
                              <>
                                <input
                                  type="date"
                                  autoFocus
                                  defaultValue={value}
                                  onBlur={e => { saveEstimatedPaymentDate(op.id, e.target.value); setEditingEpdId(null); }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingEpdId(null); }}
                                  className="border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                                {isManual && (
                                  // Clearing the field is what hands the date back
                                  // to the payment-terms calculation.
                                  <button
                                    onMouseDown={e => { e.preventDefault(); saveEstimatedPaymentDate(op.id, ''); setEditingEpdId(null); }}
                                    className="p-0.5 rounded text-gray-400 hover:bg-gray-200 hover:text-primary-600"
                                    title="Reset to the date derived from the payment terms"
                                  >
                                    <RotateCcw size={11} />
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <span className={isAuto ? 'text-gray-400 italic' : value ? 'text-gray-700' : 'text-gray-300'}>
                                  {value ? formatDate(value) : '—'}
                                </span>
                                {isManual && (
                                  <span className="px-1 rounded bg-gray-100 text-gray-500 text-[9px] uppercase tracking-wide">set</span>
                                )}
                                {/* BL-based terms get their own action for
                                    recording the BL the terms count from; the
                                    pencil beside it always allows a manual
                                    override, whatever the terms say. */}
                                {blBased && (
                                  <button
                                    onClick={() => openBlPrompt(op)}
                                    className={`p-0.5 rounded hover:bg-gray-200 ${needsBL ? 'text-amber-600 hover:text-amber-700' : 'text-gray-400 hover:text-primary-600'}`}
                                    title={needsBL
                                      ? `Terms: "${op.order_payment_terms}". Upload the BL or set the BL date to compute the estimated payment date.`
                                      : `Terms: "${op.order_payment_terms}". Update the Bill of Lading date.`}
                                  >
                                    {needsBL
                                      ? <span className="flex items-center gap-0.5 font-medium">BL<Upload size={10} /></span>
                                      : <Upload size={11} />}
                                  </button>
                                )}
                                <button
                                  onClick={() => setEditingEpdId(op.id)}
                                  className="p-0.5 rounded text-gray-400 hover:bg-gray-200 hover:text-primary-600"
                                  title={
                                    isManual ? 'Set by hand — click to change, or reset to the payment-terms date'
                                    : isAuto ? `Auto: ${blBased ? 'BL' : 'invoice'} date + ${days} days. Click to override.`
                                    : days == null ? 'No day count in the order payment terms — set a date by hand'
                                    : !hasInvoice ? 'Estimated once the invoice is entered — or set a date by hand'
                                    : 'Set the estimated payment date by hand'
                                  }
                                >
                                  <Pencil size={11} />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })()}
                      {op.wire_transfer_date && (
                        <div className="text-[11px] text-gray-400">WT: {formatDate(op.wire_transfer_date)}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleDelete(op)}
                      className="text-gray-300 hover:text-red-600 p-1 rounded hover:bg-red-50"
                      title="Delete operation and all linked records"
                    >
                      <Trash2 size={14} />
                    </button>
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

      {/* Wire-transfer association (approve) modal */}
      {wireModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeWireModal}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Landmark size={18} className="text-primary-600" />
                Associate Wire Transfer
              </h2>
              <button onClick={closeWireModal} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Scanned details — editable, the scan is a suggestion not a verdict */}
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm">
                <p className="text-xs font-medium text-gray-500 mb-1.5">{wireFile?.name}</p>
                {wireScanning ? (
                  <p className="flex items-center gap-2 text-gray-500"><Loader2 size={14} className="animate-spin" /> Reading document…</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] text-gray-500">Amount {wireScan.currency ? `(${wireScan.currency})` : ''}</span>
                        <input
                          type="number" step="0.01"
                          value={wireScan.amount ?? ''}
                          onChange={e => setWireScan(s => ({ ...s, amount: e.target.value === '' ? null : Number(e.target.value) }))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Amount"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-gray-500">Payment date</span>
                        <input
                          type="date"
                          value={wireScan.date}
                          onChange={e => setWireScan(s => ({ ...s, date: e.target.value }))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
                      <span>Payer: <strong className="text-gray-900">{wireScan.payer || '—'}</strong></span>
                      {wireScan.reference && <span className="truncate max-w-full">Ref: <strong className="text-gray-900">{wireScan.reference}</strong></span>}
                    </div>
                  </div>
                )}
              </div>

              {/* Candidate operations */}
              {!wireScanning && !wireManual && (
                wireCandidates.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">
                    No matching operation found — search manually below.
                  </p>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">
                      Select the operation to associate ({wireCandidates.length} candidate{wireCandidates.length !== 1 ? 's' : ''}, best match first):
                    </p>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {wireCandidates.map((c, i) => {
                        const selected = wireSelectedInvoice === c.invoice_id;
                        return (
                          <button
                            key={c.invoice_id}
                            onClick={() => setWireSelectedInvoice(c.invoice_id)}
                            className={`w-full text-left rounded-lg border p-3 transition-colors ${
                              selected ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200' : 'border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                {c.operation_number}
                                {i === 0 && <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">best</span>}
                                {c.invoice_status === 'paid' && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">invoice paid</span>}
                              </span>
                              <span className="text-sm font-bold text-gray-900">
                                €{Number(c.invoice_eur).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-0.5 text-xs text-gray-500">
                              <span>{c.customer_name || '—'} · {c.invoice_number}</span>
                              <span className="capitalize">{c.operation_status}</span>
                            </div>
                            {c.reasons?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {c.reasons.map((r: string) => (
                                  <span key={r} className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded">{r}</span>
                                ))}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Manual selection over every operation */}
              {!wireScanning && wireManual && (
                <div>
                  <div className="relative mb-2">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      autoFocus
                      value={wireSearch}
                      onChange={e => setWireSearch(e.target.value)}
                      placeholder="Search operation, customer, invoice or order number…"
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {wireSearching && <p className="text-xs text-gray-500 py-2 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Searching…</p>}
                    {!wireSearching && wireSearchResults.length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-4">No operation invoices found.</p>
                    )}
                    {wireSearchResults.map(c => {
                      const selected = wireSelectedInvoice === c.invoice_id;
                      return (
                        <button
                          key={c.invoice_id}
                          onClick={() => setWireSelectedInvoice(c.invoice_id)}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            selected ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200' : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                              {c.operation_number}
                              {c.invoice_status === 'paid' && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">invoice paid</span>}
                            </span>
                            <span className="text-sm font-bold text-gray-900">
                              €{Number(c.invoice_eur).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5 text-xs text-gray-500">
                            <span>{c.customer_name || '—'} · {c.invoice_number}</span>
                            <span className="capitalize">{c.operation_status}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {!wireScanning && (
                <button
                  onClick={() => { setWireManual(m => !m); setWireSelectedInvoice(null); }}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                  {wireManual ? '← Back to suggested matches' : 'Choose the operation manually instead'}
                </button>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
              <button onClick={closeWireModal} className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100">Cancel</button>
              <button
                onClick={confirmWireAssociation}
                disabled={wireScanning || wireSubmitting || !wireSelectedInvoice}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
              >
                {wireSubmitting && <Loader2 size={14} className="animate-spin" />}
                Confirm association
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewItem && (
        <FilePreviewModal
          fileName={previewItem.fileName}
          url={previewUrl}
          loading={previewLoading}
          onClose={closePreview}
          onDownload={() => downloadFile(previewItem.filePath, previewItem.fileName, previewItem.subfolder)}
        />
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

      {/* ── BL Date Prompt ─────────────────────────────────────────────────── */}
      {blPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !savingBl && !blScanning && closeBlPrompt()}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">
                BL date — {blPrompt.opNumber}
              </h3>
              <button onClick={() => !savingBl && !blScanning && closeBlPrompt()} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <p className="text-sm text-gray-600">
                Payment terms: <span className="font-medium text-gray-900">"{blPrompt.terms}"</span>
                <br />
                Upload the Bill of Lading to read its date automatically, or enter the BL date manually.
                The estimated payment date is <span className="font-medium">BL + {blPrompt.days} days{paymentTermsEndOfMonth(blPrompt.terms) ? ", then the end of that month" : ""}</span>.
              </p>

              {/* Upload BL — auto-detect the date */}
              <div>
                <input
                  ref={blFileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) scanBlFile(f); e.target.value = ''; }}
                />
                <button
                  type="button"
                  onClick={() => blFileRef.current?.click()}
                  disabled={blScanning}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-primary-400 hover:bg-primary-50 disabled:opacity-60"
                >
                  {blScanning
                    ? <><Loader2 size={15} className="animate-spin" /> Reading BL…</>
                    : <><Upload size={15} /> {blFile ? blFile.name : 'Upload Bill of Lading (auto-detect date)'}</>}
                </button>
                {blFile && !blScanning && (
                  <p className="text-xs text-green-600 mt-1">BL attached — it will be saved to the operation's documents.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">BL Date</label>
                <input
                  type="date"
                  value={blDate}
                  onChange={e => setBlDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {blDate && (
                  <p className="text-xs text-gray-500 mt-1.5">
                    Estimated payment date: <span className="font-medium text-gray-800">{formatDate(computeEstimatedPaymentDate({ payment_terms: blPrompt.terms, bl_date: blDate })?.date || '')}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeBlPrompt}
                disabled={savingBl}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-60"
              >
                Skip — not known yet
              </button>
              <button
                onClick={submitBlPrompt}
                disabled={savingBl || !blDate}
                className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 flex items-center gap-2"
              >
                {savingBl && <Loader2 size={15} className="animate-spin" />}
                {savingBl ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
