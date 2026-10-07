import { useEffect, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Edit a document filed under an operation: its name, category and notes,
 * and optionally upload a newer version of the file. The extension is kept.
 */

export interface EditableDoc {
  id: number; file_name: string; category_id: number | null; notes: string | null;
}

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

const splitName = (name: string) => {
  const m = name.match(/^(.*?)(\.[a-z0-9]{1,5})?$/i);
  return { base: m?.[1] || name, ext: m?.[2] || '' };
};

export default function OperationDocumentEditModal({ doc, operationId, categories, onClose, onSaved }: {
  doc: EditableDoc | null;
  operationId: number | string;
  categories: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addToast } = useToast();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setName(splitName(doc.file_name).base);
    setCategoryId(doc.category_id ? String(doc.category_id) : '');
    setNotes(doc.notes || '');
    setFile(null);
  }, [doc?.id]);

  if (!doc) return null;
  const ext = splitName(file?.name || doc.file_name).ext;

  async function save() {
    if (!doc || !name.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      fd.append('file_name', `${name.trim()}${ext}`);
      fd.append('category_id', categoryId);
      fd.append('notes', notes.trim());
      await api.put(`/operations/${operationId}/documents/${doc.id}`, fd);
      addToast('Document updated', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update the document', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit document">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <div className="flex items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} autoFocus />
            {ext && <span className="text-sm text-gray-500">{ext}</span>}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputCls}>
            <option value="">No category</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={inputCls} placeholder="Optional notes…" />
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 cursor-pointer hover:bg-gray-100">
          <Upload size={15} className="text-gray-400" />
          <span className="text-sm text-gray-600 truncate">{file ? file.name : 'Replace the file with a newer version (optional)'}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving && <Loader2 size={14} className="animate-spin" />} Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
