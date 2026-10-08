import { useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Products → Import SKUs: upload the packaging list (or any sheet with
 * "commercial name | reference" side by side), see what each row would do,
 * then save the ticked ones. Only SKUs change; no product is added or removed.
 */

type Status = 'set' | 'change' | 'same' | 'not_found' | 'conflict';
interface Row {
  name: string; sku: string; sheet: string; status: Status; conflict_with?: string;
  product: { id: number; name: string; sku: string | null } | null;
}

const LABEL: Record<Status, string> = {
  set: 'SKU missing — will be filled', change: 'Different SKU — will be replaced', same: 'Already correct',
  not_found: 'Not in the catalogue', conflict: 'SKU used by another product',
};

export default function SkuImportModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const close = () => { setRows(null); setFileName(''); setPicked(new Set()); onClose(); };

  async function read(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/products/import-skus', fd);
      const list: Row[] = data.rows || [];
      setRows(list);
      setPicked(new Set(list.flatMap((r, i) => (r.status === 'set' || r.status === 'change' ? [i] : []))));
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not read the file', 'error');
      setRows(null);
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    try {
      const updates = [...picked].map(i => ({ product_id: rows[i].product!.id, sku: rows[i].sku }));
      const { data } = await api.post('/products/skus', { updates });
      addToast(`${data.updated} SKU${data.updated === 1 ? '' : 's'} saved`, 'success');
      if (data.skipped?.length) addToast(`Skipped: ${data.skipped.join('; ')}`, 'error');
      onSaved();
      close();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the SKUs', 'error');
    } finally {
      setSaving(false);
    }
  }

  const toggle = (i: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const section = (statuses: Status[], selectable: boolean) => {
    const list = (rows || []).map((r, i) => ({ r, i })).filter(({ r }) => statuses.includes(r.status));
    if (!list.length) return null;
    return (
      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {statuses.map(s => LABEL[s]).join(' / ')} <span className="font-normal text-gray-400">({list.length})</span>
        </h3>
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          {list.map(({ r, i }) => (
            <label key={i} className={`flex items-center gap-3 px-3 py-1.5 text-sm ${selectable ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
              {selectable && (
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              )}
              <span className="min-w-0 flex-1 truncate text-gray-800">
                {r.product?.name ?? r.name}
                {r.product && r.product.name !== r.name && <span className="ml-1 text-xs text-gray-400">(file: {r.name})</span>}
              </span>
              {r.status === 'change' && <span className="font-mono text-xs text-gray-400 line-through">{r.product?.sku}</span>}
              <span className="font-mono text-xs text-gray-900">{r.sku}</span>
              {r.conflict_with && <span className="text-xs text-red-600">held by {r.conflict_with}</span>}
            </label>
          ))}
        </div>
      </section>
    );
  };

  return (
    <Modal open={open} onClose={close} title="Import SKUs from Excel" size="lg">
      <div className="space-y-4">
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
          onChange={e => { read(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={reading}>
            {reading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {rows ? 'Choose another file' : 'Choose the Excel file'}
          </Button>
          {fileName && <span className="flex items-center gap-1 text-sm text-gray-600"><FileSpreadsheet size={14} /> {fileName}</span>}
        </div>
        <p className="text-xs text-gray-500">
          Reads every commercial name with its reference next to it (e.g. the packaging list's "Products and codes" sheet) and matches it to the catalogue by name. Only SKUs are changed.
        </p>

        {rows && (
          <div className="max-h-[55vh] overflow-y-auto space-y-4 pr-1">
            {section(['set', 'change'], true)}
            {section(['conflict'], false)}
            {section(['not_found'], false)}
            {section(['same'], false)}
            {rows.some(r => r.status === 'not_found') && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={12} /> Names not in the catalogue are left out — add those products first, then import again.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-gray-500">{rows ? `${picked.size} SKU${picked.size === 1 ? '' : 's'} to save` : ''}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={saving || !rows || picked.size === 0}>
              {saving && <Loader2 size={14} className="animate-spin" />} Save {picked.size || ''} SKU{picked.size === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
