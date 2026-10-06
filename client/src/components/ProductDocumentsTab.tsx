import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Eye, Download, RefreshCw, Trash2, Search, Loader2, FileText } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import Button from './ui/Button';
import Modal from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';

/**
 * Inventory → Documents: the MSDS / product specification sheet library, one
 * list per category. Every catalogue product is listed, so a product still
 * missing its document shows up with an Upload shortcut. Operations take
 * copies of these (operation page → Add from library).
 */

export type ProductDocKind = 'msds' | 'pds';
export const KIND_LABEL: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Product Specification Sheet' };

export interface ProductDoc {
  id: number; product_id: number; kind: ProductDocKind; file_path: string; file_name: string;
  notes: string | null; created_at: string; updated_at: string;
  product_name: string; product_sku: string | null; uploaded_by_name: string | null;
}
interface Product { id: number; name: string; sku: string | null }

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export default function ProductDocumentsTab() {
  const { addToast } = useToast();
  const preview = useFilePreview();
  const [kind, setKind] = useState<ProductDocKind>('msds');
  const [docs, setDocs] = useState<ProductDoc[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const [upload, setUpload] = useState<{ productId: string; kind: ProductDocKind; notes: string; file: File | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState<ProductDoc | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<ProductDoc | null>(null);

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

  // One row per product: its documents of this kind (newest first), or none
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .map(p => ({ product: p, docs: docs.filter(d => d.product_id === p.id && d.kind === kind) }))
      .filter(r => !onlyMissing || r.docs.length === 0);
  }, [products, docs, kind, query, onlyMissing]);

  const covered = products.filter(p => docs.some(d => d.product_id === p.id && d.kind === kind)).length;
  const countOf = (k: ProductDocKind) => docs.filter(d => d.kind === k).length;

  const openUpload = (productId?: number) =>
    setUpload({ productId: productId ? String(productId) : '', kind, notes: '', file: null });

  async function saveUpload() {
    if (!upload?.file || !upload.productId) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', upload.file);
      fd.append('product_id', upload.productId);
      fd.append('kind', upload.kind);
      if (upload.notes.trim()) fd.append('notes', upload.notes.trim());
      await api.post('/product-documents', fd);
      addToast(`${KIND_LABEL[upload.kind]} uploaded`, 'success');
      setUpload(null);
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setSaving(false);
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

  const fileOf = (d: ProductDoc) => ({ fileName: d.file_name, filePath: d.file_path, subfolder: 'product-docs', label: `${KIND_LABEL[d.kind]} — ${d.product_name}` });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-gray-200">
          {(['msds', 'pds'] as ProductDocKind[]).map(k => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                kind === k ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {KIND_LABEL[k]} <span className="ml-1 text-xs text-gray-400">{countOf(k)}</span>
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => openUpload()}><Upload size={14} /> Upload document</Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products…"
              className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            Only products without one
          </label>
          <span className="ml-auto text-xs text-gray-500">
            {covered} of {products.length} products have a {KIND_LABEL[kind]}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
        ) : products.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">No products yet — add them under Inventory → Products.</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">Nothing matches.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-4 py-2.5 font-medium text-gray-600">Product</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">{KIND_LABEL[kind]}</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Uploaded</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ product, docs: list }) => list.length === 0 ? (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{product.name}</div>
                      {product.sku && <div className="text-xs text-gray-400">{product.sku}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-300">—</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => openUpload(product.id)}
                        className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                        <Upload size={12} /> Upload
                      </button>
                    </td>
                  </tr>
                ) : list.map((d, i) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      {i === 0 && <>
                        <div className="font-medium text-gray-900">{product.name}</div>
                        {product.sku && <div className="text-xs text-gray-400">{product.sku}</div>}
                      </>}
                    </td>
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => preview.open(fileOf(d))}
                        className="flex items-center gap-1.5 text-gray-800 hover:text-primary-600 max-w-xs">
                        <FileText size={14} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{d.file_name}</span>
                      </button>
                      {d.notes && <div className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{d.notes}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {formatDate(d.updated_at || d.created_at)}
                      {d.uploaded_by_name && <span className="text-xs text-gray-400"> · {d.uploaded_by_name}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => preview.open(fileOf(d))} title="Preview" className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Eye size={15} /></button>
                        <button onClick={() => preview.download(fileOf(d))} title="Download" className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Download size={15} /></button>
                        <button onClick={() => { setReplacing(d); replaceRef.current?.click(); }} title="Replace with a newer version"
                          className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-100"><RefreshCw size={15} /></button>
                        <button onClick={() => setDeleteDoc(d)} title="Delete" className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <input ref={replaceRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={onReplaceFile} />

      <Modal open={!!upload} onClose={() => setUpload(null)} title="Upload product document">
        {upload && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
              <select value={upload.productId} onChange={e => setUpload({ ...upload, productId: e.target.value })} className={inputCls}>
                <option value="">Choose a product…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <div className="flex gap-2">
                {(['msds', 'pds'] as ProductDocKind[]).map(k => (
                  <button key={k} type="button" onClick={() => setUpload({ ...upload, kind: k })}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      upload.kind === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <label
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setUpload({ ...upload, file: f }); }}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 cursor-pointer transition-colors ${
                dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
              }`}>
              <Upload size={20} className="text-gray-400" />
              <span className="text-sm text-gray-600">{upload.file ? upload.file.name : 'Drag & drop the file, or click to browse'}</span>
              <span className="text-xs text-gray-400">PDF, JPEG, PNG, WebP · max 10 MB</span>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                onChange={e => setUpload({ ...upload, file: e.target.files?.[0] || null })} />
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input value={upload.notes} onChange={e => setUpload({ ...upload, notes: e.target.value })}
                placeholder="e.g. revision, issue date" className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setUpload(null)}>Cancel</Button>
              <Button onClick={saveUpload} disabled={saving || !upload.file || !upload.productId}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteDoc} onClose={() => setDeleteDoc(null)} onConfirm={confirmDelete}
        title="Delete document"
        message={deleteDoc ? `Delete ${deleteDoc.file_name} from the library? Copies already added to operations stay.` : ''}
        confirmLabel="Delete" />

      {preview.modal}
    </div>
  );
}
