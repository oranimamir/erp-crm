import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Loader2, FileSpreadsheet, RefreshCw, Pencil, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { downloadExcel } from '../lib/exportExcel';
import { useToast } from '../contexts/ToastContext';
import PdfPreview from './ui/PdfPreview';

/**
 * Full check of every supplier invoice:
 *   1. the PDF text is extracted (free)
 *   2. AI reads each PDF once (Sonnet, batch — half price); readings are kept, so a re-check only reads new invoices
 * Review in one window: the list on the left, the selected invoice's PDF on the
 * right beside stored vs. suggested values — Change invoice (the suggestion or
 * own values) or Keep original.
 */

type Field = 'net' | 'vat' | 'currency' | 'supplier' | 'invoice_number' | 'date';

export type CheckScope = 'all' | 'demo' | 'sales' | 'project';

const SCOPES: { key: CheckScope; label: string }[] = [
  { key: 'all', label: 'All suppliers' },
  { key: 'demo', label: 'Demo expenses' },
  { key: 'sales', label: 'Sales activities' },
  { key: 'project', label: 'Project expenses' },
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
  status: 'ok' | 'differs' | 'unclear' | 'accepted' | 'no_pdf' | 'not_read' | 'waiting' | 'not_checked';
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
    unclear: number; waiting: number; not_read: number; not_checked: number; no_pdf: number; eur_net_diff: number; eur_vat_diff: number;
  };
  report: Row[];
}

type FilterKey = 'all' | 'amounts' | 'currency' | 'supplier' | 'number_date' | 'unclear' | 'rules' | 'accepted' | 'open';

const toReview = (r: Row) => r.status === 'differs' || r.status === 'unclear';

const FILTERS: { key: FilterKey; label: string; test: (r: Row) => boolean }[] = [
  { key: 'all', label: 'To review', test: toReview },
  { key: 'amounts', label: 'Net & VAT', test: r => toReview(r) && (r.diffs.includes('net') || r.diffs.includes('vat')) },
  { key: 'currency', label: 'Currency', test: r => toReview(r) && r.diffs.includes('currency') },
  { key: 'supplier', label: 'Supplier', test: r => toReview(r) && r.diffs.includes('supplier') },
  { key: 'number_date', label: 'Number & date', test: r => toReview(r) && (r.diffs.includes('invoice_number') || r.diffs.includes('date')) },
  { key: 'unclear', label: 'Unclear reading', test: r => r.status === 'unclear' },
  { key: 'rules', label: 'No PDF (VAT rules)', test: r => r.status === 'differs' && r.warnings.some(w => w.startsWith('rule_')) },
  { key: 'accepted', label: 'Kept original', test: r => r.status === 'accepted' },
  { key: 'open', label: 'Not checked yet', test: r => ['not_read', 'waiting', 'not_checked', 'no_pdf'].includes(r.status) },
];

const WARNING_LABELS: Record<string, string> = {
  totals_mismatch: 'Net + VAT ≠ total on the AI reading',
  vat_rate_unusual: 'Unusual VAT rate',
  foreign_vat: 'Foreign supplier charges VAT',
  not_an_invoice: 'Not an invoice (statement / tax filing?)',
  no_amounts: 'No amounts found on the invoice',
  currency_china_usd: 'Chinese supplier: invoices are in USD',
  currency_from_text: 'The invoice shows USD / GBP, not EUR',
  currency_china_eur: 'Chinese supplier read as EUR: check the currency',
  rule_foreign_vat: 'No PDF · foreign supplier charging VAT (reverse charge expected)',
  rule_vat_too_high: 'No PDF · VAT above 30% of net',
  rule_may_include_vat: 'No PDF · Belgian supplier without VAT — amount may include 21%',
};

const STATUS_LABELS: Record<string, string> = {
  no_pdf: 'No PDF stored', not_read: 'Not confirmed for free and not read by AI yet (spending limit or AI unavailable)', waiting: 'AI reading in progress',
  not_checked: 'Not checked yet — run the check',
  unclear: "AI couldn't read this invoice reliably — compare with the PDF and decide",
};

