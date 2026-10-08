import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Eye, Upload, Loader2, ClipboardCheck, ListChecks, Type, FilePlus2, PenLine, Truck } from 'lucide-react';
import { REQUIRED_OPERATION_DOCS, GENERAL_DOCUMENT, docsInCategory } from '../lib/operationDocs';
import ChooseDocumentModal from './ChooseDocumentModal';
import SupplierDocumentPickerModal from './SupplierDocumentPickerModal';
import { type DocOwner, ownerQuery } from '../lib/docOwner';

/**
 * The shipping documents an operation needs (Quality certificate, COA, Origin,
 * Insurance, Sanitary, Phytosanitary certificates, EUR1, Label, MSDS, Product
 * Specification Sheet, Declaration): one tile each, ticked once a document of
 * that category is filed. Choose picks documents already in the app (best fit
 * ticked); Upload files one from the computer straight into the category.
 * Then a General document tile (not counted): a supplier's documents, or an upload.
 * The Declaration and COA tiles list what the generator made for this owner and
 * open it ("Generate"); COA also keeps Choose (library / batch COAs as they are).
 */

interface Doc { id: number; file_name: string; file_path: string; category_name: string | null }
interface Category { id: number; name: string }

export interface OperationDeclaration { id: number; kind?: 'declaration' | 'coa'; title: string; status: 'draft' | 'final'; document_id: number | null; has_draft?: number | boolean }

