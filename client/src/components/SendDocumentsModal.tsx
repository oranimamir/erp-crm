import { useEffect, useMemo, useState } from 'react';
import { Send, Loader2, ArrowUp, ArrowDown, AlertTriangle, Hash } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Send documents: the chosen documents of an operation (or NCO) as
 * attachments of one email, in the order shown, optionally numbered
 * "01 - …", "02 - …". To / CC start from Settings → Document emails.
 */

export interface SendableDoc { id: number; file_name: string; category_name: string | null; file_size?: number | null }

const LIMIT_MB = 25;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

/** Same as the server: "01 - name" with at least two digits. */
const numberedName = (name: string, i: number, total: number) =>
  `${String(i + 1).padStart(Math.max(2, String(total).length), '0')} - ${name}`;

export default function SendDocumentsModal({ open, onClose, endpoint, reference, partyName, documents, missingRequired = [] }: {
  open: boolean;
  onClose: () => void;
  /** POST endpoint, e.g. /operations/12/documents/email */
  endpoint: string;
  /** The operation / NCO number, used in the default subject. */
  reference: string;
  partyName?: string;
  documents: SendableDoc[];
  /** Required document types not uploaded yet — shown as a notice, never blocking. */
  missingRequired?: string[];
}) {
  const { addToast } = useToast();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState<number[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [numbered, setNumbered] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(`${reference} — documents${partyName ? ` — ${partyName}` : ''}`);
    setMessage('');
    setOrder(documents.map(d => d.id));
    // Everything except superseded draft PDFs
    setPicked(new Set(documents.filter(d => !/-DRAFT\.pdf$/i.test(d.file_name)).map(d => d.id)));
    api.get('/settings/document-emails').then(({ data }) => {
      const uniq = (xs: string[]) => [...new Set(xs.map(x => x.toLowerCase()))];
      setTo(uniq([...(data.invoice?.to || []), ...(data.packing_list?.to || [])]).join(', '));
      setCc(uniq([...(data.invoice?.cc || []), ...(data.packing_list?.cc || [])]).join(', '));
    }).catch(() => {});
  }, [open]);

  const byId = useMemo(() => new Map(documents.map(d => [d.id, d])), [documents]);
  const ordered = order.map(id => byId.get(id)).filter(Boolean) as SendableDoc[];
  const chosen = ordered.filter(d => picked.has(d.id));
  const totalBytes = chosen.reduce((n, d) => n + (d.file_size || 0), 0);
  const overLimit = totalBytes > LIMIT_MB * 1024 * 1024;
  const nearLimit = !overLimit && totalBytes > LIMIT_MB * 0.8 * 1024 * 1024;

  const move = (id: number, delta: number) => setOrder(prev => {
    const i = prev.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function send() {
    setSending(true);
    try {
      const { data } = await api.post(endpoint, {
        to, cc, subject, message, numbered, documents: chosen.map(d => d.id),
      });
      addToast(data.message, 'success');
      onClose();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to send the documents', 'error');
    } finally {
      setSending(false);
    }
  }

  let shownIndex = 0;

  return (
    <Modal open={open} onClose={() => !sending && onClose()} title="Send documents by email" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To *</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com, …" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">CC</label>
            <input value={cc} onChange={e => setCc(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Message</label>
          <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)}
            placeholder={`Please find attached the documents for ${reference}.`} className={inputCls} />
        </div>

        {missingRequired.length > 0 && (
          <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
            <span>Not uploaded yet: <strong>{missingRequired.join(', ')}</strong>. You can still send what is here.</span>
          </p>
        )}

        <div className="rounded-lg border border-gray-200">
          <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-gray-50">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Attachments · {chosen.length} of {ordered.length}
            </span>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" onClick={() => setPicked(new Set(ordered.map(d => d.id)))} className="text-primary-600 hover:underline">All</button>
              <button type="button" onClick={() => setPicked(new Set())} className="text-primary-600 hover:underline">None</button>
              <label className="flex items-center gap-1.5 text-gray-700 cursor-pointer select-none">
                <input type="checkbox" checked={numbered} onChange={e => setNumbered(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <Hash size={12} /> Number the attachments
              </label>
            </div>
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100">
            {ordered.map((d, i) => {
              const on = picked.has(d.id);
              const name = on && numbered ? numberedName(d.file_name, shownIndex++, chosen.length) : d.file_name;
              return (
                <li key={d.id} className={`flex items-center gap-2 px-3 py-2 ${on ? '' : 'opacity-50'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(d.id)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800">{name}</span>
                    <span className="block truncate text-xs text-gray-400">
                      {d.category_name || 'No category'}{d.file_size != null ? ` · ${mb(d.file_size)}` : ' · file missing'}
                    </span>
                  </span>
                  <button type="button" onClick={() => move(d.id, -1)} disabled={i === 0} title="Move up"
                    className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button type="button" onClick={() => move(d.id, 1)} disabled={i === ordered.length - 1} title="Move down"
                    className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"><ArrowDown size={14} /></button>
                </li>
              );
            })}
            {ordered.length === 0 && <li className="px-3 py-4 text-sm text-gray-400 text-center">No documents yet.</li>}
          </ul>
          <div className={`px-3 py-2 border-t border-gray-100 text-xs ${overLimit ? 'text-red-600' : nearLimit ? 'text-amber-600' : 'text-gray-500'}`}>
            Total {mb(totalBytes)} of {LIMIT_MB} MB
            {overLimit && ' — too large for one email; untick some documents'}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !to.trim() || chosen.length === 0 || overLimit}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send {chosen.length || ''} document{chosen.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
