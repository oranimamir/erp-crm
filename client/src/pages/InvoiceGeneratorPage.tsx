import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { ArrowLeft, Plus, Trash2, FileDown, Loader2, Upload, FileText, X } from 'lucide-react';

// ── Unit conversion helpers ───────────────────────────────────────────────
function toLbs(qty: number, unit: string): number {
  switch ((unit || '').toLowerCase()) {
    case 'kg':   return qty * 2.20462;
    case 'tons':
    case 'mt':   return qty * 2204.623;
    default:     return qty; // lbs / pcs etc. pass through
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

// ── Line item type ────────────────────────────────────────────────────────
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

// ── Default TripleW company data ──────────────────────────────────────────
const DEFAULT_COMPANY = {
  company_name: 'TripleW BV',
  company_address1: 'Innovatiestraat 1',
  company_address2: '2030 Antwerpen, Belgium',
  company_tel: '',
  company_email: '',
  company_vat: '',
};

export default function InvoiceGeneratorPage() {
  const navigate  = useNavigate();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Template state
  const [templateExists,   setTemplateExists]   = useState(false);
  const [templateUploading, setTemplateUploading] = useState(false);
  const [useTemplate,       setUseTemplate]       = useState(false);

  // Orders list
  const [orders,          setOrders]          = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');

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

  const [generating, setGenerating] = useState(false);

  // ── On mount: load template status + orders ──────────────────────────
  useEffect(() => {
    api.get('/invoice-template').then(r => {
      setTemplateExists(r.data.exists);
      if (r.data.exists && r.data.config) {
        const cfg = r.data.config;
        setUseTemplate(true);
        // Auto-fill company & bank from extracted template config
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

  // ── Template upload ──────────────────────────────────────────────────
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
      const res = await api.post('/invoice-template', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
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
      addToast('Template uploaded and company details extracted', 'success');
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

  // ── Auto-fill from order ─────────────────────────────────────────────
  const applyOrder = async (orderId: string) => {
    if (!orderId) return;
    try {
      const res  = await api.get(`/orders/${orderId}`);
      const order = res.data;
      setClient(prev => ({ ...prev, client_name: order.customer_name || prev.client_name }));
      setHeader(prev => ({ ...prev, ref_number: order.order_number || prev.ref_number }));
      if (Array.isArray(order.items) && order.items.length > 0) {
        setItems(order.items.map((it: any, idx: number) => ({
          line:            idx + 1,
          reference:       it.description || '',
          commercial_name: it.description || '',
          packaging:       it.packaging   || '',
          quantity_lb:     it.quantity ? toLbs(parseFloat(it.quantity), it.unit || 'lbs').toFixed(2) : '',
          price_per_lb:    it.unit_price ? pricePerLb(parseFloat(it.unit_price), it.unit || 'lbs').toFixed(4) : '',
        })));
      }
      addToast('Order details applied', 'success');
    } catch {
      addToast('Could not load order details', 'error');
    }
  };

  // ── Line item helpers ────────────────────────────────────────────────
  const addItem = () => setItems(prev => [...prev, emptyLine(prev.length + 1)]);
  const removeItem = (idx: number) =>
    setItems(prev => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, line: i + 1 })));
  const updateItem = (idx: number, field: keyof LineItem, value: string) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const grandTotal = items.reduce((sum, it) =>
    sum + (parseFloat(it.quantity_lb) || 0) * (parseFloat(it.price_per_lb) || 0), 0);

  // ── Generate PDF ─────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!header.invoice_number.trim()) { addToast('Please enter an invoice number', 'error'); return; }

    const payload = {
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
    };

    setGenerating(true);
    try {
      const res = await api.post('/invoice-generate', payload, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement('a');
      a.href = url;
      a.download = `${header.invoice_number || 'invoice'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('PDF downloaded', 'success');
    } catch {
      addToast('Failed to generate PDF', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // ── Tiny section heading ─────────────────────────────────────────────
  const SectionTitle = ({ children }: { children: string }) => (
    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-200 mb-3">
      {children}
    </h2>
  );

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/invoices')} className="p-1 text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Generate Invoice PDF</h1>
      </div>

      {/* ── Template management ──────────────────────────────────────── */}
      <Card>
        <div className="p-5">
          <SectionTitle>Invoice Template</SectionTitle>
          <p className="text-sm text-gray-500 mb-4">
            Upload your invoice template (Word .docx or PDF). The system auto-extracts your company name, address, VAT, bank &amp; IBAN details and pre-fills them below. When generating, your PDF template is used as the visual base (logo &amp; branding preserved). If no template is uploaded, a standard format is generated.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleTemplateUpload}
          />

          {templateExists ? (
            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <FileText size={20} className="text-green-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">Template uploaded</p>
                <p className="text-xs text-green-600">Company and bank details have been extracted from this template.</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useTemplate}
                    onChange={e => setUseTemplate(e.target.checked)}
                    className="rounded"
                  />
                  Use as base
                </label>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Replace
                </button>
                <button onClick={handleTemplateRemove} className="p-1 text-gray-400 hover:text-red-500">
                  <X size={16} />
                </button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={templateUploading}
            >
              {templateUploading
                ? <><Loader2 size={16} className="animate-spin" /> Uploading...</>
                : <><Upload size={16} /> Upload PDF Template</>
              }
            </Button>
          )}
        </div>
      </Card>

      {/* ── Auto-fill from order ─────────────────────────────────────── */}
      <Card>
        <div className="p-5">
          <SectionTitle>Auto-fill from Order (optional)</SectionTitle>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Order</label>
              <select
                value={selectedOrderId}
                onChange={e => { setSelectedOrderId(e.target.value); applyOrder(e.target.value); }}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">— None —</option>
                {orders.map(o => (
                  <option key={o.id} value={String(o.id)}>
                    {o.order_number} — {o.customer_name || 'Customer'}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-400 pb-2 max-w-xs">Pre-fills client name and line items. You can edit all fields.</p>
          </div>
        </div>
      </Card>

      {/* ── Company details (hidden when using template overlay) ─────── */}
      {!useTemplate && (
        <Card>
          <div className="p-5">
            <SectionTitle>Company Details</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Company Name" value={company.company_name} onChange={e => setCompany({ ...company, company_name: e.target.value })} />
              <Input label="VAT Number"   value={company.company_vat}  onChange={e => setCompany({ ...company, company_vat:  e.target.value })} />
              <Input label="Address Line 1" value={company.company_address1} onChange={e => setCompany({ ...company, company_address1: e.target.value })} />
              <Input label="Address Line 2" value={company.company_address2} onChange={e => setCompany({ ...company, company_address2: e.target.value })} />
              <Input label="Phone" value={company.company_tel}   onChange={e => setCompany({ ...company, company_tel:   e.target.value })} />
              <Input label="Email" value={company.company_email} onChange={e => setCompany({ ...company, company_email: e.target.value })} />
            </div>
          </div>
        </Card>
      )}

      {/* ── Invoice header ───────────────────────────────────────────── */}
      <Card>
        <div className="p-5">
          <SectionTitle>Invoice Details</SectionTitle>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Invoice Number *" value={header.invoice_number} onChange={e => setHeader({ ...header, invoice_number: e.target.value })} />
            <Input label="Invoice Date" type="date" value={header.invoice_date} onChange={e => setHeader({ ...header, invoice_date: e.target.value })} />
            <Input label="SQ#"  value={header.sq_number}  onChange={e => setHeader({ ...header, sq_number:  e.target.value })} />
            <Input label="Ref#" value={header.ref_number} onChange={e => setHeader({ ...header, ref_number: e.target.value })} />
            <Input label="PO#"  value={header.po_number}  onChange={e => setHeader({ ...header, po_number:  e.target.value })} />
          </div>
        </div>
      </Card>

      {/* ── Client ──────────────────────────────────────────────────── */}
      <Card>
        <div className="p-5">
          <SectionTitle>Client Information</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Client / Company Name" value={client.client_name}    onChange={e => setClient({ ...client, client_name:    e.target.value })} />
            <Input label="Contact Person"        value={client.contact_person} onChange={e => setClient({ ...client, contact_person: e.target.value })} />
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Address</label>
              <textarea
                value={client.billing_address}
                onChange={e => setClient({ ...client, billing_address: e.target.value })}
                rows={2}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Street, City, Country"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Line items ──────────────────────────────────────────────── */}
      <Card>
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Line Items</SectionTitle>
            <span className="text-sm font-semibold text-gray-700">
              Total: USD {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-center px-2 py-2 font-medium text-gray-600 w-8">#</th>
                  <th className="text-left px-2 py-2 font-medium text-gray-600 w-24">Reference</th>
                  <th className="text-left px-2 py-2 font-medium text-gray-600">Commercial Name</th>
                  <th className="text-left px-2 py-2 font-medium text-gray-600 w-24">Packaging</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-600 w-28">Qty (lb)</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-600 w-28">Price/lb (USD)</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-600 w-24">Total USD</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it, idx) => {
                  const qty   = parseFloat(it.quantity_lb)  || 0;
                  const price = parseFloat(it.price_per_lb) || 0;
                  const total = qty * price;
                  return (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5 text-center text-gray-400 text-xs">{it.line}</td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={it.reference} onChange={e => updateItem(idx, 'reference', e.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" placeholder="Ref" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={it.commercial_name} onChange={e => updateItem(idx, 'commercial_name', e.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" placeholder="Product name" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={it.packaging} onChange={e => updateItem(idx, 'packaging', e.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" placeholder="e.g. 25kg bags" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={it.quantity_lb} onChange={e => updateItem(idx, 'quantity_lb', e.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" placeholder="0.00" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={it.price_per_lb} onChange={e => updateItem(idx, 'price_per_lb', e.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" placeholder="0.0000" step="0.0001" />
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium text-gray-700 text-xs">
                        {total ? total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        {items.length > 1 && (
                          <button onClick={() => removeItem(idx)} className="p-1 text-gray-300 hover:text-red-500">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add Line</Button>
          </div>
        </div>
      </Card>

      {/* ── Terms & Remarks ──────────────────────────────────────────── */}
      <Card>
        <div className="p-5">
          <SectionTitle>Terms &amp; Remarks</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Payment Terms"   value={terms.payment_terms} onChange={e => setTerms({ ...terms, payment_terms: e.target.value })} placeholder="e.g. Net 30" />
            <Input label="Description"     value={terms.description}   onChange={e => setTerms({ ...terms, description:   e.target.value })} />
            <Input label="Incoterm"        value={terms.incoterm}      onChange={e => setTerms({ ...terms, incoterm:      e.target.value })} placeholder="e.g. FOB, CIF" />
            <Input label="Delivery"        value={terms.delivery}      onChange={e => setTerms({ ...terms, delivery:      e.target.value })} />
            <Input label="Requested Delivery Date" type="date" value={terms.requested_delivery_date} onChange={e => setTerms({ ...terms, requested_delivery_date: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
              <textarea value={terms.remarks} onChange={e => setTerms({ ...terms, remarks: e.target.value })} rows={2}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Bank details (shown even in template mode for reference) ─── */}
      {!useTemplate && (
        <Card>
          <div className="p-5">
            <SectionTitle>Bank / Payment Details</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Bank"         value={bank.bank_name}    onChange={e => setBank({ ...bank, bank_name:    e.target.value })} />
              <Input label="IBAN"         value={bank.iban}          onChange={e => setBank({ ...bank, iban:         e.target.value })} />
              <Input label="BIC / SWIFT"  value={bank.bic}           onChange={e => setBank({ ...bank, bic:          e.target.value })} />
              <Input label="Bank Address" value={bank.bank_address}  onChange={e => setBank({ ...bank, bank_address: e.target.value })} />
            </div>
          </div>
        </Card>
      )}

      {/* ── Generate button ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-6">
        {useTemplate && templateExists && (
          <p className="text-xs text-gray-400">
            Using uploaded template as base — your company logo and branding will be preserved.
          </p>
        )}
        <div className="ml-auto">
          <Button onClick={handleGenerate} disabled={generating} size="lg">
            {generating
              ? <><Loader2 size={18} className="animate-spin" /> Generating...</>
              : <><FileDown size={18} /> Generate &amp; Download PDF</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}
