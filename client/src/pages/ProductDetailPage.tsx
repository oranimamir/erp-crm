import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Eye, FileText, Loader2, Package, Pencil, Tag, Upload, X, Layers } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import { KINDS, KIND_LABEL, docTitle, canPreview, type ProductDoc, type ProductDocKind } from '../components/ProductDocumentsTab';

/**
 * A product's page (Inventory → Products → click a product): its details, its
 * library documents by category (the same documents as Inventory → Documents —
 * an upload here is linked to this product and shows there too), the batches
 * of this product with their COAs, and the general documents that cover every
 * product.
 */

interface Product { id: number; name: string; sku: string | null; category: string | null; notes: string | null; created_at?: string }
interface BatchDoc { id: number; document_type: 'coa' | 'other'; document_name: string | null; file_path: string; file_name: string; created_at: string }
interface Batch { id: number; batch_number: string; category: string | null; is_finished: number; notes: string | null; documents: BatchDoc[] }
interface Overview { product: Product; documents: ProductDoc[]; general: ProductDoc[]; batches: Batch[] }

const CATEGORIES = ['Circulac', 'Naturlac'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';
const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { addToast } = useToast();
  const preview = useFilePreview();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGeneral, setShowGeneral] = useState(false);

  // Upload: a category, optional title, one or more files
  const [kind, setKind] = useState<ProductDocKind>('msds');
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Edit the product itself
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', sku: '', category: 'Circulac', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get(`/products/${id}/overview`)
      .then(res => setData(res.data))
      .catch(err => addToast(err.response?.data?.error || 'Failed to load the product', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const libFile = (d: ProductDoc) => ({ fileName: d.file_name, filePath: d.file_path, subfolder: 'product-docs', label: `${KIND_LABEL[d.kind]} — ${docTitle(d)}` });
  const batchFile = (b: Batch, d: BatchDoc) => ({ fileName: d.file_name, filePath: d.file_path, subfolder: 'batch-documents', label: `${b.batch_number} — ${d.document_type === 'coa' ? 'COA' : d.document_name || 'Document'}` });

  async function upload() {
    if (!data || !files.length) return;
    setUploading(true);
    let done = 0;
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('kind', kind);
        if (title.trim() && files.length === 1) fd.append('title', title.trim());
        fd.append('product_ids', JSON.stringify([data.product.id]));
        await api.post('/product-documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        done++;
      }
      addToast(`${done} document${done === 1 ? '' : 's'} added as ${KIND_LABEL[kind]} — also in Inventory → Documents`, 'success');
      setFiles([]);
      setTitle('');
      load();
    } catch (err: any) {
      addToast(`${done ? `${done} added, then: ` : ''}${err.response?.data?.error || 'Upload failed'}`, 'error');
      load();
    } finally {
      setUploading(false);
    }
  }

  function openEdit() {
    if (!data) return;
    const p = data.product;
    setForm({ name: p.name || '', sku: p.sku || '', category: p.category || 'Circulac', notes: p.notes || '' });
    setEditing(true);
  }

  async function saveProduct() {
    if (!form.name.trim()) { addToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      await api.put(`/products/${id}`, form);
      addToast('Product saved', 'success');
      setEditing(false);
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" size={24} /></div>;
  if (!data) {
    return (
      <div className="space-y-4">
        <Link to="/inventory?tab=products" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} /> Back to Products</Link>
        <p className="text-sm text-gray-500">This product could not be found.</p>
      </div>
    );
  }

  const { product, documents, general, batches } = data;
  const byKind = (k: ProductDocKind) => documents.filter(d => d.kind === k);
  const batchDocCount = batches.reduce((n, b) => n + b.documents.length, 0);

  const docRow = (d: ProductDoc, shared?: boolean) => (
    <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
      <FileText size={16} className="text-gray-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{docTitle(d)}</p>
        <p className="text-xs text-gray-500 truncate">
          {d.doc_code && <span className="font-mono mr-1.5">{d.doc_code}</span>}
          {d.file_name} · {formatDate(d.created_at)}
          {shared ? ' · all products' : d.products.length > 1 ? ` · also ${d.products.filter(p => p.id !== product.id).map(p => p.name).join(', ')}` : ''}
        </p>
      </div>
      {canPreview(d.file_name) && (
        <button onClick={() => preview.open(libFile(d))} title="Preview" className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Eye size={15} /></button>
      )}
      <button onClick={() => preview.download(libFile(d))} title="Download" className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Download size={15} /></button>
    </li>
  );

  return (
    <div className="space-y-5">
      <Link to="/inventory?tab=products" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Back to Products
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Package size={22} className="text-primary-600" /> {product.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-500">Product code</span>
              {product.sku
                ? <span className="font-mono font-semibold text-gray-900">{product.sku}</span>
                : <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">Code missing</span>}
              {product.category && <Badge variant={product.category === 'Naturlac' ? 'green' : 'blue'}>{product.category}</Badge>}
            </div>
            {product.notes && <p className="mt-2 text-sm text-gray-600 whitespace-pre-line">{product.notes}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-gray-500">
              <p><strong className="text-gray-900">{documents.length}</strong> document{documents.length === 1 ? '' : 's'}</p>
              <p><strong className="text-gray-900">{batches.length}</strong> batch{batches.length === 1 ? '' : 'es'}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={openEdit}><Pencil size={14} /> Edit</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Library documents of this product, by category */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-800 flex items-center gap-2"><FileText size={16} className="text-gray-500" /> Documents</h2>
              <Link to="/inventory?tab=documents" className="text-xs text-primary-600 hover:underline">All documents →</Link>
            </div>
            {documents.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No documents linked to this product yet — upload them on the right.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {KINDS.filter(k => byKind(k).length).map(k => (
                  <div key={k}>
                    <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{KIND_LABEL[k]} ({byKind(k).length})</p>
                    <ul>{byKind(k).map(d => docRow(d))}</ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Batches of this product with their COAs */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Layers size={16} className="text-gray-500" /> Batches & COAs</h2>
              <Link to="/inventory?tab=batches" className="text-xs text-primary-600 hover:underline">All batches →</Link>
            </div>
            {batches.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No batches of this product.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {batches.map(b => (
                  <li key={b.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-gray-900">{b.batch_number}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${b.is_finished ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>{b.is_finished ? 'Finished' : 'Ongoing'}</span>
                      {b.category && <span className="text-xs text-gray-500">{b.category}</span>}
                    </div>
                    {b.documents.length === 0 ? (
                      <p className="text-xs text-gray-400 mt-1">No COA or documents</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {b.documents.map(d => (
                          <span key={d.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                            <Tag size={10} /> {d.document_type === 'coa' ? 'COA' : d.document_name || 'Document'}
                            {canPreview(d.file_name) && (
                              <button onClick={() => preview.open(batchFile(b, d))} className="p-0.5 text-sky-400 hover:text-sky-700" title="Preview"><Eye size={11} /></button>
                            )}
                            <button onClick={() => preview.download(batchFile(b, d))} className="p-0.5 text-sky-400 hover:text-sky-700" title="Download"><Download size={11} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {batchDocCount > 0 && <p className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">Batch documents are managed in Inventory → Batches.</p>}
          </Card>

          {/* Documents that cover every product */}
          {general.length > 0 && (
            <Card>
              <button type="button" onClick={() => setShowGeneral(v => !v)} className="w-full px-5 py-3.5 flex items-center justify-between text-left">
                <span className="font-semibold text-gray-800 text-sm">General documents (all products) <span className="font-normal text-gray-400">· {general.length}</span></span>
                <span className="text-xs text-primary-600">{showGeneral ? 'Hide' : 'Show'}</span>
              </button>
              {showGeneral && <ul className="border-t border-gray-100 divide-y divide-gray-100">{general.map(d => docRow(d, true))}</ul>}
            </Card>
          )}
        </div>

        {/* Upload documents for this product */}
        <Card className="p-5 h-fit lg:sticky lg:top-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-3"><Upload size={16} className="text-gray-500" /> Add documents</h2>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Category</label>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map(k => (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${kind === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files || [])]); }}
              onClick={() => fileRef.current?.click()}
              className={`rounded-xl border-2 border-dashed px-3 py-5 text-center text-sm cursor-pointer transition-colors ${dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:bg-gray-50'}`}>
              <Upload size={18} className="mx-auto mb-1 text-gray-400" />
              Drop files here or <span className="text-primary-600">choose</span>
              <p className="text-[11px] text-gray-400 mt-0.5">PDF, images or Word</p>
              <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden"
                onChange={e => { setFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
            </div>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-gray-700">
                    <FileText size={12} className="text-gray-400 shrink-0" /> <span className="truncate flex-1">{f.name}</span>
                    <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
            {files.length === 1 && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500">Title (optional)</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Read off the file name when empty" className={inputCls} />
              </div>
            )}
            <Button onClick={upload} disabled={uploading || !files.length} className="w-full justify-center">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {files.length ? `Add ${files.length} as ${KIND_LABEL[kind]}` : 'Add'}
            </Button>
            <p className="text-[11px] text-gray-400">Linked to {product.name} and listed in Inventory → Documents, so operations can add them from the library.</p>
          </div>
        </Card>
      </div>

      <Modal open={editing} onClose={() => !saving && setEditing(false)} title={`Edit ${product.name}`} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Product code</label>
              <input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="Fill in when known" className={`${inputCls} font-mono`} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Category</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={inputCls}>
              {[...new Set([...CATEGORIES, form.category].filter(Boolean))].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Notes</label>
            <textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveProduct} disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save</Button>
          </div>
        </div>
      </Modal>

      {preview.modal}
    </div>
  );
}
