import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';
import {
  ArrowLeft, Plus, Trash2, Loader2, Upload, FileText, X,
  Eye, ShoppingCart, CheckCircle, FileDown, Search,
} from 'lucide-react';

// ── Unit conversion helpers ───────────────────────────────────────────────
function toLbs(qty: number, unit: string): number {
  switch ((unit || '').toLowerCase()) {
    case 'kg':   return qty * 2.20462;
    case 'tons':
    case 'mt':   return qty * 2204.623;
    default:     return qty;
  }
}
function pricePerLb(price: number, unit: string): number {
  switch ((unit || '').toLowerCase()) {
    case 'kg':   return price / 2.20462;
    case 'tons':
    case 'mt':   return price / 2204.623;
    default:     return price;
  }
}

interface LineItem {
  line: number;
  reference: string;
  commercial_name: string;
  packaging: string;
  quantity_lb: string;
  price_per_lb: string;
}

const emptyLine = (n: number): LineItem => ({
  line: n, reference: '', commercial_name: '', packaging: '', quantity_lb: '', price_per_lb: '',
});

const DEFAULT_COMPANY = {
  company_name: 'TripleW BV',
  company_address1: 'Innovatiestraat 1',
  company_address2: '2030 Antwerpen, Belgium',
  company_tel: '',
  company_email: '',
  company_vat: '',
};

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  wrapClass?: string;
}
const F = ({ wrapClass = '', className = '', ...props }: FieldProps) => (
  <span className={wrapClass}>
    <input
      className={`bg-transparent border-b border-dashed border-current/25 focus:border-current/60 focus:outline-none transition-colors ${className}`}
      {...props}
    />
  </span>
);

interface TAProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
const TA = ({ className = '', ...props }: TAProps) => (
  <textarea
    className={`bg-transparent border-b border-dashed border-current/25 focus:border-current/60 focus:outline-none transition-colors resize-none w-full ${className}`}
    {...props}
  />
);