export default function RequiredDocuments({ owner, documents, categories, onUpload, onPreview, onFiled, onOpenFile, onEditText, declarations = [] }: {
  /** The operation or non-commercial operation the documents belong to. */
  owner: DocOwner;
  documents: Doc[];
  categories: Category[];
  /** After documents were chosen from the system. */
  onFiled: () => void;
  /** Preview any stored file (library, batch, other operations). */
  onOpenFile: (file: { fileName: string; filePath: string; subfolder: string; label?: string }) => void;
  /** Edit the text of a filed Word document (declarations). */
  onEditText?: (docId: number) => void;
  /** Declarations generated for this operation (the Declaration tile opens the generator). */
  declarations?: OperationDeclaration[];
  /** Uploads one file into the category; resolves when done (the page refreshes its documents). */
  onUpload: (file: File, categoryId: number) => Promise<void>;
  onPreview: (doc: Doc, category: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Category | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<Category | null>(null);
  const [fromSupplier, setFromSupplier] = useState<Category | null>(null);
  const navigate = useNavigate();
  // Tiles the generator fills: Declaration, COA
  const genKind = (name: string): 'declaration' | 'coa' | null =>
    name.toLowerCase() === 'declaration' ? 'declaration' : name.toLowerCase() === 'coa' ? 'coa' : null;
  const isDeclaration = (name: string) => genKind(name) !== null;
  const generatedFor = (name: string) => declarations.filter(d => (d.kind || 'declaration') === genKind(name));

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
      <ChooseDocumentModal category={choosing} owner={owner} onClose={() => setChoosing(null)}
        onFiled={onFiled} onUpload={onUpload} onPreview={onOpenFile} />
      <SupplierDocumentPickerModal category={fromSupplier} owner={owner} onClose={() => setFromSupplier(null)}
        onFiled={onFiled} onUpload={onUpload} onPreview={onOpenFile} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
        {REQUIRED_OPERATION_DOCS.map(name => {
          const filed = docsInCategory(documents, name);
          const category = categoryOf(name);
          const has = filed.length > 0;
          const made = generatedFor(name);
          const coa = genKind(name) === 'coa';
          return (
            <div key={name}
              className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 ${has ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-gray-50/50'}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                  {has
                    ? <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
                    : <Circle size={15} className="text-gray-300 flex-shrink-0" />}
                  <span>{name}</span>
                </span>
                {isDeclaration(name) ? (
                  <span className="flex items-center gap-2 flex-shrink-0">
                    {coa && category && (
                      <button type="button" onClick={() => setChoosing(category)} disabled={busy !== null}
                        title="Choose a COA already in the system (library, batches, other operations) as it is"
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">
                        <ListChecks size={12} /> Choose
                      </button>
                    )}
                    <button type="button" onClick={() => navigate(`/declarations/new?${ownerQuery(owner)}${coa ? '&kind=coa' : ''}`)}
                      title={coa ? 'Generate a COA — start from the right one in the system (this operation\'s lots first), upload one or start blank' : 'Generate a declaration — start from one in the system or upload one'}
                      className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                      <FilePlus2 size={12} /> {made.length || has ? (coa ? 'Add COA' : 'Add declaration') : 'Generate'}
                    </button>
                  </span>
                ) : category && (
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onClick={() => setChoosing(category)} disabled={busy !== null}
                      title={`Choose a ${name} already in the system`}
                      className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50">
                      <ListChecks size={12} /> Choose
                    </button>
                    <button type="button" onClick={() => pick(category)} disabled={busy !== null}
                      title={`Upload a ${name} from your computer`}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">
                      {busy === name ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload
                    </button>
                  </span>
                )}
              </div>
              {isDeclaration(name) && made.length > 0 && (
                <ul className="space-y-1">
                  {made.map(dec => {
                    const doc = dec.document_id ? filed.find(f => f.id === dec.document_id) : undefined;
                    return (
                      <li key={`dec${dec.id}`} className="flex items-start gap-1">
                        <button type="button" onClick={() => navigate(`/declarations/${dec.id}`)} title={`Open in the ${coa ? 'COA' : 'declaration'} generator`}
                          className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-primary-600"><PenLine size={11} /></button>
                        <button type="button" onClick={() => (doc ? onPreview(doc, name) : navigate(`/declarations/${dec.id}`))}
                          className="flex items-start gap-1 text-left text-xs text-gray-600 hover:text-primary-600 max-w-full"
                          title={doc ? `Preview ${doc.file_name}` : 'Draft — open it to finish and generate'}>
                          {doc && <Eye size={11} className="flex-shrink-0 mt-0.5" />}
                          <span className="break-words min-w-0 [overflow-wrap:anywhere]">
                            {doc ? doc.file_name : dec.title}
                            {dec.status === 'draft' && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700">draft</span>}
                            {dec.status === 'final' && dec.has_draft ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700">edits pending</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {isDeclaration(name) && !has && made.length > 0 ? null : has ? (
                <ul className="space-y-1">
                  {filed.filter(d => !(isDeclaration(name) && made.some(dec => dec.document_id === d.id))).map(d => (
                    <li key={d.id} className="flex items-start gap-1">
                      {onEditText && /\.docx$/i.test(d.file_name) && (
                        <button type="button" onClick={() => onEditText(d.id)} title="Edit the text"
                          className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-primary-600"><Type size={11} /></button>
                      )}
                      <button type="button" onClick={() => onPreview(d, name)}
                        className="flex items-start gap-1 text-left text-xs text-gray-600 hover:text-primary-600 max-w-full" title={`Preview ${d.file_name}`}>
                        <Eye size={11} className="flex-shrink-0 mt-0.5" /> <span className="break-words min-w-0 [overflow-wrap:anywhere]">{d.file_name}</span>
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
        {(() => {
          const category = categoryOf(GENERAL_DOCUMENT);
          const filed = docsInCategory(documents, GENERAL_DOCUMENT);
          return (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2.5 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                  <FilePlus2 size={15} className="text-gray-400 flex-shrink-0" />
                  <span>{GENERAL_DOCUMENT}</span>
                </span>
                {category && (
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onClick={() => setFromSupplier(category)} disabled={busy !== null}
                      title="Choose a document from a supplier's documents"
                      className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50">
                      <Truck size={12} /> From supplier
                    </button>
                    <button type="button" onClick={() => pick(category)} disabled={busy !== null}
                      title="Upload a document from your computer"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">
                      {busy === GENERAL_DOCUMENT ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload
                    </button>
                  </span>
                )}
              </div>
              {filed.length ? (
                <ul className="space-y-1">
                  {filed.map(d => (
                    <li key={d.id} className="flex items-start gap-1">
                      <button type="button" onClick={() => onPreview(d, GENERAL_DOCUMENT)}
                        className="flex items-start gap-1 text-left text-xs text-gray-600 hover:text-primary-600 max-w-full" title={`Preview ${d.file_name}`}>
                        <Eye size={11} className="flex-shrink-0 mt-0.5" /> <span className="break-words min-w-0 [overflow-wrap:anywhere]">{d.file_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-gray-400">Any other document — from a supplier or your computer</span>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
