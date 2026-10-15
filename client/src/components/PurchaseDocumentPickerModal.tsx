import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Eye, Search, Sparkles, ExternalLink } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { type DocOwner, ownerApi } from '../lib/docOwner';

/**
 * Documents list → "From purchase operation": pick a purchase operation (the
 * likely ones first and the best one opened), tick its documents, and each is
 * filed as a copy under its own category (changeable). Copies already here are
 * marked and left unticked.
 */

interface PurchaseSource {
  id: number; po_number: string; po_date: string | null; supplier_label: string | null;
  document_count: number; suggested: boolean; reason: string | null;
}
interface PurchaseDoc {
  id: number; file_name: string; file_path: string; category_id: number | null; category_name: string | null;
  created_at: string; generated?: boolean;
}

const PREVIEWABLE = /\.(pdf|jpe?g|png|webp|gif)$/i;

/** File-name patterns → category name, for documents with no category on the purchase operation. */
const NAME_HINTS: Array<[RegExp, string]> = [
  [/(^|[^a-z])(b\/?l|bill[\s_-]*of[\s_-]*lading)([^a-z]|$)/i, 'Bill of Lading'],
  [/(^|[^a-z])(coa|certificate[\s_-]*of[\s_-]*analysis)([^a-z]|$)/i, 'COA'],
  [/(^|[^a-z])(m?sds|safety[\s_-]*data)([^a-z]|$)/i, 'MSDS'],
  [/(^|[^a-z])(pds|tds|spec(ification)?[\s_-]*sheet)([^a-z]|$)/i, 'Product Specification Sheet'],
  [/packing[\s_-]*list|(^|[^a-z])pl([^a-z]|$)/i, 'Packing list'],
  [/(^|[^a-z])eur\.?[\s_-]*1([^0-9]|$)/i, 'EUR1'],
  [/certificate[\s_-]*of[\s_-]*origin|(^|[^a-z])coo([^a-z]|$)/i, 'Origin certificate'],
  [/phyto/i, 'Phytosanitary certificate'],
  [/insurance/i, 'Insurance certificate'],
  [/(^|[^a-z])(po|purchase[\s_-]*order)([^a-z]|$)/i, 'Purchase Order'],
];
// A supplier's invoice is not this operation's (customer) invoice — never guessed
const NEVER_GUESSED = /invoice/i;