export default function InvoiceGeneratorPage() {
  const navigate     = useNavigate();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Template state
  const [templateExists,    setTemplateExists]    = useState(false);
  const [templateUploading, setTemplateUploading] = useState(false);
  const [useTemplate,       setUseTemplate]       = useState(false);

  // Orders
  const [orders,         setOrders]         = useState<any[]>([]);
  const [orderSearch,    setOrderSearch]    = useState('');
  const [showOrderDrop,  setShowOrderDrop]  = useState(false);
  const [connectedOrder, setConnectedOrder] = useState<any | null>(null);
  const orderDropRef = useRef<HTMLDivElement>(null);

  // Company info
  const [company, setCompany] = useState({ ...DEFAULT_COMPANY });

  // Invoice header
  const [header, setHeader] = useState({
    invoice_number: '',
    invoice_date:   new Date().toISOString().slice(0, 10),
    sq_number: '', ref_number: '', po_number: '',
  });

  // Client
  const [client, setClient] = useState({
    client_name: '', contact_person: '', billing_address: '',
  });

  // Line items
  const [items, setItems] = useState<LineItem[]>([emptyLine(1)]);

  // Terms
  const [terms, setTerms] = useState({
    payment_terms: '', description: '', incoterm: '', delivery: '',
    requested_delivery_date: '', remarks: '',
  });

  // Bank
  const [bank, setBank] = useState({
    bank_name: '', iban: '', bic: '', bank_address: '',
  });

  // Preview
  const [previewing,  setPreviewing]  = useState(false);
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // ── Load template + orders on mount ──────────────────────────────────
  useEffect(() => {
    api.get('/invoice-template').then(r => {
      setTemplateExists(r.data.exists);
      if (r.data.exists && r.data.config) {
        const cfg = r.data.config;
        setUseTemplate(true);
        setCompany(prev => ({
          company_name:     cfg.company_name     || prev.company_name,
          company_address1: cfg.company_address1 || prev.company_address1,
          company_address2: cfg.company_address2 || prev.company_address2,
          company_tel:      cfg.company_tel      || prev.company_tel,
          company_email:    cfg.company_email    || prev.company_email,
          company_vat:      cfg.company_vat      || prev.company_vat,
        }));
        setBank(prev => ({
          bank_name:    cfg.bank_name    || prev.bank_name,
          iban:         cfg.iban         || prev.iban,
          bic:          cfg.bic          || prev.bic,
          bank_address: cfg.bank_address || prev.bank_address,
        }));
      }
    }).catch(() => {});

    api.get('/orders', { params: { limit: 200, type: 'customer' } })
      .then(r => setOrders(r.data.data || []))
      .catch(() => {});
  }, []);

  // Close order dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (orderDropRef.current && !orderDropRef.current.contains(e.target as Node)) {
        setShowOrderDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Template upload / remove ─────────────────────────────────────────
  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !file.name.endsWith('.docx')) {
      addToast('Only PDF or Word (.docx) files allowed', 'error'); return;
    }
    setTemplateUploading(true);
    try {
      const fd = new FormData();
      fd.append('template', file);
      const res = await api.post('/invoice-template', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setTemplateExists(true);
      setUseTemplate(true);
      const cfg = res.data.config || {};
      setCompany(prev => ({
        company_name:     cfg.company_name     || prev.company_name,
        company_address1: cfg.company_address1 || prev.company_address1,
        company_address2: cfg.company_address2 || prev.company_address2,
        company_tel:      cfg.company_tel      || prev.company_tel,
        company_email:    cfg.company_email    || prev.company_email,
        company_vat:      cfg.company_vat      || prev.company_vat,
      }));
      setBank(prev => ({
        bank_name:    cfg.bank_name    || prev.bank_name,
        iban:         cfg.iban         || prev.iban,
        bic:          cfg.bic          || prev.bic,
        bank_address: cfg.bank_address || prev.bank_address,
      }));
      addToast('Template uploaded', 'success');
    } catch {
      addToast('Failed to upload template', 'error');
    } finally {
      setTemplateUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTemplateRemove = async () => {
    try {
      await api.delete('/invoice-template');
      setTemplateExists(false);
      setUseTemplate(false);
      addToast('Template removed', 'success');
    } catch {
      addToast('Failed to remove template', 'error');
    }
  };

  // ── Connect order ────────────────────────────────────────────────────
  const connectOrder = async (order: any) => {
    setShowOrderDrop(false);
    setOrderSearch('');
    try {
      const res = await api.get(`/orders/${order.id}`);
      const o = res.data;
      setConnectedOrder(o);
      setClient(prev => ({
        ...prev,
        client_name:     o.customer_name    || prev.client_name,
        billing_address: o.billing_address  || prev.billing_address,
        contact_person:  o.contact_person   || prev.contact_person,
      }));
      setHeader(prev => ({
        ...prev,
        ref_number: o.order_number || prev.ref_number,
        po_number:  o.po_number    || prev.po_number,
      }));
      if (Array.isArray(o.items) && o.items.length > 0) {
        setItems(o.items.map((it: any, idx: number) => ({
          line:            idx + 1,
          reference:       it.sku || it.description || '',
          commercial_name: it.description || '',
          packaging:       it.packaging   || '',
          quantity_lb:     it.quantity ? toLbs(parseFloat(it.quantity), it.unit || 'lbs').toFixed(2) : '',
          price_per_lb:    it.unit_price ? pricePerLb(parseFloat(it.unit_price), it.unit || 'lbs').toFixed(4) : '',
        })));
      }
      if (o.payment_terms)  setTerms(prev => ({ ...prev, payment_terms: o.payment_terms }));
      if (o.inco_terms)     setTerms(prev => ({ ...prev, incoterm: o.inco_terms }));
      if (o.delivery_date)  setTerms(prev => ({ ...prev, requested_delivery_date: o.delivery_date }));
      if (o.destination)    setTerms(prev => ({ ...prev, delivery: o.destination }));
      addToast(`Loaded: ${o.order_number}`, 'success');
    } catch {
      addToast('Could not load order details', 'error');
    }
  };

  const disconnectOrder = () => {
    setConnectedOrder(null);
    setOrderSearch('');
  };

  // ── Line item helpers ────────────────────────────────────────────────
  const addItem    = () => setItems(prev => [...prev, emptyLine(prev.length + 1)]);
  const removeItem = (idx: number) =>
    setItems(prev => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, line: i + 1 })));
  const updateItem = (idx: number, field: keyof LineItem, value: string) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const grandTotal = items.reduce(
    (sum, it) => sum + (parseFloat(it.quantity_lb) || 0) * (parseFloat(it.price_per_lb) || 0), 0
  );

  // ── Build payload ────────────────────────────────────────────────────
  const buildPayload = () => ({
    use_template: useTemplate && templateExists,
    ...company, ...header, ...client, ...terms, ...bank,
    items: items.map(it => ({
      line:            it.line,
      reference:       it.reference,
      commercial_name: it.commercial_name,
      packaging:       it.packaging,
      quantity_lb:     parseFloat(it.quantity_lb)  || 0,
      price_per_lb:    parseFloat(it.price_per_lb) || 0,
    })),
  });

  // ── Preview PDF ──────────────────────────────────────────────────────
  const handlePreview = async () => {
    if (!header.invoice_number.trim()) { addToast('Please enter an invoice number', 'error'); return; }
    setPreviewing(true);
    try {
      const res = await api.post('/invoice-generate', buildPayload(), { responseType: 'blob' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPreviewUrl(url);
      setShowPreview(true);
    } catch {
      addToast('Failed to generate preview', 'error');
    } finally {
      setPreviewing(false);
    }
  };

  // ── Download ─────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = `${header.invoice_number || 'invoice'}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    addToast('PDF downloaded', 'success');
  };

  const closePreview = () => {
    setShowPreview(false);
  };

  // ── Filtered orders for dropdown ─────────────────────────────────────
  const filteredOrders = orders.filter(o => {
    const q = orderSearch.toLowerCase();
    return !q || (o.order_number || '').toLowerCase().includes(q) || (o.customer_name || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/invoices')} className="p-1.5 text-gray-400 hover:text-gray-700 rounded">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-bold text-gray-900 mr-2">Generate Invoice PDF</h1>

        {/* Template controls */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={handleTemplateUpload}
        />
        {templateExists ? (
          <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-3 py-1 text-xs">
            <FileText size={12} className="text-green-600" />
            <span className="text-green-700 font-medium">Template active</span>
            <label className="flex items-center gap-1 ml-1 cursor-pointer text-gray-600">
              <input type="checkbox" checked={useTemplate} onChange={e => setUseTemplate(e.target.checked)} className="rounded scale-75" />
              use as base
            </label>
            <button onClick={() => fileInputRef.current?.click()} className="text-blue-500 hover:underline ml-1">replace</button>
            <button onClick={handleTemplateRemove} className="text-gray-400 hover:text-red-500 ml-0.5"><X size={11} /></button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={templateUploading}
            className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-300 rounded-full px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
          >
            {templateUploading ? <><Loader2 size={12} className="animate-spin" /> Uploading...</> : <><Upload size={12} /> Upload template</>}
          </button>
        )}

        {/* Preview button in toolbar */}
        <div className="ml-auto">
          <Button onClick={handlePreview} disabled={previewing}>
            {previewing
              ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
              : <><Eye size={16} /> Preview Invoice</>
            }
          </Button>
        </div>
      </div>

      {/* ── Order Connection Card ───────────────────────────────────────── */}
      <div className={`rounded-xl border-2 transition-colors ${connectedOrder ? 'border-green-200 bg-green-50' : 'border-dashed border-gray-200 bg-gray-50'}`}>
        {connectedOrder ? (
          /* Connected state */
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle size={18} className="text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-900">
                    Connected to order: <span className="font-bold">{connectedOrder.order_number}</span>
                  </p>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-green-700">
                    {connectedOrder.customer_name && (
                      <span>Customer: <span className="font-medium">{connectedOrder.customer_name}</span></span>
                    )}
                    {connectedOrder.items?.length > 0 && (
                      <span>{connectedOrder.items.length} line item{connectedOrder.items.length !== 1 ? 's' : ''} loaded</span>
                    )}
                    {connectedOrder.inco_terms && (
                      <span>Incoterm: <span className="font-medium">{connectedOrder.inco_terms}</span></span>
                    )}
                    {connectedOrder.payment_terms && (
                      <span>Terms: <span className="font-medium">{connectedOrder.payment_terms}</span></span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={disconnectOrder}
                className="flex items-center gap-1 text-xs text-green-700 hover:text-red-600 border border-green-200 hover:border-red-200 rounded-full px-3 py-1 transition-colors"
              >
                <X size={11} /> Disconnect
              </button>
            </div>
          </div>
        ) : (
          /* No order connected */
          <div className="px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <ShoppingCart size={16} className="text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700">Connect to an Order <span className="text-gray-400 font-normal">(optional)</span></p>
                <p className="text-xs text-gray-400 mt-0.5">Auto-fill client details and line items from a customer order</p>
              </div>
              {/* Order search dropdown */}
              <div className="relative flex-shrink-0" ref={orderDropRef}>
                <button
                  onClick={() => setShowOrderDrop(v => !v)}
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 shadow-sm"
                >
                  <Search size={14} className="text-gray-400" />
                  <span>Select order…</span>
                </button>
                {showOrderDrop && (
                  <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50">
                    <div className="p-2 border-b border-gray-100">
                      <input
                        autoFocus
                        type="text"
                        value={orderSearch}
                        onChange={e => setOrderSearch(e.target.value)}
                        placeholder="Search by order # or customer…"
                        className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                      {filteredOrders.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-gray-400 text-center">No orders found</p>
                      ) : filteredOrders.map(o => (
                        <button
                          key={o.id}
                          onClick={() => connectOrder(o)}
                          className="w-full text-left px-4 py-2.5 hover:bg-primary-50 transition-colors"
                        >
                          <p className="text-sm font-medium text-gray-900">{o.order_number}</p>
                          <p className="text-xs text-gray-500">{o.customer_name || 'No customer'}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Invoice Canvas ──────────────────────────────────────────────── */}
      <div className="bg-white shadow-xl rounded-sm border border-gray-200 overflow-hidden">

        {/* Teal header */}
        <div className="bg-teal-600 text-white px-8 py-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1 min-w-0 space-y-1">
              <F
                value={company.company_name}
                onChange={e => setCompany({ ...company, company_name: e.target.value })}
                className="text-xl font-bold text-white placeholder-white/50 w-full"
                placeholder="Company Name"
              />
              <div>
                <F
                  value={company.company_address1}
                  onChange={e => setCompany({ ...company, company_address1: e.target.value })}
                  className="text-sm text-teal-100 placeholder-teal-300/70 w-56"
                  placeholder="Address line 1"
                />
              </div>
              <div>
                <F
                  value={company.company_address2}
                  onChange={e => setCompany({ ...company, company_address2: e.target.value })}
                  className="text-sm text-teal-100 placeholder-teal-300/70 w-64"
                  placeholder="City, Country"
                />
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-xs text-teal-100">
                <span>VAT: <F value={company.company_vat} onChange={e => setCompany({ ...company, company_vat: e.target.value })} className="text-teal-100 placeholder-teal-300/70 w-28" placeholder="BE0123456789" /></span>
                <span>Tel: <F value={company.company_tel} onChange={e => setCompany({ ...company, company_tel: e.target.value })} className="text-teal-100 placeholder-teal-300/70 w-28" placeholder="+32 ..." /></span>
                <span>Email: <F value={company.company_email} onChange={e => setCompany({ ...company, company_email: e.target.value })} className="text-teal-100 placeholder-teal-300/70 w-40" placeholder="info@company.com" /></span>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <h1 className="text-3xl font-bold uppercase tracking-widest mb-3 text-white">INVOICE</h1>
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-end gap-2">
                  <span className="text-teal-200 text-xs w-12 text-right">No:</span>
                  <F
                    value={header.invoice_number}
                    onChange={e => setHeader({ ...header, invoice_number: e.target.value })}
                    className="text-white font-semibold text-right w-32 placeholder-white/50"
                    placeholder="INV-001"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-teal-200 text-xs w-12 text-right">Date:</span>
                  <F
                    type="date"
                    value={header.invoice_date}
                    onChange={e => setHeader({ ...header, invoice_date: e.target.value })}
                    className="text-white text-right w-32 placeholder-white/50"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-teal-200 text-xs w-12 text-right">SQ#:</span>
                  <F value={header.sq_number} onChange={e => setHeader({ ...header, sq_number: e.target.value })} className="text-teal-100 text-right w-32 placeholder-teal-300/70" placeholder="SQ-001" />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-teal-200 text-xs w-12 text-right">Ref#:</span>
                  <F value={header.ref_number} onChange={e => setHeader({ ...header, ref_number: e.target.value })} className="text-teal-100 text-right w-32 placeholder-teal-300/70" placeholder="REF-001" />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-teal-200 text-xs w-12 text-right">PO#:</span>
                  <F value={header.po_number} onChange={e => setHeader({ ...header, po_number: e.target.value })} className="text-teal-100 text-right w-32 placeholder-teal-300/70" placeholder="PO-001" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Client section */}
        <div className="px-8 py-5 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Bill To</p>
          <div className="space-y-1">
            <F
              value={client.client_name}
              onChange={e => setClient({ ...client, client_name: e.target.value })}
              className="text-base font-semibold text-gray-800 w-80 placeholder-gray-300"
              placeholder="Client / Company Name"
            />
            <div>
              <F
                value={client.contact_person}
                onChange={e => setClient({ ...client, contact_person: e.target.value })}
                className="text-sm text-gray-600 w-72 placeholder-gray-300"
                placeholder="Contact Person"
              />
            </div>
            <div>
              <TA
                value={client.billing_address}
                onChange={e => setClient({ ...client, billing_address: e.target.value })}
                rows={2}
                className="text-sm text-gray-600 placeholder-gray-300 w-80"
                placeholder="Billing address…"
              />
            </div>
          </div>
        </div>

        {/* Line items table */}
        <div className="px-8 py-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-teal-600 text-white text-xs">
                  <th className="px-3 py-2 text-center font-medium w-8">#</th>
                  <th className="px-3 py-2 text-left font-medium w-24">Reference</th>
                  <th className="px-3 py-2 text-left font-medium">Commercial Names</th>
                  <th className="px-3 py-2 text-left font-medium w-24">Packaging</th>
                  <th className="px-3 py-2 text-right font-medium w-28">Qty (lb)</th>
                  <th className="px-3 py-2 text-right font-medium w-30">Price/lb (USD)</th>
                  <th className="px-3 py-2 text-right font-medium w-26">Total USD</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it, idx) => {
                  const qty   = parseFloat(it.quantity_lb)  || 0;
                  const price = parseFloat(it.price_per_lb) || 0;
                  const total = qty * price;
                  return (
                    <tr key={idx} className="hover:bg-gray-50 group">
                      <td className="px-3 py-2 text-center text-gray-400 text-xs">{it.line}</td>
                      <td className="px-3 py-2">
                        <input type="text" value={it.reference} onChange={e => updateItem(idx, 'reference', e.target.value)}
                          className="w-full border-b border-dashed border-gray-200 focus:border-teal-400 bg-transparent focus:outline-none text-sm placeholder-gray-300"
                          placeholder="Ref" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" value={it.commercial_name} onChange={e => updateItem(idx, 'commercial_name', e.target.value)}
                          className="w-full border-b border-dashed border-gray-200 focus:border-teal-400 bg-transparent focus:outline-none text-sm placeholder-gray-300"
                          placeholder="Product name" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" value={it.packaging} onChange={e => updateItem(idx, 'packaging', e.target.value)}
                          className="w-full border-b border-dashed border-gray-200 focus:border-teal-400 bg-transparent focus:outline-none text-sm placeholder-gray-300"
                          placeholder="25kg bags" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={it.quantity_lb} onChange={e => updateItem(idx, 'quantity_lb', e.target.value)}
                          className="w-full border-b border-dashed border-gray-200 focus:border-teal-400 bg-transparent focus:outline-none text-sm text-right placeholder-gray-300"
                          placeholder="0.00" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={it.price_per_lb} step="0.0001" onChange={e => updateItem(idx, 'price_per_lb', e.target.value)}
                          className="w-full border-b border-dashed border-gray-200 focus:border-teal-400 bg-transparent focus:outline-none text-sm text-right placeholder-gray-300"
                          placeholder="0.0000" />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-700 text-xs whitespace-nowrap">
                        {total ? total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="px-1 py-2">
                        {items.length > 1 && (
                          <button onClick={() => removeItem(idx)} className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-red-500 transition-opacity">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-teal-600 bg-teal-50">
                  <td colSpan={5} />
                  <td className="px-3 py-2 text-right text-xs font-semibold text-teal-800 uppercase">Total (USD)</td>
                  <td className="px-3 py-2 text-right font-bold text-teal-900 text-sm">
                    {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <button onClick={addItem} className="mt-2 flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 transition-colors">
            <Plus size={13} /> Add line
          </button>
        </div>

        {/* Terms & Remarks */}
        <div className="px-8 py-5 bg-gray-50 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Terms &amp; Conditions</p>
          <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm text-gray-700">
            <div className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-36 text-xs pt-0.5">Payment Terms:</span>
              <F value={terms.payment_terms} onChange={e => setTerms({ ...terms, payment_terms: e.target.value })} className="text-gray-800 flex-1 w-full placeholder-gray-300" placeholder="e.g. Net 30" />
            </div>
            <div className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-36 text-xs pt-0.5">Description:</span>
              <F value={terms.description} onChange={e => setTerms({ ...terms, description: e.target.value })} className="text-gray-800 flex-1 w-full placeholder-gray-300" placeholder="Order description" />
            </div>
            <div className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-36 text-xs pt-0.5">Incoterm:</span>
              <F value={terms.incoterm} onChange={e => setTerms({ ...terms, incoterm: e.target.value })} className="text-gray-800 flex-1 w-full placeholder-gray-300" placeholder="e.g. FOB, CIF" />
            </div>
            <div className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-36 text-xs pt-0.5">Delivery:</span>
              <F value={terms.delivery} onChange={e => setTerms({ ...terms, delivery: e.target.value })} className="text-gray-800 flex-1 w-full placeholder-gray-300" placeholder="Port / destination" />
            </div>
            <div className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-36 text-xs pt-0.5">Requested Delivery:</span>
              <F type="date" value={terms.requested_delivery_date} onChange={e => setTerms({ ...terms, requested_delivery_date: e.target.value })} className="text-gray-800 flex-1 placeholder-gray-300" />
            </div>
            <div className="flex items-start gap-2 col-span-2">
              <span className="text-gray-500 shrink-0 w-36 text-xs pt-0.5">Remarks:</span>
              <TA value={terms.remarks} onChange={e => setTerms({ ...terms, remarks: e.target.value })} rows={2} className="text-gray-800 flex-1 placeholder-gray-300" placeholder="Additional remarks…" />
            </div>
          </div>
        </div>

        {/* Bank details */}
        {!useTemplate && (
          <div className="px-8 py-5 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Payment / Bank Details</p>
            <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm text-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 shrink-0 w-24 text-xs">Bank:</span>
                <F value={bank.bank_name} onChange={e => setBank({ ...bank, bank_name: e.target.value })} className="text-gray-800 flex-1 placeholder-gray-300" placeholder="Bank name" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 shrink-0 w-24 text-xs">IBAN:</span>
                <F value={bank.iban} onChange={e => setBank({ ...bank, iban: e.target.value })} className="text-gray-800 flex-1 font-mono placeholder-gray-300" placeholder="BE00 0000 0000 0000" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 shrink-0 w-24 text-xs">BIC / SWIFT:</span>
                <F value={bank.bic} onChange={e => setBank({ ...bank, bic: e.target.value })} className="text-gray-800 flex-1 font-mono placeholder-gray-300" placeholder="GEBABEBB" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 shrink-0 w-24 text-xs">Bank Address:</span>
                <F value={bank.bank_address} onChange={e => setBank({ ...bank, bank_address: e.target.value })} className="text-gray-800 flex-1 placeholder-gray-300" placeholder="Bank address" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom action bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-5 py-3 shadow-sm">
        <p className="text-sm text-gray-500">
          {connectedOrder
            ? <>Linked to <span className="font-medium text-gray-800">{connectedOrder.order_number}</span> · {connectedOrder.customer_name}</>
            : 'Fill in the invoice details above, then preview before downloading.'
          }
        </p>
        <Button onClick={handlePreview} disabled={previewing} size="lg">
          {previewing
            ? <><Loader2 size={18} className="animate-spin" /> Generating…</>
            : <><Eye size={18} /> Preview Invoice</>
          }
        </Button>
      </div>

      {/* ── PDF Preview Modal ───────────────────────────────────────────── */}
      {showPreview && previewUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 backdrop-blur-sm">
          {/* Modal header */}
          <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-teal-600" />
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  Invoice Preview: <span className="text-teal-600">{header.invoice_number || 'Draft'}</span>
                </p>
                <p className="text-xs text-gray-500">Review the invoice below. Download when you're satisfied.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={closePreview}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← Back to edit
              </button>
              <Button onClick={handleDownload}>
                <FileDown size={16} /> Download PDF
              </Button>
            </div>
          </div>
          {/* PDF viewer */}
          <div className="flex-1 overflow-hidden p-4">
            <iframe
              src={previewUrl}
              className="w-full h-full rounded-lg bg-white shadow-xl"
              title="Invoice Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}
