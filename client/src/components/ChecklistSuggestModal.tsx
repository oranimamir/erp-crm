import { useState } from 'react';
import { CheckSquare, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { type DocOwner, ownerApi } from '../lib/docOwner';

/**
 * After an upload: documents that look like an unticked shipping-documents box
 * (server `checklist-guesses`) — "file it as Label?" ticks that box.
 */

interface Guess { id: number; file_name: string; category: string; category_id: number; reason: string }

export function useChecklistSuggest(owner: DocOwner, onChanged: () => void) {
  const { addToast } = useToast();
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  /** Ask about these freshly uploaded documents (quietly nothing when none fits). */
  async function check(ids: number[]) {
    if (!ids.length) return;
    try {
      const { data } = await api.post(`${ownerApi(owner)}/documents/checklist-guesses`, { ids });
      const list: Guess[] = data.data || [];
      if (!list.length) return;
      setGuesses(list);
      setChosen(new Set(list.map(g => g.id)));
    } catch { /* a guess is only a convenience */ }
  }

  const close = () => setGuesses([]);

  async function apply() {
    setSaving(true);
    let done = 0;
    try {
      for (const g of guesses.filter(x => chosen.has(x.id))) {
        const fd = new FormData();
        fd.append('category_id', String(g.category_id));
        await api.put(`${ownerApi(owner)}/documents/${g.id}`, fd);
        done++;
      }
      if (done) addToast(`${done} box${done === 1 ? '' : 'es'} ticked`, 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not file the document', 'error');
    } finally {
      setSaving(false);
      close();
      if (done) onChanged();
    }
  }

  const toggle = (id: number) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const single = guesses.length === 1 ? guesses[0] : null;
  const modal = guesses.length ? (
    <Modal open onClose={close} title={single ? `Tick the ${single.category} box?` : 'Tick these shipping document boxes?'} size="md">
      <div className="space-y-4">
        {single ? (
          <p className="text-sm text-gray-700">
            <span className="font-medium">{single.file_name}</span> looks like a <span className="font-medium">{single.category}</span> ({single.reason}).
            File it as {single.category} so the box in Shipping documents is ticked?
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-700">These uploads look like shipping documents that aren't ticked yet. File them under that box?</p>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
              {guesses.map(g => (
                <label key={g.id} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={chosen.has(g.id)} onChange={() => toggle(g.id)}
                    className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-gray-800">{g.file_name}</span>
                    <span className="block text-xs text-gray-500">→ <span className="font-medium text-gray-700">{g.category}</span> · {g.reason}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={saving}>No, leave as is</Button>
          <Button onClick={apply} disabled={saving || chosen.size === 0}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckSquare size={14} />}
            {single ? `Yes, tick ${single.category}` : `Tick ${chosen.size} box${chosen.size === 1 ? '' : 'es'}`}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { check, modal };
}
