import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Cpu, Loader2, Upload, Plus, Pencil, Trash2, Eye, Check, X, AlertTriangle, FileText, Receipt,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate, todayISO } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import FilePreviewModal from '../components/ui/FilePreviewModal';
import TechnologyOperationFormModal, { type TechnologyOperation } from '../components/TechnologyOperationFormModal';
import { TO_STATUSES, toStatusOf } from '../lib/toStatus';

/**
 * One technology operation: its expenses (supplier invoices / receipts uploaded
 * here, read automatically, editable) and the TI… invoices generated from them
 * — at cost, plus a service fee line when wanted. An expense on a generated
 * invoice shows which; ticked expenses go on the next invoice.
 */

interface Expense {
  id: number;
  expense_date: string | null;
  supplier_name: string | null;
  reference: string | null;
  description: string | null;
  net_amount: number;
  vat_amount: number | null;
  total_amount: number | null;
  currency: string;
  fx_rate: number | null;
  eur_amount: number | null;
  file_path: string | null;
  file_name: string | null;
  read_by: string | null;
  read_warning: string | null;
  demo_invoice_id: number | null;
  invoice_document_id: number | null;
  invoice_number: string | null;
  invoice_status: 'draft' | 'final' | null;
}

interface TechInvoice {
  id: number;
  invoice_number: string;
  status: 'draft' | 'final';
  has_draft: number;
  doc_date: string | null;
  total: number;
  currency: string;
  recorded_id: number | null;
  recorded_status: string | null;
}

interface Detail extends TechnologyOperation {
  expenses: Expense[];
  invoices: TechInvoice[];
  expenses_eur: number;
  invoiced_eur: number;
}

