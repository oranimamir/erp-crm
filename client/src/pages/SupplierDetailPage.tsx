import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { useToast } from '../contexts/ToastContext';
import { formatDate } from '../lib/dates';
import { ArrowLeft, Mail, Phone, MapPin, DollarSign, Hash, UserRound, Loader2, Save, Receipt } from 'lucide-react';

const categoryColors: Record<string, 'blue' | 'purple' | 'orange' | 'green'> = {
  logistics: 'blue', blenders: 'purple', raw_materials: 'orange', shipping: 'green',
};
const categoryLabels: Record<string, string> = {
  logistics: 'Logistics', blenders: 'Blenders', raw_materials: 'Raw Materials', shipping: 'Shipping',
};

export default function SupplierDetailPage() {
  const { id } = useParams();
  const [supplier, setSupplier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expenseInvoices, setExpenseInvoices] = useState<any[]>([]);
  const [params, setParams] = useSearchParams();
  const tab: 'summary' | 'details' = params.get('tab') === 'details' ? 'details' : 'summary';

  useEffect(() => {
    api.get(`/suppliers/${id}`)
      .then(async s => {
        setSupplier(s.data);
        // Suppliers bill through the supplier (expense) invoices, filed by name
        try {
          const r = await api.get('/demo-expenses/invoices', { params: { suppliers: s.data.name, sort_by: 'issue_date', sort_dir: 'desc' } });
          setExpenseInvoices(r.data || []);
        } catch { setExpenseInvoices([]); }
      })
      .catch(() => setSupplier(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;
  if (!supplier) return <p className="text-center py-20 text-gray-500">Supplier not found</p>;

  const fmtMoney = (amount: number | undefined | null, currency: string | undefined | null) => {
    const cur = (currency || 'EUR').toUpperCase();
    const sym = cur === 'USD' ? '$' : cur === 'GBP' ? '£' : cur === 'EUR' ? '€' : '';
    const body = Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sym ? `${sym}${body}` : `${body} ${cur}`;
  };

  return (
    <div className="space-y-6">
      <Link to="/suppliers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} /> Back to Suppliers</Link>

      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
          <Badge variant={categoryColors[supplier.category] || 'gray'}>{categoryLabels[supplier.category] || supplier.category}</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {supplier.email && <div className="flex items-center gap-2 text-gray-600"><Mail size={16} /> {supplier.email}</div>}
          {supplier.phone && <div className="flex items-center gap-2 text-gray-600"><Phone size={16} /> {supplier.phone}</div>}
          {supplier.address && <div className="flex items-start gap-2 text-gray-600"><MapPin size={16} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-line">{supplier.address}</span></div>}
          {supplier.vat_number && <div className="flex items-center gap-2 text-gray-600"><Hash size={16} /> VAT {supplier.vat_number}</div>}
          {supplier.contact_person && <div className="flex items-center gap-2 text-gray-600"><UserRound size={16} /> {supplier.contact_person}</div>}
        </div>
        {supplier.notes && <p className="mt-4 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{supplier.notes}</p>}
      </Card>

      <div className="border-b border-gray-200">
        <nav className="flex gap-0 -mb-px">
          {(['summary', 'details'] as const).map(t => (
            <button
              key={t}
              onClick={() => setParams(t === 'summary' ? {} : { tab: t })}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'details' && <SupplierDetailsForm supplier={supplier} onSaved={setSupplier} />}

      {tab === 'summary' && (() => {
        // Supplier invoices are recorded excl. VAT; EUR throughout, converted at the invoice date
        const eurOf = (r: any) => Number(r.eur_amount ?? r.amount) || 0;
        const vatOf = (r: any) => Number(r.vat_eur_amount ?? r.vat_amount) || 0;
        const year = String(new Date().getFullYear());
        const total = expenseInvoices.reduce((sum, r) => sum + eurOf(r), 0);
        const vat = expenseInvoices.reduce((sum, r) => sum + vatOf(r), 0);
        const thisYear = expenseInvoices.filter(r => String(r.issue_date || '').startsWith(year)).reduce((sum, r) => sum + eurOf(r), 0);
        const last = expenseInvoices[0]?.issue_date;
        const fmtEur = (n: number) => `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return (
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Financial Summary</h2>
              <span className="text-xs text-gray-400">from the supplier invoices, in EUR</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Total Invoices</p>
                <p className="text-xl font-bold text-blue-700">{expenseInvoices.length}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-600 font-medium">Total Spend (excl. VAT)</p>
                <p className="text-xl font-bold text-gray-700">{fmtEur(total)}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <p className="text-xs text-orange-600 font-medium">VAT</p>
                <p className="text-xl font-bold text-orange-700">{fmtEur(vat)}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 font-medium">Spend {year}</p>
                <p className="text-xl font-bold text-green-700">{fmtEur(thisYear)}</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <p className="text-xs text-purple-600 font-medium">Last Invoice</p>
                <p className="text-xl font-bold text-purple-700">{last ? formatDate(last) : '—'}</p>
              </div>
            </div>
          </Card>
        );
      })()}

      {tab === 'summary' && expenseInvoices.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Receipt size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Supplier invoices</h2>
            <Link to={`/supplier-invoices?supplier=${encodeURIComponent(supplier.name)}&tab=${expenseInvoices[0]?.domain || 'demo'}`}
              className="ml-auto text-xs text-primary-600 hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 font-medium">Invoice</th>
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-left py-2 font-medium">Category</th>
                  <th className="text-right py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {expenseInvoices.slice(0, 12).map(r => (
                  <tr key={r.id}>
                    <td className="py-2 text-gray-800">{r.invoice_id}</td>
                    <td className="py-2 text-gray-600">{formatDate(r.issue_date)}</td>
                    <td className="py-2 text-gray-600">{r.category}</td>
                    <td className="py-2 text-right text-gray-900">{fmtMoney(r.amount, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {expenseInvoices.length > 12 && <p className="text-xs text-gray-400 mt-2">Showing the latest 12.</p>}
        </Card>
      )}
    </div>
  );
}

/** Everything the documents take from this supplier: the purchase order reads it. */
function SupplierDetailsForm({ supplier, onSaved }: { supplier: any; onSaved: (s: any) => void }) {
  const { addToast } = useToast();
  const initial = () => ({
    name: supplier.name || '', category: supplier.category || 'raw_materials',
    address: supplier.address || '', vat_number: supplier.vat_number || '', contact_person: supplier.contact_person || '',
    email: supplier.email || '', phone: supplier.phone || '', notes: supplier.notes || '',
  });
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(initial()), [supplier.id]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial());
  const set = (k: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const input = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
  const label = 'block text-xs font-medium text-gray-500 mb-1';

  async function save() {
    if (!form.name.trim()) { addToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      const { data } = await api.put(`/suppliers/${supplier.id}`, form);
      onSaved(data);
      addToast('Supplier details saved', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><label className={label}>Name</label><input className={input} value={form.name} onChange={set('name')} /></div>
        <div>
          <label className={label}>Category</label>
          <select className={input} value={form.category} onChange={set('category')}>
            {Object.entries(categoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div><label className={label}>VAT / Tax ID</label><input className={input} value={form.vat_number} onChange={set('vat_number')} /></div>
        <div className="sm:col-span-2"><label className={label}>Address (one line per row)</label><textarea rows={3} className={input} value={form.address} onChange={set('address')} /></div>
        <div><label className={label}>Contact person</label><input className={input} value={form.contact_person} onChange={set('contact_person')} /></div>
        <div><label className={label}>Phone</label><input className={input} value={form.phone} onChange={set('phone')} /></div>
        <div className="sm:col-span-2"><label className={label}>Email</label><input type="email" className={input} value={form.email} onChange={set('email')} /></div>
        <div className="sm:col-span-2"><label className={label}>Notes</label><textarea rows={2} className={input} value={form.notes} onChange={set('notes')} /></div>
      </div>
      <p className="text-xs text-gray-400">Supplier purchase orders are addressed with these details.</p>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>
    </Card>
  );
}
