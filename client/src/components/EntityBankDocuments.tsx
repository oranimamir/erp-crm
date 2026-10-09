import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Loader2, Eye, Download, Trash2, RefreshCw, AlertTriangle, Landmark, Check } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useFilePreview } from '../lib/useFilePreview';
import Button from './ui/Button';
import Modal from './ui/Modal';

/**
 * TripleW Details → Account ownership documents: per entity, the bank letters
 * proving the accounts are TripleW's. Each upload is read by Claude (bank,
 * holder, IBAN / BIC per currency); "Apply to bank" writes the reading into
 * one of the entity's banks (USD account → USD fields, any other → EUR), so the
 * Company Details PDF and the documents print it.
 */

interface Bank { bank_name: string; bank_address: string; usd_account: string; usd_bic: string; eur_account: string; eur_bic: string }
export interface BankEntity { code: string; company_name: string; banks: Bank[]; default_bank: number }

interface Reading {
  bank_name: string | null; bank_address: string | null; account_holder: string | null;
  accounts: Array<{ currency: string | null; iban: string | null; bic: string | null }>;
}
interface EntityDoc {
  id: number; entity_code: string; title: string | null; file_path: string; file_name: string;
  extracted: Reading | null; read_error: string | null; created_at: string;
}

const EMPTY_BANK: Bank = { bank_name: '', bank_address: '', usd_account: '', usd_bic: '', eur_account: '', eur_bic: '' };
const LABELS: Record<keyof Bank, string> = {
  bank_name: 'Bank name', bank_address: 'Bank address', usd_account: 'USD account (IBAN)', usd_bic: 'USD BIC / SWIFT',
  eur_account: 'EUR account (IBAN)', eur_bic: 'EUR BIC / SWIFT',
};

/** The bank as it would be after applying the reading. */
function applied(bank: Bank, r: Reading): Bank {
  const next = { ...bank };
  if (r.bank_name) next.bank_name = r.bank_name;
  if (r.bank_address) next.bank_address = r.bank_address;
  for (const a of r.accounts) {
    const usd = (a.currency || '').toUpperCase() === 'USD';
    if (a.iban) next[usd ? 'usd_account' : 'eur_account'] = a.iban;
    if (a.bic) next[usd ? 'usd_bic' : 'eur_bic'] = a.bic;
  }
  return next;
}

