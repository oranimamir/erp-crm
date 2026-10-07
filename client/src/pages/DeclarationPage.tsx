import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Eye, Save, CheckCircle, FileDown, Loader2, RefreshCw, Upload, Search, Sparkles, FileText,
  Heading1, AlignLeft, Table2, PenLine, Plus, Trash2, ArrowUp, ArrowDown, UserRound, FilePlus2, X,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/ui/Button';

/**
 * Declaration generator. /declarations/new?operation_id= — pick the starting
 * document (a library declaration — those for the operation's products first —
 * one generated on another operation, an upload, or blank). /declarations/:id —
 * edit it with a live preview; Save draft keeps the form, Confirm & generate
 * files the PDF under the operation (category Declaration).
 */

type Block = { type: 'paragraph'; text: string } | { type: 'table'; rows: string[][]; header: boolean };
interface DeclarationData {
  title: string; department: string; heading: string;
  addressee: { name: string; address: string } | null;
  blocks: Block[];
  place: string; date: string; signatory: string; role: string; signature_file: string | null;
}
interface Declaration {
  id: number; operation_id: number; title: string; status: 'draft' | 'final';
  data: DeclarationData; draft: DeclarationData | null; file_path: string | null; file_name: string | null;
  operation: { id: number; operation_number: string; customer_name: string | null; customer_address: string | null } | null;
}

