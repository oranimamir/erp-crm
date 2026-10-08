import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCheck2, ShoppingCart, Receipt, Package, Eye } from 'lucide-react';
import api from '../lib/api';

/**
 * The four documents generated from an order — order confirmation, supplier
 * PO, invoice, packing list — each opening its generator. The label says
 * where each stands: nothing yet, a saved draft, or ✓ finalized (and filed in
 * the operation's Documents).
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

const btn = 'flex items-center gap-1 text-xs sm:text-sm text-primary-600 hover:text-primary-700 border border-primary-200 bg-primary-50 rounded-lg px-2 py-1 disabled:opacity-100 disabled:bg-gray-50 disabled:text-gray-300 disabled:border-gray-200 disabled:cursor-not-allowed';

const mark = (doc: Doc | null) => (!doc ? '' : doc.status === 'draft' ? ' (draft)' : ' ✓');

export default function DocumentGenerators({ orderId, operationId, ncoId, ncoType = 'samples', refreshKey, onPreview }: {
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
}) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<State>({ oc: null, po: null, invoice: null, pl: null });

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
  }, [orderId, ncoId, refreshKey]);

  if (!orderId && !ncoId) return null;
  const q = ncoId ? `nco_id=${ncoId}` : `order_id=${orderId}${operationId ? `&operation_id=${operationId}` : ''}`;
  const source = ncoId ? 'this NCO' : 'this order';
  const poOnly = !!ncoId && ncoType === 'shipping';
  const invoiceFinal = !!docs.invoice && docs.invoice.status !== 'draft';

  const title = (doc: Doc | null, what: string) => !doc
    ? `Generate the ${what} from ${source}`
    : doc.status === 'draft' ? `Continue the draft ${what}` : `Open the ${what}${doc.file_name ? ` (${doc.file_name})` : ''}`;

  /** The PDF to preview: a generated document's, a PL's final (else its draft). */
  const pdfOf = (doc: Doc | null): { path: string; name: string } | null => {
    if (!doc) return null;
    if (doc.final_file_path) return { path: doc.final_file_path, name: doc.final_file_name || 'packing-list.pdf' };
    // OC / PO / invoice drafts have no file; a PL draft has its watermarked one
    if (doc.file_path) return { path: doc.file_path, name: doc.file_name || 'document.pdf' };
    return null;
  };
  const eye = (doc: Doc | null, label: string) => {
    const pdf = onPreview ? pdfOf(doc) : null;
    if (!pdf) return null;
    return (
      <button type="button" title={`Preview ${pdf.name}`}
        onClick={() => onPreview!({ fileName: pdf.name, filePath: pdf.path, subfolder: 'operation-docs', label })}
        className="-ml-1 p-1 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100">
        <Eye size={14} />
      </button>
    );
  };

  return (
    <>
      {!poOnly && <>
      <button className={btn} title={title(docs.oc, 'order confirmation')}
        onClick={() => navigate(docs.oc ? `/order-confirmations/${docs.oc.id}` : `/order-confirmations/new?${q}`)}>
        <FileCheck2 size={13} /> Order Confirmation{mark(docs.oc)}
      </button>
      {eye(docs.oc, 'Order confirmation')}
      </>}
      <button className={btn} title={title(docs.po, 'supplier purchase order')}
        onClick={() => navigate(docs.po ? `/purchase-orders/${docs.po.id}` : `/purchase-orders/new?${q}`)}>
        <ShoppingCart size={13} /> Supplier PO{mark(docs.po)}
      </button>
      {eye(docs.po, 'Supplier purchase order')}
      {!poOnly && <>
      <button className={btn} title={title(docs.invoice, 'invoice')}
        onClick={() => navigate(docs.invoice ? `/invoices/documents/${docs.invoice.id}` : `/invoices/documents/new?${q}`)}>
        <Receipt size={13} /> {ncoId ? 'Sample invoice' : 'Invoice'}{mark(docs.invoice)}
      </button>
      {eye(docs.invoice, 'Invoice')}
      {/* The packing list is built from the generated invoice */}
      <button className={btn} disabled={!docs.pl && !invoiceFinal}
        title={docs.pl ? title(docs.pl, 'packing list')
          : invoiceFinal ? 'Generate the packing list from the invoice' : 'Generate the invoice first — the packing list is built from it'}
        onClick={() => navigate(docs.pl ? `/packing-lists/${docs.pl.id}` : `/packing-lists/new?invoice_document_id=${docs.invoice?.id}`)}>
        <Package size={13} /> Packing List{mark(docs.pl)}
      </button>
      {eye(docs.pl, docs.pl?.final_file_path ? 'Packing list' : 'Packing list (draft)')}
      </>}
    </>
  );
}
