import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Loader2, Eye, FileSpreadsheet, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { downloadExcel } from '../lib/exportExcel';
import { useToast } from '../contexts/ToastContext';

/**
 * Full check of every supplier invoice: Claude reads each stored PDF and the
 * report lists where the stored figures differ from the printed ones.
 * Report only — fixing is done by hand in the invoice list / VAT audit.
 */

type Field = 'net' | 'vat' | 'currency' | 'supplier' | 'invoice_number' | 'date';

interface Row {
  id: number; domain: string; category: string;
  status: 'ok' | 'differs' | 'no_pdf' | 'not_read' | 'failed';
  stored: { invoice_id: string; issue_date: string; supplier: string; currency: string; amount: number; vat_amount: number; total: number };
  read?: {
    invoice_id: string | null; issue_date: string | null; supplier: string | null; supplier_as_printed: string | null;
    supplier_vat: string | null; supplier_country: string | null; currency: string | null;
    amount: number; vat_amount: number; total: number; vat_rate: number | null;
  };
  diffs: Field[]; warnings: string[];
  eur_net_diff?: number; eur_vat_diff?: number;
}

interface CheckData {
  job: { running: boolean; total: number; done: number; failed: { id: number; reason: string }[]; startedAt: string | null; finishedAt: string | null };
  summary: { total: number; checked: number; matching: number; differing: number; not_checkable: number; not_read: number; amount_diffs: number; eur_net_diff: number; eur_vat_diff: number };
  report: Row[];
}

type FilterKey = 'all' | 'amounts' | 'currency' | 'supplier' | 'number_date' | 'warnings' | 'not_checkable';

const FILTERS: { key: FilterKey; label: string; test: (r: Row) => boolean }[] = [
  { key: 'all', label: 'All differences', test: r => r.status === 'differs' },
  { key: 'amounts', label: 'Net & VAT', test: r => r.diffs.includes('net') || r.diffs.includes('vat') },
  { key: 'currency', label: 'Currency', test: r => r.diffs.includes('currency') },
  { key: 'supplier', label: 'Supplier', test: r => r.diffs.includes('supplier') },
  { key: 'number_date', label: 'Number & date', test: r => r.diffs.includes('invoice_number') || r.diffs.includes('date') },
  { key: 'warnings', label: 'Warnings', test: r => r.warnings.length > 0 },
  { key: 'not_checkable', label: 'Not checkable', test: r => r.status === 'no_pdf' || r.status === 'failed' || r.status === 'not_read' },
];

const WARNING_LABELS: Record<string, string> = {
  totals_mismatch: 'Net + VAT ≠ total on the invoice',
  vat_rate_unusual: 'Unusual VAT rate',
  foreign_vat: 'Foreign supplier charges VAT',
  not_an_invoice: 'Not an invoice (quote / statement?)',
};

const STATUS_LABELS: Record<string, string> = { no_pdf: 'No PDF stored', not_read: 'Not read yet', failed: 'Could not be read' };

const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (n: number) => `€${money(n)}`;