const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'block text-xs font-medium text-gray-600 mb-1';
const isoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function Section({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function DeclarationPage() {
  const { id } = useParams();
  return id && id !== 'new' ? <DeclarationEditor id={Number(id)} /> : <StartDeclaration />;
}

// ── Step 1: where to start from ───────────────────────────────────────────

function StartDeclaration() {
  const [params] = useSearchParams();
  const operationId = Number(params.get('operation_id'));
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [library, setLibrary] = useState<any[]>([]);
  const [previous, setPrevious] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!operationId) return;
    api.get('/declarations/sources', { params: { operation_id: operationId } })
      .then(({ data }) => { setLibrary(data.library || []); setPrevious(data.previous || []); })
      .catch(() => addToast('Failed to load the declarations', 'error'))
      .finally(() => setLoading(false));
  }, [operationId]);

  async function start(body: FormData | Record<string, unknown>) {
    setBusy(true);
    try {
      const { data } = await api.post('/declarations', body);
      navigate(`/declarations/${data.id}`, { replace: true });
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Could not start the declaration', 'error');
      setBusy(false);
    }
  }
  const upload = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('operation_id', String(operationId));
    fd.append('file', file);
    start(fd);
  };

  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const suggested = library.filter(d => d.suggested && match(`${d.title} ${d.file_name}`));
  const others = library.filter(d => !d.suggested && match(`${d.title} ${d.file_name} ${d.products.map((p: any) => p.name).join(' ')}`));
  const prev = previous.filter(d => match(`${d.title} ${d.operation_number} ${d.customer_name || ''}`));

  if (!operationId) return <p className="text-sm text-gray-500">Open the generator from an operation's Shipping documents.</p>;

  const card = (key: string, title: string, sub: string, onClick: () => void, tag?: React.ReactNode) => (
    <button key={key} type="button" onClick={onClick} disabled={busy}
      className="flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left hover:border-primary-300 hover:bg-primary-50/40 disabled:opacity-60">
      <FileText size={16} className="mt-0.5 flex-shrink-0 text-gray-400" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-800">{title}</span>
        <span className="block truncate text-xs text-gray-400">{sub}</span>
      </span>
      {tag}
    </button>
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <Link to={`/operations/${operationId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Back to operation
      </Link>
      <div>
        <h1 className="text-xl font-bold text-gray-900">New declaration</h1>
        <p className="text-sm text-gray-500">Start from a declaration in the system or upload one — you can change everything before generating the PDF.</p>
      </div>

      <label
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files?.[0]); }}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 cursor-pointer transition-colors ${
          dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
        {busy ? <Loader2 size={20} className="animate-spin text-primary-600" /> : <Upload size={20} className="text-gray-400" />}
        <span className="text-sm text-gray-700">Upload a declaration — drag &amp; drop or click</span>
        <span className="text-xs text-gray-400">Word (.docx) or PDF · also saved to Inventory → Documents → Declarations for later operations</span>
        <input ref={fileRef} type="file" accept=".docx,.pdf" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      </label>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search declarations…"
            className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => start({ operation_id: operationId })}>
          <FilePlus2 size={14} /> Start blank
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
      ) : (
        <div className="space-y-5">
          {suggested.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Suggested for this operation's products</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {suggested.map(d => card(`l${d.id}`, d.title || d.file_name, d.products.map((p: any) => p.name).join(', '),
                  () => start({ operation_id: operationId, source_type: 'library', source_id: d.id }),
                  <span className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700"><Sparkles size={11} /> Suggested</span>))}
              </div>
            </section>
          )}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Declaration library</h2>
            {others.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {others.map(d => card(`l${d.id}`, d.title || d.file_name, d.products.length ? d.products.map((p: any) => p.name).join(', ') : 'General — all products',
                  () => start({ operation_id: operationId, source_type: 'library', source_id: d.id })))}
              </div>
            ) : <p className="text-sm text-gray-400">{library.length ? 'Nothing matches.' : 'No declarations in the library yet — upload one above.'}</p>}
          </section>
          {prev.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Generated on other operations</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {prev.map(d => card(`d${d.id}`, d.title, `${d.operation_number}${d.customer_name ? ` · ${d.customer_name}` : ''} · ${formatDate(d.updated_at)}`,
                  () => start({ operation_id: operationId, source_type: 'declaration', source_id: d.id })))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 2: edit + preview + generate ─────────────────────────────────────

function DeclarationEditor({ id }: { id: number }) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [record, setRecord] = useState<Declaration | null>(null);
  const [form, setForm] = useState<DeclarationData | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const sigRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  urlRef.current = previewUrl;
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  useEffect(() => {
    api.get(`/declarations/${id}`).then(({ data }) => {
      setRecord(data);
      setForm(data.draft || data.data);
    }).catch(() => { addToast('Declaration not found', 'error'); navigate(-1); });
  }, [id]);

  // Signature thumbnail
  useEffect(() => {
    let url: string | null = null;
    setSigUrl(null);
    if (!form?.signature_file) return;
    api.get(`/files/declaration-assets/${form.signature_file}`, { responseType: 'blob' })
      .then(r => { url = URL.createObjectURL(r.data); setSigUrl(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [form?.signature_file]);

  async function preview(data = form) {
    if (!data) return;
    setPreviewing(true);
    try {
      const res = await api.post('/declarations/preview', { data }, { responseType: 'blob' });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      setPreviewUrl(URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
    } catch {
      addToast('Failed to render the preview', 'error');
    } finally {
      setPreviewing(false);
    }
  }
  // First preview straight away; then it follows the form (debounced)
  const first = useRef(true);
  useEffect(() => {
    if (!form) return;
    if (first.current) { first.current = false; preview(form); return; }
    const t = setTimeout(() => preview(form), 900);
    return () => clearTimeout(t);
  }, [form]);

  if (!record || !form) return <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-primary-600" /></div>;

  const set = (patch: Partial<DeclarationData>) => setForm({ ...form, ...patch });
  const setBlock = (i: number, b: Block) => set({ blocks: form.blocks.map((x, j) => (j === i ? b : x)) });
  const moveBlock = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= form.blocks.length) return;
    const next = [...form.blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set({ blocks: next });
  };
  const generated = record.status === 'final';

  async function save(status: 'draft' | 'final') {
    if (!form) return;
    if (status === 'final' && !form.title.trim()) { addToast('Give the declaration a title', 'error'); return; }
    setSaving(true);
    try {
      const { data } = await api.put(`/declarations/${id}`, { data: form, status });
      setRecord({ ...record!, ...data });
      addToast(status === 'final' ? `${data.file_name} generated and filed under the operation` : 'Draft saved', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    const res = await api.get(`/declarations/${id}/pdf`, { responseType: 'blob' });
    const href = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = href; a.download = record?.file_name || 'declaration.pdf'; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function uploadSignature(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/declarations/signature', fd);
      set({ signature_file: data.file });
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Upload failed', 'error');
    }
  }

  const op = record.operation;
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <Link to={`/operations/${record.operation_id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> Back to operation{op ? ` ${op.operation_number}` : ''}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => preview()} disabled={previewing}>
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
          </Button>
          <Button variant="secondary" size="sm" onClick={() => save('draft')} disabled={saving}
            title={generated ? 'Keep these edits as a draft — the generated PDF stays until you regenerate' : 'Keep the declaration as a draft — nothing is filed yet'}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
          </Button>
          <Button size="sm" onClick={() => save('final')} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {generated ? 'Confirm & regenerate' : 'Confirm & generate'}
          </Button>
          <Button variant="secondary" size="sm" onClick={download} disabled={!generated}>
            <FileDown size={14} /> Download PDF
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-xl font-bold text-gray-900">{form.title || 'Declaration'}</h1>
        <p className="text-sm text-gray-500">Declaration{op ? ` for ${op.operation_number}${op.customer_name ? ` · ${op.customer_name}` : ''}` : ''} — generated as a PDF and filed under the operation's Declaration documents.</p>
      </div>

      {!generated && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Save size={16} className="text-amber-600 flex-shrink-0" /> <span><strong>Draft</strong> — not generated yet. Confirm &amp; generate when it reads right.</span>
        </div>
      )}
      {generated && record.draft && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Save size={16} className="text-amber-600 flex-shrink-0" /> <span>Draft changes saved on top of <strong>{record.file_name}</strong> — Confirm &amp; regenerate to apply them.</span>
        </div>
      )}
      {generated && !record.draft && (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle size={16} className="text-green-600 flex-shrink-0" /> <span><strong>{record.file_name}</strong> generated and filed under the operation.</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="space-y-5">
          <Section icon={<Heading1 size={16} />} title="Header">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelCls}>Title *</label>
                <input value={form.title} onChange={e => set({ title: e.target.value })} className={inputCls} placeholder="e.g. Midas Naturlac SL10 Composition" />
              </div>
              <div>
                <label className={labelCls}>Department</label>
                <input value={form.department} onChange={e => set({ department: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Heading</label>
                <input value={form.heading} onChange={e => set({ heading: e.target.value })} className={inputCls} placeholder="TripleW statement" />
              </div>
            </div>
          </Section>

          <Section icon={<UserRound size={16} />} title="Addressed to (optional)"
            action={op?.customer_name ? (
              <button type="button" onClick={() => set({ addressee: { name: op.customer_name || '', address: op.customer_address || '' } })}
                className="text-xs text-primary-600 hover:text-primary-700">Fill from customer</button>
            ) : undefined}>
            {form.addressee ? (
              <div className="space-y-3">
                <input value={form.addressee.name} onChange={e => set({ addressee: { ...form.addressee!, name: e.target.value } })} className={inputCls} placeholder="Company name" />
                <textarea value={form.addressee.address} onChange={e => set({ addressee: { ...form.addressee!, address: e.target.value } })} rows={3} className={inputCls} placeholder="Address" />
                <button type="button" onClick={() => set({ addressee: null })} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"><X size={12} /> Remove the addressee</button>
              </div>
            ) : (
              <button type="button" onClick={() => set({ addressee: { name: '', address: '' } })} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700">
                <Plus size={14} /> Add an addressee
              </button>
            )}
          </Section>

          <Section icon={<AlignLeft size={16} />} title="Statement">
            <p className="mb-3 text-xs text-gray-500">Wrap words in <code className="rounded bg-gray-100 px-1">**double stars**</code> for bold. Start a line with <code className="rounded bg-gray-100 px-1">• </code> for a bullet, <code className="rounded bg-gray-100 px-1">{'  – '}</code> for a sub-bullet.</p>
            <div className="space-y-3">
              {form.blocks.map((b, i) => (
                <div key={i} className="group rounded-lg border border-gray-200 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-400">
                    {b.type === 'table' ? <Table2 size={12} /> : <AlignLeft size={12} />}
                    <span>{b.type === 'table' ? 'Table' : 'Paragraph'}</span>
                    <span className="ml-auto flex items-center gap-0.5">
                      <button type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0} title="Move up" className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowUp size={12} /></button>
                      <button type="button" onClick={() => moveBlock(i, 1)} disabled={i === form.blocks.length - 1} title="Move down" className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowDown size={12} /></button>
                      <button type="button" onClick={() => set({ blocks: form.blocks.filter((_, j) => j !== i) })} title="Delete" className="p-1 rounded hover:bg-red-50 hover:text-red-600"><Trash2 size={12} /></button>
                    </span>
                  </div>
                  {b.type === 'paragraph' ? (
                    <textarea value={b.text} onChange={e => setBlock(i, { ...b, text: e.target.value })}
                      rows={Math.min(8, Math.max(1, Math.ceil(b.text.length / 80) + (b.text.match(/\n/g)?.length || 0)))}
                      className="block w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  ) : (
                    <TableEditor block={b} onChange={nb => setBlock(i, nb)} />
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => set({ blocks: [...form.blocks, { type: 'paragraph', text: '' }] })}><Plus size={14} /> Paragraph</Button>
                <Button variant="secondary" size="sm" onClick={() => set({ blocks: [...form.blocks, { type: 'table', header: true, rows: [['Element', 'Value'], ['', '']] }] })}><Table2 size={14} /> Table</Button>
              </div>
            </div>
          </Section>

          <Section icon={<PenLine size={16} />} title="Issued & signed">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Issued in</label>
                <input value={form.place} onChange={e => set({ place: e.target.value })} className={inputCls} placeholder="Antwerp" />
              </div>
              <div>
                <label className={labelCls}>On</label>
                <input type={isoDate(form.date) || !form.date ? 'date' : 'text'} value={form.date} onChange={e => set({ date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Signed by</label>
                <input value={form.signatory} onChange={e => set({ signatory: e.target.value })} className={inputCls} placeholder="Name" />
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <input value={form.role} onChange={e => set({ role: e.target.value })} className={inputCls} placeholder="e.g. Technology and Quality Manager at TripleW" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Signature</label>
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-gray-200 bg-white">
                    {sigUrl ? <img src={sigUrl} alt="Signature" className="max-h-14 max-w-[150px]" /> : <span className="text-xs text-gray-400">No signature</span>}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => sigRef.current?.click()}><Upload size={14} /> {form.signature_file ? 'Replace' : 'Upload'}</Button>
                  {form.signature_file && <button type="button" onClick={() => set({ signature_file: null })} className="text-xs text-gray-500 hover:text-red-600">Remove</button>}
                  <input ref={sigRef} type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={e => { uploadSignature(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              </div>
            </div>
          </Section>
        </div>

        <div className="xl:sticky xl:top-4">
          <Section icon={<Eye size={16} />} title="Preview"
            action={<button type="button" onClick={() => preview()} disabled={previewing} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
              {previewing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
            </button>}>
            {previewUrl ? (
              <iframe src={`${previewUrl}#navpanes=0&view=FitH`} title="Declaration preview" className="w-full rounded-lg border border-gray-200 bg-white" style={{ height: '78vh' }} />
            ) : (
              <div className="flex h-64 items-center justify-center"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function TableEditor({ block, onChange }: { block: Extract<Block, { type: 'table' }>; onChange: (b: Extract<Block, { type: 'table' }>) => void }) {
  const cols = useMemo(() => Math.max(1, ...block.rows.map(r => r.length)), [block.rows]);
  const rows = block.rows.map(r => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
  const setCell = (ri: number, ci: number, v: string) => onChange({ ...block, rows: rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) });
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className="border border-gray-200 p-0">
                    <input value={c} onChange={e => setCell(ri, ci, e.target.value)}
                      className={`w-full min-w-[90px] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
                        ri === 0 && block.header ? 'bg-green-50 font-semibold' : ''}`} />
                  </td>
                ))}
                <td className="w-6 pl-1">
                  <button type="button" onClick={() => onChange({ ...block, rows: rows.filter((_, i) => i !== ri) })} title="Delete row"
                    className="p-0.5 text-gray-300 hover:text-red-600"><X size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => onChange({ ...block, rows: [...rows, Array(cols).fill('')] })} className="text-primary-600 hover:text-primary-700">+ Row</button>
        <button type="button" onClick={() => onChange({ ...block, rows: rows.map(r => [...r, '']) })} className="text-primary-600 hover:text-primary-700">+ Column</button>
        {cols > 1 && <button type="button" onClick={() => onChange({ ...block, rows: rows.map(r => r.slice(0, -1)) })} className="text-gray-500 hover:text-red-600">− Last column</button>}
        <label className="ml-auto flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={block.header} onChange={e => onChange({ ...block, header: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" /> First row is the header
        </label>
      </div>
    </div>
  );
}
