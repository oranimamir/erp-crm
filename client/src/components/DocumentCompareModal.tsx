import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Columns2, Download, Loader2, X } from 'lucide-react';
import api from '../lib/api';

/**
 * Two of an operation's documents side by side. The left one is the document
 * "Compare with" was clicked on; each side has a picker, so either can be
 * switched to any other document of the operation.
 */

export interface CompareDoc { id: number; file_path: string; file_name: string; category_name: string | null }

const canShow = (name: string) => /\.(pdf|jpe?g|png|webp|gif)$/i.test(name);
const label = (d: CompareDoc) => `${d.category_name ? `${d.category_name} — ` : ''}${d.file_name}`;

export default function DocumentCompareModal({ docs, initialLeft, subfolder = 'operation-docs', onClose }: {
  docs: CompareDoc[];
  initialLeft: number;
  subfolder?: string;
  onClose: () => void;
}) {
  const [leftId, setLeftId] = useState<number>(initialLeft);
  const [rightId, setRightId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 p-2 sm:p-4 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between text-white mb-2" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold flex items-center gap-2"><Columns2 size={18} /> Compare documents</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10" title="Close (Esc)"><X size={20} /></button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3" onClick={e => e.stopPropagation()}>
        <Pane docs={docs} value={leftId} onChange={id => setLeftId(id!)} subfolder={subfolder} />
        <Pane docs={docs} value={rightId} onChange={setRightId} subfolder={subfolder} exclude={leftId}
          placeholder="Choose the document to compare with…" />
      </div>
    </div>,
    document.body,
  );
}

function Pane({ docs, value, onChange, subfolder, exclude, placeholder }: {
  docs: CompareDoc[];
  value: number | null;
  onChange: (id: number | null) => void;
  subfolder: string;
  exclude?: number;
  placeholder?: string;
}) {
  const doc = docs.find(d => d.id === value) || null;
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (current.current) { URL.revokeObjectURL(current.current); current.current = null; }
    setUrl(null);
    setFailed(false);
    if (!doc || !canShow(doc.file_name)) return;
    setLoading(true);
    api.get(`/files/${subfolder}/${doc.file_path}`, { responseType: 'blob' })
      .then(resp => {
        if (cancelled) return;
        const t = String(resp.headers['content-type'] || 'application/pdf');
        const u = URL.createObjectURL(new Blob([resp.data], { type: t }));
        current.current = u;
        setType(t);
        setUrl(u);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [doc?.id]);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);

  async function download() {
    if (!doc) return;
    const resp = await api.get(`/files/${subfolder}/${doc.file_path}`, { responseType: 'blob' });
    const href = URL.createObjectURL(resp.data);
    const a = document.createElement('a');
    a.href = href; a.download = doc.file_name; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
        <select value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
          className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          {value === null && <option value="">{placeholder || 'Choose a document…'}</option>}
          {docs.filter(d => d.id !== exclude).map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}
        </select>
        {doc && (
          <button onClick={download} title="Download" className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Download size={15} /></button>
        )}
      </div>
      <div className="flex-1 min-h-0 bg-gray-50">
        {!doc ? (
          <p className="p-6 text-sm text-gray-500">{placeholder || 'Choose a document.'}</p>
        ) : !canShow(doc.file_name) ? (
          <p className="p-6 text-sm text-gray-500">This file type can't be shown in the browser — download it to open it.</p>
        ) : loading ? (
          <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
        ) : failed || !url ? (
          <p className="p-6 text-sm text-red-600">The document could not be loaded.</p>
        ) : type.startsWith('image/') ? (
          <div className="h-full overflow-auto"><img src={url} alt={doc.file_name} className="max-w-full mx-auto" /></div>
        ) : (
          <iframe src={`${url}#navpanes=0&toolbar=0&view=FitH`} title={doc.file_name} className="w-full h-full min-h-[60vh] bg-white" />
        )}
      </div>
    </div>
  );
}
