import { useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, Search, ShoppingCart, FilePlus2 } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Sales operation → Supplier PO: first asks whether to use a PO generated on a
 * purchase operation. Choosing one files a copy of its PDF under the operation
 * (category Purchase Order, via `from-system` source `purchase`); otherwise
 * the usual supplier PO generator opens.
 */

interface PurchasePo {
  id: number;
  po_number: string;
  file_path: string;
  file_name: string | null;
  purchase_operation_document_id: number;
  purchase_operation_id: number;
  po_date: string | null;
  supplier_label: string | null;
  products: string[];
  /** Uploaded as a document rather than generated here. */
  uploaded: boolean;
}

export default function PurchasePoPickerModal({ operationId, onClose, onCreateNew, onFiled }: {
  operationId: number;
  onClose: () => void;
  /** Open the supplier PO generator instead. */
  onCreateNew: () => void;
  onFiled: () => void;
}) {
  const { addToast } = useToast();
  const [rows, setRows] = useState<PurchasePo[] | null>(null);
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // The PO shown below the list (inside this window, so it is never hidden behind it)
  const [preview, setPreview] = useState<{ id: number; url: string | null } | null>(null);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);

  async function showPreview(r: PurchasePo) {
    if (preview?.id === r.id) { setPreview(null); return; }
    setPreview({ id: r.id, url: null });
    try {
      const resp = await api.get(`/files/operation-docs/${r.file_path}`, { responseType: 'blob' });
      const type = String(resp.headers['content-type'] || 'application/pdf');
      if (!/pdf|image/.test(type)) { addToast('This PO is not a PDF or image — download it from the purchase operation', 'info'); setPreview(null); return; }
      setPreview({ id: r.id, url: URL.createObjectURL(new Blob([resp.data], { type })) });
    } catch {
      addToast('Failed to load the preview', 'error');
      setPreview(null);
    }
  }

  useEffect(() => {
    api.get('/purchase-operations/for-picking').then(res => setRows(res.data || [])).catch(() => setRows([]));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter(r => !q || `${r.po_number} ${r.supplier_label || ''} ${r.products.join(' ')}`.toLowerCase().includes(q));
  }, [rows, search]);

  async function use() {
    const row = rows?.find(r => r.id === chosen);
    if (!row) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/operations/${operationId}/documents/from-system`, {
        category: 'Purchase Order', items: [{ source: 'purchase', id: row.purchase_operation_document_id }],
      });
      if (!data.added) throw new Error(data.missing?.length ? `File missing: ${data.missing.join(', ')}` : 'Nothing was filed');
      addToast(`${row.file_name || row.po_number} filed under the operation documents`, 'success');
      onFiled();
    } catch (err: any) {
      addToast(err.response?.data?.error || err.message || 'Failed to file the PO', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title="Supplier PO" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Use a PO from Purchase Operations? Its PDF is filed in this operation's documents.</p>

        <div className="relative w-fit">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search number, supplier, product…"
            className="rounded-full border border-gray-300 bg-white pl-8 pr-3 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
          {rows === null ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-600" size={20} /></div>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              {rows.length ? 'No PO matches.' : 'No generated POs on purchase operations yet.'}
            </p>
          ) : shown.map(r => (
            <label key={r.id} className={`flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50 ${chosen === r.id ? 'bg-primary-50' : ''}`}>
              <input type="radio" name="purchase-po" checked={chosen === r.id} onChange={() => setChosen(r.id)} />
              <ShoppingCart size={15} className="shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {r.po_number} <span className="font-normal text-gray-500">· {r.supplier_label || 'No supplier'}{r.po_date ? ` · ${formatDate(r.po_date)}` : ''}</span>
                  {r.uploaded && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-normal text-gray-600">uploaded</span>}
                </p>
                {r.uploaded && <p className="truncate text-xs text-gray-400">{r.file_name}</p>}
                {r.products.length > 0 && <p className="truncate text-xs text-gray-400">{r.products.join(', ')}</p>}
              </div>
              <button type="button" title={preview?.id === r.id ? 'Hide the preview' : 'Preview'}
                onClick={e => { e.preventDefault(); showPreview(r); }}
                className={`p-1.5 rounded hover:text-gray-700 ${preview?.id === r.id ? 'text-primary-600' : 'text-gray-400'}`}>
                <Eye size={15} />
              </button>
            </label>
          ))}
        </div>

        {preview && (
          preview.url
            ? <iframe src={preview.url} title="Purchase order preview" className="w-full rounded-lg border border-gray-200" style={{ height: '50vh' }} />
            : <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-600" size={20} /></div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button variant="secondary" onClick={onCreateNew} disabled={saving}>
            <FilePlus2 size={14} /> No — create a new supplier PO
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={use} disabled={saving || !chosen}>
              {saving && <Loader2 size={14} className="animate-spin" />} Use this PO
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
