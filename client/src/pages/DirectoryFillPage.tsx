import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';
import { ArrowLeft, Building2, CheckCircle, Loader2, Sparkles, Truck, Users } from 'lucide-react';

// Customer and supplier details gathered from the documents on file, shown
// beside what each record holds today. Nothing is saved until the user
// applies the values they ticked (and may edit first).

type Field = 'company' | 'address' | 'vat_number' | 'email' | 'phone' | 'contact_person';

interface Row {
  kind: 'customer' | 'supplier' | 'new_supplier';
  id: number | null;
  name: string;
  category?: string;
  billed_as?: string[];
  invoices?: number;
  current: Record<string, string>;
  proposed: Partial<Record<Field, { value: string; source: string }>>;
}

const LABELS: Record<Field, string> = {
  company: 'Legal name', address: 'Address', vat_number: 'VAT / Tax ID',
  email: 'Email', phone: 'Phone', contact_person: 'Contact person',
};
const CUSTOMER_FIELDS: Field[] = ['company', 'address', 'vat_number', 'email', 'phone', 'contact_person'];
const SUPPLIER_FIELDS: Field[] = ['address', 'vat_number', 'email', 'phone', 'contact_person'];
const CATEGORIES = [
  { value: 'raw_materials', label: 'Raw materials' },
  { value: 'blenders', label: 'Blenders' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'logistics', label: 'Logistics' },
];

const rowKey = (r: Row) => `${r.kind}:${r.id ?? r.name}`;
const fieldsOf = (r: Row) => (r.kind === 'customer' ? CUSTOMER_FIELDS : SUPPLIER_FIELDS);

export default function DirectoryFillPage() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [readInfo, setReadInfo] = useState<{ documents: number; errors: string[] } | null>(null);
  const [applying, setApplying] = useState(false);
  // Per row+field: ticked, and the (editable) value to save
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [addNew, setAddNew] = useState<Record<string, boolean>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});

  function adopt(data: { customers: Row[]; suppliers: Row[] }) {
    const all = [...data.customers, ...data.suppliers];
    setRows(all);
    const t: Record<string, boolean> = {};
    const v: Record<string, string> = {};
    for (const r of all) {
      for (const f of fieldsOf(r)) {
        const p = r.proposed[f];
        if (!p) continue;
        const k = `${rowKey(r)}|${f}`;
        v[k] = p.value;
        // Only fill what is empty; replacing an existing value is a deliberate tick
        t[k] = !r.current[f] && p.value !== r.current[f];
      }
    }
    setTicked(t);
    setValues(v);
    setCategories(Object.fromEntries(all.filter(r => r.kind === 'new_supplier').map(r => [rowKey(r), r.category || 'raw_materials'])));
    setAddNew(prev => ({ ...Object.fromEntries(all.filter(r => r.kind === 'new_supplier').map(r => [rowKey(r), true])), ...prev }));
  }

  async function load(ai: boolean) {
    ai ? setReading(true) : setLoading(true);
    try {
      const { data } = await api.get('/directory/suggestions', { params: ai ? { ai: 1 } : {}, timeout: 10 * 60 * 1000 });
      adopt(data);
      if (ai) {
        setReadInfo({ documents: data.documents_read, errors: data.errors || [] });
        addToast(`Read ${data.documents_read} document${data.documents_read === 1 ? '' : 's'}`, 'success');
      }
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to gather details', 'error');
    } finally {
      setLoading(false);
      setReading(false);
    }
  }

  useEffect(() => { load(false); }, []);

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      if (r.kind === 'new_supplier' && addNew[rowKey(r)]) { n++; continue; }
      if (fieldsOf(r).some(f => ticked[`${rowKey(r)}|${f}`])) n++;
    }
    return n;
  }, [rows, ticked, addNew]);

  async function apply() {
    const updates = rows.flatMap((r): Array<Record<string, unknown>> => {
      const key = rowKey(r);
      const fields = Object.fromEntries(
        fieldsOf(r).filter(f => ticked[`${key}|${f}`]).map(f => [f, values[`${key}|${f}`] ?? ''])
      );
      if (r.kind === 'new_supplier') {
        return addNew[key] ? [{ kind: r.kind, name: r.name, category: categories[key], fields }] : [];
      }
      return Object.keys(fields).length ? [{ kind: r.kind, id: r.id, fields }] : [];
    });
    if (!updates.length) { addToast('Nothing ticked to save', 'info'); return; }
    setApplying(true);
    try {
      const { data } = await api.post('/directory/apply', { updates });
      addToast(
        `Saved: ${data.customersUpdated} customer${data.customersUpdated === 1 ? '' : 's'}, ` +
        `${data.suppliersUpdated} supplier${data.suppliersUpdated === 1 ? '' : 's'} updated, ` +
        `${data.suppliersCreated} supplier${data.suppliersCreated === 1 ? '' : 's'} added`,
        'success',
      );
      await load(false);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setApplying(false);
    }
  }

  const customers = rows.filter(r => r.kind === 'customer');
  const existingSuppliers = rows.filter(r => r.kind === 'supplier');
  const newSuppliers = rows.filter(r => r.kind === 'new_supplier');

  return (
    <div className="space-y-6">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Fill in details from documents</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl">
            Customer and supplier details found in your orders, invoices and billing profiles, next to what each record holds now.
            Empty fields are ticked for you; tick a filled one to replace it. You can edit any value before saving — nothing is saved until you click Save.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => load(true)} disabled={reading || loading}
            title="Reads the latest invoice or order of each customer and supplier that still has gaps">
            {reading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {reading ? 'Reading documents…' : 'Read documents with AI'}
          </Button>
          <Button onClick={apply} disabled={applying || !selectedCount}>
            {applying ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
            Save {selectedCount ? `(${selectedCount})` : ''}
          </Button>
        </div>
      </div>

      {reading && (
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Reading each customer's and supplier's latest document — this can take a minute or two.
          Documents already read are remembered, so running it again is quick.
        </p>
      )}
      {readInfo && readInfo.errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Some documents could not be read: {readInfo.errors.join('; ')}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={24} /></div>
      ) : (
        <>
          <Group title="Customers" icon={<Users size={16} />} rows={customers} {...{ ticked, setTicked, values, setValues }} />
          <Group title="Suppliers" icon={<Truck size={16} />} rows={existingSuppliers} {...{ ticked, setTicked, values, setValues }} />
          <Group
            title="Sales-activity suppliers not in the Suppliers tab"
            subtitle="They bill your sales activities but have no supplier record. Ticked ones are added to Suppliers."
            icon={<Building2 size={16} />}
            rows={newSuppliers}
            {...{ ticked, setTicked, values, setValues }}
            renderHeader={r => (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={!!addNew[rowKey(r)]}
                    onChange={e => setAddNew(p => ({ ...p, [rowKey(r)]: e.target.checked }))} />
                  Add to Suppliers
                </label>
                <select value={categories[rowKey(r)] || 'raw_materials'}
                  onChange={e => setCategories(p => ({ ...p, [rowKey(r)]: e.target.value }))}
                  className="text-xs border border-gray-300 rounded px-1.5 py-1">
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            )}
          />
        </>
      )}
    </div>
  );
}

