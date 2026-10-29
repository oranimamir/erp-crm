import { useEffect, useState, type ReactNode } from 'react';
import { Columns2, ShoppingCart, FileCheck2, Receipt, Ship, FileText, Search } from 'lucide-react';
import MenuPanel from './ui/MenuPanel';
import api from '../lib/api';
import OrderCompareModal, { type CompareChoice } from './OrderCompareModal';
import { sortForSending } from '../lib/operationDocs';

/**
 * ONE "Compare" button on every generator: its panel offers the customer's
 * order, the order confirmation, the invoice or the Bill of Lading (greyed with
 * the reason when missing / still a draft), then every PDF / image filed in the
 * owner's documents (operation, NCO or purchase operation; searchable when many)
 * — the pick opens side by side with the document being edited.
 */

export type CompareKind = 'order' | 'oc' | 'invoice' | 'bl';

export interface CompareFile { number: string; file_path: string; file_name: string | null }

const MISSING: Record<CompareKind, string> = {
  order: 'No order linked',
  oc: 'No finalized order confirmation for this order yet',
  invoice: 'No generated invoice for this order yet',
  bl: 'No Bill of Lading in the operation documents yet',
};

const previewable = (name: string) => /\.(pdf|png|jpe?g|gif|webp)$/i.test(name || '');

export default function CompareButtons({ kinds, orderId, operationId, ncoId, purchaseOperationId, title, renderPreview, bl }: {
  kinds: CompareKind[];
  orderId: number | null;
  /** Lets the BL be looked up among the operation's documents when not passed in. */
  operationId?: number | null;
  /** Owners whose documents "Compare with other documents" lists (the first one known). */
  ncoId?: number | null;
  purchaseOperationId?: number | null;
  /** What is being generated — "Invoice", "Packing list". */
  title: string;
  renderPreview: () => Promise<Blob>;
  /** The operation's BL, when the page knows it. */
  bl?: CompareFile | null;
}) {
  const [oc, setOc] = useState<CompareFile | null>(null);
  const [invoice, setInvoice] = useState<CompareFile | null>(null);
  const [foundBl, setFoundBl] = useState<CompareFile | null>(null);

  useEffect(() => {
    if (bl !== undefined || !kinds.includes('bl') || !operationId) { setFoundBl(null); return; }
    api.get(`/operations/${operationId}/bill-of-lading`)
      .then(({ data }) => setFoundBl(data?.file_path ? { number: '', file_path: data.file_path, file_name: data.file_name } : null))
      .catch(() => setFoundBl(null));
  }, [operationId, bl === undefined, kinds.join(',')]);
  const [open, setOpen] = useState<CompareKind | null>(null);

  // The owner's uploaded / filed documents, for "Compare with other documents"
  const ownerUrl = operationId ? `/operations/${operationId}`
    : ncoId ? `/non-commercial-operations/${ncoId}`
    : purchaseOperationId ? `/purchase-operations/${purchaseOperationId}` : null;
  const [docs, setDocs] = useState<CompareChoice[]>([]);
  const [otherDoc, setOtherDoc] = useState<CompareChoice | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!ownerUrl) { setDocs([]); return; }
    api.get(ownerUrl)
      .then(({ data }) => {
        const list = sortForSending(((data?.documents || []) as any[]).filter(d => d.file_path && previewable(d.file_name)));
        setDocs(list.map(d => ({
          id: d.id,
          label: d.category_name ? `${d.file_name} — ${d.category_name}` : d.file_name,
          filePath: d.file_path, fileName: d.file_name, subfolder: 'operation-docs',
        })));
      })
      .catch(() => setDocs([]));
  }, [ownerUrl]);

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

  const files: Record<CompareKind, CompareFile | null> = { order: null, oc, invoice, bl: bl !== undefined ? bl : foundBl };
  const available = (kind: CompareKind) => (kind === 'order' ? !!orderId : !!files[kind]);

  const left = (kind: CompareKind) => {
    const f = files[kind];
    if (kind === 'order' || !f) return undefined;
    const name = kind === 'oc' ? `Order confirmation ${f.number}` : kind === 'invoice' ? `Invoice ${f.number}` : 'Bill of Lading';
    return { title: name, filePath: f.file_path, fileName: f.file_name || undefined, subfolder: 'operation-docs' };
  };

  const ICON: Record<CompareKind, ReactNode> = {
    order: <ShoppingCart size={16} />, oc: <FileCheck2 size={16} />, invoice: <Receipt size={16} />, bl: <Ship size={16} />,
  };
  const NAME: Record<CompareKind, string> = { order: "Customer's order", oc: 'Order confirmation', invoice: 'Invoice', bl: 'Bill of Lading' };
  const term = search.trim().toLowerCase();
  const shownDocs = term ? docs.filter(d => d.label.toLowerCase().includes(term)) : docs;
  const availableCount = kinds.filter(available).length + (docs.length ? 1 : 0);

  return (
    <>
      <MenuPanel label="Compare" icon={<Columns2 size={15} />} width={420} badge={availableCount ? null : '0'}
        title={`Show another document side by side with this ${title.toLowerCase()}`}>
        {close => (
          <div className="py-1.5">
            <p className="px-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Side by side with this {title.toLowerCase()}</p>
            {kinds.map(kind => {
              const ok = available(kind);
              const f = files[kind];
              return (
                <button key={kind} type="button" disabled={!ok} onClick={() => { close(); setOpen(kind); }}
                  className="flex w-[calc(100%-12px)] items-center gap-3 mx-1.5 px-3 py-2 rounded-lg text-left hover:bg-gray-50 disabled:opacity-55 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ok ? 'bg-primary-50 text-primary-600' : 'bg-gray-100 text-gray-400'}`}>{ICON[kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900">{NAME[kind]}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {!ok ? MISSING[kind] : kind === 'order' ? 'The order the customer sent' : (f?.file_name || f?.number)}
                    </span>
                  </span>
                  {ok && <span className="shrink-0 text-xs font-semibold text-primary-600">Compare →</span>}
                </button>
              );
            })}
            {ownerUrl && (
              <div className="mt-1.5 border-t border-gray-100 pt-1.5">
                <p className="px-4 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Other documents filed here {docs.length ? `(${docs.length})` : ''}
                </p>
                {docs.length > 6 && (
                  <div className="px-3 pb-1.5">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a document…" autoFocus
                        className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                  </div>
                )}
                {docs.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-gray-400">No PDF or image in the documents yet.</p>
                ) : shownDocs.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-gray-400">Nothing matches “{search}”.</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {shownDocs.map(d => (
                      <button key={d.id} type="button" onClick={() => { close(); setSearch(''); setOtherDoc(d); }}
                        className="flex w-[calc(100%-12px)] items-center gap-2.5 mx-1.5 px-3 py-1.5 rounded-lg text-left hover:bg-gray-50">
                        <FileText size={14} className="shrink-0 text-gray-400" />
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{d.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </MenuPanel>
      {otherDoc && (
        <OrderCompareModal
          title={title}
          left={{ title: otherDoc.label, filePath: otherDoc.filePath, fileName: otherDoc.fileName, subfolder: otherDoc.subfolder }}
          choices={docs}
          onChoose={setOtherDoc}
          renderPreview={renderPreview}
          onClose={() => setOtherDoc(null)}
        />
      )}
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
