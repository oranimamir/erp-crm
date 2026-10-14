import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Trash2, Loader2, ShoppingCart, Eye, Download, Upload, FileText, Check, X, FilePlus2, ClipboardList,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import { DOC_ACCEPT } from '../lib/operationDocs';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import PurchaseOperationFormModal, { type PurchaseOperation } from '../components/PurchaseOperationFormModal';
import CustomerOrderPicker, { type PickedOrder } from '../components/CustomerOrderPicker';

/**
 * One purchase operation: step 1 is its supplier PO (from a customer order —
 * lines prefilled, prices blank — or from scratch, in the same generator as a
 * sales operation's Supplier PO), then the supplier's documents, several
 * uploaded at once.
 */

interface Doc {
  id: number;
  file_path: string;
  file_name: string;
  category_id: number | null;
  category_name: string | null;
  notes: string | null;
  created_at: string;
  file_size: number | null;
  generated: boolean;
  /** The PO uploaded as a document (filed as Purchase Order). */
  uploaded_po: boolean;
}

interface Detail extends PurchaseOperation {
  supplier_category: string | null;
  purchase_order: { id: number; po_number: string; status: 'draft' | 'final'; file_path: string | null; file_name: string | null; has_draft: number } | null;
  documents: Doc[];
  /** 'final' generated here, 'uploaded', 'draft' being prepared, or null. */
  purchase_order_status: 'final' | 'uploaded' | 'draft' | null;
  uploaded_po: Doc | null;
}

interface Category { id: number; name: string }

const sizeOf = (n: number | null) => n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const previewable = (name: string) => /\.(pdf|png|jpe?g|webp)$/i.test(name);

