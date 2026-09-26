import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../lib/api';
import { Columns2, Loader2, RefreshCw, X } from 'lucide-react';

/**
 * The customer's order next to the document being generated from it, so the
 * two can be checked against each other before confirming. The order shows
 * as the uploaded file when there is one, else as its recorded lines.
 */
export default function OrderCompareModal({ orderId, title, renderPreview, onClose, left }: {
  orderId?: number | null;
  /** "Order confirmation", "Invoice", "Purchase order" */
  title: string;
  /** Renders the current form to a PDF blob. */
  renderPreview: () => Promise<Blob>;
  onClose: () => void;
  /** Show this file on the left instead of the customer's order (e.g. the Bill of Lading). */
  left?: { title: string; filePath: string; fileName?: string; subfolder: string };
}) {
  const [order, setOrder] = useState<any>(null);
  const [orderUrl, setOrderUrl] = useState<string | null>(null);
  const [orderType, setOrderType] = useState('');
  const [orderLoading, setOrderLoading] = useState(true);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [docError, setDocError] = useState(false);
  const urls = useRef<string[]>([]);

  const track = (url: string) => { urls.current.push(url); return url; };
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (left) {
          const resp = await api.get(`/files/${left.subfolder}/${left.filePath}`, { responseType: 'blob' });
          const type = resp.headers['content-type'] || 'application/pdf';
          if (!cancelled) {
            setOrderType(type);
            setOrderUrl(track(URL.createObjectURL(new Blob([resp.data], { type }))));
          }
          return;
        }
        if (!orderId) return;
        const { data } = await api.get(`/orders/${orderId}`);
        if (cancelled) return;
        setOrder(data);
        if (data.file_path) {
          const resp = await api.get(`/files/orders/${data.file_path}`, { responseType: 'blob' });
          const type = resp.headers['content-type'] || 'application/pdf';
          if (!cancelled) {
            setOrderType(type);
            setOrderUrl(track(URL.createObjectURL(new Blob([resp.data], { type }))));
          }
        }
      } catch {
        /* falls back to the recorded lines, or the empty state */
      } finally {
        if (!cancelled) setOrderLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, left?.filePath]);

  async function refreshDoc() {
    setDocLoading(true);
    setDocError(false);
    try {
      const blob = await renderPreview();
      setDocUrl(track(URL.createObjectURL(blob)));
    } catch {
      setDocError(true);
    } finally {
      setDocLoading(false);
    }
  }
  useEffect(() => { refreshDoc(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Just the pages: no thumbnail sidebar or toolbar in the browser's PDF viewer
  const pdfOnly = (url: string) => `${url}#navpanes=0&toolbar=0&view=FitH`;

  const pane = 'flex-1 min-h-0 min-w-0 flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden';
  const head = 'px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-sm font-medium text-gray-700';

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 p-2 sm:p-4 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between text-white mb-2" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold flex items-center gap-2"><Columns2 size={18} /> {left ? left.title : 'Order'} vs {title.toLowerCase()}</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10" title="Close (Esc)"><X size={20} /></button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3" onClick={e => e.stopPropagation()}>
        <div className={pane}>
          <div className={head}>
            {left ? left.title : `Customer order${order?.order_number ? ` ${order.order_number}` : ''}`}
            {(left?.fileName || order?.file_name) && <span className="text-xs font-normal text-gray-400 truncate">{left?.fileName || order?.file_name}</span>}
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-gray-50">
            {orderLoading ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
            ) : orderUrl && orderType.startsWith('image/') ? (
              <img src={orderUrl} alt="Customer order" className="max-w-full mx-auto" />
            ) : orderUrl ? (
              <iframe src={pdfOnly(orderUrl)} title="Customer order" className="w-full h-full min-h-[60vh] bg-white" />
            ) : order ? (
              <OrderLines order={order} />
            ) : (
              <p className="p-6 text-sm text-gray-500">The order could not be loaded.</p>
            )}
          </div>
        </div>

        <div className={pane}>
          <div className={head}>
            {title} (preview of the current form)
            <button onClick={refreshDoc} disabled={docLoading}
              className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-0.5">
              {docLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
            </button>
          </div>
          <div className="flex-1 min-h-0 bg-gray-50">
            {docLoading && !docUrl ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
            ) : docError && !docUrl ? (
              <p className="p-6 text-sm text-red-600">The preview could not be rendered.</p>
            ) : docUrl ? (
              <iframe src={pdfOnly(docUrl)} title={title} className="w-full h-full min-h-[60vh] bg-white" />
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** An order entered by hand has no file — show what was recorded instead. */
function OrderLines({ order }: { order: any }) {
  const items: any[] = order.items || [];
  const rows: Array<[string, string]> = [
    ['Customer', order.customer_name || order.supplier_name || ''],
    ['Order date', order.order_date || ''],
    ['Incoterms', order.inco_terms || ''],
    ['Destination', order.destination || ''],
    ['Delivery date', order.delivery_date || ''],
    ['Payment terms', order.payment_terms || ''],
  ].filter(([, v]) => !!v) as Array<[string, string]>;
  return (
    <div className="p-4 space-y-4 text-sm">
      <p className="text-xs text-gray-500">No order document was uploaded — these are the order's recorded details.</p>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-gray-500">{k}</dt><dd className="text-gray-900">{v}</dd></Fragment>))}
        </dl>
      )}
      <table className="w-full bg-white border border-gray-200 rounded">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="text-left px-2 py-1.5">Product</th>
            <th className="text-right px-2 py-1.5">Qty</th>
            <th className="text-right px-2 py-1.5">Unit price</th>
            <th className="text-right px-2 py-1.5">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((i, idx) => (
            <tr key={idx}>
              <td className="px-2 py-1.5">{i.description}{i.packaging ? <span className="text-gray-400"> · {i.packaging}</span> : null}</td>
              <td className="px-2 py-1.5 text-right">{i.quantity} {i.unit}</td>
              <td className="px-2 py-1.5 text-right">{i.unit_price} {i.currency}</td>
              <td className="px-2 py-1.5 text-right">{((Number(i.quantity) || 0) * (Number(i.unit_price) || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })} {i.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
