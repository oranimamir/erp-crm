import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Eye, Download, RefreshCw, Trash2, Search, Loader2, FileText, Pencil, FileArchive, CheckCircle2, Type } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import Button from './ui/Button';
import Modal from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import DocxTextEditModal from './DocxTextEditModal';

/**
 * Inventory → Documents: the MSDS / product specification sheet / declaration / COA
 * library, one list per kind. A document covers any number of products (an
 * MSDS covers a whole family); one with no product is general. Import ZIP
 * loads a whole folder at once. Operations take copies of these (operation
 * page → Add from library).
 */

export type ProductDocKind = 'msds' | 'pds' | 'declaration' | 'coa';
export const KINDS: ProductDocKind[] = ['msds', 'pds', 'declaration', 'coa'];
export const KIND_LABEL: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Product Specification Sheet', declaration: 'Declaration', coa: 'COA' };
export const KIND_SHORT: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Spec sheet', declaration: 'Declaration', coa: 'COA' };

interface Product { id: number; name: string; sku: string | null }
export interface ProductDoc {
  id: number; kind: ProductDocKind; title: string | null; doc_code: string | null;
  file_path: string; file_name: string; notes: string | null; created_at: string; updated_at: string;
  uploaded_by_name: string | null; products: Product[];
}
interface ImportResult { imported: number; replaced: number; skipped: number; productsCreated: string[]; general: string[]; ignored: string[] }

export const docTitle = (d: { title: string | null; file_name: string }) => d.title || d.file_name;
/** Browsers can show PDFs and images; Word files are downloaded. */
export const canPreview = (fileName: string) => /\.(pdf|jpe?g|png|webp)$/i.test(fileName);

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';

