import { useState } from 'react';
import api from './api';
import { useToast } from '../contexts/ToastContext';
import FilePreviewModal from '../components/ui/FilePreviewModal';

/** A stored upload, as `/api/files/<subfolder>/<filePath>` serves it. */
export interface PreviewFile { fileName: string; filePath: string; subfolder: string; label?: string }

/**
 * Preview / download for stored uploads: `open(file)` shows it in the shared
 * FilePreviewModal; render `modal` once in the page.
 */
export function useFilePreview() {
  const { addToast } = useToast();
  const [item, setItem] = useState<PreviewFile | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(file: PreviewFile) {
    setItem(file);
    setUrl(null);
    setLoading(true);
    try {
      const resp = await api.get(`/files/${file.subfolder}/${file.filePath}`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: String(resp.headers['content-type'] || 'application/octet-stream') });
      setUrl(URL.createObjectURL(blob));
    } catch {
      addToast('Failed to load preview', 'error');
      setItem(null);
    } finally {
      setLoading(false);
    }
  }

  function close() {
    if (url) URL.revokeObjectURL(url);
    setItem(null);
    setUrl(null);
  }

  async function download(file: PreviewFile) {
    try {
      const resp = await api.get(`/files/${file.subfolder}/${file.filePath}`, { responseType: 'blob' });
      const href = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = href; a.download = file.fileName; a.click();
      URL.revokeObjectURL(href);
    } catch {
      addToast('Download failed', 'error');
    }
  }

  const modal = item ? (
    <FilePreviewModal fileName={item.fileName} url={url} loading={loading} label={item.label}
      onClose={close} onDownload={() => download(item)} />
  ) : null;

  return { open, download, modal };
}
