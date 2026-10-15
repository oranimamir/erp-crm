import { useRef, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { type DocOwner, ownerApi } from '../lib/docOwner';
import { REQUIRED_OPERATION_DOCS, GENERAL_DOCUMENT, docsInCategory } from '../lib/operationDocs';

/**
 * Nothing ticks a shipping-documents box without the user saying so:
 *  - `confirmUploads` — before an upload filed under an unticked box's category
 *    ("Tick the Sanitary certificate box?"; no → filed as General document)
 *  - `check` — after an upload under another category, documents that look like
 *    an unticked box (server `checklist-guesses`) are offered for it
 */

interface Item { key: string; file_name: string; category: string; reason?: string }
interface Prompt { items: Item[]; before: boolean; resolve: (yes: Set<string>) => void }

type Category = { id: number; name: string };
type Doc = { category_name: string | null };

const isChecklist = (name: string) => REQUIRED_OPERATION_DOCS.some(c => docsInCategory([{ category_name: name }], c).length > 0);

export function useChecklistSuggest(owner: DocOwner, onChanged: () => void) {
  const { addToast } = useToast();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  /** Shows the question; resolves with the keys the user said yes to (none on No / close). */
  function ask(items: Item[], before: boolean): Promise<Set<string>> {
    return new Promise(resolve => {
      setChosen(new Set(items.map(i => i.key)));
      setPrompt({ items, before, resolve });
    });
  }
  const answer = (yes: Set<string>) => { prompt?.resolve(yes); setPrompt(null); };

  // The documents as of the latest render (a tile uploads several files one by one)
  const docsRef = useRef<Doc[]>([]);

  /**
   * Before uploading: files headed for a checklist box that isn't ticked yet
   * are asked about. Returns each file's category id to upload with — the box's
   * when the user agrees, else General document (or none).
   */
  async function confirmUploads<T>(files: Array<{ ref: T; name: string; categoryId: number | null }>, categories: Category[], docs: Doc[]): Promise<Map<T, number | null>> {
    const out = new Map<T, number | null>(files.map(f => [f.ref, f.categoryId]));
    const nameOf = (id: number | null) => categories.find(c => c.id === id)?.name || '';
    const current = docsRef.current.length ? docsRef.current : docs;
    const asking = files.filter(f => {
      const name = nameOf(f.categoryId);
      return name && isChecklist(name) && docsInCategory(current, name).length === 0;
    });
    if (!asking.length) return out;
    const yes = await ask(asking.map((f, i) => ({ key: String(i), file_name: f.name, category: nameOf(f.categoryId) })), true);
    const general = categories.find(c => c.name.toLowerCase() === GENERAL_DOCUMENT.toLowerCase())?.id ?? null;
    asking.forEach((f, i) => { if (!yes.has(String(i))) out.set(f.ref, general); });
    return out;
  }

  /** After uploading under another category: offer the box these documents look like (quietly nothing when none fits). */
  async function check(ids: number[]) {
    if (!ids.length) return;
    let guesses: Array<{ id: number; file_name: string; category: string; category_id: number; reason: string }> = [];
    try {
      guesses = (await api.post(`${ownerApi(owner)}/documents/checklist-guesses`, { ids })).data.data || [];
    } catch { return; /* a guess is only a convenience */ }
    if (!guesses.length) return;
    const yes = await ask(guesses.map(g => ({ key: String(g.id), file_name: g.file_name, category: g.category, reason: g.reason })), false);
    let done = 0;
    try {
      for (const g of guesses.filter(x => yes.has(String(x.id)))) {
        const fd = new FormData();
        fd.append('category_id', String(g.category_id));
        await api.put(`${ownerApi(owner)}/documents/${g.id}`, fd);
        done++;
      }
      if (done) addToast(`${done} box${done === 1 ? '' : 'es'} ticked`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not file the document', 'error');
    } finally {
      if (done) onChanged();
    }
  }

  const toggle = (key: string) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const items = prompt?.items || [];
  const single = items.length === 1 ? items[0] : null;
  const no = prompt?.before ? 'No, upload without ticking' : 'No, leave as is';
  const modal = prompt ? (
    <Modal open onClose={() => answer(new Set())} closeOnBackdrop={false}
      title={single ? `Tick the ${single.category} box?` : 'Tick these shipping document boxes?'} size="md">
      <div className="space-y-4">
        {single ? (
          <p className="text-sm text-gray-700">
            {prompt.before ? (
              <>Uploading <span className="font-medium">{single.file_name}</span> as <span className="font-medium">{single.category}</span> ticks
                the {single.category} box in Shipping documents. OK to tick it?</>
            ) : (
              <><span className="font-medium">{single.file_name}</span> looks like a <span className="font-medium">{single.category}</span>{single.reason ? ` (${single.reason})` : ''}.
                File it as {single.category} so the box in Shipping documents is ticked?</>
            )}
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              {prompt.before ? 'These uploads would tick shipping document boxes. Tick the ones you agree with:' : "These uploads look like shipping documents that aren't ticked yet. Tick the ones to file under that box:"}
            </p>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
              {items.map(i => (
                <label key={i.key} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={chosen.has(i.key)} onChange={() => toggle(i.key)}
                    className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-gray-800">{i.file_name}</span>
                    <span className="block text-xs text-gray-500">→ <span className="font-medium text-gray-700">{i.category}</span>{i.reason ? ` · ${i.reason}` : ''}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {prompt.before && <p className="text-xs text-gray-500">"No" still uploads the file — as a General document, without ticking the box.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => answer(new Set())}>{no}</Button>
          <Button onClick={() => answer(single ? new Set([single.key]) : chosen)} disabled={!single && chosen.size === 0}>
            <CheckSquare size={14} />
            {single ? `Yes, tick ${single.category}` : `Tick ${chosen.size} box${chosen.size === 1 ? '' : 'es'}`}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { check, confirmUploads, modal, docsRef };
}
