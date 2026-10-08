import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Loader2, Eye, Download, Pencil, Trash2, Check, X } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import Card from './ui/Card';
import Button from './ui/Button';

/**
 * Supplier → Documents: the supplier's own paperwork (certificates, contracts,
 * specifications…), kept on the supplier. An operation's General document
 * tile picks from here.
 */

export interface SupplierDocument {
  id: number; supplier_id: number; title: string | null; doc_type: string | null;
  file_path: string; file_name: string; notes: string | null;
  uploaded_by_name: string | null; created_at: string; file_size: number | null;
}

const TYPE_SUGGESTIONS = ['Certificate', 'COA', 'ISO certificate', 'Contract', 'Product specification', 'MSDS', 'Declaration', 'Price list', 'Company registration', 'Bank details'];
const PREVIEWABLE = /\.(pdf|jpe?g|png|webp)$/i;
const fmtSize = (n: number | null) => n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const input = 'block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

export default function SupplierDocumentsTab({ supplierId }: { supplierId: number }) {
  const { addToast } = useToast();
  const preview = useFilePreview();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<SupplierDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [docType, setDocType] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<{ id: number; title: string; doc_type: string; notes: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/suppliers/${supplierId}/documents`)
      .then(r => setDocs(r.data || []))
      .catch(() => addToast('Failed to load the documents', 'error'))
      .finally(() => setLoading(false));
  }, [supplierId]);

  async function upload() {
    if (!files.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      files.forEach(f => form.append('files', f));
      form.append('doc_type', docType);
      form.append('notes', notes);
      const { data } = await api.post(`/suppliers/${supplierId}/documents`, form);
      setDocs(data);
      addToast(`${files.length} document${files.length === 1 ? '' : 's'} uploaded`, 'success');
      setFiles([]); setDocType(''); setNotes('');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const { data } = await api.put(`/suppliers/${supplierId}/documents/${editing.id}`, editing);
      setDocs(prev => prev.map(d => (d.id === data.id ? data : d)));
      setEditing(null);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    }
  }

  async function remove(id: number) {
    try {
      await api.delete(`/suppliers/${supplierId}/documents/${id}`);
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    } finally {
      setConfirmDelete(null);
    }
  }

  const fileOf = (d: SupplierDocument) => ({ fileName: d.file_name, filePath: d.file_path, subfolder: 'supplier-docs', label: d.title || d.file_name });

  return (
    <div className="space-y-4">
      {preview.modal}
      <datalist id="supplier-doc-types">{TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Upload size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Upload documents</h2>
          <span className="text-xs text-gray-400">PDF, Word or images · up to 10 MB each</span>
        </div>
        <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" className="hidden"
          onChange={e => { setFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); setFiles(Array.from(e.dataTransfer.files || [])); }}
          className={`rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm cursor-pointer transition-colors ${
            dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-300 hover:bg-gray-50'}`}>
          {files.length
            ? <span className="text-gray-800">{files.map(f => f.name).join(', ')}</span>
            : <span className="text-gray-500">Drop files here or <span className="text-primary-600 font-medium">choose from your computer</span></span>}
        </div>
        {files.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Document type</label>
              <input list="supplier-doc-types" className={input} value={docType} onChange={e => setDocType(e.target.value)} placeholder="e.g. Certificate" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input className={input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setFiles([])} disabled={uploading}>Clear</Button>
              <Button size="sm" onClick={upload} disabled={uploading}>
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload {files.length}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Documents</h2>
          <span className="text-xs text-gray-400">{docs.length || ''}</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
        ) : docs.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No documents for this supplier yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 font-medium">Document</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Notes</th>
                  <th className="text-left py-2 font-medium">Uploaded</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docs.map(d => editing?.id === d.id ? (
                  <tr key={d.id} className="bg-primary-50/40">
                    <td className="py-2 pr-2"><input className={input} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></td>
                    <td className="py-2 pr-2"><input list="supplier-doc-types" className={input} value={editing.doc_type} onChange={e => setEditing({ ...editing, doc_type: e.target.value })} /></td>
                    <td className="py-2 pr-2" colSpan={2}><input className={input} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={saveEdit} className="p-1.5 rounded text-green-600 hover:bg-green-50" title="Save"><Check size={15} /></button>
                      <button onClick={() => setEditing(null)} className="p-1.5 rounded text-gray-400 hover:bg-gray-100" title="Cancel"><X size={15} /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={d.id}>
                    <td className="py-2 pr-3">
                      <span className="block text-gray-800">{d.title || d.file_name}</span>
                      <span className="block text-xs text-gray-400">{d.file_name}{d.file_size != null ? ` · ${fmtSize(d.file_size)}` : ''}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{d.doc_type || '—'}</td>
                    <td className="py-2 pr-3 text-gray-600">{d.notes || ''}</td>
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                      {formatDate(d.created_at)}{d.uploaded_by_name && <span className="block text-xs text-gray-400">{d.uploaded_by_name}</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {confirmDelete === d.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-red-600">Delete?</span>
                          <button onClick={() => remove(d.id)} className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                          <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-xs rounded text-gray-600 hover:bg-gray-100">Keep</button>
                        </span>
                      ) : (
                        <>
                          {PREVIEWABLE.test(d.file_name) && (
                            <button onClick={() => preview.open(fileOf(d))} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Preview"><Eye size={15} /></button>
                          )}
                          <button onClick={() => preview.download(fileOf(d))} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Download"><Download size={15} /></button>
                          <button onClick={() => setEditing({ id: d.id, title: d.title || '', doc_type: d.doc_type || '', notes: d.notes || '' })}
                            className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Edit"><Pencil size={15} /></button>
                          <button onClick={() => setConfirmDelete(d.id)} className="p-1.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50" title="Delete"><Trash2 size={15} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
