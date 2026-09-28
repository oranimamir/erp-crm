import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCheck2, ShoppingCart, Receipt, Package } from 'lucide-react';
import api from '../lib/api';

/**
 * The four documents generated from an order — order confirmation, supplier
 * PO, invoice, packing list — each opening its generator. The label says
 * where each stands: nothing yet, a saved draft, or ✓ finalized (and filed in
 * the operation's Documents).
 */

interface Doc { id: number; status?: string | null; file_name?: string | null }

type State = { oc: Doc | null; po: Doc | null; invoice: Doc | null; pl: Doc | null };

const btn = 'flex items-center gap-1 text-xs sm:text-sm text-primary-600 hover:text-primary-700 border border-primary-200 bg-primary-50 rounded-lg px-2 py-1 disabled:opacity-100 disabled:bg-gray-50 disabled:text-gray-300 disabled:border-gray-200 disabled:cursor-not-allowed';

const mark = (doc: Doc | null) => (!doc ? '' : doc.status === 'draft' ? ' (draft)' : ' ✓');

export default function DocumentGenerators({ orderId, operationId, refreshKey }: {
  orderId: number | null;
  operationId?: number | null;
  /** Changes when the documents may have changed (e.g. the operation's document count). */
  refreshKey?: unknown;
}) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<State>({ oc: null, po: null, invoice: null, pl: null });

  useEffect(() => {
    if (!orderId) return;
    const first = (url: string) => api.get(url).then(({ data }) => (data?.[0] as Doc) || null).catch(() => null);
    Promise.all([
      first(`/order-confirmations/by-order/${orderId}`),
      first(`/purchase-orders/by-order/${orderId}`),
      first(`/invoice-documents/by-order/${orderId}`),
      first(`/packing-lists/by-order/${orderId}`),
    ]).then(([oc, po, invoice, pl]) => setDocs({ oc, po, invoice, pl }));
  }, [orderId, refreshKey]);

  if (!orderId) return null;
  const q = `order_id=${orderId}${operationId ? `&operation_id=${operationId}` : ''}`;
  const invoiceFinal = !!docs.invoice && docs.invoice.status !== 'draft';

  const title = (doc: Doc | null, what: string) => !doc
    ? `Generate the ${what} from this order`
    : doc.status === 'draft' ? `Continue the draft ${what}` : `Open the ${what}${doc.file_name ? ` (${doc.file_name})` : ''}`;

  return (
    <>
      <button className={btn} title={title(docs.oc, 'order confirmation')}
        onClick={() => navigate(docs.oc ? `/order-confirmations/${docs.oc.id}` : `/order-confirmations/new?${q}`)}>
        <FileCheck2 size={13} /> Order Confirmation{mark(docs.oc)}
      </button>
      <button className={btn} title={title(docs.po, 'supplier purchase order')}
        onClick={() => navigate(docs.po ? `/purchase-orders/${docs.po.id}` : `/purchase-orders/new?${q}`)}>
        <ShoppingCart size={13} /> Supplier PO{mark(docs.po)}
      </button>
      <button className={btn} title={title(docs.invoice, 'invoice')}
        onClick={() => navigate(docs.invoice ? `/invoices/documents/${docs.invoice.id}` : `/invoices/documents/new?${q}`)}>
        <Receipt size={13} /> Invoice{mark(docs.invoice)}
      </button>
      {/* The packing list is built from the generated invoice */}
      <button className={btn} disabled={!docs.pl && !invoiceFinal}
        title={docs.pl ? title(docs.pl, 'packing list')
          : invoiceFinal ? 'Generate the packing list from the invoice' : 'Generate the invoice first — the packing list is built from it'}
        onClick={() => navigate(docs.pl ? `/packing-lists/${docs.pl.id}` : `/packing-lists/new?invoice_document_id=${docs.invoice?.id}`)}>
        <Package size={13} /> Packing List{mark(docs.pl)}
      </button>
    </>
  );
}
