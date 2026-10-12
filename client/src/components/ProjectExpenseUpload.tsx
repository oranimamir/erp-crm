import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Button from './ui/Button';

export interface ProjectOption { to_id: number; label: string; to_number: string; title: string | null; status: string }

/**
 * Supplier Invoices → Project expenses: pick the project (a technology
 * operation) and upload its invoices (PDF / XML, several at once). Each is read
 * and filed under the project; the technology operation gets it as an expense.
 */
export default function ProjectExpenseUpload({ projects, onUploaded }: { projects: ProjectOption[]; onUploaded: () => void }) {
  const { addToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<string>(projects.length === 1 ? projects[0].label : '');
  const [uploading, setUploading] = useState(false);
  const chosen = project || (projects.length === 1 ? projects[0].label : '');

  const upload = async (files: FileList | null) => {
    if (!files?.length || !chosen) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('project', chosen);
      for (const f of Array.from(files)) form.append('files', f);
      const res = await api.post('/demo-expenses/project-upload', form);
      const { added, skipped } = res.data as { added: any[]; skipped: { file: string; reason: string }[] };
      if (added.length) addToast(`${added.length} invoice(s) added to ${res.data.project}`, 'success');
      for (const s of skipped) addToast(`${s.file}: ${s.reason}`, 'error');
      const check = added.filter(a => a.warnings?.length).length;
      if (check) addToast(`${check} invoice(s) need a check (read with warnings) — open them in the list`, 'info');
      onUploaded();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        No technology project yet — create one under <Link to="/technology-operations" className="underline font-medium">Technology Ops</Link> first; its title becomes the sub category here.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm text-gray-600">Project</label>
      <select value={chosen} onChange={e => setProject(e.target.value)}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-primary-500">
        {projects.length > 1 && <option value="">Choose the project…</option>}
        {projects.map(p => <option key={p.to_id} value={p.label}>{p.label}{p.title ? ` — ${p.to_number}` : ''}</option>)}
      </select>
      <input ref={inputRef} type="file" accept=".pdf,.xml" multiple className="hidden" onChange={e => upload(e.target.files)} />
      <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={uploading || !chosen}>
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {uploading ? 'Reading…' : 'Upload project invoices'}
      </Button>
      <span className="text-xs text-gray-500">Each invoice is also added to the technology operation's expenses, ready to bill on a TI invoice.</span>
    </div>
  );
}