export default function InvoiceFullCheck({ onClose, onView }: { onClose: () => void; onView: (id: number) => void }) {
  const { addToast } = useToast();
  const [data, setData] = useState<CheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/demo-expenses/full-check');
      setData(res.data);
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to load the check', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  // Poll while the job runs
  const running = !!data?.job.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load]);

  const start = async (force: boolean) => {
    setStarting(true);
    try {
      await api.post('/demo-expenses/full-check', { force });
      await load();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to start the check', 'error');
    } finally {
      setStarting(false);
    }
  };

  const rows = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter)!;
    return (data?.report || []).filter(f.test);
  }, [data, filter]);

  const exportExcel = async () => {
    const all = (data?.report || []).filter(r => r.status !== 'ok');
    await downloadExcel(`Supplier invoice check ${new Date().toISOString().substring(0, 10)}`, [
      'Status', 'Differences', 'Warnings', 'Domain', 'Category',
      'Stored invoice no.', 'Printed invoice no.', 'Stored date', 'Printed date',
      'Stored supplier', 'Printed supplier', 'Supplier VAT no.', 'Country',
      'Stored currency', 'Printed currency',
      'Stored net', 'Printed net', 'Stored VAT', 'Printed VAT', 'Printed VAT rate %', 'Stored total', 'Printed total',
      'Net diff (EUR)', 'VAT diff (EUR)', 'Row id',
    ], all.map(r => [
      r.status === 'differs' ? 'Differs' : STATUS_LABELS[r.status] || r.status,
      r.diffs.join(', '), r.warnings.map(w => WARNING_LABELS[w] || w).join(', '), r.domain, r.category,
      r.stored.invoice_id, r.read?.invoice_id, r.stored.issue_date, r.read?.issue_date,
      r.stored.supplier, r.read?.supplier_as_printed, r.read?.supplier_vat, r.read?.supplier_country,
      r.stored.currency, r.read?.currency,
      r.stored.amount, r.read?.amount, r.stored.vat_amount, r.read?.vat_amount, r.read?.vat_rate, r.stored.total, r.read?.total,
      r.eur_net_diff, r.eur_vat_diff, r.id,
    ]));
  };

  const s = data?.summary;
  const job = data?.job;
  const neverRun = !!data && !job?.startedAt && s?.checked === 0;

  // One cell: stored value, and the printed one underneath when it differs
  const Cell = ({ r, field, stored, read, className = '' }: { r: Row; field: Field; stored: ReactNode; read: ReactNode; className?: string }) => {
    const differs = r.diffs.includes(field);
    return (
      <td className={`px-3 py-2 align-top ${className}`}>
        <div className={differs ? 'text-gray-400 line-through' : 'text-gray-800'}>{stored}</div>
        {differs && <div className="text-red-700 font-medium">{read}</div>}
      </td>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl max-w-[1400px] w-full mx-4 max-h-[92vh] flex flex-col">
        <div className="p-5 border-b flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Full check of supplier invoices</h2>
            <p className="text-sm text-gray-500 mt-1">
              Every stored invoice PDF is read and compared with what is stored. Nothing is changed — fix rows in the invoice list or the VAT audit.
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={28} /></div>
        ) : (
          <>
            <div className="px-5 py-4 border-b space-y-3">
              {running && job && (
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading invoices…</span>
                    <span className="tabular-nums">{job.done} / {job.total}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-2 bg-primary-600 transition-all" style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">You can close this window — the check keeps running on the server.</p>
                </div>
              )}
              {s && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Invoices</p><p className="font-semibold tabular-nums">{s.total}</p></div>
                  <div><p className="text-xs text-gray-400">Checked</p><p className="font-semibold tabular-nums">{s.checked}{s.not_read > 0 && <span className="text-gray-400 font-normal"> ({s.not_read} to read)</span>}</p></div>
                  <div><p className="text-xs text-gray-400">Correct</p><p className="font-semibold text-green-600 tabular-nums">{s.matching}</p></div>
                  <div><p className="text-xs text-gray-400">With differences</p><p className="font-semibold text-red-600 tabular-nums">{s.differing}<span className="text-gray-400 font-normal"> ({s.amount_diffs} amounts)</span></p></div>
                  <div><p className="text-xs text-gray-400">Net difference</p><p className="font-semibold tabular-nums">{eur(s.eur_net_diff)}</p></div>
                  <div><p className="text-xs text-gray-400">VAT difference</p><p className="font-semibold text-amber-600 tabular-nums">{eur(s.eur_vat_diff)}</p></div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {!running && (
                  <button onClick={() => start(false)} disabled={starting}
                    className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50 flex items-center gap-1.5">
                    {starting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {neverRun ? 'Start check' : s && s.not_read > 0 ? `Read the remaining ${s.not_read}` : 'Run again'}
                  </button>
                )}
                {!running && !neverRun && (
                  <button onClick={() => start(true)} disabled={starting}
                    className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    title="Read every invoice again, ignoring earlier readings">
                    Re-read all
                  </button>
                )}
                <button onClick={exportExcel} disabled={!s || (s.differing === 0 && s.not_checkable === 0)}
                  className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5">
                  <FileSpreadsheet size={14} /> Download Excel
                </button>
                <div className="flex flex-wrap gap-1.5 ml-auto">
                  {FILTERS.map(f => {
                    const n = (data?.report || []).filter(f.test).length;
                    return (
                      <button key={f.key} onClick={() => setFilter(f.key)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${filter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {f.label} <span className="opacity-70">{n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {rows.length === 0 ? (
                <p className="py-16 text-center text-sm text-gray-400">
                  {neverRun ? 'Not run yet — start the check to read every invoice.' : 'Nothing in this view.'}
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500 uppercase">
                    <tr className="border-b">
                      <th className="text-left px-3 py-2 font-medium">Invoice no.</th>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Supplier</th>
                      <th className="text-left px-3 py-2 font-medium">Cur.</th>
                      <th className="text-right px-3 py-2 font-medium">Net</th>
                      <th className="text-right px-3 py-2 font-medium">VAT</th>
                      <th className="text-right px-3 py-2 font-medium">Total</th>
                      <th className="text-left px-3 py-2 font-medium">Notes</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <Cell r={r} field="invoice_number" stored={r.stored.invoice_id} read={r.read?.invoice_id} className="max-w-[180px] break-all" />
                        <Cell r={r} field="date" stored={formatDate(r.stored.issue_date)} read={r.read?.issue_date ? formatDate(r.read.issue_date) : ''} className="whitespace-nowrap" />
                        <Cell r={r} field="supplier" stored={r.stored.supplier} className="max-w-[220px]"
                          read={<>{r.read?.supplier}{r.read?.supplier_as_printed && r.read.supplier_as_printed !== r.read.supplier && <span className="block text-gray-400 font-normal">printed: {r.read.supplier_as_printed}</span>}</>} />
                        <Cell r={r} field="currency" stored={r.stored.currency} read={r.read?.currency} />
                        <Cell r={r} field="net" stored={money(r.stored.amount)} read={money(r.read?.amount)} className="text-right tabular-nums whitespace-nowrap" />
                        <Cell r={r} field="vat" stored={money(r.stored.vat_amount)}
                          read={<>{money(r.read?.vat_amount)}{r.read?.vat_rate != null && <span className="text-gray-400 font-normal"> ({r.read.vat_rate}%)</span>}</>}
                          className="text-right tabular-nums whitespace-nowrap" />
                        <td className="px-3 py-2 align-top text-right tabular-nums whitespace-nowrap">
                          <div className="text-gray-800">{money(r.stored.total)}</div>
                          {r.read && Math.abs(r.read.total - r.stored.total) > 0.02 && <div className="text-red-700 font-medium">{money(r.read.total)}</div>}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-500 max-w-[220px]">
                          {STATUS_LABELS[r.status] && <div>{STATUS_LABELS[r.status]}</div>}
                          {r.warnings.map(w => <div key={w} className="text-amber-700">{WARNING_LABELS[w] || w}</div>)}
                          {(r.eur_net_diff || r.eur_vat_diff) ? (
                            <div className="text-gray-400">Δ net {eur(r.eur_net_diff || 0)} · Δ VAT {eur(r.eur_vat_diff || 0)}</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <button onClick={() => onView(r.id)} className="text-gray-400 hover:text-primary-600" title="View invoice"><Eye size={15} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-2 border-t text-xs text-gray-400">
              Crossed out = stored value, red = what the invoice shows.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