export default function ProductDocumentsTab() {
  const { addToast } = useToast();
  const preview = useFilePreview();
  const [kind, setKind] = useState<ProductDocKind>('msds');
  const [docs, setDocs] = useState<ProductDoc[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const [form, setForm] = useState<{ doc?: ProductDoc; kind: ProductDocKind; title: string; notes: string; productIds: number[]; file: File | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState<ProductDoc | null>(null);
  const [textDoc, setTextDoc] = useState<ProductDoc | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<ProductDoc | null>(null);
  const [importing, setImporting] = useState<{ kind: ProductDocKind; file: File | null; busy: boolean; result: ImportResult | null } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/product-documents'),
      api.get('/products', { params: { limit: 10000 } }),
    ]).then(([d, p]) => {
      setDocs(d.data.data || []);
      setProducts((p.data.data || []).sort((a: Product, b: Product) => a.name.localeCompare(b.name)));
    }).catch(() => addToast('Failed to load product documents', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const q = query.trim().toLowerCase();
  const ofKind = docs.filter(d => d.kind === kind);
  const visibleDocs = useMemo(() => ofKind.filter(d => !q || [
    d.title, d.file_name, d.doc_code, d.notes, ...d.products.flatMap(p => [p.name, p.sku]),
  ].some(v => (v || '').toLowerCase().includes(q))), [docs, kind, q]);

  // Products no document of this kind names (general documents don't count)
  const missing = useMemo(() => products
    .filter(p => !ofKind.some(d => d.products.some(x => x.id === p.id)))
    .filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)), [products, docs, kind, q]);
  const covered = products.length - products.filter(p => !ofKind.some(d => d.products.some(x => x.id === p.id))).length;

  const openUpload = (productId?: number) =>
    setForm({ kind, title: '', notes: '', productIds: productId ? [productId] : [], file: null });
  const openEdit = (d: ProductDoc) =>
    setForm({ doc: d, kind: d.kind, title: d.title || '', notes: d.notes || '', productIds: d.products.map(p => p.id), file: null });

  async function saveForm() {
    if (!form) return;
    if (!form.doc && !form.file) return;
    setSaving(true);
    try {
      const fd = new FormData();
      if (form.file) fd.append('file', form.file);
      fd.append('title', form.title.trim());
      fd.append('notes', form.notes.trim());
      fd.append('product_ids', JSON.stringify(form.productIds));
      if (form.doc) {
        await api.put(`/product-documents/${form.doc.id}`, fd);
        addToast('Document updated', 'success');
      } else {
        fd.append('kind', form.kind);
        await api.post('/product-documents', fd);
        addToast(`${KIND_LABEL[form.kind]} uploaded`, 'success');
      }
      setForm(null);
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function runImport() {
    if (!importing?.file) return;
    setImporting({ ...importing, busy: true });
    try {
      const fd = new FormData();
      fd.append('file', importing.file);
      fd.append('kind', importing.kind);
      const { data } = await api.post('/product-documents/import', fd, { timeout: 300000 });
      setImporting({ ...importing, busy: false, result: data });
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Import failed', 'error');
      setImporting({ ...importing, busy: false });
    }
  }

  async function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !replacing) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.put(`/product-documents/${replacing.id}`, fd);
      addToast('Document replaced', 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Replace failed', 'error');
    } finally {
      setReplacing(null);
    }
  }

  async function confirmDelete() {
    if (!deleteDoc) return;
    try {
      await api.delete(`/product-documents/${deleteDoc.id}`);
      addToast('Document deleted', 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Delete failed', 'error');
    }
    setDeleteDoc(null);
  }

  const fileOf = (d: ProductDoc) => ({ fileName: d.file_name, filePath: d.file_path, subfolder: 'product-docs', label: `${KIND_LABEL[d.kind]} — ${docTitle(d)}` });
  const show = (d: ProductDoc) => (canPreview(d.file_name) ? preview.open(fileOf(d)) : preview.download(fileOf(d)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-gray-200">
          {KINDS.map(k => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                kind === k ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {k === 'declaration' ? 'Declarations' : KIND_LABEL[k]} <span className="ml-1 text-xs text-gray-400">{docs.filter(d => d.kind === k).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setImporting({ kind, file: null, busy: false, result: null })}>
            <FileArchive size={14} /> Import ZIP
          </Button>
          <Button size="sm" onClick={() => openUpload()}><Upload size={14} /> Upload document</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={onlyMissing ? 'Search products…' : 'Search documents or products…'}
              className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            Products without one
          </label>
          <span className="ml-auto text-xs text-gray-500">
            {covered} of {products.length} products have a{kind === 'msds' ? 'n' : ''} {KIND_LABEL[kind]}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
        ) : onlyMissing ? (
          missing.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-400">Every product has one.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-4 py-2.5 font-medium text-gray-600">Product without a{kind === 'msds' ? 'n' : ''} {KIND_LABEL[kind]}</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {missing.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{p.name}</div>
                      {p.sku && <div className="text-xs text-gray-400">{p.sku}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => openUpload(p.id)}
                        className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                        <Upload size={12} /> Upload
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : visibleDocs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">
            {ofKind.length ? 'Nothing matches.' : `No ${KIND_LABEL[kind]} documents yet — upload one or import a ZIP.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-4 py-2.5 font-medium text-gray-600">Document</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Products</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Uploaded</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleDocs.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => show(d)}
                        className="flex items-start gap-1.5 text-left text-gray-800 hover:text-primary-600 max-w-sm">
                        <FileText size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
                        <span>{docTitle(d)}</span>
                      </button>
                      <div className="text-xs text-gray-400 mt-0.5 pl-5">
                        {d.doc_code && <span className="font-mono">{d.doc_code}</span>}
                        {d.doc_code && d.notes && ' · '}
                        {d.notes}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><ProductChips products={d.products} /></td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {formatDate(d.updated_at || d.created_at)}
                      {d.uploaded_by_name && <div className="text-xs text-gray-400">{d.uploaded_by_name}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {canPreview(d.file_name) && (
                          <button onClick={() => preview.open(fileOf(d))} title="Preview" className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Eye size={15} /></button>
                        )}
                        <button onClick={() => preview.download(fileOf(d))} title="Download" className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Download size={15} /></button>
                        {/\.docx$/i.test(d.file_name) && (
                          <button onClick={() => setTextDoc(d)} title="Edit the text of this Word document" className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-100"><Type size={15} /></button>
                        )}
                        <button onClick={() => openEdit(d)} title="Edit title and products" className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-100"><Pencil size={15} /></button>
                        <button onClick={() => { setReplacing(d); replaceRef.current?.click(); }} title="Replace with a newer version"
                          className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-100"><RefreshCw size={15} /></button>
                        <button onClick={() => setDeleteDoc(d)} title="Delete" className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <input ref={replaceRef} type="file" accept={ACCEPT} className="hidden" onChange={onReplaceFile} />

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.doc ? 'Edit document' : 'Upload product document'} size="lg">
        {form && (
          <div className="space-y-4">
            {!form.doc && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <div className="flex gap-2 flex-wrap">
                  {KINDS.map(k => (
                    <button key={k} type="button" onClick={() => setForm({ ...form, kind: k })}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        form.kind === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!form.doc && (
              <label
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setForm({ ...form, file: f }); }}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 cursor-pointer transition-colors ${
                  dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}>
                <Upload size={20} className="text-gray-400" />
                <span className="text-sm text-gray-600">{form.file ? form.file.name : 'Drag & drop the file, or click to browse'}</span>
                <span className="text-xs text-gray-400">PDF, Word, JPEG, PNG, WebP · max 10 MB</span>
                <input type="file" accept={ACCEPT} className="hidden"
                  onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
              </label>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder={form.doc ? form.doc.file_name : 'Defaults to the file name'} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Products</label>
              <ProductPicker products={products} value={form.productIds} onChange={ids => setForm({ ...form, productIds: ids })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. revision, issue date" className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={saveForm} disabled={saving || (!form.doc && !form.file)}>
                {saving && <Loader2 size={14} className="animate-spin" />} {form.doc ? 'Save' : 'Upload'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!importing} onClose={() => !importing?.busy && setImporting(null)} title="Import a ZIP into the library">
        {importing && (importing.result ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-gray-800">
              <CheckCircle2 size={16} className="text-green-600" />
              {importing.result.imported} added · {importing.result.replaced} replaced · {importing.result.skipped} already there
            </p>
            {importing.result.productsCreated.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="font-medium text-amber-800">{importing.result.productsCreated.length} new product{importing.result.productsCreated.length === 1 ? '' : 's'} added — fill in their SKU</p>
                <p className="mt-1 text-xs text-amber-700">{importing.result.productsCreated.join(', ')}</p>
                <Link to="/inventory?tab=products" onClick={() => setImporting(null)} className="mt-2 inline-block text-xs font-medium text-primary-600 hover:underline">
                  Open Inventory → Products
                </Link>
              </div>
            )}
            {importing.result.general.length > 0 && (
              <p className="text-xs text-gray-500">General (no product): {importing.result.general.join(', ')}</p>
            )}
            {importing.result.ignored.length > 0 && (
              <p className="text-xs text-gray-500">Skipped (not a document): {importing.result.ignored.join(', ')}</p>
            )}
            <div className="flex justify-end pt-1"><Button onClick={() => setImporting(null)}>Done</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Import into</label>
              <div className="flex gap-2 flex-wrap">
                {KINDS.map(k => (
                  <button key={k} type="button" onClick={() => setImporting({ ...importing, kind: k })}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      importing.kind === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <label
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setImporting({ ...importing, file: f }); }}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 cursor-pointer transition-colors ${
                dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
              }`}>
              <FileArchive size={20} className="text-gray-400" />
              <span className="text-sm text-gray-600">{importing.file ? importing.file.name : 'Drag & drop the ZIP, or click to browse'}</span>
              <span className="text-xs text-gray-400">Each file is linked to the products it covers; missing products are added</span>
              <input type="file" accept=".zip" className="hidden"
                onChange={e => setImporting({ ...importing, file: e.target.files?.[0] || null })} />
            </label>
            <p className="text-xs text-gray-500">A file already in the library is replaced when it changed and left alone when it didn't.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setImporting(null)} disabled={importing.busy}>Cancel</Button>
              <Button onClick={runImport} disabled={importing.busy || !importing.file}>
                {importing.busy ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />} Import
              </Button>
            </div>
          </div>
        ))}
      </Modal>

      <ConfirmDialog open={!!deleteDoc} onClose={() => setDeleteDoc(null)} onConfirm={confirmDelete}
        title="Delete document"
        message={deleteDoc ? `Delete ${docTitle(deleteDoc)} from the library? Copies already added to operations stay.` : ''}
        confirmLabel="Delete" />

      <DocxTextEditModal endpoint={textDoc ? `/product-documents/${textDoc.id}/text` : null}
        title={textDoc ? `Edit ${docTitle(textDoc)}` : undefined}
        note="Copies already added to operations keep their text."
        onClose={() => setTextDoc(null)} onSaved={load} />

      {preview.modal}
    </div>
  );
}

/** The products a document covers; a long list folds behind "+N more". */
export function ProductChips({ products }: { products: Product[] }) {
  const [open, setOpen] = useState(false);
  if (!products.length) return <span className="text-xs text-gray-500 italic">General — all products</span>;
  const shown = open ? products : products.slice(0, 4);
  return (
    <div className="flex flex-wrap gap-1 max-w-md">
      {shown.map(p => (
        <span key={p.id} className="px-1.5 py-0.5 rounded bg-gray-100 text-xs text-gray-700">{p.name}</span>
      ))}
      {products.length > 4 && (
        <button type="button" onClick={() => setOpen(!open)} className="px-1.5 py-0.5 text-xs text-primary-600 hover:underline">
          {open ? 'less' : `+${products.length - 4} more`}
        </button>
      )}
    </div>
  );
}

/** Searchable checkbox list of products; nothing ticked = general. */
function ProductPicker({ products, value, onChange }: { products: Product[]; value: number[]; onChange: (ids: number[]) => void }) {
  const [search, setSearch] = useState('');
  const picked = new Set(value);
  const s = search.trim().toLowerCase();
  const list = products
    .filter(p => !s || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s))
    .sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)) || a.name.localeCompare(b.name));
  const toggle = (id: number) => onChange(picked.has(id) ? value.filter(v => v !== id) : [...value, id]);
  return (
    <div className="rounded-lg border border-gray-300">
      <div className="flex items-center gap-2 border-b border-gray-200 px-2 py-1.5">
        <Search size={13} className="text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
          className="flex-1 text-sm focus:outline-none" />
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {value.length ? `${value.length} selected` : 'None — general document'}
        </span>
        {value.length > 0 && <button type="button" onClick={() => onChange([])} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>}
      </div>
      <div className="max-h-52 overflow-y-auto p-1">
        {list.length ? list.map(p => (
          <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
            <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            <span className="text-gray-800">{p.name}</span>
            {p.sku && <span className="text-xs text-gray-400">{p.sku}</span>}
          </label>
        )) : <p className="px-2 py-2 text-xs text-gray-400">No products match.</p>}
      </div>
    </div>
  );
}
