import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCheck2, ShoppingCart, Receipt, Package, Eye, Trash2, FilePlus2 } from 'lucide-react';
import MenuPanel from './ui/MenuPanel';
import api from '../lib/api';
import PurchasePoPickerModal from './PurchasePoPickerModal';

/**
 * The documents generated from an order (or NCO) — order confirmation, supplier
 * PO, invoice, packing list — behind ONE "Generate" button: its panel lists
 * each with where it stands (Not started / Draft / Generated), a preview eye,
 * a bin for a draft, and Create / Continue / Open into its generator.
 */

interface Doc {
  id: number;
  status?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  /** Packing lists: the final PDF, filed beside the draft. */
  final_file_path?: string | null;
  final_file_name?: string | null;
}

export interface PreviewTarget { fileName: string; filePath: string; subfolder: string; label?: string }

type State = { oc: Doc | null; po: Doc | null; invoice: Doc | null; pl: Doc | null };

export default function DocumentGenerators({ orderId, operationId, ncoId, ncoType = 'samples', refreshKey, onPreview, onChanged, importedPo }: {
  orderId: number | null;
  operationId?: number | null;
  /** A non-commercial operation instead of an order: everything is drafted from its lines and filed under it. */
  ncoId?: number | null;
  /** Samples: OC, sample invoice, PL and supplier PO. Shipping (with a supplier): the supplier PO only. */
  ncoType?: 'samples' | 'shipping';
  /** When given, each document with a filed PDF gets an eye icon that opens it here. */
  onPreview?: (item: PreviewTarget) => void;
  /** Changes when the documents may have changed (e.g. the operation's document count). */
  refreshKey?: unknown;
  /** After a draft was deleted (a packing-list draft also had a filed PDF), or a purchase operation's PO was filed. */
  onChanged?: () => void;
  /** A purchase operation's PO already filed under this operation (sales operations). */
  importedPo?: { file_name: string; file_path: string } | null;
}) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<State>({ oc: null, po: null, invoice: null, pl: null });
  const [reload, setReload] = useState(0);
  // Sales operation without its own PO: ask first whether to use a purchase operation's PO
  const [askPurchasePo, setAskPurchasePo] = useState(false);

  useEffect(() => {
    if (!orderId && !ncoId) return;
    const first = (url: string) => api.get(url).then(({ data }) => (data?.[0] as Doc) || null).catch(() => null);
    const by = ncoId ? `by-nco/${ncoId}` : `by-order/${orderId}`;
    Promise.all([
      first(`/order-confirmations/${by}`),
      first(`/purchase-orders/${by}`),
      first(`/invoice-documents/${by}`),
      first(`/packing-lists/${by}`),
    ]).then(([oc, po, invoice, pl]) => setDocs({ oc, po, invoice, pl }));
  }, [orderId, ncoId, refreshKey, reload]);

  if (!orderId && !ncoId) return null;
  const q = ncoId ? `nco_id=${ncoId}` : `order_id=${orderId}${operationId ? `&operation_id=${operationId}` : ''}`;
  const source = ncoId ? 'this NCO' : 'this order';
  const poOnly = !!ncoId && ncoType === 'shipping';
  const invoiceFinal = !!docs.invoice && docs.invoice.status !== 'draft';

  /** The PDF to preview: a generated document's, a PL's final (else its draft). */
  const pdfOf = (doc: Doc | null): { path: string; name: string } | null => {
    if (!doc) return null;
    if (doc.final_file_path) return { path: doc.final_file_path, name: doc.final_file_name || 'packing-list.pdf' };
    // OC / PO / invoice drafts have no file; a PL draft has its watermarked one
    if (doc.file_path) return { path: doc.file_path, name: doc.file_name || 'document.pdf' };
    return null;
  };
  const eye = (doc: Doc | null, label: string, close: () => void) => {
    const pdf = onPreview ? pdfOf(doc) : null;
    if (!pdf) return null;
    return (
      <button type="button" title={`Preview ${pdf.name}`}
        onClick={() => { close(); onPreview!({ fileName: pdf.name, filePath: pdf.path, subfolder: 'operation-docs', label }); }}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
        <Eye size={15} />
      </button>
    );
  };

  /** A bin beside a draft (a PL only while it was never finalized). */
  const ENDPOINT: Record<keyof State, string> = { oc: 'order-confirmations', po: 'purchase-orders', invoice: 'invoice-documents', pl: 'packing-lists' };
  const NAME: Record<keyof State, string> = { oc: 'order confirmation', po: 'supplier PO', invoice: ncoId ? 'sample invoice' : 'invoice', pl: 'packing list' };
  const bin = (key: keyof State, close: () => void) => {
    const doc = docs[key];
    if (!doc || doc.status !== 'draft' || doc.final_file_path) return null;
    return (
      <button type="button" title={`Delete the draft ${NAME[key]}`}
        onClick={async () => {
          close();
          if (!window.confirm(`Delete the draft ${NAME[key]}? Its number becomes free again.`)) return;
          try {
            await api.delete(`/${ENDPOINT[key]}/${doc.id}`);
            setReload(n => n + 1);
            onChanged?.();
          } catch { window.alert(`Could not delete the draft ${NAME[key]}`); }
        }}
        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
        <Trash2 size={15} />
      </button>
    );
  };

  type Key = keyof State;
  const rows: Array<{ key: Key; label: string; icon: ReactNode; doc: Doc | null; open: () => void; disabled?: string; extra?: ReactNode; note?: string }> = [
    ...(!poOnly ? [{
      key: 'oc' as Key, label: 'Order confirmation', icon: <FileCheck2 size={16} />, doc: docs.oc,
      open: () => navigate(docs.oc ? `/order-confirmations/${docs.oc.id}` : `/order-confirmations/new?${q}`),
    }] : []),
    {
      key: 'po', label: 'Supplier purchase order', icon: <ShoppingCart size={16} />, doc: docs.po,
      note: !docs.po && importedPo ? `${importedPo.file_name} — from a purchase operation` : undefined,
      open: () => {
        if (docs.po) navigate(`/purchase-orders/${docs.po.id}`);
        else if (operationId && !ncoId) setAskPurchasePo(true);
        else navigate(`/purchase-orders/new?${q}`);
      },
    },
    ...(!poOnly ? [{
      key: 'invoice' as Key, label: ncoId ? 'Sample invoice' : 'Invoice', icon: <Receipt size={16} />, doc: docs.invoice,
      open: () => navigate(docs.invoice ? `/invoices/documents/${docs.invoice.id}` : `/invoices/documents/new?${q}`),
    }, {
      key: 'pl' as Key, label: 'Packing list', icon: <Package size={16} />, doc: docs.pl,
      disabled: !docs.pl && !invoiceFinal ? 'Generate the invoice first — the packing list is built from it' : undefined,
      open: () => navigate(docs.pl ? `/packing-lists/${docs.pl.id}` : `/packing-lists/new?invoice_document_id=${docs.invoice?.id}`),
    }] : []),
  ];
  const doneCount = rows.filter(r => (r.doc && r.doc.status !== 'draft') || (r.key === 'po' && !r.doc && importedPo)).length;

  /** Where a document stands, as a coloured chip. */
  const chip = (r: typeof rows[number]) => {
    if (!r.doc && r.key === 'po' && importedPo) return <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Filed</span>;
    if (!r.doc) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Not started</span>;
    if (r.doc.status === 'draft') return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Draft</span>;
    return <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Generated</span>;
  };
  const sub = (r: typeof rows[number]) => r.disabled
    ? r.disabled
    : r.note ? r.note
    : !r.doc ? `Create it from ${source}`
    : r.doc.status === 'draft' ? (r.doc.final_file_name ? `Final ${r.doc.final_file_name} · edits saved as a draft` : 'Saved, not generated yet — continue it')
    : r.doc.final_file_name || r.doc.file_name || 'Generated and filed';
  const action = (r: typeof rows[number]) => !r.doc ? (r.key === 'po' && importedPo ? 'Change' : 'Create') : r.doc.status === 'draft' ? 'Continue' : 'Open';

  return (
    <>
      <MenuPanel label="Generate" icon={<FilePlus2 size={15} />} variant="primary" badge={`${doneCount}/${rows.length}`} width={400}
        title="Create or open the documents generated from this order — order confirmation, supplier PO, invoice, packing list">
        {close => (
          <div className="py-1.5">
            <p className="px-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Documents from {source}</p>
            {rows.map(r => {
              const eyeBtn = r.key === 'po' && !r.doc && importedPo && onPreview ? (
                <button type="button" title={`Preview ${importedPo.file_name}`}
                  onClick={() => { close(); onPreview({ fileName: importedPo.file_name, filePath: importedPo.file_path, subfolder: 'operation-docs', label: 'Supplier purchase order' }); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Eye size={15} /></button>
              ) : eye(r.doc, r.key === 'pl' && !r.doc?.final_file_path ? 'Packing list (draft)' : r.label, close);
              return (
                <div key={r.key} className={`group flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg ${r.disabled ? 'opacity-60' : 'hover:bg-gray-50'}`}>
                  <button type="button" disabled={!!r.disabled} onClick={() => { close(); r.open(); }}
                    className="flex flex-1 min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${r.doc && r.doc.status !== 'draft' ? 'bg-green-50 text-green-600' : r.doc ? 'bg-amber-50 text-amber-600' : 'bg-primary-50 text-primary-600'}`}>
                      {r.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{r.label}</span>
                        {chip(r)}
                      </span>
                      <span className="block truncate text-xs text-gray-500">{sub(r)}</span>
                    </span>
                  </button>
                  {eyeBtn}
                  {bin(r.key, close)}
                  {!r.disabled && (
                    <button type="button" onClick={() => { close(); r.open(); }}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary-600 hover:bg-primary-50">
                      {action(r)} →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </MenuPanel>
      {askPurchasePo && operationId && (
        <PurchasePoPickerModal
          operationId={operationId}
          onClose={() => setAskPurchasePo(false)}
          onCreateNew={() => { setAskPurchasePo(false); navigate(`/purchase-orders/new?${q}`); }}
          onFiled={() => { setAskPurchasePo(false); onChanged?.(); }}
        />
      )}
    </>
  );
}