function Group({ title, subtitle, icon, rows, ticked, setTicked, values, setValues, renderHeader }: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  rows: Row[];
  ticked: Record<string, boolean>;
  setTicked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  values: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  renderHeader?: (r: Row) => React.ReactNode;
}) {
  if (!rows.length) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">{icon} {title} <span className="text-gray-400 font-normal text-sm">({rows.length})</span></h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {rows.map(r => {
          const key = rowKey(r);
          const fields = fieldsOf(r);
          const found = fields.filter(f => r.proposed[f]);
          return (
            <div key={key} className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                  {r.id && r.kind !== 'new_supplier'
                    ? <Link to={`/${r.kind === 'customer' ? 'customers' : 'suppliers'}/${r.id}`} className="font-medium text-gray-900 hover:text-primary-600">{r.name}</Link>
                    : <span className="font-medium text-gray-900">{r.name}</span>}
                  {!!r.invoices && <span className="ml-2 text-xs text-gray-400">{r.invoices} sales invoice{r.invoices === 1 ? '' : 's'}</span>}
                </div>
                {renderHeader?.(r)}
              </div>
              <div className="divide-y divide-gray-50">
                {fields.map(f => {
                  const k = `${key}|${f}`;
                  const p = r.proposed[f];
                  const current = r.current[f];
                  if (!p) {
                    return (
                      <div key={f} className="px-4 py-2 grid grid-cols-[110px_1fr] gap-3 text-sm">
                        <span className="text-gray-400">{LABELS[f]}</span>
                        <span className={current ? 'text-gray-700 whitespace-pre-line' : 'text-gray-300'}>{current || 'not found'}</span>
                      </div>
                    );
                  }
                  const same = current && current.trim() === p.value.trim();
                  return (
                    <div key={f} className="px-4 py-2 grid grid-cols-[110px_1fr] gap-3 text-sm items-start">
                      <label className="flex items-center gap-1.5 text-gray-500 pt-1">
                        <input type="checkbox" checked={!!ticked[k]} disabled={!!same}
                          onChange={e => setTicked(t => ({ ...t, [k]: e.target.checked }))} />
                        {LABELS[f]}
                      </label>
                      <div className="space-y-1 min-w-0">
                        {same ? (
                          <p className="text-gray-700 whitespace-pre-line">{current} <span className="text-xs text-green-600">✓ already on record</span></p>
                        ) : (
                          <>
                            {f === 'address'
                              ? <textarea rows={Math.min(4, (values[k] || '').split('\n').length)} value={values[k] ?? ''}
                                  onChange={e => { setValues(v => ({ ...v, [k]: e.target.value })); setTicked(t => ({ ...t, [k]: true })); }}
                                  className={`w-full rounded border px-2 py-1 text-sm ${ticked[k] ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200'}`} />
                              : <input value={values[k] ?? ''}
                                  onChange={e => { setValues(v => ({ ...v, [k]: e.target.value })); setTicked(t => ({ ...t, [k]: true })); }}
                                  className={`w-full rounded border px-2 py-1 text-sm ${ticked[k] ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200'}`} />}
                            <p className="text-[11px] text-gray-400">
                              from {p.source}
                              {current && <> · replaces <span className="text-gray-600">{current.replace(/\n/g, ', ')}</span></>}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!found.length && (
                <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-50">
                  Nothing found yet{r.kind === 'customer' ? '' : ' — try "Read documents with AI"'}.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
