import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Library, Loader2, Search, AlertTriangle, Sparkles } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { type DocOwner, ownerParams } from '../lib/docOwner';
import { docTitle, type ProductDoc, type ProductDocKind } from './ProductDocumentsTab';

/**
 * Operation → Documents → Add from library: one section per library category
 * (MSDS, Product Specification Sheet, Declarations, COA). For the products on
 * the operation's invoice (else its order) the most suitable document of each
 * category is ticked — for COAs the ones naming the operation's lot numbers,
 * else the best per product; every other document of the category is listed under it
 * (searchable), so any can be picked instead. The chosen ones are copied into
 * the operation's documents.
 */

interface SuggestLine { description: string; product: { id: number; name: string } | null; documents: ProductDoc[] }

const KINDS: ProductDocKind[] = ['msds', 'pds', 'declaration', 'coa'];
const SECTION_TITLE: Record<ProductDocKind, string> = { msds: 'MSDS', pds: 'Product Specification Sheet', declaration: 'Declarations', coa: 'COA' };

/**
 * The most specific document of a kind for one product: fewest products
 * covered (a product's own sheet over a family MSDS), then the highest
 * document code (the newer issue), then the newest upload.
 */
function best(docs: ProductDoc[]): ProductDoc | undefined {
  return [...docs].sort((a, b) =>
    a.products.length - b.products.length
    || (b.doc_code || '').localeCompare(a.doc_code || '')
    || (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
  )[0];
}

/**
 * The suggested documents, each with what it was suggested for (products; for
 * COAs naming a lot, "lot …").
 */
function suggestionsOf(lines: SuggestLine[], coaByLot: Record<number, string[]> = {}): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const add = (doc: ProductDoc | undefined, product: string) => {
    if (!doc) return;
    const list = out.get(doc.id) || [];
    if (!list.includes(product)) list.push(product);
    out.set(doc.id, list);
  };
  for (const line of lines) {
    if (!line.product) continue;
    add(best(line.documents.filter(d => d.kind === 'msds')), line.product.name);
    add(best(line.documents.filter(d => d.kind === 'pds')), line.product.name);
    for (const d of line.documents.filter(x => x.kind === 'declaration')) add(d, line.product.name);
  }
  // COAs: the lot's own certificate; only without one, the best per product
  const lotCoas = Object.entries(coaByLot);
  if (lotCoas.length) {
    for (const [id, lots] of lotCoas) for (const lot of lots) add({ id: Number(id) } as ProductDoc, `lot ${lot}`);
  } else {
    for (const line of lines) if (line.product) add(best(line.documents.filter(d => d.kind === 'coa')), line.product.name);
  }
  return out;
}

