import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Search } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Edit the text of a Word document (a declaration) paragraph by paragraph.
 * Only what is changed is rewritten, so bold, fonts and layout stay as in the
 * original; Enter inside a paragraph makes a line break. `endpoint` is the
 * document's text API (`/operations/:id/documents/:docId/text` or
 * `/product-documents/:id/text`).
 */

interface Paragraph { key: string; part: string; text: string }

export default function DocxTextEditModal({ endpoint, title, note, onClose, onSaved }: {
  /** null = closed */
  endpoint: string | null;
  title?: string;
  /** Shown under the title, e.g. "Copies already added to operations keep their text". */
  note?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { addToast } = useToast();
  const [fileName, setFileName] = useState('');
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!endpoint) return;
    setLoading(true);
    setQuery('');
    api.get(endpoint)
      .then(({ data }) => {
        setFileName(data.file_name || '');
        setParagraphs(data.paragraphs || []);
        setTexts(Object.fromEntries((data.paragraphs || []).map((p: Paragraph) => [p.key, p.text])));
      })
      .catch(err => { addToast(err.response?.data?.error || 'The document could not be opened', 'error'); onClose(); })
      .finally(() => setLoading(false));
  }, [endpoint]);

  const changed = useMemo(() => paragraphs.filter(p => texts[p.key] !== p.text), [paragraphs, texts]);
  const q = query.trim().toLowerCase();
  const visible = paragraphs.filter(p => !q || (texts[p.key] ?? '').toLowerCase().includes(q));

  if (!endpoint) return null;

  async function save() {
    if (!endpoint || !changed.length) return;
    setSaving(true);
    try {
      const { data } = await api.put(endpoint, { edits: Object.fromEntries(changed.map(p => [p.key, texts[p.key]])) });
      addToast(`Document saved (${data.changed} paragraph${data.changed === 1 ? '' : 's'} changed)`, 'success');
      onSaved?.();
      onClose();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the document', 'error');
    } finally {
      setSaving(false);
    }
  }

  const close = () => {
    if (changed.length && !window.confirm('Discard your changes to this document?')) return;
    onClose();
  };

  let lastPart = '';
  return (
    <Modal open onClose={close} title={title || 'Edit document text'} size="lg">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-800">{fileName}</p>
              <p className="text-xs text-gray-500">
                Change the text below — formatting is kept. Enter adds a line break.{note ? ` ${note}` : ''}
              </p>
            </div>
            <div className="relative w-48">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find text…"
                className="w-full rounded-lg border border-gray-300 pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
            {visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{paragraphs.length ? 'No paragraph contains that text.' : 'No text found in this document.'}</p>
            ) : visible.map(p => {
              const heading = p.part !== lastPart ? p.part : null;
              lastPart = p.part;
              const value = texts[p.key] ?? '';
              const dirty = value !== p.text;
              return (
                <div key={p.key}>
                  {heading && <p className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{heading}</p>}
                  <div className="flex items-start gap-2">
                    <textarea value={value} onChange={e => setTexts({ ...texts, [p.key]: e.target.value })}
                      rows={Math.min(8, Math.max(1, Math.ceil(value.length / 90) + (value.match(/\n/g)?.length || 0)))}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                        dirty ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200'
                      }`} />
                    {dirty && (
                      <button type="button" onClick={() => setTexts({ ...texts, [p.key]: p.text })} title="Undo this change"
                        className="mt-1 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><RotateCcw size={14} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-gray-500">{changed.length ? `${changed.length} paragraph${changed.length === 1 ? '' : 's'} changed` : 'No changes yet'}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button onClick={save} disabled={saving || !changed.length}>
                {saving && <Loader2 size={14} className="animate-spin" />} Save document
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
