import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSignature, Plus, Eye, Trash2, Pencil } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import type { PreviewTarget } from './DocumentGenerators';

interface Proforma {
  id: number;
  pi_number: string;
  status: 'draft' | 'final';
  file_path: string | null;
  file_name: string | null;
  sent_to: string | null;
  sent_at: string | null;
  updated_at: string;
  draft?: unknown;
  data: { oc_date?: string };
  summary: { total: number; currency: string; products: string[]; lines: number };
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Proforma invoices of an operation — issued before the client's order, in the
 * order confirmation's format. "New proforma invoice" opens the generator,
 * which offers to start from the client's earlier order confirmations.
 */
export default function ProformaInvoicesCard({ operationId, hasOrder, refreshKey, onPreview, onChanged }: {
  operationId: number;
  hasOrder: boolean;
  refreshKey?: unknown;
  onPreview: (item: PreviewTarget) => void;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Proforma[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.get(`/proforma-invoices/by-operation/${operationId}`).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [operationId, refreshKey, reload]);

  // Once the order is in, the card only stays while there are proformas to see
  if (rows === null || (hasOrder && rows.length === 0)) return null;

  const newOne = () => navigate(`/proforma-invoices/new?operation_id=${operationId}`);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <FileSignature size={18} className="text-violet-600" /> Proforma Invoice{rows.length > 1 ? `s (${rows.length})` : ''}
        </h2>
        <button onClick={newOne}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700">
          <Plus size={14} /> New proforma invoice
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-4 text-sm text-gray-500">
          No order yet? Send the client a proforma invoice first — products, prices, shipping cost and terms in the order confirmation format,
          or copied from one of their earlier order confirmations.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map(p => (
            <div key={p.id} className="px-4 sm:px-5 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => navigate(`/proforma-invoices/${p.id}`)} className="font-medium text-gray-900 hover:text-primary-600 hover:underline">{p.pi_number}</button>
                  {p.status === 'draft'
                    ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Draft</span>
                    : <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Generated</span>}
                  {p.status !== 'draft' && !!p.draft && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">edits pending</span>}
                  {p.sent_at && <span className="text-[11px] text-gray-500">Sent to {p.sent_to}</span>}
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {[p.data?.oc_date ? formatDate(p.data.oc_date) : '', p.summary.products.join(', ')].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">{money(p.summary.total)} {p.summary.currency}</span>
              <div className="flex items-center gap-1">
                {p.file_path && (
                  <button title={`Preview ${p.file_name}`} onClick={() => onPreview({ fileName: p.file_name || 'proforma.pdf', filePath: p.file_path!, subfolder: 'operation-docs', label: 'Proforma invoice' })}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Eye size={15} /></button>
                )}
                <button title="Open" onClick={() => navigate(`/proforma-invoices/${p.id}`)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Pencil size={15} /></button>
                {p.status === 'draft' && (
                  <button title="Delete this draft" onClick={async () => {
                    if (!window.confirm(`Delete the draft proforma ${p.pi_number}?`)) return;
                    try { await api.delete(`/proforma-invoices/${p.id}`); setReload(n => n + 1); onChanged?.(); }
                    catch { window.alert('Could not delete the draft'); }
                  }} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
