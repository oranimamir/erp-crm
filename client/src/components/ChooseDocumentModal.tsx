import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Sparkles, Upload, Eye } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { type DocOwner, ownerApi } from '../lib/docOwner';

/**
 * A shipping document tile's "Choose": the documents already in the app that
 * could fill this category (library, batch COAs, this operation's
 * uncategorized files, the same category on other operations), the best fits
 * ticked. Or upload a file from the computer instead.
 */

type SourceType = 'library' | 'batch' | 'this' | 'other';
interface SourceDoc {
  source: SourceType; id: number; title: string; subtitle: string;
  file_name: string; file_path: string; subfolder: string; date: string | null; suggested: boolean;
}

const SOURCE_LABEL: Record<SourceType, string> = {
  library: 'Document library (Inventory → Documents)',
  batch: 'Batch documents (Inventory → Batches)',
  this: 'On this operation, no category yet',
  other: 'Used on other operations',
};
const SOURCES: SourceType[] = ['library', 'batch', 'this', 'other'];
const keyOf = (d: { source: SourceType; id: number }) => `${d.source}:${d.id}`;

export default function ChooseDocumentModal({ category, owner, onClose, onFiled, onUpload, onPreview }: {
  /** The tile's category, e.g. "MSDS", "Quality certificate". */
  category: { id: number; name: string } | null;
  owner: DocOwner;
  onClose: () => void;
  /** After documents were filed (the page refreshes its documents). */
  onFiled: () => void;
  /** Upload from the computer into this category. */
  onUpload: (file: File, categoryId: number) => Promise<void>;
  onPreview: (file: { fileName: string; filePath: string; subfolder: string; label?: string }) => void;
}) {
  const { addToast } = useToast();
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    setQuery('');
    api.get(`${ownerApi(owner)}/document-sources`, { params: { category: category.name } })
      .then(({ data }) => {
        const list: SourceDoc[] = data.data || [];
        setDocs(list);
        setPicked(new Set(list.filter(d => d.suggested).map(keyOf)));
      })
      .catch(() => addToast('Failed to load the documents', 'error'))
      .finally(() => setLoading(false));
  }, [category?.name, owner.kind, owner.id]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => docs.filter(d => !q || `${d.title} ${d.subtitle} ${d.file_name}`.toLowerCase().includes(q)), [docs, q]);

  if (!category) return null;

  const toggle = (k: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  async function file() {
    if (!category) return;
    setSaving(true);
    try {
      const items = docs.filter(d => picked.has(keyOf(d))).map(d => ({ source: d.source, id: d.id }));
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
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !category) return;
    setSaving(true);
    try { await onUpload(f, category.id); onClose(); } finally { setSaving(false); }
  }

  const groups = SOURCES
    .map(source => ({ source, items: visible.filter(d => d.source === source).sort((a, b) => Number(b.suggested) - Number(a.suggested)) }))
    .filter(g => g.items.length);

  return (
    <Modal open onClose={onClose} title={`${category.name} — choose a document`} size="lg">
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={onFile} />
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search documents…"
                className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={saving}>
              <Upload size={14} /> Upload from computer
            </Button>
          </div>

          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
              {docs.length ? 'Nothing matches.' : `No ${category.name} in the system yet — upload it from your computer.`}
            </p>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto space-y-4 pr-1">
              {groups.map(g => (
                <section key={g.source} className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{SOURCE_LABEL[g.source]}</h3>
                  <div className="rounded-lg border border-gray-200 p-1">
                    {g.items.map(d => {
                      const k = keyOf(d);
                      return (
                        <label key={k} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${picked.has(k) ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                          <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-gray-800">{d.title}</span>
                            <span className="block truncate text-xs text-gray-400">
                              {d.subtitle}{d.date ? ` · ${formatDate(d.date)}` : ''}
                            </span>
                          </span>
                          {d.suggested && (
                            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">
                              <Sparkles size={11} /> Suggested
                            </span>
                          )}
                          {/\.(pdf|jpe?g|png|webp)$/i.test(d.file_name) && (
                            <button type="button" title="Preview"
                              onClick={e => { e.preventDefault(); onPreview({ fileName: d.file_name, filePath: d.file_path, subfolder: d.subfolder, label: d.title }); }}
                              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"><Eye size={14} /></button>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

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
