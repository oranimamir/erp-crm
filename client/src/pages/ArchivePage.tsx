import { useEffect, useState } from 'react';
import { Archive, Eye, Download, Trash2, Loader2, Search } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useFilePreview } from '../lib/useFilePreview';

/**
 * Archive: every file someone deleted (or replaced with a new version) anywhere
 * in the app — operation documents, invoices, orders, supplier documents,
 * library documents, generated PDFs, supplier invoices… — with where it came
 * from, who removed it and when. Files can be previewed and downloaded; an
 * admin can delete one for good.
 */

interface ArchivedFile {
  id: number; section: string; context: string | null; file_name: string; stored_name: string;
  size: number | null; reason: 'deleted' | 'replaced'; deleted_by_name: string | null; deleted_at: string;
}

const PREVIEWABLE = /\.(pdf|jpe?g|png|webp)$/i;
const fmtSize = (n: number | null) => n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const fmtTime = (iso: string) => {
  const time = /\d{2}:\d{2}/.exec(iso)?.[0];
  return `${formatDate(iso.slice(0, 10))}${time ? ` ${time}` : ''}`;
};

export default function ArchivePage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const preview = useFilePreview();
  const [rows, setRows] = useState<ArchivedFile[]>([]);
  const [sections, setSections] = useState<Array<{ section: string; count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/archive', { params: { search: search || undefined, section: section || undefined, page, limit: 50 } })
      .then(({ data }) => {
        setRows(data.data || []); setTotal(data.total || 0); setTotalPages(data.totalPages || 1); setSections(data.sections || []);
      })
      .catch(() => addToast('Failed to load the archive', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, section, page]);

  async function removeForGood(r: ArchivedFile) {
    if (!confirm(`Delete "${r.file_name}" for good? It can't be recovered afterwards.`)) return;
    try {
      await api.delete(`/archive/${r.id}`);
      addToast('Deleted for good', 'success');
      load();
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  const fileOf = (r: ArchivedFile) => ({ fileName: r.file_name, filePath: r.stored_name, subfolder: 'archive', label: r.file_name });
  const allCount = sections.reduce((n, s) => n + s.count, 0);

  return (
    <div className="space-y-4">
      {preview.modal}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Archive size={22} className="text-primary-600" /> Archive
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
          Every file deleted (or replaced by a new version) anywhere in the system lands here, with where it came from, who removed it and when.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search file name, operation, supplier, who deleted…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <select value={section} onChange={e => { setSection(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All sections ({allCount})</option>
          {sections.map(s => <option key={s.section} value={s.section}>{s.section} ({s.count})</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary-600" size={24} /></div>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-16">
            {search || section ? 'Nothing in the archive matches.' : 'The archive is empty — files deleted from now on will appear here.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-2.5">File</th>
                  <th className="px-4 py-2.5">Section</th>
                  <th className="px-4 py-2.5">Belonged to</th>
                  <th className="px-4 py-2.5">Removed</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800 break-all">{r.file_name}</p>
                      <p className="text-xs text-gray-400">{fmtSize(r.size)}</p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-700">{r.section}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.context || '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${r.reason === 'replaced' ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-red-700'}`}>
                        {r.reason === 'replaced' ? 'Replaced' : 'Deleted'}
                      </span>
                      <p className="text-xs text-gray-500 mt-0.5">{fmtTime(r.deleted_at)}{r.deleted_by_name ? ` · ${r.deleted_by_name}` : ''}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {PREVIEWABLE.test(r.file_name) && (
                          <button onClick={() => preview.open(fileOf(r))} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Preview"><Eye size={15} /></button>
                        )}
                        <button onClick={() => preview.download(fileOf(r))} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Download"><Download size={15} /></button>
                        {isAdmin && (
                          <button onClick={() => removeForGood(r)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete for good"><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{total} files</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">Previous</button>
            <span className="px-2 py-1">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
