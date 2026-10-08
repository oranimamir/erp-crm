import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, PackageOpen, Plus, Trash2, Save, Loader2, Upload, FileText, Eye, Download, FileStack, Send,
  Library, Edit2, Columns2, Type, Pencil, Check, X,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import NcoStatusSelect from '../components/NcoStatusSelect';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import Button from '../components/ui/Button';
import DocumentGenerators from '../components/DocumentGenerators';
import SendDocumentsModal from '../components/SendDocumentsModal';
import RequiredDocuments, { type OperationDeclaration } from '../components/RequiredDocuments';
import AddFromLibraryModal from '../components/AddFromLibraryModal';
import OperationDocumentEditModal from '../components/OperationDocumentEditModal';
import DocumentCompareModal from '../components/DocumentCompareModal';
import DocxTextEditModal from '../components/DocxTextEditModal';
import { missingRequired, sortForSending, docNumber, DOC_ACCEPT } from '../lib/operationDocs';

/**
 * One non-commercial operation, with what a regular operation has: the lines
 * are the source of the generated documents — order confirmation, sample
 * invoice (SI… number, "Sample without commercial value", never revenue),
 * packing list and supplier PO (shipping NCOs: the PO only) — plus the
 * shipping documents checklist, Add from library, declarations, and the
 * numbered documents list (edit, compare, send). All filed here.
 */

interface NcoLine {
  product: string; reference: string; quantity: string; quantity_unit: string;
  unit_price: string; currency: string; hs_code: string; lots: string;
}
interface NcoDoc { id: number; file_path: string; file_name: string; category_id: number | null; category_name: string | null; notes: string | null; created_at: string; file_size?: number | null }
interface Nco {
  id: number; nco_number: string; entity: string; type: 'samples' | 'shipping';
  customer_id: number | null; supplier_id: number | null; customer_name: string | null; supplier_name: string | null;
  nco_date: string | null; notes: string | null; status?: string; items: any[]; documents: NcoDoc[];
}
interface Category { id: number; name: string }

const UNITS = ['KG', 'G', 'MT', 'L', 'ML', 'PCS', 'LBS'];
const CURRENCIES = ['EUR', 'USD', 'GBP'];

const cell = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

const blankLine = (): NcoLine => ({ product: '', reference: '', quantity: '', quantity_unit: 'KG', unit_price: '', currency: 'EUR', hs_code: '', lots: '' });
const toForm = (l: any): NcoLine => ({
  product: l.product || '', reference: l.reference || '',
  quantity: l.quantity ? String(l.quantity) : '', quantity_unit: l.quantity_unit || 'KG',
  unit_price: l.unit_price ? String(l.unit_price) : '', currency: l.currency || 'EUR',
  hs_code: l.hs_code || '', lots: (l.lots || []).join(', '),
});
const toPayload = (l: NcoLine) => ({
  product: l.product.trim(), reference: l.reference.trim(),
  quantity: Number(l.quantity) || 0, quantity_unit: l.quantity_unit, unit_price: Number(l.unit_price) || 0,
  currency: l.currency, hs_code: l.hs_code.trim(),
  lots: l.lots.split(',').map(x => x.trim()).filter(Boolean),
});

