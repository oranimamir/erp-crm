import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, Maximize2, Minimize2, X } from 'lucide-react';

interface FilePreviewModalProps {
  /** Name shown in the header; also decides whether to render an <img> or an <iframe>. */
  fileName: string;
  /** Object URL for the file. Null while it is still being fetched. */
  url: string | null;
  loading?: boolean;
  /** Optional chip under the file name (e.g. a document category). */
  label?: string;
  onClose: () => void;
  onDownload?: () => void;
}

const STORAGE_KEY = 'filePreviewSize';
const MIN_W = 420;
const MIN_H = 320;

function isImage(name: string) {
  return /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(name);
}

function clampToViewport(w: number, h: number) {
  return {
    w: Math.max(MIN_W, Math.min(w, window.innerWidth - 32)),
    h: Math.max(MIN_H, Math.min(h, window.innerHeight - 32)),
  };
}

/** Last size the user settled on, so previews keep it from one document to the next. */
function loadSize() {
  const fallback = { w: Math.min(1100, window.innerWidth - 64), h: Math.min(820, window.innerHeight - 80) };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clampToViewport(fallback.w, fallback.h);
    const saved = JSON.parse(raw);
    if (typeof saved?.w !== 'number' || typeof saved?.h !== 'number') return clampToViewport(fallback.w, fallback.h);
    return clampToViewport(saved.w, saved.h);
  } catch {
    return clampToViewport(fallback.w, fallback.h);
  }
}

export default function FilePreviewModal({
  fileName, url, loading, label, onClose, onDownload,
}: FilePreviewModalProps) {
  const [size, setSize] = useState(loadSize);
  const [maximized, setMaximized] = useState(false);
  const [resizing, setResizing] = useState(false);

  // Live values during a drag — refs avoid a re-render per mousemove
  const dragRef = useRef<{ x: number; y: number; w: number; h: number; axis: 'x' | 'y' | 'both' } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the panel inside the window when it is resized smaller
  useEffect(() => {
    const onResize = () => setSize(prev => clampToViewport(prev.w, prev.h));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResize = useCallback((axis: 'x' | 'y' | 'both') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMaximized(false);
    dragRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, axis };
    setResizing(true);
  }, [size.w, size.h]);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // The panel is centred, so it grows from both edges — hence the doubling
      const next = clampToViewport(
        d.axis === 'y' ? d.w : d.w + (e.clientX - d.x) * 2,
        d.axis === 'x' ? d.h : d.h + (e.clientY - d.y) * 2
      );
      setSize(next);
    };

    const onUp = () => {
      setResizing(false);
      dragRef.current = null;
      setSize(current => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* private mode */ }
        return current;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  const panelStyle = maximized
    ? { width: 'calc(100vw - 24px)', height: 'calc(100vh - 24px)' }
    : { width: size.w, height: size.h };

  // Only treat a backdrop click as "close" when the press *started* there, so a
  // resize drag that happens to end over the backdrop doesn't dismiss the panel.
  const pressedBackdrop = useRef(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onMouseDown={e => { pressedBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (e.target === e.currentTarget && pressedBackdrop.current) onClose(); }}
    >
      {/* While dragging, this sits above the iframe so it cannot swallow the mouse */}
      {resizing && <div className="fixed inset-0 z-[60] cursor-nwse-resize" />}

      <div
        className="relative bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate">{fileName}</p>
            {label && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">{label}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onDownload && (
              <button
                onClick={onDownload}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Download size={14} /> Download
              </button>
            )}
            <button
              onClick={() => setMaximized(v => !v)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
              title={maximized ? 'Restore size' : 'Maximise'}
            >
              {maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Close (Esc)">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-gray-100 flex items-center justify-center p-4">
          {loading || !url ? (
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-sm">Loading preview…</span>
            </div>
          ) : isImage(fileName) ? (
            <img src={url} alt={fileName} className="max-w-full max-h-full object-contain rounded-lg shadow" />
          ) : (
            <iframe src={url} title={fileName} className="w-full h-full rounded-lg shadow bg-white" />
          )}
        </div>

        {/* Resize handles — edges for one axis, corner for both. Generous hit
            areas: missing them lands on the backdrop, which is easy to do. */}
        {!maximized && (
          <>
            <div
              onMouseDown={startResize('x')}
              className="absolute top-0 right-0 h-full w-2.5 cursor-ew-resize hover:bg-primary-400/30"
              title="Drag to resize"
            />
            <div
              onMouseDown={startResize('y')}
              className="absolute bottom-0 left-0 w-full h-2.5 cursor-ns-resize hover:bg-primary-400/30"
              title="Drag to resize"
            />
            <div
              onMouseDown={startResize('both')}
              className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize flex items-end justify-end p-0.5 group"
              title="Drag to resize"
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4 text-gray-400 group-hover:text-primary-600">
                <path
                  d="M15 5 L5 15 M15 10 L10 15 M15 15 L14.5 15"
                  stroke="currentColor" strokeWidth="1.75" fill="none" strokeLinecap="round"
                />
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
