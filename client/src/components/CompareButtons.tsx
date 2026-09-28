import { useEffect, useState } from 'react';
import { Columns2 } from 'lucide-react';
import api from '../lib/api';
import OrderCompareModal from './OrderCompareModal';

/**
 * The "Compare with …" buttons every generator carries: the document being
 * edited side by side with the customer's order, the order confirmation, the
 * invoice or the Bill of Lading. A button whose document does not exist yet
 * (or is still a draft, so has no PDF) stays in light grey.
 */

export type CompareKind = 'order' | 'oc' | 'invoice' | 'bl';

export interface CompareFile { number: string; file_path: string; file_name: string | null }

const LABELS: Record<CompareKind, string> = {
  order: 'Compare with order',
  oc: 'Compare with OC',
  invoice: 'Compare with invoice',
  bl: 'Compare with BL',
};

const MISSING: Record<CompareKind, string> = {
  order: 'No order linked',
  oc: 'No finalized order confirmation for this order yet',
  invoice: 'No generated invoice for this order yet',
  bl: 'No Bill of Lading in the operation documents yet',
};

const cls = (available: boolean) => available
  ? 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-colors'
  : 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold bg-gray-50 text-gray-300 border border-gray-200 cursor-not-allowed';

export default function CompareButtons({ kinds, orderId, title, renderPreview, bl }: {
  kinds: CompareKind[];
  orderId: number | null;
  /** What is being generated — "Invoice", "Packing list". */
  title: string;
  renderPreview: () => Promise<Blob>;
  /** The operation's BL, when the page knows it. */
  bl?: CompareFile | null;
}) {
  const [oc, setOc] = useState<CompareFile | null>(null);
  const [invoice, setInvoice] = useState<CompareFile | null>(null);
  const [open, setOpen] = useState<CompareKind | null>(null);

  useEffect(() => {
    if (!orderId) { setOc(null); setInvoice(null); return; }
    if (kinds.includes('oc')) {
      api.get(`/order-confirmations/by-order/${orderId}`)
        .then(({ data }) => {
          const hit = (data || []).find((r: any) => r.file_path && r.status !== 'draft');
          setOc(hit ? { number: hit.oc_number, file_path: hit.file_path, file_name: hit.file_name } : null);
        })
        .catch(() => setOc(null));
    }
    if (kinds.includes('invoice')) {
      api.get(`/invoice-documents/by-order/${orderId}`)
        .then(({ data }) => {
          const hit = (data || []).find((r: any) => r.file_path && r.status !== 'draft');
          setInvoice(hit ? { number: hit.invoice_number, file_path: hit.file_path, file_name: hit.file_name } : null);
        })
        .catch(() => setInvoice(null));
    }
  }, [orderId, kinds.join(',')]);

  const files: Record<CompareKind, CompareFile | null> = { order: null, oc, invoice, bl: bl ?? null };
  const available = (kind: CompareKind) => (kind === 'order' ? !!orderId : !!files[kind]);

  const left = (kind: CompareKind) => {
    const f = files[kind];
    if (kind === 'order' || !f) return undefined;
    const name = kind === 'oc' ? `Order confirmation ${f.number}` : kind === 'invoice' ? `Invoice ${f.number}` : 'Bill of Lading';
    return { title: name, filePath: f.file_path, fileName: f.file_name || undefined, subfolder: 'operation-docs' };
  };

  return (
    <>
      {kinds.map(kind => {
        const ok = available(kind);
        const f = files[kind];
        return (
          <button
            key={kind} type="button" disabled={!ok} onClick={() => setOpen(kind)} className={cls(ok)}
            title={ok ? (kind === 'order' ? "Show the customer's order side by side with this document"
              : `Show ${f?.file_name || f?.number} next to this document`) : MISSING[kind]}
          >
            <Columns2 size={14} /> {LABELS[kind]}
          </button>
        );
      })}
      {open && available(open) && (
        <OrderCompareModal
          key={open}
          orderId={orderId}
          title={title}
          left={left(open)}
          renderPreview={renderPreview}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
