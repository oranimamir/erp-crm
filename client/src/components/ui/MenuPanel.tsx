import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

/**
 * A button that opens a floating panel under it (Generate…, Compare…). The panel
 * is drawn on the page itself, so a card with overflow hidden never clips it;
 * it closes on a click outside, Escape, scrolling or resizing.
 */
export default function MenuPanel({ label, icon, variant = 'secondary', badge, width = 380, align = 'left', disabled, title, children }: {
  label: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary';
  /** A small count beside the label (e.g. "2/4") */
  badge?: string | null;
  width?: number;
  align?: 'left' | 'right';
  disabled?: boolean;
  title?: string;
  /** The panel content; `close` shuts it (call it before opening anything). */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom - 12;
    setPos({ top: r.bottom + 6, left, maxHeight: Math.max(220, below) });
  }, [open, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const btnCls = variant === 'primary'
    ? 'bg-primary-600 text-white border-primary-600 hover:bg-primary-700'
    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400';

  return (
    <>
      <button ref={btnRef} type="button" disabled={disabled} title={title} onClick={() => setOpen(v => !v)}
        aria-haspopup="menu" aria-expanded={open}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${btnCls} ${open ? 'ring-2 ring-primary-200' : ''}`}>
        {icon}
        {label}
        {badge && (
          <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${variant === 'primary' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>{badge}</span>
        )}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxHeight }}
          className="z-[60] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5">
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}
