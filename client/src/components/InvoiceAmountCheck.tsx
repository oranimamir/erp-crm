import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Eye, Loader2, RefreshCw, ScanSearch } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * Customer Invoices → Check amounts: the uploaded invoices are read again from
 * their file (the whole page, so a total printed in a box or picture beside
 * the table is found) and the ones recorded at another amount are listed to
 * correct — Apply takes the amount on the invoice, Keep leaves it as recorded.
 */

interface Row {
  invoice_id: number; invoice_number: string; customer_name: string | null; invoice_date: string | null;
  recorded_amount: number; recorded_currency: string; file_subfolder: string | null; file_path: string | null; file_name: string | null;
  read_total: number | null; read_currency: string | null;
  subtotal: number | null; freight: number | null; insurance: number | null; vat: number | null; other_charges: number | null;
  message: string | null;
  corrected_to?: number | null;
}
interface Overview {
  run: { running: boolean; total: number; done: number; read: number; stopped: string | null; finished_at: string | null };
  candidates: number; not_checked: number; matching: number; decided: number; estimated_usd: number;
  differing: Row[]; unreadable: Row[]; auto_corrected: Row[];
}

const money = (n: number | null | undefined, currency?: string | null) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;

export default function InvoiceAmountCheck({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get('/invoices/amount-check');
      setData(d);
      return d as Overview;
    } catch {
      return null;
    }
  }, []);

  // While a run is going, look again every few seconds
  useEffect(() => {
    if (!open) return;
    let stop = false;
    const tick = async () => {
      const d = await load();
      if (!stop && d?.run.running) timer.current = setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
  }, [open, load]);

  const start = async () => {
    try {
      const { data: d } = await api.post('/invoices/amount-check/run', {});
      setData(d);
      const tick = async () => { const n = await load(); if (n?.run.running) timer.current = setTimeout(tick, 3000); else onChanged?.(); };
      timer.current = setTimeout(tick, 2000);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not start the check', 'error');
    }
  };

  const apply = async (row: Row) => {
    setBusy(row.invoice_id);
    try {
      const typed = amounts[row.invoice_id];
      await api.post(`/invoices/${row.invoice_id}/amount-check/apply`, typed != null && typed !== '' ? { amount: Number(typed) } : {});
      addToast(`${row.invoice_number} corrected to ${money(typed ? Number(typed) : row.read_total, row.read_currency || row.recorded_currency)}`, 'success');
      await load();
      onChanged?.();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not correct the invoice', 'error');
    } finally {
      setBusy(null);
    }
  };

  const keep = async (row: Row) => {
    setBusy(row.invoice_id);
    try {
      await api.post(`/invoices/${row.invoice_id}/amount-check/keep`, {});
      await load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not save', 'error');
    } finally {
      setBusy(null);
    }
  };

  const applyAll = async () => {
    if (!data?.differing.length) return;
    if (!window.confirm(`Correct all ${data.differing.length} invoices to the amount read from their file?`)) return;
    setBusy('all');
    let done = 0;
    for (const row of data.differing) {
      try { await api.post(`/invoices/${row.invoice_id}/amount-check/apply`, {}); done++; } catch { /* listed again after the reload */ }
    }
    addToast(`${done} invoice${done === 1 ? '' : 's'} corrected`, 'success');
    await load();
    onChanged?.();
    setBusy(null);
  };

  const viewPdf = async (row: Row) => {
    if (!row.file_path || !row.file_subfolder) { addToast('No PDF found for this invoice', 'error'); return; }
    try {
      const resp = await api.get(`/files/${row.file_subfolder}/${row.file_path}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: String(resp.headers['content-type'] || 'application/pdf') }));
      window.open(url, '_blank', 'noopener');
    } catch {
      addToast('Could not open the file', 'error');
    }
  };

  const parts = (r: Row) => [
    r.subtotal != null ? `Subtotal ${money(r.subtotal)}` : '',
    r.freight ? `Freight ${money(r.freight)}` : '',
    r.insurance ? `Insurance ${money(r.insurance)}` : '',
    r.vat ? `VAT ${money(r.vat)}` : '',
    r.other_charges ? `Other ${money(r.other_charges)}` : '',
  ].filter(Boolean).join(' · ');

  const run = data?.run;
  return (
    <Modal open={open} onClose={onClose} title="Check invoice amounts" size="xl">
      {!data ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Reads every uploaded customer invoice again from its file — the whole page, so a total printed in a box or picture
            beside the table is found — and lists the ones recorded at a different amount. Invoices generated in the app are not
            checked: their amount is calculated.
          </p>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
            <span className="text-gray-700"><strong>{data.candidates}</strong> uploaded invoices</span>
            <span className="text-gray-500">· {data.matching} match</span>
            {data.decided > 0 && <span className="text-gray-500">· {data.decided} decided</span>}
            {data.not_checked > 0 && <span className="text-gray-500">· {data.not_checked} not read yet (≈ ${data.estimated_usd.toFixed(2)} of AI reading)</span>}
            <span className="ml-auto">
              {run?.running ? (
                <span className="inline-flex items-center gap-2 text-primary-700 font-medium">
                  <Loader2 size={14} className="animate-spin" /> Reading {Math.min(run.done + 1, run.total)} of {run.total}…
                </span>
              ) : isAdmin ? (
                <Button size="sm" onClick={start} disabled={!data.candidates}>
                  {data.not_checked === data.candidates ? <ScanSearch size={14} /> : <RefreshCw size={14} />}
                  {data.not_checked === data.candidates ? 'Check now' : 'Check again'}
                </Button>
              ) : (
                <span className="text-xs text-gray-500">An admin can start the check</span>
              )}
            </span>
          </div>

          {run?.stopped && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {run.stopped}
            </div>
          )}

          {data.differing.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
              <CheckCircle size={16} />
              {data.not_checked === data.candidates
                ? 'Nothing checked yet.'
                : run?.running ? 'No difference found so far…' : 'Every invoice read matches its recorded amount.'}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{data.differing.length} invoice{data.differing.length === 1 ? '' : 's'} recorded at a different amount</h3>
                <Button size="sm" variant="secondary" onClick={applyAll} disabled={busy !== null}>
                  {busy === 'all' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Correct all
                </Button>
              </div>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {data.differing.map(r => {
                  const diff = r.read_total != null ? r.read_total - r.recorded_amount : 0;
                  return (
                    <div key={r.invoice_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-[200px] flex-1">
                        <p className="text-sm">
                          <Link to={`/invoices/${r.invoice_id}`} className="font-semibold text-primary-600 hover:underline">{r.invoice_number}</Link>
                          <span className="text-gray-700"> · {r.customer_name || '—'}</span>
                          {r.invoice_date && <span className="text-gray-400"> · {formatDate(r.invoice_date)}</span>}
                        </p>
                        <p className="text-sm text-gray-600 mt-0.5">
                          Recorded <strong className="text-gray-900">{money(r.recorded_amount, r.recorded_currency)}</strong>
                          {' → '}on the invoice <strong className="text-green-700">{money(r.read_total, r.read_currency || r.recorded_currency)}</strong>
                          {diff !== 0 && <span className="text-amber-700"> ({diff > 0 ? '+' : ''}{money(diff)})</span>}
                        </p>
                        {parts(r) && <p className="text-xs text-gray-500 mt-0.5">{parts(r)}</p>}
                        {r.message && <p className="text-xs text-amber-700 mt-0.5">{r.message}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => viewPdf(r)} title="Open the invoice file"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Eye size={16} /></button>
                        <input type="number" step="any" value={amounts[r.invoice_id] ?? String(r.read_total ?? '')}
                          onChange={e => setAmounts(a => ({ ...a, [r.invoice_id]: e.target.value }))}
                          className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                          title="The amount to record" />
                        <Button size="sm" onClick={() => apply(r)} disabled={busy !== null}>
                          {busy === r.invoice_id ? <Loader2 size={14} className="animate-spin" /> : null} Correct
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => keep(r)} disabled={busy !== null}>Keep recorded</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {data.auto_corrected.length > 0 && (
            <details className="rounded-lg border border-green-200 bg-green-50/40 px-3 py-2 text-sm" open={!data.differing.length}>
              <summary className="cursor-pointer text-green-800 font-medium">
                {data.auto_corrected.length} corrected automatically — the subtotal had been recorded as the total
              </summary>
              <ul className="mt-2 space-y-1">
                {data.auto_corrected.map(r => (
                  <li key={r.invoice_id} className="flex flex-wrap items-center gap-2 text-gray-700">
                    <Link to={`/invoices/${r.invoice_id}`} className="font-medium text-primary-600 hover:underline">{r.invoice_number}</Link>
                    <span>{r.customer_name || ''}</span>
                    <span className="text-xs text-gray-500">now {money(r.corrected_to ?? r.recorded_amount, r.recorded_currency)}{parts(r) ? ` · ${parts(r)}` : ''}</span>
                    {r.file_path && <button type="button" onClick={() => viewPdf(r)} className="ml-auto p-1 text-gray-400 hover:text-gray-700"><Eye size={14} /></button>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {data.unreadable.length > 0 && (
            <details className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-gray-600">{data.unreadable.length} could not be read — check these by hand</summary>
              <ul className="mt-2 space-y-1">
                {data.unreadable.map(r => (
                  <li key={r.invoice_id} className="flex items-center gap-2 text-gray-600">
                    <Link to={`/invoices/${r.invoice_id}`} className="font-medium text-primary-600 hover:underline">{r.invoice_number}</Link>
                    <span>{r.customer_name || ''}</span>
                    <span className="text-xs text-gray-400">{r.message}</span>
                    {r.file_path && <button type="button" onClick={() => viewPdf(r)} className="ml-auto p-1 text-gray-400 hover:text-gray-700"><Eye size={14} /></button>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
