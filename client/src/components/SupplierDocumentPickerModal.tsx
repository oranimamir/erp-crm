import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Upload, Eye } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { type DocOwner, ownerApi } from '../lib/docOwner';
import { DOC_ACCEPT } from '../lib/operationDocs';
import type { SupplierDocument } from './SupplierDocumentsTab';

/**
 * The General document tile: pick a supplier, then the documents of theirs to
 * file (copies) under the operation — or upload a file from the computer.
 */

interface SupplierWithDocs { id: number; name: string; document_count: number }

export default function SupplierDocumentPickerModal({ category, owner, onClose, onFiled, onUpload, onPreview }: {
  /** The General document category. */
  category: { id: number; name: string } | null;
  owner: DocOwner;
  onClose: () => void;
  onFiled: () => void;
  onUpload: (file: File, categoryId: number) => Promise<void>;
  onPreview: (file: { fileName: string; filePath: string; subfolder: string; label?: string }) => void;
}) {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [suppliers, setSuppliers] = useState<SupplierWithDocs[]>([]);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [docs, setDocs] = useState<SupplierDocument[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    setSupplierId(null);
    setDocs([]);
    api.get('/suppliers/with-documents')
      .then(r => setSuppliers(r.data || []))
      .catch(() => addToast('Failed to load the suppliers', 'error'))
      .finally(() => setLoading(false));
  }, [category?.id]);

  useEffect(() => {
    setPicked(new Set());
    if (!supplierId) { setDocs([]); return; }
    setLoadingDocs(true);
    api.get(`/suppliers/${supplierId}/documents`)
      .then(r => setDocs(r.data || []))
      .catch(() => addToast('Failed to load the documents', 'error'))
      .finally(() => setLoadingDocs(false));
  }, [supplierId]);

  if (!category) return null;

  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function file() {
    if (!category) return;
    setSaving(true);
    try {
      const items = [...picked].map(id => ({ source: 'supplier', id }));
      const { data } = await api.post(`${ownerApi(owner)}/documents/from-system`, { category: category.name, items });
      addToast(`${data.added} document${data.added === 1 ? '' : 's'} filed as ${category.name}`, 'success');
      if (data.missing?.length) addToast(`Missing on the server: ${data.missing.join(', ')}`, 'error');
      onFiled();
      onClose();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to file the documents', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !category) return;
    setSaving(true);
    try { for (const f of files) await onUpload(f, category.id); onClose(); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={`${category.name} — choose from a supplier or upload`} size="lg">
      <input ref={fileRef} type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={onFile} />
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
              <select value={supplierId ?? ''} onChange={e => setSupplierId(Number(e.target.value) || null)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="">{suppliers.length ? 'Choose a supplier…' : 'No supplier has documents yet'}</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.document_count})</option>)}
              </select>
            </div>
            <span className="text-xs text-gray-400 sm:pb-2.5">or</span>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={saving}>
              <Upload size={14} /> Upload from computer
            </Button>
          </div>

          {!suppliers.length && (
            <p className="text-xs text-gray-500">
              Supplier documents are added on the supplier's page → Documents tab (<Link to="/suppliers" className="text-primary-600 hover:underline">Suppliers</Link>).
            </p>
          )}

          {supplierId && (loadingDocs ? (
            <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-primary-600" /></div>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-gray-200 p-1">
              {docs.map(d => (
                <label key={d.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${picked.has(d.id) ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800">{d.title || d.file_name}</span>
                    <span className="block truncate text-xs text-gray-400">
                      {[d.doc_type, d.file_name, formatDate(d.created_at)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {/\.(pdf|jpe?g|png|webp)$/i.test(d.file_name) && (
                    <button type="button" title="Preview"
                      onClick={e => { e.preventDefault(); onPreview({ fileName: d.file_name, filePath: d.file_path, subfolder: 'supplier-docs', label: d.title || d.file_name }); }}
                      className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"><Eye size={14} /></button>
                  )}
                </label>
              ))}
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-gray-500">{picked.size} selected · copies are filed as {category.name}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={file} disabled={saving || picked.size === 0}>
                {saving && <Loader2 size={14} className="animate-spin" />} Add {picked.size || ''} as {category.name}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
