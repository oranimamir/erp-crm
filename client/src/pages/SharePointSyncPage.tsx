import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, FolderOpen, FileText, CheckCircle, XCircle, Clock, Download } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';

interface SharePointFile {
  name: string;
  downloadUrl: string;
  type: 'order' | 'invoice' | 'other';
}

interface PendingItem {
  id: number;
  folder_name: string;
  files: string;
  detected_at: string;
  status: 'pending' | 'imported' | 'ignored';
  operation_id: number | null;
  imported_at: string | null;
  imported_by_name: string | null;
  imported_operation_number: string | null;
}

const FILE_TYPE_COLORS: Record<string, string> = {
  order: 'bg-blue-100 text-blue-700',
  invoice: 'bg-green-100 text-green-700',
  other: 'bg-gray-100 text-gray-500',
};

export default function SharePointSyncPage() {
  const navigate = useNavigate();
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [historyItems, setHistoryItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [ignoring, setIgnoring] = useState<number | null>(null);
  const [scanResult, setScanResult] = useState<{ found: number; new: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const [pendingRes, importedRes, ignoredRes] = await Promise.all([
        api.get('/sharepoint/pending?status=pending&limit=100'),
        api.get('/sharepoint/pending?status=imported&limit=50'),
        api.get('/sharepoint/pending?status=ignored&limit=50'),
      ]);
      setPendingItems(pendingRes.data.data);
      setHistoryItems([...importedRes.data.data, ...ignoredRes.data.data].sort(
        (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
      ));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load pending items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    setError(null);
    try {
      const res = await api.get('/sharepoint/scan');
      setScanResult(res.data);
      await fetchPending();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleImport = async (item: PendingItem) => {
    setImporting(item.id);
    setError(null);
    try {
      const res = await api.post(`/sharepoint/pending/${item.id}/import`);
      await fetchPending();
      navigate(`/operations/${res.data.operationId}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Import failed');
      setImporting(null);
    }
  };

  const handleIgnore = async (item: PendingItem) => {
    setIgnoring(item.id);
    setError(null);
    try {
      await api.post(`/sharepoint/pending/${item.id}/ignore`);
      await fetchPending();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to ignore');
    } finally {
      setIgnoring(null);
    }
  };

  const parseFiles = (filesJson: string): SharePointFile[] => {
    try { return JSON.parse(filesJson); } catch { return []; }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SharePoint Sync</h1>
          <p className="text-sm text-gray-500 mt-1">
            Detects new SO folders in <span className="font-mono text-xs bg-gray-100 px-1 rounded">03 - Operations (Sales orders)</span> and lets you import them.
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={16} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {/* Scan result */}
      {scanResult && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 text-sm">
          Scan complete: <strong>{scanResult.found}</strong> folders found,{' '}
          <strong>{scanResult.new}</strong> new.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Pending section */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Clock size={18} className="text-amber-500" />
          Pending Import
          {pendingItems.length > 0 && (
            <span className="ml-1 bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingItems.length}
            </span>
          )}
        </h2>

        {pendingItems.length === 0 ? (
          <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-400 text-sm">
            No pending operations. Click "Scan Now" to check for new SharePoint folders.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingItems.map(item => {
              const files = parseFiles(item.files);
              const orderFiles = files.filter(f => f.type === 'order');
              const invoiceFiles = files.filter(f => f.type === 'invoice');
              const otherFiles = files.filter(f => f.type === 'other');

              return (
                <div key={item.id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <FolderOpen size={18} className="text-amber-500 shrink-0" />
                        <span className="font-semibold text-gray-900">{item.folder_name}</span>
                        <span className="text-xs text-gray-400">
                          detected {formatDate(item.detected_at.split('T')[0])}
                        </span>
                      </div>

                      {/* Files */}
                      <div className="flex flex-wrap gap-1.5">
                        {files.length === 0 ? (
                          <span className="text-xs text-gray-400 italic">No files found</span>
                        ) : (
                          files.map((f, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${FILE_TYPE_COLORS[f.type]}`}
                            >
                              <FileText size={11} />
                              {f.name}
                              <span className="opacity-60">({f.type})</span>
                            </span>
                          ))
                        )}
                      </div>

                      {/* Summary */}
                      {files.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1.5">
                          Will import: {orderFiles.length > 0 && `${orderFiles.length} order doc${orderFiles.length > 1 ? 's' : ''}`}
                          {orderFiles.length > 0 && invoiceFiles.length > 0 && ', '}
                          {invoiceFiles.length > 0 && `${invoiceFiles.length} invoice${invoiceFiles.length > 1 ? 's' : ''}`}
                          {otherFiles.length > 0 && ` (${otherFiles.length} other skipped)`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleImport(item)}
                        disabled={importing === item.id || ignoring === item.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-60 transition-colors"
                      >
                        <Download size={14} />
                        {importing === item.id ? 'Importing...' : 'Import'}
                      </button>
                      <button
                        onClick={() => handleIgnore(item)}
                        disabled={importing === item.id || ignoring === item.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
                      >
                        <XCircle size={14} />
                        {ignoring === item.id ? 'Ignoring...' : 'Ignore'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History section */}
      {historyItems.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <CheckCircle size={18} className="text-gray-400" />
            History
          </h2>
          <div className="space-y-2">
            {historyItems.map(item => (
              <div key={item.id} className="border border-gray-100 rounded-lg px-4 py-3 bg-gray-50 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FolderOpen size={16} className="text-gray-400 shrink-0" />
                  <span className="text-sm font-medium text-gray-700">{item.folder_name}</span>
                  <span className="text-xs text-gray-400">detected {formatDate(item.detected_at.split('T')[0])}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.status === 'imported' ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        <CheckCircle size={11} />
                        Imported
                      </span>
                      {item.imported_operation_number && (
                        <button
                          onClick={() => navigate(`/operations/${item.operation_id}`)}
                          className="text-xs text-primary-600 hover:underline"
                        >
                          {item.imported_operation_number}
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                      <XCircle size={11} />
                      Ignored
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
