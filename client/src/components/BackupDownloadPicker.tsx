import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

// Settings → Backup: download the whole backup, or tick exactly which parts go
// in the ZIP — per tab with or without its files (else just the Excel).

interface PartOption { key: string; label: string; hint: string; tab: boolean; has_files: boolean }
type Picks = Record<string, { on: boolean; files: boolean }>;

const STORAGE_KEY = 'settings.backupPicks';

function loadPicks(): Picks {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}

function savePicks(picks: Picks) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(picks)); } catch { /* not remembered */ }
}

async function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export default function BackupDownloadPicker() {
  const { addToast } = useToast();
  const [parts, setParts] = useState<PartOption[]>([]);
  const [picks, setPicks] = useState<Picks>(loadPicks);
  const [busy, setBusy] = useState<'full' | 'custom' | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get('/backup/parts').then(r => setParts(r.data || [])).catch(() => {});
  }, []);

  const pickOf = (key: string) => picks[key] ?? { on: false, files: true };
  const update = (next: Picks) => { setPicks(next); savePicks(next); };
  const setPick = (key: string, patch: Partial<{ on: boolean; files: boolean }>) =>
    update({ ...picks, [key]: { ...pickOf(key), ...patch } });

  const chosen = parts.filter(p => pickOf(p.key).on);
  const tabs = parts.filter(p => p.tab);
  const whole = parts.filter(p => !p.tab);

  const allTabs = (files: boolean) => {
    const next: Picks = { ...picks };
    for (const p of whole) next[p.key] = { ...pickOf(p.key), on: false };
    for (const p of tabs) next[p.key] = { on: true, files };
    update(next);
  };
  const clear = () => {
    const next: Picks = {};
    for (const p of parts) next[p.key] = { ...pickOf(p.key), on: false };
    update(next);
  };

  async function downloadFull() {
    setBusy('full');
    try {
      const res = await api.get('/backup', { responseType: 'blob' });
      await saveBlob(res.data, `erp-backup-${stamp()}.zip`);
      addToast('Backup downloaded', 'success');
    } catch {
      addToast('Failed to download the backup', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function downloadChosen() {
    if (!chosen.length) return;
    setBusy('custom');
    try {
      const res = await api.post('/backup/custom', {
        parts: chosen.map(p => ({ part: p.key, files: p.has_files ? pickOf(p.key).files : true })),
      }, { responseType: 'blob' });
      await saveBlob(res.data, `erp-backup-custom-${stamp()}.zip`);
      addToast('Backup downloaded', 'success');
    } catch {
      addToast('Failed to download the backup', 'error');
    } finally {
      setBusy(null);
    }
  }

  const row = (p: PartOption) => {
    const pick = pickOf(p.key);
    return (
      <div key={p.key} className="flex items-start gap-3 py-2">
        <input type="checkbox" id={`bk-${p.key}`} checked={pick.on} onChange={e => setPick(p.key, { on: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
        <label htmlFor={`bk-${p.key}`} className="flex-1 min-w-0 cursor-pointer">
          <span className="block text-sm font-medium text-gray-900">{p.label}</span>
          <span className="block text-xs text-gray-500">{p.hint}</span>
        </label>
        {p.has_files && (
          <label className={`flex items-center gap-1.5 text-xs shrink-0 ${pick.on ? 'text-gray-700' : 'text-gray-300'}`}>
            <input type="checkbox" checked={pick.files} disabled={!pick.on} onChange={e => setPick(p.key, { files: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            With files
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Download full backup</p>
          <p className="text-sm text-gray-500 mt-0.5">
            Everything in one ZIP: the database, every uploaded file and the invoices by category — enough to restore the app
          </p>
        </div>
        <button onClick={downloadFull} disabled={busy !== null}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
          {busy === 'full' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {busy === 'full' ? 'Preparing...' : 'Download all'}
        </button>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-start gap-2 text-left">
          {open ? <ChevronDown size={16} className="text-gray-400 mt-0.5 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 mt-0.5 shrink-0" />}
          <span>
            <span className="block text-sm font-medium text-gray-900">Choose what to download{chosen.length ? ` (${chosen.length} ticked)` : ''}</span>
            <span className="block text-sm text-gray-500 mt-0.5">Only some tabs or parts, each in its own folder of one ZIP — with or without their files.</span>
          </span>
        </button>
        {open && <>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-3 mb-1">
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => allTabs(true)} className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">All tabs</button>
            <button type="button" onClick={() => allTabs(false)} className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">All tabs, Excel only</button>
            <button type="button" onClick={clear} className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">Clear</button>
          </div>
        </div>

        {parts.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mt-3 mb-1">By tab</p>
              <div className="divide-y divide-gray-100">{tabs.map(row)}</div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mt-3 mb-1">Whole app</p>
              <div className="divide-y divide-gray-100">{whole.map(row)}</div>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-3">
          <button onClick={downloadChosen} disabled={busy !== null || chosen.length === 0}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {busy === 'custom' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {busy === 'custom' ? 'Preparing...' : chosen.length ? `Download selected (${chosen.length})` : 'Download selected'}
          </button>
        </div>
        </>}
      </div>
    </div>
  );
}
