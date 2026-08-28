import { useState } from 'react';

export interface RankedRow {
  key: string;
  label: string;
  /** One value per series; a single-element array is the common case. */
  values: number[];
}

interface Props {
  rows: RankedRow[];
  series: { name: string; color: string }[];
  format: (n: number) => string;
  /** Denominator for the share column; defaults to the sum of series 0. */
  total?: number;
  maxRows?: number;
}

/**
 * Ranked horizontal bars — the magnitude job. Nominal categories all wear the
 * same hue (a per-bar value ramp would double-encode length), so filtering can
 * never repaint a survivor. The tail beyond `maxRows` folds into "Other".
 */
export default function RankedBars({ rows, series, format, total, maxRows = 10 }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">No data for this period</p>;
  }

  const sorted = [...rows].sort((a, b) => (b.values[0] || 0) - (a.values[0] || 0));
  const shown = sorted.slice(0, maxRows);
  const tail = sorted.slice(maxRows);
  if (tail.length) {
    shown.push({
      key: '__other__',
      label: `Other (${tail.length})`,
      values: series.map((_, si) => tail.reduce((s, r) => s + (r.values[si] || 0), 0)),
    });
  }

  const max = Math.max(...shown.flatMap(r => r.values), 1);
  const denom = total ?? sorted.reduce((s, r) => s + (r.values[0] || 0), 0);

  return (
    <div className="space-y-3">
      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-4">
          {series.map(s => (
            <span key={s.name} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {shown.map((r, i) => {
          const share = denom > 0 ? (r.values[0] || 0) / denom : 0;
          const isOther = r.key === '__other__';
          return (
            <div
              key={r.key}
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(h => (h === r.key ? null : h))}
              className="group"
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-sm text-gray-700 truncate min-w-0 flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 tabular-nums w-4 shrink-0">{isOther ? '' : i + 1}</span>
                  <span className="truncate">{r.label}</span>
                </span>
                <span className="shrink-0 flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">{format(r.values[0] || 0)}</span>
                  <span className="text-[11px] text-gray-400 tabular-nums w-9 text-right">
                    {denom > 0 ? `${Math.round(share * 100)}%` : ''}
                  </span>
                </span>
              </div>
              <div className="space-y-[2px]">
                {series.map((s, si) => {
                  const v = r.values[si] || 0;
                  return (
                    <div key={s.name} className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--viz-track)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max((v / max) * 100, v > 0 ? 1.5 : 0)}%`,
                          backgroundColor: isOther ? 'var(--viz-muted)' : s.color,
                          opacity: hover === null || hover === r.key ? 1 : 0.5,
                        }}
                        title={`${r.label} · ${s.name}: ${format(v)}`}
                      />
                    </div>
                  );
                })}
              </div>
              {series.length > 1 && hover === r.key && (
                <div className="flex flex-wrap gap-x-4 mt-1">
                  {series.map((s, si) => (
                    <span key={s.name} className="text-[11px] text-gray-500">
                      {s.name}: <span className="tabular-nums text-gray-700">{format(r.values[si] || 0)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