export default function AddFromLibraryModal({ open, onClose, owner, existingNames, onAdded }: {
  open: boolean;
  onClose: () => void;
  /** The operation or non-commercial operation the copies are filed under. */
  owner: DocOwner;
  /** File names already on the operation — those documents start unticked. */
  existingNames: string[];
  onAdded: () => void;
}) {
  const { addToast } = useToast();
  const [lines, setLines] = useState<SuggestLine[]>([]);
  const [coaByLot, setCoaByLot] = useState<Record<number, string[]>>({});
  const [source, setSource] = useState<'invoice' | 'order' | 'lines'>('order');
  const [all, setAll] = useState<ProductDoc[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [queries, setQueries] = useState<Record<ProductDocKind, string>>({ msds: '', pds: '', declaration: '', coa: '' });

  const have = useMemo(() => new Set(existingNames.map(n => n.toLowerCase())), [existingNames]);
  const suggested = useMemo(() => suggestionsOf(lines, coaByLot), [lines, coaByLot]);
  const operationProductIds = useMemo(() => new Set(lines.flatMap(l => (l.product ? [l.product.id] : []))), [lines]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setQueries({ msds: '', pds: '', declaration: '', coa: '' });
    Promise.all([
      api.get('/product-documents/suggest', { params: ownerParams(owner) }),
      api.get('/product-documents'),
    ]).then(([s, d]) => {
      const suggestLines: SuggestLine[] = s.data.lines || [];
      const library: ProductDoc[] = d.data.data || [];
      setLines(suggestLines);
      setCoaByLot(s.data.coa_lot_matches || {});
      setSource(s.data.source === 'invoice' ? 'invoice' : s.data.source === 'lines' ? 'lines' : 'order');
      setAll(library);
      // Suggestions start ticked, unless already on the operation
      const byId = new Map(library.map(x => [x.id, x]));
      const start = new Set<number>();
      for (const id of suggestionsOf(suggestLines, s.data.coa_lot_matches || {}).keys()) {
        const doc = byId.get(id);
        if (doc && !have.has(doc.file_name.toLowerCase())) start.add(id);
      }
      setPicked(start);
    }).catch(() => addToast('Failed to load the document library', 'error'))
      .finally(() => setLoading(false));
  }, [open, owner.kind, owner.id]);

  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function add() {
    setSaving(true);
    try {
      const { data } = await api.post('/product-documents/copy', { ids: [...picked], ...ownerParams(owner) });
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

  /**
   * A category's documents in the order worth looking at: suggested, then
   * others for this operation's products, then general, then the rest.
   */
  const ordered = (kind: ProductDocKind) => {
    const rank = (d: ProductDoc) =>
      suggested.has(d.id) ? 0
        : d.products.some(p => operationProductIds.has(p.id)) ? 1
          : d.products.length === 0 ? 2 : 3;
    const q = queries[kind].trim().toLowerCase();
    return all
      .filter(d => d.kind === kind)
      .filter(d => !q || [docTitle(d), d.file_name, d.doc_code, ...d.products.map(p => p.name)]
        .some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => rank(a) - rank(b)
        || (a.doc_code || docTitle(a)).localeCompare(b.doc_code || docTitle(b)));
  };

  const row = (d: ProductDoc) => {
    const forProducts = suggested.get(d.id);
    const forThisOp = forProducts ? [] : d.products.filter(p => operationProductIds.has(p.id)).map(p => p.name);
    return (
      <label key={d.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${
        picked.has(d.id) ? 'bg-primary-50' : 'hover:bg-gray-50'
      }`}>
        <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)}
          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-gray-800">{docTitle(d)}</span>
          <span className="block truncate text-xs text-gray-400">
            {d.doc_code && <span className="font-mono">{d.doc_code} · </span>}
            {d.products.length ? d.products.map(p => p.name).join(', ') : 'General — all products'}
          </span>
        </span>
        {forProducts ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0"
            title={`Suggested for ${forProducts.join(', ')}`}>
            <Sparkles size={11} /> Suggested{forProducts.length === 1 ? ` · ${forProducts[0]}` : ` · ${forProducts.length} ${forProducts.every(f => f.startsWith('lot ')) ? 'lots' : 'products'}`}
          </span>
        ) : forThisOp.length > 0 ? (
          <span className="text-xs text-gray-500 flex-shrink-0">also for {forThisOp[0]}{forThisOp.length > 1 ? ` +${forThisOp.length - 1}` : ''}</span>
        ) : null}
        {have.has(d.file_name.toLowerCase()) && <span className="text-xs text-gray-400 flex-shrink-0">already added</span>}
      </label>
    );
  };

  const matched = [...new Set(lines.filter(l => l.product).map(l => l.product!.name))];
  const unmatched = lines.filter(l => !l.product);

  return (
    <Modal open={open} onClose={onClose} title="Add documents from the library" size="lg">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
      ) : (
        <div className="space-y-5">
          <div className="text-sm text-gray-600">
            {lines.length === 0 ? (
              <span className="text-gray-400">No invoice or order lines on this operation — pick the documents below.</span>
            ) : (
              <>
                Suggested for the products on {source === 'lines' ? 'the sample lines' : `this ${owner.kind === 'nco' ? 'NCO' : 'operation'}'s ${source}`}:{' '}
                <span className="font-medium text-gray-800">{matched.join(', ') || 'none matched'}</span>
                {unmatched.length > 0 && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertTriangle size={12} />
                    No catalogue product matched: {unmatched.map(l => l.description || 'line').join(', ')} — pick their documents below.
                  </p>
                )}
              </>
            )}
          </div>

          {KINDS.map(kind => {
            const docs = ordered(kind);
            const total = all.filter(d => d.kind === kind).length;
            const chosen = all.filter(d => d.kind === kind && picked.has(d.id)).length;
            return (
              <section key={kind} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-800">
                    {SECTION_TITLE[kind]}
                    <span className="ml-2 text-xs font-normal text-gray-500">{chosen} selected · {total} in the library</span>
                  </h3>
                  <div className="relative w-56">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={queries[kind]} onChange={e => setQueries({ ...queries, [kind]: e.target.value })}
                      placeholder={`Search ${kind === 'msds' ? 'MSDS' : SECTION_TITLE[kind].toLowerCase()}…`}
                      className="w-full rounded-lg border border-gray-300 pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 p-1">
                  {docs.length ? docs.map(row) : (
                    <p className="px-3 py-3 text-xs text-gray-400">
                      {total ? 'Nothing matches.' : `No ${SECTION_TITLE[kind]} in the library yet.`}
                    </p>
                  )}
                </div>
              </section>
            );
          })}

          <Link to="/inventory?tab=documents" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
            <Library size={12} /> Manage the library in Inventory → Documents
          </Link>

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
