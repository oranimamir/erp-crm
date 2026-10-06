import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Library, Loader2, Search, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { KIND_LABEL, type ProductDoc } from './ProductDocumentsTab';

/**
 * Operation → Documents → Add from library: the order's products with their
 * MSDS / specification sheets ticked, plus any other library document. The
 * chosen ones are copied into the operation's documents.
 */

interface SuggestLine { description: string; product: { id: number; name: string } | null; documents: ProductDoc[] }

export default function AddFromLibraryModal({ open, onClose, operationId, existingNames, onAdded }: {
  open: boolean;
  onClose: () => void;
  operationId: number;
  /** File names already on the operation — those documents start unticked. */
  existingNames: string[];
  onAdded: () => void;
}) {
  const { addToast } = useToast();
  const [lines, setLines] = useState<SuggestLine[]>([]);
  const [all, setAll] = useState<ProductDoc[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setQuery('');
    Promise.all([
      api.get('/product-documents/suggest', { params: { operation_id: operationId } }),
      api.get('/product-documents'),
    ]).then(([s, d]) => {
      const suggested: SuggestLine[] = s.data.lines || [];
      setLines(suggested);
      setAll(d.data.data || []);
      // Newest MSDS + spec sheet of each matched product, unless already on the operation
      const have = new Set(existingNames.map(n => n.toLowerCase()));
      const start = new Set<number>();
      for (const line of suggested) {
        for (const kind of ['msds', 'pds'] as const) {
          const doc = line.documents.find(x => x.kind === kind);
          if (doc && !have.has(doc.file_name.toLowerCase())) start.add(doc.id);
        }
      }
      setPicked(start);
    }).catch(() => addToast('Failed to load the document library', 'error'))
      .finally(() => setLoading(false));
  }, [open, operationId]);

  const suggestedIds = useMemo(() => new Set(lines.flatMap(l => l.documents.map(d => d.id))), [lines]);
  const others = all.filter(d => !suggestedIds.has(d.id) && (!query.trim()
    || `${d.product_name} ${d.file_name}`.toLowerCase().includes(query.trim().toLowerCase())));

  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function add() {
    setSaving(true);
    try {
      const { data } = await api.post('/product-documents/copy', { ids: [...picked], operation_id: operationId });
      addToast(`${data.added} document${data.added === 1 ? '' : 's'} added`, 'success');
      if (data.missing?.length) addToast(`Missing on the server: ${data.missing.join(', ')}`, 'error');
      onAdded();
      onClose();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to add documents', 'error');
    } finally {
      setSaving(false);
    }
  }

  const row = (d: ProductDoc) => (
    <label key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
      <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)}
        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
      <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 flex-shrink-0">{KIND_LABEL[d.kind] === 'MSDS' ? 'MSDS' : 'Spec sheet'}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-800">{d.file_name}</span>
        <span className="block truncate text-xs text-gray-400">{d.product_name}</span>
      </span>
      {existingNames.some(n => n.toLowerCase() === d.file_name.toLowerCase()) && (
        <span className="text-xs text-gray-400 flex-shrink-0">already added</span>
      )}
    </label>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add documents from the library" size="lg">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">For this operation's products</h3>
            {lines.length === 0 ? (
              <p className="text-sm text-gray-400">No order lines on this operation — pick documents below.</p>
            ) : lines.map((line, i) => (
              <div key={i} className="rounded-lg border border-gray-200">
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-sm">
                  <span className="font-medium text-gray-800">{line.description || 'Line'}</span>
                  {line.product
                    ? <span className="text-xs text-gray-500"> → {line.product.name}</span>
                    : <span className="text-xs text-amber-600"> · no catalogue product matched</span>}
                </div>
                <div className="p-1">
                  {line.documents.length ? line.documents.map(row) : (
                    <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-amber-700">
                      <AlertTriangle size={12} />
                      {line.product ? 'No MSDS or spec sheet in the library for this product yet.' : 'Pick its document below.'}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Other library documents</h3>
              <div className="relative w-56">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
                  className="w-full rounded-lg border border-gray-300 pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 p-1">
              {others.length ? others.map(row) : <p className="px-3 py-3 text-xs text-gray-400">Nothing else in the library.</p>}
            </div>
            <Link to="/inventory?tab=documents" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
              <Library size={12} /> Manage the library in Inventory → Documents
            </Link>
          </section>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-gray-500">{picked.size} selected · copies are added, the library stays as it is</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={add} disabled={saving || picked.size === 0}>
                {saving && <Loader2 size={14} className="animate-spin" />} Add {picked.size || ''} to operation
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
