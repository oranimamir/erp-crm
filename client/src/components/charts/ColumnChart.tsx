import { useState } from 'react';
import { niceMax, axisTicks } from './viz';

export interface ColumnSeries {
  name: string;
  color: string;
  values: number[];
}

interface Props {
  categories: string[];
  series: ColumnSeries[];
  format: (n: number) => string;      // tooltip / direct label
  formatAxis: (n: number) => string;  // axis ticks
  height?: number;
  /** Highlight the biggest column with a direct label (default true). */
  labelExtreme?: boolean;
}

/**
 * Time-series columns. One shared axis (never a second scale), hairline grid,
 * ≤24px bars with a 4px rounded cap and a 2px surface gap between neighbours.
 * Values are read from the tooltip, the direct label on the extreme, and the
 * table twin that every panel renders underneath.
 */
export default function ColumnChart({
  categories, series, format, formatAxis, height = 200, labelExtreme = true,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const flat = series.flatMap(s => s.values);
  const max = niceMax(Math.max(...flat, 0) || 1);
  const extreme = labelExtreme ? Math.max(...flat, 0) : Infinity;
  let extremeUsed = false;

  return (
    <div>
      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-4 mb-3">
          {series.map(s => (
            <span key={s.name} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {/* Y axis */}
        <div className="flex flex-col justify-between items-end shrink-0 w-16" style={{ height }}>
          {axisTicks(max).map((v, i) => (
            <span key={i} className="text-[10px] leading-none tabular-nums text-gray-400">{formatAxis(v)}</span>
          ))}
        </div>

        {/* Plot */}
        <div className="flex-1 min-w-0 relative" style={{ height }}>
          {[0, 25, 50, 75, 100].map(pct => (
            <div key={pct} className="absolute left-0 right-0 pointer-events-none"
              style={{
                bottom: `${(pct / 100) * height}px`,
                borderTop: '1px solid',
                borderColor: pct === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)',
              }} />
          ))}

          <div className="absolute inset-0 flex items-end">
            {categories.map((cat, ci) => {
              const active = hover === ci;
              return (
                <div
                  key={cat + ci}
                  className="flex-1 h-full relative flex items-end justify-center gap-[2px] cursor-default"
                  onMouseEnter={() => setHover(ci)}
                  onMouseLeave={() => setHover(h => (h === ci ? null : h))}
                >
                  {/* Full-height hit target — bigger than the marks themselves */}
                  <div className="absolute inset-0" style={{ background: active ? 'rgba(148,163,184,0.10)' : 'transparent' }} />

                  {series.map(s => {
                    const v = s.values[ci] || 0;
                    const h = v > 0 ? Math.max((v / max) * height, 2) : 1;
                    const isExtreme = labelExtreme && !extremeUsed && v > 0 && v === extreme;
                    if (isExtreme) extremeUsed = true;
                    return (
                      <div key={s.name} className="relative flex-1 max-w-[24px] h-full flex flex-col justify-end items-center">
                        {/* The one direct label rides its own bar cap, not the plot top */}
                        {isExtreme && (
                          <span
                            className="absolute left-1/2 -translate-x-1/2 text-[10px] font-medium text-gray-600 whitespace-nowrap tabular-nums"
                            style={{ bottom: `${h + 4}px` }}
                          >
                            {formatAxis(v)}
                          </span>
                        )}
                        <div
                          className="w-full transition-all"
                          style={{
                            height: `${h}px`,
                            borderTopLeftRadius: 4,
                            borderTopRightRadius: 4,
                            backgroundColor: v > 0 ? s.color : 'var(--viz-track)',
                            opacity: hover === null || active ? 1 : 0.45,
                          }}
                        />
                      </div>
                    );
                  })}

                  {active && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                      <div className="rounded-lg bg-gray-900 text-white text-[11px] px-2.5 py-1.5 shadow-lg whitespace-nowrap">
                        <p className="font-semibold mb-0.5">{cat}</p>
                        {series.map(s => (
                          <p key={s.name} className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="text-gray-300">{s.name}</span>
                            <span className="ml-auto pl-2 tabular-nums">{format(s.values[ci] || 0)}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* X axis */}
      <div className="flex ml-[72px] mt-1.5">
        {categories.map((c, i) => (
          <div key={c + i} className="flex-1 text-center min-w-0">
            <span className={`text-[10px] truncate block ${hover === i ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