export default function PurchaseOperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const preview = useFilePreview();
  const [op, setOp] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [order, setOrder] = useState<PickedOrder | null>(null);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const [renaming, setRenaming] = useState<{ id: number; name: string; category: string } | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<Doc | null>(null);

  const load = () => api.get(`/purchase-operations/${id}`)
    .then(res => setOp(res.data))
    .catch(err => {
      addToast(err.response?.data?.error || 'Failed to load the purchase operation', 'error');
      navigate('/purchase-operations');
    })
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    api.get('/operations/categories').then(res => setCategories(res.data || [])).catch(() => {});
  }, []);

  async function upload(files: File[]) {
    if (!files.length || !op) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      if (uploadCategory) fd.append('category_id', uploadCategory);
      const { data } = await api.post(`/purchase-operations/${op.id}/documents`, fd);
      setOp(prev => prev ? { ...prev, documents: data.documents } : prev);
      addToast(`${data.added} document${data.added === 1 ? '' : 's'} added${data.skipped?.length ? ` — skipped (file type): ${data.skipped.join(', ')}` : ''}`,
        data.skipped?.length ? 'info' : 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function saveRename() {
    if (!renaming || !op) return;
    try {
      await api.put(`/purchase-operations/${op.id}/documents/${renaming.id}`, {
        file_name: renaming.name, category_id: renaming.category ? Number(renaming.category) : null,
      });
      setRenaming(null);
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    }
  }

  async function removeDoc(doc: Doc) {
    if (!op) return;
    try {
      await api.delete(`/purchase-operations/${op.id}/documents/${doc.id}`);
      addToast(doc.generated ? 'Purchase order deleted' : `${doc.file_name} deleted — kept in the Archive`, 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  async function removeDraftPo() {
    if (!op?.purchase_order || op.purchase_order.status !== 'draft') return;
    if (!window.confirm(`Delete the draft purchase order ${op.purchase_order.po_number}?`)) return;
    try {
      await api.delete(`/purchase-orders/${op.purchase_order.id}`);
      load();
    } catch { addToast('Could not delete the draft', 'error'); }
  }

  async function handleDelete() {
    if (!op) return;
    try {
      await api.delete(`/purchase-operations/${op.id}`);
      addToast(`${op.po_number} deleted`, 'success');
      navigate('/purchase-operations');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  if (loading || !op) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" size={24} /></div>;
  }

  const po = op.purchase_order;
  const poFile = po?.status === 'final' && po.file_path ? { fileName: po.file_name || `${po.po_number}.pdf`, filePath: po.file_path, subfolder: 'operation-docs', label: 'Purchase order' } : null;
  // A PO uploaded as a document counts as the PO unless one was generated here
  const uploaded = op.purchase_order_status === 'uploaded' ? op.uploaded_po : null;
  const uploadedFile = uploaded ? { fileName: uploaded.file_name, filePath: uploaded.file_path, subfolder: 'operation-docs', label: 'Purchase order (uploaded)' } : null;
  const hasPo = !!po || !!uploaded;

  return (
    <div className="space-y-5">
      <Link to="/purchase-operations" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Purchase Operations
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{op.po_number}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {op.supplier_label || 'No supplier'}{op.po_date ? ` · ${formatDate(op.po_date)}` : ''}
          </p>
          {op.notes && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{op.notes}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit</Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</Button>
        </div>
      </div>

      {/* Step 1 — the purchase order */}
      <Card>
        <div className={`p-5 ${!hasPo ? 'bg-primary-50/50 rounded-xl ring-1 ring-primary-200' : ''}`}>
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart size={16} className="text-primary-600" />
            <h2 className="font-semibold text-gray-800">Step 1 · Purchase order</h2>
            {uploaded ? (
              <span className="ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700">Uploaded ✓</span>
            ) : po && (
              <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${po.status === 'draft' ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'}`}>
                {po.status === 'draft' ? 'Draft' : `Generated ✓${po.has_draft ? ' · edits pending' : ''}`}
              </span>
            )}
          </div>
          {uploaded && uploadedFile ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-700">PO uploaded: <strong>{uploaded.file_name}</strong>
                  <span className="text-gray-400"> · {formatDate(uploaded.created_at)}</span></span>
                {previewable(uploaded.file_name) && (
                  <Button size="sm" variant="secondary" onClick={() => preview.open(uploadedFile)}><Eye size={14} /> Preview</Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => preview.download(uploadedFile)}><Download size={14} /> Download</Button>
              </div>
              <p className="text-[11px] text-gray-400">
                {po?.status === 'draft'
                  ? <>A PO is also being drafted here — <button type="button" className="text-primary-600 hover:underline" onClick={() => navigate(`/purchase-orders/${po.id}`)}>continue it</button>; once generated it becomes the PO.</>
                  : <>Want the PO from this system instead? <button type="button" className="text-primary-600 hover:underline" onClick={() => navigate(`/purchase-orders/new?purchase_operation_id=${op.id}`)}>Generate one</button>.</>}
                {' '}Filed in the documents as Purchase Order — change its category there if it isn't the PO.
              </p>
            </div>
          ) : !po ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Generate the PO first. It is numbered and filed as <strong>{op.po_number}.pdf</strong>.
                {' '}Have the PO already? Upload it below (category Purchase Order, or a name like "PO …") and it counts as the PO.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
                  <span className="text-xs font-medium text-gray-500 pl-1"><ClipboardList size={13} className="inline -mt-0.5" /> From a customer order</span>
                  <CustomerOrderPicker value={order?.id ?? null} onChange={setOrder} noneLabel="Choose the order…" />
                  <Button size="sm" disabled={!order}
                    onClick={() => navigate(`/purchase-orders/new?purchase_operation_id=${op.id}&order_id=${order!.id}`)}>
                    Start from this order
                  </Button>
                </div>
                <span className="text-xs text-gray-400">or</span>
                <Button size="sm" variant="secondary" onClick={() => navigate(`/purchase-orders/new?purchase_operation_id=${op.id}`)}>
                  <FilePlus2 size={14} /> From scratch
                </Button>
              </div>
              <p className="text-[11px] text-gray-400">From an order the products, quantities and delivery are copied — the prices are left for you to type. You can compare with any order inside the PO.</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => navigate(`/purchase-orders/${po.id}`)}>
                {po.status === 'draft' ? 'Continue the draft' : 'Open the PO'}
              </Button>
              {poFile && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => preview.open(poFile)}><Eye size={14} /> Preview</Button>
                  <Button size="sm" variant="secondary" onClick={() => preview.download(poFile)}><Download size={14} /> Download</Button>
                </>
              )}
              {po.status === 'draft' && (
                <Button size="sm" variant="secondary" onClick={removeDraftPo}><Trash2 size={14} /> Delete draft</Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Supplier documents */}
      <Card>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-800">Documents <span className="text-gray-400 font-normal">({op.documents.length})</span></h2>
            <div className="flex items-center gap-2">
              <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700" title="Category for the files you upload next">
                <option value="">No category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload files
              </Button>
              <input ref={fileInput} type="file" multiple accept={DOC_ACCEPT} className="hidden"
                onChange={e => upload(Array.from(e.target.files || []))} />
            </div>
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files || [])); }}
            className={`rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${
              dragging ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-400'
            }`}>
            {uploading ? 'Uploading…' : 'Drop the supplier\'s documents here — as many as you like at once (PDF, images, Word, Excel, CSV, text)'}
          </div>

          {op.documents.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {op.documents.map(d => {
                const file = { fileName: d.file_name, filePath: d.file_path, subfolder: 'operation-docs' };
                const editing = renaming?.id === d.id;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <FileText size={16} className="shrink-0 text-gray-400" />
                    {editing ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <input value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })}
                          className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm" autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null); }} />
                        <select value={renaming.category} onChange={e => setRenaming({ ...renaming, category: e.target.value })}
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm">
                          <option value="">No category</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button onClick={saveRename} className="p-1 text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                        <button onClick={() => setRenaming(null)} className="p-1 text-gray-400 hover:text-gray-600" title="Cancel"><X size={16} /></button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800" title={d.file_name}>{d.file_name}</p>
                        <p className="text-xs text-gray-400">
                          {[d.generated ? 'Generated purchase order' : d.uploaded_po ? 'Purchase order (uploaded)' : d.category_name, formatDate(d.created_at), sizeOf(d.file_size)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    )}
                    {!editing && (
                      <div className="flex items-center gap-1">
                        {previewable(d.file_name) && (
                          <button onClick={() => preview.open(file)} className="p-1.5 rounded text-gray-400 hover:text-gray-700" title="Preview"><Eye size={15} /></button>
                        )}
                        <button onClick={() => preview.download(file)} className="p-1.5 rounded text-gray-400 hover:text-gray-700" title="Download"><Download size={15} /></button>
                        {!d.generated && (
                          <button onClick={() => setRenaming({ id: d.id, name: d.file_name, category: d.category_id ? String(d.category_id) : '' })}
                            className="p-1.5 rounded text-gray-400 hover:text-primary-600" title="Rename / category"><Pencil size={15} /></button>
                        )}
                        <button onClick={() => setDeleteDoc(d)} className="p-1.5 rounded text-gray-400 hover:text-red-600" title="Delete"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      {preview.modal}

      <PurchaseOperationFormModal
        open={editOpen}
        editing={op}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); load(); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete purchase operation"
        message={`Delete ${op.po_number} with its purchase order and documents? The files go to the Archive. Copies already filed on sales operations stay.`}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        open={deleteDoc !== null}
        onClose={() => setDeleteDoc(null)}
        onConfirm={() => deleteDoc && removeDoc(deleteDoc)}
        title={deleteDoc?.generated ? 'Delete the purchase order' : 'Delete document'}
        message={deleteDoc?.generated
          ? `This is the generated purchase order — deleting it deletes ${op.po_number}'s PO (the PDF goes to the Archive).`
          : `Delete ${deleteDoc?.file_name ?? ''}? It goes to the Archive.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
