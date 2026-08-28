import { useState } from 'react';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface Props {
  slices: DonutSlice[];
  format: (n: number) => string;
  centerLabel?: string;
  size?: number;
  /** Slices beyond this fold into a neutral "Other" — hues are never generated. */
  maxSlices?: number;
}

/**
 * Part-to-whole at a glance. Segments are separated by a 2px ring in the surface
 * colour (never a border drawn around the mark), and the legend carries identity
 * so nothing depends on colour matching alone.
 */
export default function DonutChart({ slices, format, centerLabel, size = 168, maxSlices = 6 }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const sorted = [...slices].filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);
  if (tail.length) {
    shown.push({
      key: '__other__',
      label: `Other (${tail.length})`,
      value: tail.reduce((s, x) => s + x.value, 0),
      color: 'var(--viz-muted)',
    });
  }

  const total = shown.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <p className="text-sm text-gray-500 py-6 text-center">No data for this period</p>;

  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 6;
  const ir = r * 0.62;
  let angle = -Math.PI / 2;

  const paths = shown.map(s => {
    const sweep = (s.value / total) * 2 * Math.PI;
    const end = angle + sweep;
    const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    const [x2, y2] = [cx + r * Math.cos(end), cy + r * Math.sin(end)];
    const [ix1, iy1] = [cx + ir * Math.cos(end), cy + ir * Math.sin(end)];
    const [ix2, iy2] = [cx + ir * Math.cos(angle), cy + ir * Math.sin(angle)];
    const large = sweep > Math.PI ? 1 : 0;
    const d = sweep >= 2 * Math.PI - 1e-6
      // A single full-circle slice can't be drawn as one arc — use two halves.
      ? `M${cx},${cy - r} A${r},${r},0,1,1,${cx - 0.01},${cy - r} L${cx - 0.01},${cy - ir} A${ir},${ir},0,1,0,${cx},${cy - ir}Z`
      : `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r},0,${large},1,${x2.toFixed(2)},${y2.toFixed(2)} L${ix1.toFixed(2)},${iy1.toFixed(2)} A${ir},${ir},0,${large},0,${ix2.toFixed(2)},${iy2.toFixed(2)}Z`;
    angle = end;
    return { ...s, d, pct: s.value / total };
  });

  const active = paths.find(p => p.key === hover);

  return (
    <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {paths.map(p => (
            <path
              key={p.key}
              d={p.d}
              fill={p.color}
              stroke="var(--viz-surface)"
              strokeWidth={2}
              style={{ opacity: hover === null || hover === p.key ? 1 : 0.4, transition: 'opacity .15s' }}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(h => (h === p.key ? null : h))}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-6">
          <span className="text-[11px] text-gray-400 truncate max-w-full">
            {active ? active.label : centerLabel || 'Total'}
          </span>
          <span className="text-base font-semibold text-gray-900 truncate max-w-full">
            {format(active ? active.value : total)}
          </span>
          {active && <span className="text-[11px] text-gray-400">{Math.round(active.pct * 100)}%</span>}
        </div>
      </div>

      <div className="flex-1 min-w-0 w-full space-y-1.5">
        {paths.map(p => (
          <div
            key={p.key}
            className="flex items-center gap-2 py-0.5 rounded cursor-default"
            onMouseEnter={() => setHover(p.key)}
            onMouseLeave={() => setHover(h => (h === p.key ? null : h))}
            style={{ opacity: hover === null || hover === p.key ? 1 : 0.55 }}
          >
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{p.label}</span>
            <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{Math.round(p.pct * 100)}%</span>
            <span className="text-sm font-medium text-gray-900 tabular-nums shrink-0 text-right min-w-[86px]">{format(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