/** The document's own category, else one guessed from its name (a category whose name it contains, or a hint). */
function categoryFor(d: { file_name: string; category_id: number | null }, categories: Array<{ id: number; name: string }>): number | null {
  if (d.category_id) return d.category_id;
  const stem = d.file_name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').toLowerCase();
  const byName = (name: string) => categories.find(c => c.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  const contained = [...categories].sort((a, b) => b.name.length - a.name.length)
    .find(c => c.name.length > 3 && !NEVER_GUESSED.test(c.name) && stem.includes(c.name.toLowerCase()));
  if (contained) return contained.id;
  for (const [re, name] of NAME_HINTS) {
    const id = re.test(d.file_name) ? byName(name) : null;
    if (id) return id;
  }
  return null;
}
const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

export default function PurchaseDocumentPickerModal({ open, owner, categories, existing, onClose, onFiled, onPreview }: {
  open: boolean;
  owner: DocOwner;
  categories: Array<{ id: number; name: string }>;
  /** The owner's documents, to mark copies already filed here */
  existing: Array<{ file_name: string; notes: string | null }>;
  onClose: () => void;
  onFiled: () => void;
  onPreview: (file: { fileName: string; filePath: string; subfolder: string; label?: string }) => void;
}) {
  const { addToast } = useToast();
  const [sources, setSources] = useState<PurchaseSource[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [docs, setDocs] = useState<PurchaseDoc[]>([]);
  const [picked, setPicked] = useState<Map<number, number | null>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch('');
    setDocs([]);
    api.get(`${ownerApi(owner)}/purchase-sources`)
      .then(r => {
        const list: PurchaseSource[] = r.data.data || [];
        setSources(list);
        setSelected(list.find(s => s.suggested)?.id ?? null);
      })
      .catch(() => addToast('Failed to load the purchase operations', 'error'))
      .finally(() => setLoading(false));
  }, [open, owner.kind, owner.id]);

  const current = sources.find(s => s.id === selected) || null;

  // Names of documents already copied here from the selected purchase operation
  const alreadyHere = useMemo(() => {
    if (!current) return new Set<string>();
    const note = `from purchase operation ${current.po_number}`.toLowerCase();
    return new Set(existing.filter(d => (d.notes || '').toLowerCase() === note).map(d => d.file_name.toLowerCase()));
  }, [current, existing]);

  useEffect(() => {
    setPicked(new Map());
    if (!selected) { setDocs([]); return; }
    setLoadingDocs(true);
    api.get(`/purchase-operations/${selected}`)
      .then(r => setDocs(r.data.documents || []))
      .catch(() => addToast('Failed to load the documents', 'error'))
      .finally(() => setLoadingDocs(false));
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(s => [s.po_number, s.supplier_label].some(v => (v || '').toLowerCase().includes(q)));
  }, [sources, search]);

  const isHere = (d: PurchaseDoc) => alreadyHere.has(d.file_name.toLowerCase());
  const fresh = docs.filter(d => !isHere(d));

  const toggle = (d: PurchaseDoc) => setPicked(prev => {
    const next = new Map(prev);
    if (next.has(d.id)) next.delete(d.id); else next.set(d.id, categoryFor(d, categories));
    return next;
  });
  const setCategory = (id: number, categoryId: number | null) => setPicked(prev => new Map(prev).set(id, categoryId));
  const allFreshPicked = fresh.length > 0 && fresh.every(d => picked.has(d.id));
  const toggleAll = () => setPicked(allFreshPicked ? new Map() : new Map(fresh.map(d => [d.id, categoryFor(d, categories)])));
  const categoryName = (id: number | null) => categories.find(c => c.id === id)?.name;

  async function file() {
    setSaving(true);
    try {
      const items = [...picked].map(([id, category_id]) => ({ source: 'purchase', id, category_id }));
      const { data } = await api.post(`${ownerApi(owner)}/documents/from-system`, { per_document: true, items });
      addToast(`${data.added} document${data.added === 1 ? '' : 's'} added from ${current?.po_number}`, 'success');
      if (data.missing?.length) addToast(`Missing on the server: ${data.missing.join(', ')}`, 'error');
      onFiled();
      onClose();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to add the documents', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Add documents from a purchase operation" size="xl">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
      ) : !sources.length ? (
        <p className="py-8 text-center text-sm text-gray-500">
          No purchase operation has documents yet — add them on <Link to="/purchase-operations" className="text-primary-600 hover:underline">Purchase Operations</Link>.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[280px_1fr]">
            {/* Purchase operations */}
            <div className="space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="PO number or supplier…" className={`${inputCls} pl-8`} />
              </div>
              <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-gray-200 p-1 space-y-0.5">
                {filtered.map(s => (
                  <button key={s.id} type="button" onClick={() => setSelected(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg ${selected === s.id ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-gray-50'}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">{s.po_number}</span>
                      <span className="text-xs text-gray-400">{s.document_count} doc{s.document_count === 1 ? '' : 's'}</span>
                    </span>
                    <span className="block truncate text-xs text-gray-500">{[s.supplier_label, formatDate(s.po_date)].filter(Boolean).join(' · ')}</span>
                    {s.reason && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        <Sparkles size={10} /> {s.reason}
                      </span>
                    )}
                  </button>
                ))}
                {!filtered.length && <p className="px-3 py-4 text-center text-xs text-gray-400">No match</p>}
              </div>
            </div>

            {/* Its documents */}
            <div className="min-w-0">
              {!current ? (
                <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400">
                  Choose a purchase operation
                </div>
              ) : loadingDocs ? (
                <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-primary-600" /></div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/purchase-operations/${current.id}`} target="_blank"
                      className="inline-flex items-center gap-1 text-sm font-medium text-gray-800 hover:text-primary-600">
                      {current.po_number}{current.supplier_label ? ` — ${current.supplier_label}` : ''} <ExternalLink size={12} />
                    </Link>
                    {fresh.length > 0 && (
                      <button type="button" onClick={toggleAll} className="text-xs text-primary-600 hover:underline">
                        {allFreshPicked ? 'Clear' : 'Select all'}
                      </button>
                    )}
                  </div>
                  <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {docs.map(d => {
                      const here = isHere(d);
                      const on = picked.has(d.id);
                      return (
                        <div key={d.id} className={`flex items-center gap-3 px-3 py-2 ${on ? 'bg-primary-50' : ''} ${here ? 'opacity-60' : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => toggle(d)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                          <button type="button" onClick={() => toggle(d)} className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-sm text-gray-800">{d.file_name}</span>
                            <span className="block truncate text-xs text-gray-400">
                              {[d.generated ? 'Generated PO' : null, formatDate(d.created_at), here ? 'Already on this operation' : null].filter(Boolean).join(' · ')}
                            </span>
                          </button>
                          {on ? (
                            <select value={picked.get(d.id) ?? ''} onChange={e => setCategory(d.id, Number(e.target.value) || null)}
                              title="Filed under this category"
                              className="w-44 flex-shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500">
                              <option value="">No category</option>
                              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          ) : (
                            <span className="w-44 flex-shrink-0 truncate text-right text-xs text-gray-500">
                              {d.category_name || categoryName(categoryFor(d, categories)) || 'No category'}
                            </span>
                          )}
                          {PREVIEWABLE.test(d.file_name) ? (
                            <button type="button" title="Preview"
                              onClick={() => onPreview({ fileName: d.file_name, filePath: d.file_path, subfolder: 'operation-docs', label: d.file_name })}
                              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"><Eye size={14} /></button>
                          ) : <span className="w-[22px] flex-shrink-0" />}
                        </div>
                      );
                    })}
                    {!docs.length && <p className="px-3 py-6 text-center text-xs text-gray-400">No documents</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-gray-500">{picked.size} selected · copies are filed here; the purchase operation keeps its own</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={file} disabled={saving || picked.size === 0}>
                {saving && <Loader2 size={14} className="animate-spin" />} Add {picked.size || ''} document{picked.size === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