const words = (s: string) => s.toLowerCase().replace(/\b(bv|b\.v\.|nv|sa|srl|ltd)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function EntitySection({ entity, canEdit, onApplied }: { entity: BankEntity; canEdit: boolean; onApplied: (raw: any) => void }) {
  const { addToast } = useToast();
  const preview = useFilePreview();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<EntityDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [applyDoc, setApplyDoc] = useState<EntityDoc | null>(null);
  const [target, setTarget] = useState<string>('new');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/company-entities/${entity.code}/documents`)
      .then(({ data }) => setDocs(data || []))
      .catch(() => addToast('Failed to load the account ownership documents', 'error'))
      .finally(() => setLoading(false));
  }, [entity.code]);

  async function upload(list: File[]) {
    if (!list.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      list.forEach(f => form.append('files', f));
      const { data } = await api.post(`/company-entities/${entity.code}/documents`, form);
      setDocs(data || []);
      const failed = (data || []).slice(0, list.length).filter((d: EntityDoc) => d.read_error).length;
      addToast(failed
        ? `${list.length} uploaded — ${failed} could not be read (see below)`
        : `${list.length} document${list.length === 1 ? '' : 's'} uploaded and read`, failed ? 'error' : 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function reread(d: EntityDoc) {
    setBusyId(d.id);
    try {
      const { data } = await api.post(`/company-entities/${entity.code}/documents/${d.id}/read`);
      setDocs(prev => prev.map(x => (x.id === d.id ? data : x)));
      addToast(data.read_error ? data.read_error : 'Read again', data.read_error ? 'error' : 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to read the document', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(d: EntityDoc) {
    if (!confirm(`Delete "${d.file_name}"?`)) return;
    try {
      await api.delete(`/company-entities/${entity.code}/documents/${d.id}`);
      setDocs(prev => prev.filter(x => x.id !== d.id));
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  function openApply(d: EntityDoc) {
    // Suggest the bank with the same name, else a new one
    const name = words(d.extracted?.bank_name || '');
    const same = name ? entity.banks.findIndex(b => b.bank_name && (words(b.bank_name).includes(name) || name.includes(words(b.bank_name)))) : -1;
    setTarget(same >= 0 ? String(same) : 'new');
    setApplyDoc(d);
  }

  async function apply() {
    if (!applyDoc?.extracted) return;
    setSaving(true);
    try {
      const banks = entity.banks.map(b => ({ ...b }));
      if (target === 'new') banks.push(applied({ ...EMPTY_BANK }, applyDoc.extracted));
      else banks[Number(target)] = applied(banks[Number(target)], applyDoc.extracted);
      const { data } = await api.put(`/company-entities/${entity.code}`, { banks, default_bank: entity.default_bank });
      onApplied(data);
      addToast(target === 'new' ? 'Bank added from the document' : 'Bank details updated from the document', 'success');
      setApplyDoc(null);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save the bank', 'error');
    } finally {
      setSaving(false);
    }
  }

  const before = applyDoc ? (target === 'new' ? EMPTY_BANK : entity.banks[Number(target)] || EMPTY_BANK) : EMPTY_BANK;
  const after = applyDoc?.extracted ? applied(before, applyDoc.extracted) : before;
  const holder = applyDoc?.extracted?.account_holder;
  const holderMismatch = !!holder && !!entity.company_name
    && !words(holder).includes(words(entity.company_name)) && !words(entity.company_name).includes(words(holder));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {preview.modal}
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <Landmark size={16} className="text-gray-500" />
        <h2 className="font-semibold text-gray-800 text-sm sm:text-base">{entity.company_name || entity.code}</h2>
        <span className="text-xs text-gray-400">({entity.code})</span>
      </div>

      {canEdit && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files || [])); }}
          onClick={() => !uploading && fileRef.current?.click()}
          className={`m-4 rounded-lg border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-colors ${dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-300'}`}>
          <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
            onChange={e => { upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
          {uploading ? (
            <span className="inline-flex items-center gap-2 text-sm text-gray-600"><Loader2 size={16} className="animate-spin" /> Uploading and reading the bank details…</span>
          ) : (
            <span className="inline-flex flex-col items-center gap-1 text-sm text-gray-600">
              <Upload size={18} className="text-gray-400" />
              Drop bank documents here (account confirmation, bank letter, RIB…) or click to choose
              <span className="text-xs text-gray-400">PDF or images · the bank details are read off them so you can apply them to a bank</span>
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary-600" size={20} /></div>
      ) : docs.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-gray-400">No account ownership documents yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {docs.map(d => {
            const file = { fileName: d.file_name, filePath: d.file_path, subfolder: 'entity-docs', label: d.title || d.file_name };
            const r = d.extracted;
            return (
              <li key={d.id} className="px-5 py-3 space-y-2">
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-gray-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{d.file_name}</p>
                    <p className="text-xs text-gray-400">{formatDate(d.created_at)}</p>
                  </div>
                  <button onClick={() => preview.open(file)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Preview"><Eye size={15} /></button>
                  <button onClick={() => preview.download(file)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Download"><Download size={15} /></button>
                  {canEdit && (
                    <>
                      <button onClick={() => reread(d)} disabled={busyId === d.id} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-100" title="Read the bank details again">
                        {busyId === d.id ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                      </button>
                      <button onClick={() => remove(d)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete"><Trash2 size={15} /></button>
                    </>
                  )}
                </div>
                {r ? (
                  <div className="ml-7 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-700 flex flex-wrap items-start gap-x-6 gap-y-1">
                    <div>
                      <p><span className="text-gray-400">Bank:</span> {r.bank_name || '—'}</p>
                      {r.bank_address && <p className="whitespace-pre-line"><span className="text-gray-400">Address:</span> {r.bank_address}</p>}
                      <p><span className="text-gray-400">Holder:</span> {r.account_holder || '—'}</p>
                    </div>
                    <div className="space-y-0.5">
                      {r.accounts.length ? r.accounts.map((a, i) => (
                        <p key={i} className="font-mono">{a.currency || '???'} · {a.iban || '—'}{a.bic ? ` · ${a.bic}` : ''}</p>
                      )) : <p className="text-gray-400">No account number found</p>}
                    </div>
                    {canEdit && (
                      <Button size="sm" className="ml-auto" onClick={() => openApply(d)}><Landmark size={13} /> Apply to bank</Button>
                    )}
                  </div>
                ) : d.read_error ? (
                  <p className="ml-7 flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle size={12} /> Not read: {d.read_error}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {applyDoc && (
        <Modal open onClose={() => setApplyDoc(null)} title="Apply the bank details" size="lg">
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="block text-xs font-medium text-gray-500 mb-1">Into</span>
              <select value={target} onChange={e => setTarget(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {entity.banks.map((b, i) => (
                  <option key={i} value={String(i)}>{b.bank_name || `Bank ${i + 1}`}{i === entity.default_bank ? ' (default)' : ''}</option>
                ))}
                <option value="new">A new bank</option>
              </select>
            </label>
            {holderMismatch && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle size={13} /> The holder on the document is "{holder}", not {entity.company_name}. Check it is the right entity.
              </p>
            )}
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500"><th className="text-left py-1">Field</th><th className="text-left py-1">Now</th><th className="text-left py-1">After</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {(Object.keys(LABELS) as (keyof Bank)[]).map(k => {
                  const changed = (before[k] || '') !== (after[k] || '');
                  return (
                    <tr key={k}>
                      <td className="py-1.5 pr-3 text-xs text-gray-500 whitespace-nowrap">{LABELS[k]}</td>
                      <td className="py-1.5 pr-3 text-xs text-gray-500 whitespace-pre-line">{before[k] || '—'}</td>
                      <td className={`py-1.5 text-xs whitespace-pre-line ${changed ? 'font-semibold text-green-700' : 'text-gray-700'}`}>
                        {after[k] || '—'} {changed && <Check size={11} className="inline" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setApplyDoc(null)}>Cancel</Button>
              <Button onClick={apply} disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Apply</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function EntityBankDocuments({ entities, canEdit, onApplied }: {
  entities: BankEntity[]; canEdit: boolean; onApplied: (raw: any) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs sm:text-sm text-gray-500">
        Upload the bank's proof of account ownership for each entity. The bank, account holder and accounts are read off
        the document; "Apply to bank" fills them into that entity's bank on the Details tab, which the Company Details PDF and the documents print.
      </p>
      {entities.map(e => <EntitySection key={e.code} entity={e} canEdit={canEdit} onApplied={onApplied} />)}
    </div>
  );
}