const FIELD_LABELS: Record<Field, string> = {
  net: 'Net', vat: 'VAT', currency: 'Currency', supplier: 'Supplier', invoice_number: 'Number', date: 'Date',
};

const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (n: number) => `€${money(n)}`;
const usd = (n: number) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;

/** The reading's values for the fields that differ — what accepting the suggestion saves. */
function suggestedFields(r: Row): Record<string, any> {
  const f: Record<string, any> = {};
  if (!r.read || r.status === 'unclear') return f;
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
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  const rows = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter)!;
    return (data?.report || []).filter(f.test);
  }, [data, filter]);

  // Keep a row selected: the first one, or (after it left the list) the one now in its place
  const [lastIndex, setLastIndex] = useState(0);
  const selected = rows.find(r => r.id === selectedId) || null;
  useEffect(() => {
    if (selected || rows.length === 0) return;
    const next = rows[Math.min(lastIndex, rows.length - 1)];
    setSelectedId(next.id);
  }, [rows, selected, lastIndex]);
  const select = (r: Row) => { setSelectedId(r.id); setLastIndex(rows.indexOf(r)); };
  const step = (d: number) => {
    const i = selected ? rows.indexOf(selected) : -1;
    const n = rows[i + d];
    if (n) select(n);
  };

  const startCheck = async () => {
    setBusy('start');
    try { await api.post('/demo-expenses/full-check/run', { domain }); await load(); }
    catch (err: any) { addToast(err?.response?.data?.error || 'Could not start the check', 'error'); }
    finally { setBusy(null); }
  };

  /** After an action the row leaves the list (or stays, e.g. in "Kept original") — move on to the next one. */
  const moveOn = (r: Row) => {
    const i = rows.indexOf(r);
    const next = rows[i + 1];
    setLastIndex(Math.max(0, i));
    setSelectedId(next ? next.id : null);
  };

  const changeInvoice = async (r: Row, fields: Record<string, any>, source: 'check' | 'manual') => {
    if (Object.keys(fields).length === 0) { addToast('Nothing to change', 'info'); return false; }
    setBusy(`fix-${r.id}`);
    try {
      const res = await api.post(`/demo-expenses/invoices/${r.id}/apply-check`, { fields, source });
      addToast(res.data.changed?.length ? `Updated: ${res.data.changed.join(', ')}` : 'No changes', 'success');
      moveOn(r);
      await load();
      return true;
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to update', 'error');
      return false;
    } finally { setBusy(null); }
  };

  const keepOriginal = async (r: Row) => {
    setBusy(`fix-${r.id}`);
    try {
      await api.post(`/demo-expenses/invoices/${r.id}/accept-check`);
      addToast('Kept the original', 'success');
      moveOn(r);
      await load();
      return true;
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to save', 'error');
      return false;
    } finally { setBusy(null); }
  };

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
  const scopeLabel = (sc: string) => sc === 'demo' ? 'Demo expenses' : sc === 'sales' ? 'Sales activities' : sc === 'project' ? 'Project expenses' : 'all supplier invoices';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[98vw] h-[96vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Check supplier invoices</h2>
              {!running && <ScopeSwitch value={scope} onChange={onScopeChange} />}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Every invoice is compared with its PDF as read by AI — each PDF is read once, a re-check only reads new or changed ones.
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
            <div className="px-5 py-3 border-b">
              {running && run ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-primary-600" />
                    Checking {scopeLabel(run.scope)}…
                  </p>
                  {run.status === 'text' ? (
                    <>
                      <p className="text-sm text-gray-600">Preparing the PDFs (free){run.text_progress.total > 0 && ` — ${run.text_progress.done} of ${run.text_progress.total}`}</p>
                      {run.text_progress.total > 0 && (
                        <div className="h-1.5 bg-gray-100 rounded-full max-w-md"><div className="h-1.5 bg-primary-600 rounded-full" style={{ width: `${(run.text_progress.done / run.text_progress.total) * 100}%` }} /></div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-600">
                      AI is reading {run.ai_reading} invoice PDF(s) not read before (about $0.007 each).
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
                  <div className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    <span className="text-gray-500">Invoices <strong className="text-gray-900 tabular-nums">{s!.total}</strong></span>
                    <span className="text-gray-500">Correct <strong className="text-green-600 tabular-nums">{s!.ok}</strong>{s!.accepted > 0 && <span className="text-gray-400"> + {s!.accepted} kept</span>}</span>
                    <span className="text-gray-500">To review <strong className="text-red-600 tabular-nums">{s!.differing + s!.unclear}</strong></span>
                    <span className="text-gray-500">Not checked <strong className="text-gray-900 tabular-nums">{s!.not_read + s!.waiting + s!.not_checked}</strong></span>
                    <span className="text-gray-500">Net diff <strong className="tabular-nums">{eur(s!.eur_net_diff)}</strong></span>
                    <span className="text-gray-500">VAT diff <strong className="text-amber-600 tabular-nums">{eur(s!.eur_vat_diff)}</strong></span>
                  </div>
                </div>
              )}
            </div>

            {!running && (
              <div className="flex-1 flex min-h-0">
                {/* Left: the list */}
                <div className="w-[400px] shrink-0 border-r flex flex-col min-h-0">
                  <div className="px-3 py-2 border-b flex flex-wrap items-center gap-1">
                    {FILTERS.map(f => {
                      const n = data.report.filter(f.test).length;
                      if (n === 0 && f.key !== 'all' && f.key !== filter) return null;
                      return (
                        <button key={f.key} onClick={() => { setFilter(f.key); setSelectedId(null); setLastIndex(0); }}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${filter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                          {f.label} <span className="opacity-70">{n}</span>
                        </button>
                      );
                    })}
                    <button onClick={exportExcel} title="Download Excel"
                      className="ml-auto p-1 text-gray-500 hover:text-gray-800 rounded hover:bg-gray-100"><FileSpreadsheet size={15} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {rows.length === 0 ? (
                      <p className="py-16 text-center text-sm text-gray-400">Nothing in this view.</p>
                    ) : rows.map(r => (
                      <button key={r.id} onClick={() => select(r)}
                        className={`w-full text-left px-3 py-2 border-b border-gray-100 text-xs ${selected?.id === r.id ? 'bg-primary-50 border-l-4 border-l-primary-600' : 'hover:bg-gray-50'}`}>
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-gray-900 truncate">{r.stored.supplier}</span>
                          <span className="text-gray-500 whitespace-nowrap">{formatDate(r.stored.issue_date)}</span>
                        </div>
                        <div className="flex justify-between gap-2 text-gray-500">
                          <span className="truncate">{r.stored.invoice_id}</span>
                          <span className="tabular-nums whitespace-nowrap">{r.stored.currency} {money(r.stored.total)}</span>
                        </div>
                        {r.status === 'unclear' ? (
                          <div className="text-amber-700 mt-0.5">Unclear reading · {r.diffs.map(d => FIELD_LABELS[d]).join(', ')}</div>
                        ) : r.diffs.length > 0 ? (
                          <div className="text-red-700 mt-0.5">{r.diffs.map(d => FIELD_LABELS[d]).join(', ')}</div>
                        ) : STATUS_LABELS[r.status] ? (
                          <div className="text-gray-400 mt-0.5 truncate">{STATUS_LABELS[r.status]}</div>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: the invoice beside its figures */}
                <div className="flex-1 min-w-0">
                  {selected ? (
                    <Review key={selected.id} row={selected} busy={busy === `fix-${selected.id}`}
                      position={`${rows.indexOf(selected) + 1} of ${rows.length}`}
                      onPrev={() => step(-1)} onNext={() => step(1)}
                      onChange={(fields, source) => changeInvoice(selected, fields, source)}
                      onKeep={() => keepOriginal(selected)} />
                  ) : (
                    <p className="py-20 text-center text-sm text-gray-400">Pick an invoice on the left.</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Review: the invoice PDF beside stored / suggested values ─────────────────

const FIELDS: { key: string; field: Field; label: string; type: 'text' | 'number' | 'date'; stored: (r: Row) => any; read: (r: Row) => any }[] = [
  { key: 'invoice_id', field: 'invoice_number', label: 'Invoice no.', type: 'text', stored: r => r.stored.invoice_id, read: r => r.read?.invoice_id },
  { key: 'issue_date', field: 'date', label: 'Date', type: 'date', stored: r => r.stored.issue_date, read: r => r.read?.issue_date },
  { key: 'supplier', field: 'supplier', label: 'Supplier', type: 'text', stored: r => r.stored.supplier, read: r => r.read?.supplier },
  { key: 'currency', field: 'currency', label: 'Currency', type: 'text', stored: r => r.stored.currency, read: r => r.read?.currency },
  { key: 'amount', field: 'net', label: 'Net (excl. VAT)', type: 'number', stored: r => r.stored.amount, read: r => r.read?.amount },
  { key: 'vat_amount', field: 'vat', label: 'VAT', type: 'number', stored: r => r.stored.vat_amount, read: r => r.read?.vat_amount },
];

function Review({ row, busy, position, onPrev, onNext, onChange, onKeep }: {
  row: Row; busy: boolean; position: string; onPrev: () => void; onNext: () => void;
  onChange: (fields: Record<string, any>, source: 'check' | 'manual') => void;
  onKeep: () => void;
}) {
  const [pdf, setPdf] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [editing, setEditing] = useState(false);
  const suggestion = suggestedFields(row);
  // Start from the suggestion where there is one, else the stored value
  const initial = () => Object.fromEntries(FIELDS.map(f => {
    const v = f.key in suggestion ? suggestion[f.key] : f.stored(row);
    return [f.key, v == null ? '' : String(v)];
  }));
  const [values, setValues] = useState<Record<string, string>>(initial);

  useEffect(() => {
    setLoadingPdf(true);
    api.get(`/demo-expenses/invoices/${row.id}`).then(r => setPdf(r.data.embedded_pdf || null)).catch(() => setPdf(null)).finally(() => setLoadingPdf(false));
  }, [row.id]);

  /** Fields whose value differs from what is stored. */
  const changed = () => {
    const out: Record<string, any> = {};
    for (const f of FIELDS) {
      const v = values[f.key].trim();
      const stored = f.stored(row);
      if (f.type === 'number') { if (v !== '' && Math.abs(Number(v) - Number(stored)) > 0.001) out[f.key] = Number(v); }
      else if (v && v !== String(stored ?? '')) out[f.key] = f.key === 'currency' ? v.toUpperCase() : v;
    }
    return out;
  };
  const save = () => {
    const out = changed();
    const same = Object.keys(out).length === Object.keys(suggestion).length
      && Object.entries(suggestion).every(([k, v]) => String(out[k]) === String(v));
    onChange(out, same ? 'check' : 'manual');
  };
  const show = (f: typeof FIELDS[number], v: any) => (v == null || v === '' ? '—' : f.type === 'number' ? money(Number(v)) : f.type === 'date' ? formatDate(v) : String(v));
  const net = Number(values.amount) || 0, vat = Number(values.vat_amount) || 0;
  const reviewable = row.status === 'differs' || row.status === 'unclear';
  const ruleOnly = row.verified_by?.startsWith('VAT rules');

  return (
    <div className="h-full flex">
      <div className="flex-1 bg-gray-100 min-w-0">
        {loadingPdf ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" /></div>
          : pdf ? <PdfPreview base64={pdf} className="w-full h-full border-0" title="Invoice PDF" />
            : <p className="p-6 text-sm text-gray-500">No PDF stored for this invoice{ruleOnly ? ' — the suggestion comes from the VAT rules only. Check it against your records.' : '.'}</p>}
      </div>
      <div className="w-[380px] shrink-0 border-l flex flex-col">
        <div className="px-4 py-2.5 border-b">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{row.stored.supplier}</h3>
            <div className="flex items-center gap-0.5 text-xs text-gray-500 whitespace-nowrap">
              <button onClick={onPrev} className="p-1 hover:bg-gray-100 rounded"><ChevronLeft size={15} /></button>
              {position}
              <button onClick={onNext} className="p-1 hover:bg-gray-100 rounded"><ChevronRight size={15} /></button>
            </div>
          </div>
          <p className="text-xs text-gray-500 truncate">
            {row.stored.invoice_id}{row.read?.supplier_vat && ` · VAT ${row.read.supplier_vat}`}{row.verified_by && ` · checked by ${row.verified_by}`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          {STATUS_LABELS[row.status] && <p className={`text-xs rounded px-2 py-1 ${row.status === 'unclear' ? 'text-amber-800 bg-amber-50' : 'text-gray-600 bg-gray-50'}`}>{STATUS_LABELS[row.status]}</p>}
          {row.status === 'accepted' && <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">Original kept{row.accepted_by ? ` by ${row.accepted_by}` : ''}{row.accepted_at ? `, ${formatDate(row.accepted_at.substring(0, 10))}` : ''}</p>}
          {row.warnings.map(w => <p key={w} className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">{WARNING_LABELS[w] || w}</p>)}

          {!editing ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="font-medium pb-1"></th>
                  <th className="font-medium pb-1">Stored</th>
                  <th className="font-medium pb-1">{ruleOnly ? 'Suggested' : 'AI reading'}</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(f => {
                  const differs = row.diffs.includes(f.field);
                  return (
                    <tr key={f.key} className={`border-t border-gray-100 ${differs ? 'bg-red-50/60' : ''}`}>
                      <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">{f.label}</td>
                      <td className={`py-1.5 pr-2 break-all ${differs ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{show(f, f.stored(row))}</td>
                      <td className={`py-1.5 break-all ${differs ? 'text-red-700 font-semibold' : 'text-gray-400'}`}>{row.read ? show(f, f.read(row)) : ''}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-gray-200">
                  <td className="py-1.5 pr-2 text-gray-500">Total</td>
                  <td className="py-1.5 pr-2 tabular-nums">{money(row.stored.total)}</td>
                  <td className={`py-1.5 tabular-nums ${row.read && Math.abs(row.read.total - row.stored.total) > 0.02 ? 'text-red-700 font-semibold' : 'text-gray-400'}`}>{row.read ? money(row.read.total) : ''}{row.read?.vat_rate != null && <span className="text-gray-400 font-normal"> ({row.read.vat_rate}%)</span>}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-gray-500">{Object.keys(suggestion).length ? 'Filled in with the AI suggestion — adjust anything, then save.' : 'Type the right values, then save.'}</p>
              {FIELDS.map(f => {
                const differs = row.diffs.includes(f.field);
                return (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">
                      {f.label} <span className="font-normal text-gray-400">· stored {show(f, f.stored(row))}</span>
                    </label>
                    <input type={f.type} step={f.type === 'number' ? '0.01' : undefined} value={values[f.key]}
                      onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      className={`w-full px-2 py-1 border rounded text-sm ${differs ? 'border-red-300 bg-red-50/40' : 'border-gray-300'}`} />
                  </div>
                );
              })}
              <div className="flex justify-between text-sm border-t pt-2">
                <span className="text-gray-500">Total (net + VAT)</span>
                <span className="font-semibold tabular-nums">{money(net + vat)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex flex-col gap-2">
          {!editing ? (
            <>
              <button onClick={() => { setValues(initial()); setEditing(true); }} disabled={busy}
                className="w-full px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-1.5 font-medium">
                <Pencil size={14} /> Change invoice
              </button>
              {reviewable && (
                <button onClick={onKeep} disabled={busy}
                  className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1.5 font-medium">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Keep original
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={save} disabled={busy}
                className="w-full px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-1.5 font-medium">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save change
              </button>
              <button onClick={() => setEditing(false)} disabled={busy}
                className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
