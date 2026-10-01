import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Loader2, Eye, FileSpreadsheet, RefreshCw, Wand2, Pencil, Check } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { downloadExcel } from '../lib/exportExcel';
import { useToast } from '../contexts/ToastContext';
import PdfPreview from './ui/PdfPreview';

/**
 * Full check of every supplier invoice, cheapest first:
 *   1. free text check (the stored figures are searched in the PDF text)
 *   2. AI on the text (Haiku, batch — half price) for what 1 could not confirm
 *   3. AI on the PDF (Sonnet, batch) for scans and doubtful text readings
 * Differences can be fixed with the reading's values (Fix) or by hand, next to
 * the invoice itself (quick view).
 */

type Field = 'net' | 'vat' | 'currency' | 'supplier' | 'invoice_number' | 'date';

export type CheckScope = 'all' | 'demo' | 'sales';

const SCOPES: { key: CheckScope; label: string }[] = [
  { key: 'all', label: 'All suppliers' },
  { key: 'demo', label: 'Demo expenses' },
  { key: 'sales', label: 'Sales activities' },
];

/** All / Demo expenses / Sales activities */
export function ScopeSwitch({ value, onChange }: { value: CheckScope; onChange: (v: CheckScope) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs">
      {SCOPES.map(s => (
        <button key={s.key} onClick={() => onChange(s.key)}
          className={`px-2.5 py-1.5 font-medium ${value === s.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} ${s.key !== 'all' ? 'border-l border-gray-300' : ''}`}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

interface Read {
  invoice_id: string | null; issue_date: string | null; supplier: string | null; supplier_as_printed: string | null;
  supplier_vat: string | null; supplier_country: string | null; currency: string | null;
  amount: number; vat_amount: number; total: number; vat_rate: number | null;
}

interface Row {
  id: number; domain: string; category: string;
  status: 'ok' | 'differs' | 'accepted' | 'no_pdf' | 'not_read' | 'waiting' | 'not_checked';
  accepted_by?: string; accepted_at?: string;
  stored: { invoice_id: string; issue_date: string; supplier: string; currency: string; amount: number; vat_amount: number; total: number };
  read?: Read;
  diffs: Field[]; warnings: string[]; reasons: string[];
  verified_by?: string;
  eur_net_diff?: number; eur_vat_diff?: number;
}

interface CheckRun {
  id: number; scope: string; status: 'text' | 'ai_text' | 'ai_pdf' | 'done' | 'stopped';
  started_by: string | null; started_at: string; finished_at: string | null; message: string | null;
  text_progress: { running: boolean; done: number; total: number };
  ai_reading: number; ai_read: number; cost_usd: number;
}

interface CheckData {
  run: CheckRun | null;
  budget: { monthly_usd: number; spent_usd: number; left_usd: number };
  summary: {
    total: number; ok: number; accepted: number; confirmed_free: number; differing: number; amount_diffs: number;
    waiting: number; not_read: number; not_checked: number; no_pdf: number; eur_net_diff: number; eur_vat_diff: number;
  };
  report: Row[];
}

type FilterKey = 'all' | 'amounts' | 'currency' | 'supplier' | 'number_date' | 'warnings' | 'rules' | 'accepted' | 'open';

const FILTERS: { key: FilterKey; label: string; test: (r: Row) => boolean }[] = [
  { key: 'all', label: 'All differences', test: r => r.status === 'differs' },
  { key: 'amounts', label: 'Net & VAT', test: r => r.diffs.includes('net') || r.diffs.includes('vat') },
  { key: 'currency', label: 'Currency', test: r => r.diffs.includes('currency') },
  { key: 'supplier', label: 'Supplier', test: r => r.diffs.includes('supplier') },
  { key: 'number_date', label: 'Number & date', test: r => r.diffs.includes('invoice_number') || r.diffs.includes('date') },
  { key: 'warnings', label: 'Warnings', test: r => r.status === 'differs' && r.warnings.length > 0 },
  { key: 'rules', label: 'No PDF (VAT rules)', test: r => r.status === 'differs' && r.warnings.some(w => w.startsWith('rule_')) },
  { key: 'accepted', label: 'Marked correct', test: r => r.status === 'accepted' },
  { key: 'open', label: 'Not checked yet', test: r => ['not_read', 'waiting', 'not_checked', 'no_pdf'].includes(r.status) },
];

const WARNING_LABELS: Record<string, string> = {
  totals_mismatch: 'Net + VAT ≠ total on the invoice',
  vat_rate_unusual: 'Unusual VAT rate',
  foreign_vat: 'Foreign supplier charges VAT',
  not_an_invoice: 'Not an invoice (statement / tax filing?)',
  needs_pdf_read: 'Text reading unsure — the PDF itself was not read (spending limit?)',
  rule_foreign_vat: 'No PDF · foreign supplier charging VAT (reverse charge expected)',
  rule_vat_too_high: 'No PDF · VAT above 30% of net',
  rule_may_include_vat: 'No PDF · Belgian supplier without VAT — amount may include 21%',
};

const STATUS_LABELS: Record<string, string> = {
  no_pdf: 'No PDF stored', not_read: 'Not confirmed for free and not read by AI (spending limit or AI unavailable)', waiting: 'AI reading in progress',
  not_checked: 'Not checked yet — run the check',
};

const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (n: number) => `€${money(n)}`;
const usd = (n: number) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;

/** The reading's values for the fields that differ — what "Fix" saves. */
function suggestedFields(r: Row): Record<string, any> {
  const f: Record<string, any> = {};
  if (!r.read) return f;
  if (r.diffs.includes('net')) f.amount = r.read.amount;
  if (r.diffs.includes('vat')) f.vat_amount = r.read.vat_amount;
  if (r.diffs.includes('currency') && r.read.currency) f.currency = r.read.currency;
  if (r.diffs.includes('supplier') && r.read.supplier) f.supplier = r.read.supplier;
  if (r.diffs.includes('invoice_number') && r.read.invoice_id) f.invoice_id = r.read.invoice_id;
  if (r.diffs.includes('date') && r.read.issue_date) f.issue_date = r.read.issue_date;
  return f;
}

export default function InvoiceFullCheck({ onClose, scope, onScopeChange }: {
  onClose: () => void; scope: CheckScope; onScopeChange: (s: CheckScope) => void;
}) {
  const domain = scope === 'all' ? undefined : scope;
  const { addToast } = useToast();
  const [data, setData] = useState<CheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [quickView, setQuickView] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/demo-expenses/full-check', { params: domain ? { domain } : {} });
      setData(res.data);
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to load the check', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, domain]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // While a check runs: refresh often during the text check, every minute while AI reads
  const run = data?.run || null;
  const running = !!run && (run.status === 'text' || run.status === 'ai_text' || run.status === 'ai_pdf');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, run?.status === 'text' ? 2000 : 60000);
    return () => clearInterval(t);
  }, [running, run?.status, load]);

  const startCheck = async () => {
    setBusy('start');
    try { await api.post('/demo-expenses/full-check/run', { domain }); await load(); }
    catch (err: any) { addToast(err?.response?.data?.error || 'Could not start the check', 'error'); }
    finally { setBusy(null); }
  };

  const applyFix = async (r: Row, fields: Record<string, any>, source: 'check' | 'manual') => {
    if (Object.keys(fields).length === 0) { addToast('Nothing to change', 'info'); return false; }
    setBusy(`fix-${r.id}`);
    try {
      const res = await api.post(`/demo-expenses/invoices/${r.id}/apply-check`, { fields, source });
      addToast(res.data.changed?.length ? `Updated: ${res.data.changed.join(', ')}` : 'No changes', 'success');
      await load();
      return true;
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to update', 'error');
      return false;
    } finally { setBusy(null); }
  };

  const accept = async (r: Row) => {
    setBusy(`fix-${r.id}`);
    try {
      await api.post(`/demo-expenses/invoices/${r.id}/accept-check`);
      addToast('Marked correct as stored', 'success');
      await load();
      return true;
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to save', 'error');
      return false;
    } finally { setBusy(null); }
  };

  const rows = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter)!;
    return (data?.report || []).filter(f.test);
  }, [data, filter]);

  const exportExcel = async () => {
    const all = (data?.report || []).filter(r => r.status !== 'ok');
    await downloadExcel(`Supplier invoice check ${new Date().toISOString().substring(0, 10)}`, [
      'Status', 'Differences', 'Warnings', 'Verified by', 'Domain', 'Category',
      'Stored invoice no.', 'Printed invoice no.', 'Stored date', 'Printed date',
      'Stored supplier', 'Printed supplier', 'Supplier VAT no.', 'Country',
      'Stored currency', 'Printed currency',
      'Stored net', 'Printed net', 'Stored VAT', 'Printed VAT', 'Printed VAT rate %', 'Stored total', 'Printed total',
      'Net diff (EUR)', 'VAT diff (EUR)', 'Row id',
    ], all.map(r => [
      r.status === 'differs' ? 'Differs' : STATUS_LABELS[r.status] || r.status,
      r.diffs.join(', '), r.warnings.map(w => WARNING_LABELS[w] || w).join(', '), r.verified_by, r.domain, r.category,
      r.stored.invoice_id, r.read?.invoice_id, r.stored.issue_date, r.read?.issue_date,
      r.stored.supplier, r.read?.supplier_as_printed, r.read?.supplier_vat, r.read?.supplier_country,
      r.stored.currency, r.read?.currency,
      r.stored.amount, r.read?.amount, r.stored.vat_amount, r.read?.vat_amount, r.read?.vat_rate, r.stored.total, r.read?.total,
      r.eur_net_diff, r.eur_vat_diff, r.id,
    ]));
  };

  const s = data?.summary;
  const scopeLabel = (sc: string) => sc === 'demo' ? 'Demo expenses' : sc === 'sales' ? 'Sales activities' : 'all supplier invoices';

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
      <div className="bg-white rounded-xl shadow-2xl max-w-[1400px] w-full mx-4 max-h-[94vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Full check of supplier invoices</h2>
              {!running && <ScopeSwitch value={scope} onChange={onScopeChange} />}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Every invoice is compared with its PDF — free where possible, AI only where needed.
              {data && <> AI this month: <strong>{usd(data.budget.spent_usd)}</strong> of {usd(data.budget.monthly_usd)} (limit in Settings).</>}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        {loading || !data ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={28} /></div>
        ) : (
          <>
            {/* The check: one button, the server does the rest */}
            <div className="px-5 py-4 border-b">
              {running && run ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-primary-600" />
                    Checking {scopeLabel(run.scope)}…
                  </p>
                  {run.status === 'text' ? (
                    <>
                      <p className="text-sm text-gray-600">Comparing the stored figures with the PDFs (free){run.text_progress.total > 0 && ` — ${run.text_progress.done} of ${run.text_progress.total}`}</p>
                      {run.text_progress.total > 0 && (
                        <div className="h-1.5 bg-gray-100 rounded-full max-w-md"><div className="h-1.5 bg-primary-600 rounded-full" style={{ width: `${(run.text_progress.done / run.text_progress.total) * 100}%` }} /></div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-600">
                      AI is reading {run.ai_reading} invoice(s) that could not be confirmed for free
                      {run.status === 'ai_pdf' ? ' (scanned or unclear ones, from the PDF itself)' : ''}.
                      This usually takes under an hour — you can close this window and come back; the results will be here.
                    </p>
                  )}
                  <p className="text-xs text-gray-400">Started by {run.started_by || '—'}, {formatDate(run.started_at.substring(0, 10))}</p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <button onClick={startCheck} disabled={!!busy}
                    className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1.5 font-medium">
                    {busy === 'start' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {run ? 'Check again' : 'Check invoices'} — {scopeLabel(scope)}
                  </button>
                  {run && (
                    <div className="text-sm text-gray-600">
                      <span className={run.status === 'stopped' ? 'text-red-700 font-medium' : ''}>
                        {run.status === 'stopped' ? 'Last check stopped' : 'Last check finished'}
                      </span>
                      {' '}{formatDate((run.finished_at || run.started_at).substring(0, 10))} · {scopeLabel(run.scope)}
                      {run.ai_read > 0 && <> · AI read {run.ai_read} invoice(s) for {usd(run.cost_usd)}</>}
                      {run.message && <p className={`text-xs mt-0.5 ${run.status === 'stopped' ? 'text-red-700' : 'text-amber-700'}`}>{run.message}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!running && (<>
            {/* Summary + filters */}
            <div className="px-5 py-3 border-b space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
                <div><p className="text-xs text-gray-400">Invoices</p><p className="font-semibold tabular-nums">{s!.total}</p></div>
                <div><p className="text-xs text-gray-400">Correct</p><p className="font-semibold text-green-600 tabular-nums">{s!.ok}{s!.accepted > 0 && <span className="text-gray-400 font-normal"> + {s!.accepted} marked</span>}</p></div>
                <div><p className="text-xs text-gray-400">With differences</p><p className="font-semibold text-red-600 tabular-nums">{s!.differing}<span className="text-gray-400 font-normal"> ({s!.amount_diffs} amounts)</span></p></div>
                <div><p className="text-xs text-gray-400">Not checked yet</p><p className="font-semibold tabular-nums">{s!.not_read + s!.waiting + s!.not_checked}<span className="text-gray-400 font-normal">{s!.no_pdf > 0 && ` + ${s!.no_pdf} no PDF`}</span></p></div>
                <div><p className="text-xs text-gray-400">Net difference</p><p className="font-semibold tabular-nums">{eur(s!.eur_net_diff)}</p></div>
                <div><p className="text-xs text-gray-400">VAT difference</p><p className="font-semibold text-amber-600 tabular-nums">{eur(s!.eur_vat_diff)}</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {FILTERS.map(f => {
                  const n = data.report.filter(f.test).length;
                  return (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${filter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {f.label} <span className="opacity-70">{n}</span>
                    </button>
                  );
                })}
                <button onClick={exportExcel}
                  className="ml-auto px-3 py-1 text-xs border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
                  <FileSpreadsheet size={13} /> Download Excel
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {rows.length === 0 ? (
                <p className="py-16 text-center text-sm text-gray-400">Nothing in this view.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500 uppercase z-10">
                    <tr className="border-b">
                      <th className="text-left px-3 py-2 font-medium">Invoice no.</th>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Supplier</th>
                      <th className="text-left px-3 py-2 font-medium">Cur.</th>
                      <th className="text-right px-3 py-2 font-medium">Net</th>
                      <th className="text-right px-3 py-2 font-medium">VAT</th>
                      <th className="text-right px-3 py-2 font-medium">Total</th>
                      <th className="text-left px-3 py-2 font-medium">Notes</th>
                      <th className="text-right px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <Cell r={r} field="invoice_number" stored={r.stored.invoice_id} read={r.read?.invoice_id} className="max-w-[170px] break-all" />
                        <Cell r={r} field="date" stored={formatDate(r.stored.issue_date)} read={r.read?.issue_date ? formatDate(r.read.issue_date) : ''} className="whitespace-nowrap" />
                        <Cell r={r} field="supplier" stored={r.stored.supplier} className="max-w-[200px]"
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
                        <td className="px-3 py-2 align-top text-gray-500 max-w-[210px]">
                          {STATUS_LABELS[r.status] && <div>{STATUS_LABELS[r.status]}</div>}
                          {r.warnings.map(w => <div key={w} className="text-amber-700">{WARNING_LABELS[w] || w}</div>)}
                          {r.verified_by && <div className="text-gray-400">Checked by: {r.verified_by}</div>}
                          {r.status === 'accepted' && <div className="text-green-700">Marked correct{r.accepted_by ? ` by ${r.accepted_by}` : ''}{r.accepted_at ? `, ${formatDate(r.accepted_at.substring(0, 10))}` : ''}</div>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center justify-end gap-1">
                            {r.status === 'differs' && (
                              <button onClick={() => applyFix(r, suggestedFields(r), 'check')} disabled={!!busy}
                                className="px-2 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                                title="Save the values printed on the invoice for the fields that differ">
                                {busy === `fix-${r.id}` ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Fix
                              </button>
                            )}
                            {r.status === 'differs' && (
                              <button onClick={() => accept(r)} disabled={!!busy}
                                className="px-2 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                                title="The stored values are right — stop flagging this invoice (until it is edited)">
                                <Check size={12} /> Correct as stored
                              </button>
                            )}
                            <button onClick={() => setQuickView(r)}
                              className="px-2 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-100 flex items-center gap-1 whitespace-nowrap"
                              title="Open the invoice next to its figures — check and edit by hand">
                              <Eye size={12} /> Quick view
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-2 border-t text-xs text-gray-400">
              Crossed out = stored, red = printed on the invoice (or the VAT-rule suggestion when there is no PDF). Fix saves it; Correct as stored keeps what is there; Quick view shows the invoice to check and edit by hand.
            </div>
            </>)}
          </>
        )}
      </div>

      {quickView && (
        <QuickView
          row={data?.report.find(r => r.id === quickView.id) || quickView}
          busy={busy === `fix-${quickView.id}`}
          onClose={() => setQuickView(null)}
          onSave={async (fields, source) => { if (await applyFix(quickView, fields, source)) setQuickView(null); }}
          onAccept={async () => { if (await accept(quickView)) setQuickView(null); }}
        />
      )}
    </div>
  );
}

// ─── Quick view: the invoice PDF beside stored / printed values, editable ─────

const QV_FIELDS: { key: string; field: Field | null; label: string; type: 'text' | 'number' | 'date'; stored: (r: Row) => any; read: (r: Row) => any }[] = [
  { key: 'invoice_id', field: 'invoice_number', label: 'Invoice no.', type: 'text', stored: r => r.stored.invoice_id, read: r => r.read?.invoice_id },
  { key: 'issue_date', field: 'date', label: 'Date', type: 'date', stored: r => r.stored.issue_date, read: r => r.read?.issue_date },
  { key: 'supplier', field: 'supplier', label: 'Supplier', type: 'text', stored: r => r.stored.supplier, read: r => r.read?.supplier },
  { key: 'currency', field: 'currency', label: 'Currency', type: 'text', stored: r => r.stored.currency, read: r => r.read?.currency },
  { key: 'amount', field: 'net', label: 'Net (excl. VAT)', type: 'number', stored: r => r.stored.amount, read: r => r.read?.amount },
  { key: 'vat_amount', field: 'vat', label: 'VAT', type: 'number', stored: r => r.stored.vat_amount, read: r => r.read?.vat_amount },
];

function QuickView({ row, busy, onClose, onSave, onAccept }: {
  row: Row; busy: boolean; onClose: () => void;
  onSave: (fields: Record<string, any>, source: 'check' | 'manual') => void;
  onAccept: () => void;
}) {
  const [pdf, setPdf] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  // Start from the printed value where it differs, else the stored one
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(QV_FIELDS.map(f => {
    const v = f.field && row.diffs.includes(f.field) && f.read(row) != null ? f.read(row) : f.stored(row);
    return [f.key, v == null ? '' : String(v)];
  })));

  useEffect(() => {
    api.get(`/demo-expenses/invoices/${row.id}`).then(r => setPdf(r.data.embedded_pdf || null)).catch(() => {}).finally(() => setLoadingPdf(false));
  }, [row.id]);

  const changed = () => {
    const out: Record<string, any> = {};
    for (const f of QV_FIELDS) {
      const v = values[f.key].trim();
      const stored = f.stored(row);
      if (f.type === 'number') { if (v !== '' && Math.abs(Number(v) - Number(stored)) > 0.001) out[f.key] = Number(v); }
      else if (v && v !== String(stored ?? '')) out[f.key] = f.key === 'currency' ? v.toUpperCase() : v;
    }
    return out;
  };
  const net = Number(values.amount) || 0, vat = Number(values.vat_amount) || 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] h-[92vh] flex overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex-1 bg-gray-100 min-w-0">
          {loadingPdf ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" /></div>
            : pdf ? <PdfPreview base64={pdf} className="w-full h-full border-0" title="Invoice PDF" />
              : <p className="p-6 text-sm text-gray-500">No PDF stored for this invoice — the suggestion comes from the VAT rules only. Check it against your records.</p>}
        </div>
        <div className="w-[400px] shrink-0 border-l flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate">{row.stored.invoice_id}</h3>
              <p className="text-xs text-gray-500 truncate">{row.stored.supplier}{row.read?.supplier_vat && ` · VAT ${row.read.supplier_vat}`}</p>
            </div>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            {row.warnings.map(w => <p key={w} className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">{WARNING_LABELS[w] || w}</p>)}
            {QV_FIELDS.map(f => {
              const differs = !!f.field && row.diffs.includes(f.field);
              const stored = f.stored(row), read = f.read(row);
              const show = (v: any) => (v == null || v === '' ? '—' : f.type === 'number' ? money(Number(v)) : f.type === 'date' ? formatDate(v) : String(v));
              return (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">{f.label}</label>
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className={differs ? 'text-gray-400 line-through' : 'text-gray-600'}>Stored: {show(stored)}</span>
                    {row.read && <span className={differs ? 'text-red-700 font-medium' : 'text-green-700'}>{row.verified_by?.startsWith('VAT rules') ? 'Suggested' : 'Invoice'}: {show(read)}</span>}
                  </div>
                  <input type={f.type} step={f.type === 'number' ? '0.01' : undefined} value={values[f.key]}
                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    className={`w-full px-2 py-1 border rounded text-sm ${differs ? 'border-red-300 bg-red-50/40' : 'border-gray-300'}`} />
                </div>
              );
            })}
            <div className="flex justify-between text-sm border-t pt-2">
              <span className="text-gray-500">Total (net + VAT)</span>
              <span className="font-semibold tabular-nums">{money(net + vat)}{row.read && <span className="text-xs text-gray-400 font-normal"> · invoice {money(row.read.total)}</span>}</span>
            </div>
          </div>
          <div className="p-4 border-t flex flex-col gap-2">
            {row.status === 'differs' && (
              <button onClick={() => onSave(suggestedFields(row), 'check')} disabled={busy}
                className="w-full px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Fix — use the values on the invoice
              </button>
            )}
            {row.status === 'differs' && (
              <button onClick={onAccept} disabled={busy}
                className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1.5">
                <Check size={14} /> Correct as stored — keep it
              </button>
            )}
            <button onClick={() => onSave(changed(), 'manual')} disabled={busy}
              className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Pencil size={14} /> Save the values above
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