export default function NcoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const preview = useFilePreview();
  const fileRef = useRef<HTMLInputElement>(null);

  const [nco, setNco] = useState<Nco | null>(null);
  const [lines, setLines] = useState<NcoLine[]>([]);
  const [savedLines, setSavedLines] = useState('[]');
  const [savingLines, setSavingLines] = useState(false);
  const [products, setProducts] = useState<Array<{ id: number; name: string; sku: string | null }>>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [editDoc, setEditDoc] = useState<NcoDoc | null>(null);
  const [compareDocId, setCompareDocId] = useState<number | null>(null);
  const [textDocId, setTextDocId] = useState<number | null>(null);
  const [declarations, setDeclarations] = useState<OperationDeclaration[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/non-commercial-operations/${id}`);
      setNco(data);
      api.get(`/declarations/by-nco/${id}`).then(r => setDeclarations(r.data || [])).catch(() => setDeclarations([]));
      const form = (data.items || []).map(toForm);
      setLines(form.length ? form : [blankLine()]);
      setSavedLines(JSON.stringify((data.items || []).map((l: any) => toPayload(toForm(l)))));
    } catch {
      addToast('Non-commercial operation not found', 'error');
      navigate('/non-commercial-operations');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/products', { params: { limit: 10000 } }).then(r => setProducts(r.data.data || [])).catch(() => {});
    api.get('/operations/categories').then(r => {
      setCategories(r.data);
      const invoice = (r.data as Category[]).find(c => c.name === 'Invoice');
      if (invoice) setUploadCategory(String(invoice.id));
    }).catch(() => {});
  }, []);

  const payloadLines = useMemo(() => lines.map(toPayload).filter(l => l.product || l.quantity), [lines]);
  const linesDirty = JSON.stringify(payloadLines) !== savedLines;

  const setLine = (i: number, patch: Partial<NcoLine>) => setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** Picking a catalogue product fills its SKU as the reference. */
  const pickProduct = (i: number, name: string) => {
    const p = products.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
    setLine(i, { product: name, ...(p?.sku && !lines[i].reference ? { reference: p.sku } : {}) });
  };

  async function saveLines() {
    setSavingLines(true);
    try {
      const { data } = await api.put(`/non-commercial-operations/${id}`, { items: payloadLines });
      setNco(data);
      setSavedLines(JSON.stringify(payloadLines));
      addToast('Sample lines saved', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the lines', 'error');
    } finally {
      setSavingLines(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        if (uploadCategory) fd.append('category_id', uploadCategory);
        await api.post(`/non-commercial-operations/${id}/documents`, fd);
      }
      addToast(`${list.length} document${list.length === 1 ? '' : 's'} uploaded`, 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  /** One file into a category (shipping document tiles). */
  async function uploadToCategory(file: File, categoryId: number) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category_id', String(categoryId));
      await api.post(`/non-commercial-operations/${id}/documents`, fd);
      await load();
      addToast('Document uploaded', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    }
  }

  /** A number of the user's own instead of the series one. */
  async function saveNumber() {
    if (renaming === null || !nco) return;
    const next = renaming.trim();
    if (!next || next === nco.nco_number) { setRenaming(null); return; }
    try {
      const { data } = await api.put(`/non-commercial-operations/${id}`, { nco_number: next });
      setNco(data);
      setRenaming(null);
      addToast(`Renumbered to ${data.nco_number} — documents already generated keep their number`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not change the number', 'error');
    }
  }

  async function deleteDoc(doc: NcoDoc) {
    if (!confirm(`Delete ${doc.file_name}? A generated document is deleted with it.`)) return;
    try {
      await api.delete(`/non-commercial-operations/${id}/documents/${doc.id}`);
      addToast('Document deleted', 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Delete failed', 'error');
    }
  }

  if (!nco) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" size={24} /></div>;

  const isSamples = nco.type === 'samples';
  const fileOf = (d: NcoDoc) => ({ fileName: d.file_name, filePath: d.file_path, subfolder: 'operation-docs', label: d.category_name || undefined });
  const owner = { kind: 'nco' as const, id: nco.id };
  // Documents in sending order, numbered as they go out (superseded drafts unnumbered)
  const sortedDocs = sortForSending(nco.documents);
  const numberedDocs = sortedDocs.filter(d => !/-DRAFT\.pdf$/i.test(d.file_name));
  const docNumbers = new Map(numberedDocs.map((d, i) => [d.id, docNumber(i, numberedDocs.length)]));

  return (
    <div className="space-y-5">
      <Link to="/non-commercial-operations" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Non-Commercial Operations
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {renaming === null ? (
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <PackageOpen size={22} className="text-gray-400" /> {nco.nco_number}
                <button type="button" onClick={() => setRenaming(nco.nco_number)} title="Use a number of your own"
                  className="p-1 rounded text-gray-300 hover:text-primary-600 hover:bg-gray-100"><Pencil size={15} /></button>
              </h1>
            ) : (
              <div className="flex items-center gap-2">
                <PackageOpen size={22} className="text-gray-400" />
                <input value={renaming} onChange={e => setRenaming(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveNumber(); if (e.key === 'Escape') setRenaming(null); }}
                  className="rounded-lg border border-gray-300 px-2 py-1 text-xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                <button type="button" onClick={saveNumber} title="Save the number" className="p-1.5 rounded-lg text-green-600 hover:bg-green-50"><Check size={18} /></button>
                <button type="button" onClick={() => setRenaming(null)} title="Cancel" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X size={18} /></button>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isSamples ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                {isSamples ? 'Samples' : 'Shipping'}
              </span>
              <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">{nco.entity}</span>
              <NcoStatusSelect ncoId={nco.id} status={nco.status} onSaved={next => setNco(prev => (prev ? { ...prev, status: next } : prev))} />
              <span className="text-gray-700">
                {isSamples ? 'To ' : 'With '}
                <span className="font-medium">{(isSamples ? nco.customer_name : nco.supplier_name) || '—'}</span>
              </span>
              {nco.nco_date && <span className="text-gray-400">· {formatDate(nco.nco_date)}</span>}
            </div>
            {nco.notes && <p className="mt-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 max-w-2xl whitespace-pre-wrap">{nco.notes}</p>}
          </div>
          <p className="text-xs text-gray-400 max-w-xs">Not a sale — never counted in revenue, the dashboard or analytics.</p>
        </div>
      </div>

      {/* Sample lines */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-800">{isSamples ? 'Sample lines' : 'Lines'}</h2>
            {isSamples && <p className="text-xs text-gray-500 mt-0.5">The order confirmation, invoice and packing list are drafted from these.</p>}
          </div>
          <Button size="sm" onClick={saveLines} disabled={savingLines || !linesDirty}>
            {savingLines ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save lines
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 w-[26%]">Product</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2 w-28">Quantity</th>
                <th className="px-3 py-2 w-24">Unit</th>
                <th className="px-3 py-2 w-28">Unit value</th>
                <th className="px-3 py-2 w-24">Currency</th>
                <th className="px-3 py-2">Lots</th>
                <th className="px-3 py-2">HS code</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <input list="nco-products" value={l.product} onChange={e => pickProduct(i, e.target.value)} placeholder="Product…" className={cell} />
                  </td>
                  <td className="px-3 py-2"><input value={l.reference} onChange={e => setLine(i, { reference: e.target.value })} className={cell} /></td>
                  <td className="px-3 py-2"><input type="number" step="any" min={0} value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} className={`${cell} text-right`} /></td>
                  <td className="px-3 py-2">
                    <select value={l.quantity_unit} onChange={e => setLine(i, { quantity_unit: e.target.value })} className={cell}>
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2"><input type="number" step="any" min={0} value={l.unit_price} onChange={e => setLine(i, { unit_price: e.target.value })} placeholder="0" className={`${cell} text-right`} /></td>
                  <td className="px-3 py-2">
                    <select value={l.currency} onChange={e => setLine(i, { currency: e.target.value })} className={cell}>
                      {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2"><input value={l.lots} onChange={e => setLine(i, { lots: e.target.value })} placeholder="L1, L2" className={cell} /></td>
                  <td className="px-3 py-2"><input value={l.hs_code} onChange={e => setLine(i, { hs_code: e.target.value })} className={cell} /></td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setLines(prev => prev.length === 1 ? [blankLine()] : prev.filter((_, j) => j !== i))}
                      className="p-1 rounded text-gray-300 hover:text-red-600" title="Remove line"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="nco-products">
            {products.map(p => <option key={p.id} value={p.name}>{p.sku || ''}</option>)}
          </datalist>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <button type="button" onClick={() => setLines(prev => [...prev, blankLine()])}
            className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700"><Plus size={14} /> Add line</button>
          {linesDirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>
      </div>

      {/* Generators */}
      {(
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2"><FileStack size={16} className="text-gray-500" /> Generate documents</h2>
            {linesDirty && <span className="text-xs text-amber-600">Save the lines first — new drafts are made from the saved lines</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DocumentGenerators orderId={null} ncoId={nco.id} ncoType={nco.type} refreshKey={nco.documents.length}
              onPreview={item => preview.open(item)} />
          </div>
          <p className="text-xs text-gray-500">
            {isSamples
              ? 'The sample invoice is numbered SI + entity + date (e.g. SIBE20260813001) and marked “Sample without commercial value” — it never enters revenue or the invoice series.'
              : 'Shipping with a supplier: generate the purchase order from these lines.'}
          </p>
        </div>
      )}

      {/* Shipping documents checklist */}
      <RequiredDocuments
        owner={owner}
        documents={nco.documents}
        categories={categories}
        onUpload={uploadToCategory}
        onPreview={(doc, label) => preview.open({ ...fileOf(doc as NcoDoc), label })}
        onFiled={load}
        onOpenFile={item => preview.open(item)}
        onEditText={docId => setTextDocId(docId)}
        declarations={declarations}
      />

      {/* Documents */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <FileText size={16} className="text-gray-500" /> Documents ({nco.documents.length})
          </h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowLibrary(true)}
              title="Add MSDS / product specification sheets / declarations from Inventory → Documents">
              <Library size={14} /> Add from library
            </Button>
            <Button size="sm" onClick={() => setShowSend(true)} disabled={nco.documents.length === 0}>
              <Send size={14} /> Send documents
            </Button>
          </div>
        </div>

        <div className="px-5 pt-4 flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-gray-500">Upload as</label>
          <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="">No category</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); uploadFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          className={`mx-5 my-3 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1.5 py-5 cursor-pointer transition-colors ${
            dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
          }`}>
          {uploading ? <Loader2 size={20} className="animate-spin text-primary-500" /> : <Upload size={20} className="text-gray-400" />}
          <p className="text-sm text-gray-600">Drag & drop files (e.g. the invoice), or click to browse</p>
          <p className="text-xs text-gray-400">PDF, images, Word, Excel, CSV, text · max 10 MB each</p>
          <input ref={fileRef} type="file" multiple accept={DOC_ACCEPT} className="hidden"
            onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {nco.documents.length === 0 ? (
          <p className="pb-6 text-center text-sm text-gray-400">No documents yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sortedDocs.map(doc => (
              <li key={doc.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                {docNumbers.has(doc.id) ? (
                  <span className="w-7 flex-shrink-0 text-center text-xs font-semibold text-primary-700 bg-primary-50 rounded py-0.5" title="Order in the Send documents email">
                    {docNumbers.get(doc.id)}
                  </span>
                ) : (
                  <span className="w-7 flex-shrink-0 text-center text-[10px] text-gray-400" title="Draft — not sent by default">draft</span>
                )}
                <FileText size={18} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {doc.category_name && <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">{doc.category_name}</span>}
                    {doc.notes && <span className="text-xs text-gray-500 truncate">{doc.notes}</span>}
                    <span className="text-xs text-gray-400">{formatDate(doc.created_at)}</span>
                  </div>
                </div>
                <button onClick={() => preview.open(fileOf(doc))} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500" title="Preview"><Eye size={15} /></button>
                <button onClick={() => preview.download(fileOf(doc))} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500" title="Download"><Download size={15} /></button>
                {/\.docx$/i.test(doc.file_name) && (
                  <button onClick={() => setTextDocId(doc.id)} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 hover:text-primary-600" title="Edit the text of this Word document"><Type size={15} /></button>
                )}
                <button onClick={() => setEditDoc(doc)} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 hover:text-primary-600" title="Edit name, category, notes or file"><Edit2 size={15} /></button>
                <button onClick={() => setCompareDocId(doc.id)} disabled={nco.documents.length < 2}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={nco.documents.length < 2 ? 'Add another document to compare with' : 'Compare with another document'}>
                  <Columns2 size={13} /> Compare with
                </button>
                <button onClick={() => deleteDoc(doc)} className="p-1.5 rounded-lg hover:bg-red-100 text-gray-400 hover:text-red-600" title="Delete"><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SendDocumentsModal
        open={showSend}
        onClose={() => setShowSend(false)}
        endpoint={`/non-commercial-operations/${nco.id}/documents/email`}
        reference={nco.nco_number}
        partyName={(isSamples ? nco.customer_name : nco.supplier_name) || ''}
        documents={sortedDocs}
        missingRequired={missingRequired(nco.documents)}
        defaultNumbered
      />

      <AddFromLibraryModal open={showLibrary} onClose={() => setShowLibrary(false)} owner={owner}
        existingNames={nco.documents.map(d => d.file_name)} onAdded={load} />
      <OperationDocumentEditModal doc={editDoc} apiBase={`/non-commercial-operations/${nco.id}`} categories={categories}
        onClose={() => setEditDoc(null)} onSaved={load} />
      {compareDocId !== null && (
        <DocumentCompareModal docs={nco.documents} initialLeft={compareDocId} onClose={() => setCompareDocId(null)} />
      )}
      <DocxTextEditModal endpoint={textDocId !== null ? `/non-commercial-operations/${nco.id}/documents/${textDocId}/text` : null}
        title="Edit document text" note="Only this copy changes — the library stays as it is."
        onClose={() => setTextDocId(null)} onSaved={load} />

      {preview.modal}
    </div>
  );
}