type ExpenseDraft = {
  expense_date: string; supplier_name: string; reference: string; description: string;
  net_amount: string; vat_amount: string; total_amount: string; currency: string;
};

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const money = (n: number | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cellInput = 'w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500';

const draftOf = (e?: Partial<Expense>): ExpenseDraft => ({
  expense_date: e?.expense_date || todayISO(),
  supplier_name: e?.supplier_name || '',
  reference: e?.reference || '',
  description: e?.description || '',
  net_amount: e?.net_amount != null ? String(e.net_amount) : '',
  vat_amount: e?.vat_amount != null ? String(e.vat_amount) : '',
  total_amount: e?.total_amount != null ? String(e.total_amount) : '',
  currency: e?.currency || 'EUR',
});

export default function TechnologyOperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const preview = useFilePreview();
  const [op, setOp] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Inline edit: an expense id, or 'new' for a manual expense
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(draftOf());
  const [savingExpense, setSavingExpense] = useState(false);
  const [deleteExpense, setDeleteExpense] = useState<Expense | null>(null);

  // Ticked expenses go on the next invoice
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [pdf, setPdf] = useState<{ name: string; url: string | null; invoiceId: number } | null>(null);
  const [deleteInvoice, setDeleteInvoice] = useState<TechInvoice | null>(null);

  const load = async (keepSelection = false) => {
    try {
      const { data } = await api.get(`/technology-operations/${id}`);
      setOp(data);
      if (!keepSelection) {
        setSelected(new Set((data.expenses as Expense[]).filter(e => !e.invoice_document_id).map(e => e.id)));
      }
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to load the operation', 'error');
      navigate('/technology-operations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setLoading(true); load(); }, [id]);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const form = new FormData();
    for (const f of list) form.append('files', f);
    setUploading(list.length);
    try {
      const { data } = await api.post(`/technology-operations/${id}/expenses`, form);
      const added: Expense[] = data.expenses || [];
      const flagged = added.filter(e => e.read_warning).length;
      addToast(`${added.length} expense${added.length === 1 ? '' : 's'} added${flagged ? ` — ${flagged} to check` : ''}`, flagged ? 'info' : 'success');
      await load(true);
      setSelected(prev => new Set([...prev, ...added.map(e => e.id)]));
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(0);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function startEdit(e: Expense | null) {
    setEditingId(e ? e.id : 'new');
    setDraft(draftOf(e ?? undefined));
  }

  async function saveExpense() {
    setSavingExpense(true);
    try {
      const body = {
        ...draft,
        net_amount: draft.net_amount === '' ? 0 : Number(draft.net_amount),
        vat_amount: draft.vat_amount === '' ? null : Number(draft.vat_amount),
        total_amount: draft.total_amount === '' ? null : Number(draft.total_amount),
      };
      if (editingId === 'new') {
        const { data } = await api.post(`/technology-operations/${id}/expenses`, body);
        const added: Expense[] = data.expenses || [];
        await load(true);
        setSelected(prev => new Set([...prev, ...added.map(e => e.id)]));
      } else {
        await api.put(`/technology-operations/${id}/expenses/${editingId}`, body);
        await load(true);
      }
      setEditingId(null);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the expense', 'error');
    } finally {
      setSavingExpense(false);
    }
  }

  async function removeExpense(e: Expense) {
    try {
      await api.delete(`/technology-operations/${id}/expenses/${e.id}`);
      setSelected(prev => { const next = new Set(prev); next.delete(e.id); return next; });
      await load(true);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete the expense', 'error');
    }
  }

  async function setStatus(status: string) {
    try {
      const { data } = await api.put(`/technology-operations/${id}`, { status });
      setOp(prev => (prev ? { ...prev, status: data.status } : prev));
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to change the status', 'error');
    }
  }

  async function handleDelete() {
    try {
      await api.delete(`/technology-operations/${id}`);
      addToast(`${op?.to_number} deleted`, 'success');
      navigate('/technology-operations');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  async function openPdf(inv: TechInvoice) {
    setPdf({ name: `${inv.invoice_number}.pdf`, url: null, invoiceId: inv.id });
    try {
      const res = await api.get(`/invoice-documents/${inv.id}/pdf`, { responseType: 'blob' });
      setPdf({ name: `${inv.invoice_number}.pdf`, url: URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })), invoiceId: inv.id });
    } catch {
      addToast('Failed to load the PDF', 'error');
      setPdf(null);
    }
  }

  function closePdf() {
    if (pdf?.url) URL.revokeObjectURL(pdf.url);
    setPdf(null);
  }

  function downloadPdf() {
    if (!pdf?.url) return;
    const a = document.createElement('a');
    a.href = pdf.url; a.download = pdf.name; a.click();
  }

  async function removeInvoice(inv: TechInvoice) {
    try {
      await api.delete(`/invoice-documents/${inv.id}`);
      addToast(`Invoice ${inv.invoice_number} deleted — its expenses can be invoiced again`, 'success');
      await load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete the invoice', 'error');
    }
  }

  function generateInvoice() {
    const ids = [...selected];
    if (!ids.length) { addToast('Tick the expenses to invoice', 'error'); return; }
    navigate(`/invoices/documents/new?to_id=${id}&expense_ids=${ids.join(',')}`);
  }

  if (loading || !op) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-600" size={24} /></div>;
  }

  const st = toStatusOf(op.status);
  const uninvoiced = op.expenses.filter(e => !e.invoice_document_id);
  const selectable = (e: Expense) => !e.invoice_document_id;
  const allTicked = uninvoiced.length > 0 && uninvoiced.every(e => selected.has(e.id));
  const totalEur = op.expenses.reduce((s, e) => s + (e.eur_amount ?? e.net_amount ?? 0), 0);
  const selectedEur = op.expenses.filter(e => selected.has(e.id)).reduce((s, e) => s + (e.eur_amount ?? e.net_amount ?? 0), 0);
  const dash = <span className="text-gray-300">—</span>;

  const editRow = (
    <>
      <td className="px-2 py-2" />
      <td className="px-2 py-2"><input type="date" value={draft.expense_date} onChange={e => setDraft({ ...draft, expense_date: e.target.value })} className={cellInput} /></td>
      <td className="px-2 py-2"><input value={draft.supplier_name} onChange={e => setDraft({ ...draft, supplier_name: e.target.value })} placeholder="Supplier" className={cellInput} /></td>
      <td className="px-2 py-2"><input value={draft.reference} onChange={e => setDraft({ ...draft, reference: e.target.value })} placeholder="Invoice no." className={cellInput} /></td>
      <td className="px-2 py-2"><input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What it was for" className={cellInput} /></td>
      <td className="px-2 py-2"><input type="number" step="any" value={draft.net_amount} onChange={e => setDraft({ ...draft, net_amount: e.target.value })} className={`${cellInput} text-right`} /></td>
      <td className="px-2 py-2"><input type="number" step="any" value={draft.vat_amount} onChange={e => setDraft({ ...draft, vat_amount: e.target.value })} className={`${cellInput} text-right`} /></td>
      <td className="px-2 py-2"><input type="number" step="any" value={draft.total_amount} onChange={e => setDraft({ ...draft, total_amount: e.target.value })} className={`${cellInput} text-right`} /></td>
      <td className="px-2 py-2">
        <select value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value })} className={cellInput}>
          {[...new Set([...CURRENCIES, draft.currency])].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="px-2 py-2" />
      <td className="px-2 py-2" />
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <button onClick={saveExpense} disabled={savingExpense} className="p-1.5 rounded text-green-600 hover:bg-green-50" title="Save">
          {savingExpense ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button onClick={() => setEditingId(null)} disabled={savingExpense} className="p-1.5 rounded text-gray-400 hover:bg-gray-100" title="Cancel"><X size={14} /></button>
      </td>
    </>
  );

  return (
    <div className="space-y-5">
      <Link to="/technology-operations" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Technology operations
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Cpu size={20} className="text-gray-400" />
            <h1 className="text-2xl font-bold text-gray-900">{op.to_number}</h1>
            <select value={op.status} onChange={e => setStatus(e.target.value)}
              className={`rounded-full border-0 px-2.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 ${st.cls}`}>
              {TO_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {op.title && <p className="text-gray-700">{op.title}</p>}
          <p className="text-sm text-gray-500">
            {op.customer_id ? <Link to={`/customers/${op.customer_id}`} className="text-primary-600 hover:underline">{op.customer_name}</Link> : 'No customer'}
            {op.to_date && <> · {formatDate(op.to_date)}</>}
          </p>
          {op.notes && <p className="text-sm text-gray-500 whitespace-pre-wrap">{op.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right mr-3">
            <p className="text-xs text-gray-500">Expenses</p>
            <p className="font-semibold text-gray-900">€{money(totalEur)}</p>
          </div>
          <div className="text-right mr-3">
            <p className="text-xs text-gray-500">Invoiced</p>
            <p className="font-semibold text-gray-900">€{money(op.invoiced_eur)}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}><Pencil size={14} /> Edit</Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</Button>
        </div>
      </div>

      {/* Expenses */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <Receipt size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-800 text-sm flex-1">Expenses ({op.expenses.length})</h2>
          <Button variant="secondary" size="sm" onClick={() => startEdit(null)} disabled={editingId !== null}><Plus size={14} /> Add manually</Button>
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
          </Button>
          <input ref={fileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
            onChange={e => e.target.files && uploadFiles(e.target.files)} />
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}
          className={`mx-5 mt-4 rounded-lg border-2 border-dashed px-4 py-4 text-center text-sm transition-colors ${
            dragOver ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-400'
          }`}
        >
          {uploading
            ? <span className="inline-flex items-center gap-2 text-gray-600"><Loader2 size={14} className="animate-spin" /> Reading {uploading} file{uploading === 1 ? '' : 's'}…</span>
            : <>Drop supplier invoices / receipts here (PDF or images, several at once) — supplier, date, number and amounts are read automatically. Invoices uploaded in Supplier Invoices → Project Expenses under this project appear here by themselves.</>}
        </div>

        <div className="overflow-x-auto p-5 pt-3">
          {op.expenses.length === 0 && editingId !== 'new' ? (
            <p className="py-8 text-center text-sm text-gray-400">No expenses yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2 w-8">
                    <input type="checkbox" checked={allTicked} disabled={!uninvoiced.length}
                      onChange={e => setSelected(e.target.checked ? new Set(uninvoiced.map(x => x.id)) : new Set())}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" title="Tick all not invoiced" />
                  </th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Supplier</th>
                  <th className="px-2 py-2">Reference</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right">Net</th>
                  <th className="px-2 py-2 text-right">VAT</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2">Cur.</th>
                  <th className="px-2 py-2 text-right">EUR (net)</th>
                  <th className="px-2 py-2">Invoice</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {op.expenses.map(e => (
                  <tr key={e.id} className={editingId === e.id ? 'bg-primary-50/40' : 'hover:bg-gray-50'}>
                    {editingId === e.id ? editRow : (
                      <>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={selected.has(e.id)} disabled={!selectable(e)}
                            onChange={ev => setSelected(prev => { const next = new Set(prev); if (ev.target.checked) next.add(e.id); else next.delete(e.id); return next; })}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-40" />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-gray-700">{formatDate(e.expense_date) || dash}</td>
                        <td className="px-2 py-2 text-gray-900">
                          {e.supplier_name || dash}
                          {e.demo_invoice_id && (
                            <Link to="/supplier-invoices?tab=project" className="ml-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:underline"
                              title="From Supplier Invoices → Project Expenses — edit or delete it there">Project expense</Link>
                          )}
                          {e.read_warning && (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-red-600" title={e.read_warning}>
                              <AlertTriangle size={12} /> check
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-gray-700">{e.reference || dash}</td>
                        <td className="px-2 py-2 text-gray-700 max-w-[14rem] truncate" title={e.description || ''}>{e.description || dash}</td>
                        <td className="px-2 py-2 text-right text-gray-900 whitespace-nowrap">{money(e.net_amount)}</td>
                        <td className="px-2 py-2 text-right text-gray-600 whitespace-nowrap">{e.vat_amount != null ? money(e.vat_amount) : dash}</td>
                        <td className="px-2 py-2 text-right text-gray-600 whitespace-nowrap">{e.total_amount != null ? money(e.total_amount) : dash}</td>
                        <td className="px-2 py-2 text-gray-600">{e.currency}</td>
                        <td className="px-2 py-2 text-right text-gray-900 whitespace-nowrap">
                          {e.eur_amount != null ? money(e.eur_amount) : <span className="text-amber-600" title="No exchange rate">?</span>}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {e.invoice_document_id ? (
                            <Link to={`/invoices/documents/${e.invoice_document_id}`}
                              className={`rounded-full px-2 py-0.5 font-medium hover:underline ${
                                e.invoice_status === 'final' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                              }`}>
                              {e.invoice_number}{e.invoice_status === 'draft' ? ' (draft)' : ''}
                            </Link>
                          ) : <span className="text-gray-400">Not invoiced</span>}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {e.file_path && (
                            <button onClick={() => preview.open({ fileName: e.file_name || 'expense', filePath: e.file_path!, subfolder: 'technology-expenses' })}
                              className="p-1.5 rounded text-gray-400 hover:text-primary-600" title="View file"><Eye size={14} /></button>
                          )}
                          {!e.demo_invoice_id && <>
                          <button onClick={() => startEdit(e)} disabled={editingId !== null} className="p-1.5 rounded text-gray-400 hover:text-primary-600 disabled:opacity-40" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteExpense(e)} disabled={e.invoice_status === 'final'}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 disabled:opacity-40"
                            title={e.invoice_status === 'final' ? `On invoice ${e.invoice_number}` : 'Delete'}><Trash2 size={14} /></button>
                          </>}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {editingId === 'new' && <tr className="bg-primary-50/40">{editRow}</tr>}
              </tbody>
              {op.expenses.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 font-semibold text-gray-900">
                    <td colSpan={9} className="px-2 py-2 text-right">Total (EUR)</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">€{money(totalEur)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            {selected.size
              ? <><strong>{selected.size}</strong> expense{selected.size === 1 ? '' : 's'} ticked · €{money(selectedEur)} at cost</>
              : uninvoiced.length ? 'Tick the expenses to invoice.' : 'Every expense is invoiced.'}
          </p>
          <Button size="sm" onClick={generateInvoice} disabled={!selected.size}>
            <FileText size={14} /> Generate invoice
          </Button>
        </div>
      </div>

      {/* Invoices */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <FileText size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-800 text-sm flex-1">Invoices ({op.invoices.length})</h2>
        </div>
        {op.invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No invoices yet — tick expenses above and Generate invoice.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Invoice #</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {op.invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">
                    <Link to={`/invoices/documents/${inv.id}`} className="text-primary-600 hover:underline">{inv.invoice_number}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{formatDate(inv.doc_date) || dash}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900 whitespace-nowrap">{money(inv.total)} {inv.currency}</td>
                  <td className="px-4 py-2.5">
                    {inv.status === 'draft' ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Draft</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Generated</span>
                        {inv.recorded_id && (
                          <Link to={`/invoices/${inv.recorded_id}`}
                            className={`rounded-full px-2 py-0.5 text-xs font-medium hover:underline ${
                              inv.recorded_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                            {inv.recorded_status === 'paid' ? 'Paid' : inv.recorded_status === 'overdue' ? 'Overdue' : 'Unpaid'}
                          </Link>
                        )}
                        {!!inv.has_draft && <span className="text-xs text-amber-600">edits pending</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {inv.status === 'final' && (
                      <button onClick={() => openPdf(inv)} className="p-1.5 rounded text-gray-400 hover:text-primary-600" title="View PDF"><Eye size={14} /></button>
                    )}
                    <Link to={`/invoices/documents/${inv.id}`} className="inline-block p-1.5 rounded text-gray-400 hover:text-primary-600" title="Edit"><Pencil size={14} /></Link>
                    {inv.status === 'draft' && (
                      <button onClick={() => setDeleteInvoice(inv)} className="p-1.5 rounded text-gray-400 hover:text-red-600" title="Delete draft"><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <TechnologyOperationFormModal
        open={showEdit}
        editing={op}
        onClose={() => setShowEdit(false)}
        onSaved={() => { setShowEdit(false); load(true); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete technology operation"
        message={`Delete ${op.to_number} with its expenses and invoices? The files go to the Archive.`}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        open={deleteExpense !== null}
        onClose={() => setDeleteExpense(null)}
        onConfirm={() => deleteExpense && removeExpense(deleteExpense)}
        title="Delete expense"
        message={`Delete ${deleteExpense?.supplier_name || 'this expense'}${deleteExpense?.reference ? ` ${deleteExpense.reference}` : ''}?${deleteExpense?.file_path ? ' The file goes to the Archive.' : ''}`}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        open={deleteInvoice !== null}
        onClose={() => setDeleteInvoice(null)}
        onConfirm={() => deleteInvoice && removeInvoice(deleteInvoice)}
        title="Delete draft invoice"
        message={`Delete draft ${deleteInvoice?.invoice_number ?? ''}? Its expenses can be invoiced again.`}
        confirmLabel="Delete"
      />

      {pdf && (
        <FilePreviewModal fileName={pdf.name} url={pdf.url} loading={!pdf.url} onClose={closePdf} onDownload={downloadPdf} />
      )}
      {preview.modal}
    </div>
  );
}
