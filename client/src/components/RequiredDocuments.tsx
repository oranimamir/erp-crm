import { useRef, useState } from 'react';
import { CheckCircle2, Circle, Eye, Upload, Loader2, ClipboardCheck } from 'lucide-react';
import { REQUIRED_OPERATION_DOCS, docsInCategory } from '../lib/operationDocs';

/**
 * The shipping documents an operation needs (Quality, Origin, Insurance,
 * Sanitary, Phytosanitary certificates, EUR1, Label): one tile each, ticked
 * once a document of that category is filed. Upload on a tile files straight
 * into that category.
 */

interface Doc { id: number; file_name: string; file_path: string; category_name: string | null }
interface Category { id: number; name: string }

export default function RequiredDocuments({ documents, categories, onUpload, onPreview }: {
  documents: Doc[];
  categories: Category[];
  /** Uploads one file into the category; resolves when done (the page refreshes its documents). */
  onUpload: (file: File, categoryId: number) => Promise<void>;
  onPreview: (doc: Doc, category: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Category | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const done = REQUIRED_OPERATION_DOCS.filter(c => docsInCategory(documents, c).length > 0).length;
  const categoryOf = (name: string) => categories.find(c => c.name.toLowerCase() === name.toLowerCase()) || null;

  const pick = (category: Category) => {
    setTarget(category);
    inputRef.current?.click();
  };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !target) return;
    setBusy(target.name);
    try { await onUpload(file, target.id); } finally { setBusy(null); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <ClipboardCheck size={16} className="text-gray-500" />
          Shipping documents
        </h2>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block w-28 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${done === REQUIRED_OPERATION_DOCS.length ? 'bg-green-500' : 'bg-primary-500'}`}
              style={{ width: `${(done / REQUIRED_OPERATION_DOCS.length) * 100}%` }} />
          </div>
          <span className={`text-xs font-semibold ${done === REQUIRED_OPERATION_DOCS.length ? 'text-green-600' : 'text-gray-500'}`}>
            {done} of {REQUIRED_OPERATION_DOCS.length} in
          </span>
        </div>
      </div>

      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={onFile} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        {REQUIRED_OPERATION_DOCS.map(name => {
          const filed = docsInCategory(documents, name);
          const category = categoryOf(name);
          const has = filed.length > 0;
          return (
            <div key={name}
              className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 ${has ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-gray-50/50'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800 min-w-0">
                  {has
                    ? <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
                    : <Circle size={15} className="text-gray-300 flex-shrink-0" />}
                  <span className="truncate">{name}</span>
                </span>
                {category && (
                  <button type="button" onClick={() => pick(category)} disabled={busy !== null}
                    title={has ? `Add another ${name}` : `Upload the ${name}`}
                    className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 flex-shrink-0">
                    {busy === name ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {has ? 'Add' : 'Upload'}
                  </button>
                )}
              </div>
              {has ? (
                <ul className="space-y-0.5">
                  {filed.map(d => (
                    <li key={d.id}>
                      <button type="button" onClick={() => onPreview(d, name)}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-primary-600 max-w-full" title={`Preview ${d.file_name}`}>
                        <Eye size={11} className="flex-shrink-0" /> <span className="truncate">{d.file_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-gray-400">Not uploaded yet</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
