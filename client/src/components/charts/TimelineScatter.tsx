import { useState } from 'react';
import { niceMax, axisTicks } from './viz';

export interface TimelinePoint {
  key: string;
  date: string;       // ISO date
  value: number;      // EUR
  label: string;      // invoice # / order #
  sublabel?: string;  // customer / party name
  tag?: string;       // operation # badge
}

interface Props {
  points: TimelinePoint[];
  color: string;
  format: (n: number) => string;
  height?: number;
}

/**
 * Individual transactions plotted against real calendar time — lets a reader
 * see at a glance whether invoice/order dates land where they're expected to,
 * which a monthly rollup hides. One hue (this is identity-by-measure, already
 * carried by the panel it sits in), >=8px markers with a 2px surface ring.
 */
export default function TimelineScatter({ points, color, format, height = 180 }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const valid = points
    .map(p => ({ ...p, t: new Date(p.date).getTime() }))
    .filter(p => p.date && !isNaN(p.t));

  if (valid.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">No dated rows to plot</p>;
  }

  const minT = Math.min(...valid.map(p => p.t));
  const maxT = Math.max(...valid.map(p => p.t));
  const span = Math.max(maxT - minT, 86400000); // floor of 1 day, avoid /0 for a single date
  const maxV = niceMax(Math.max(...valid.map(p => p.value), 0) || 1);

  const xPct = (t: number) => ((t - minT) / span) * 100;
  const yPct = (v: number) => 100 - Math.max(0, Math.min(1, v / maxV)) * 100;

  // Month boundaries within range, for gridlines + axis labels
  const months: { t: number; label: string }[] = [];
  const cursor = new Date(minT);
  cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
  const endGuard = new Date(maxT);
  let guard = 0;
  while (cursor.getTime() <= endGuard.getTime() && guard < 60) {
    months.push({ t: cursor.getTime(), label: cursor.toLocaleDateString('en-GB', { month: 'short' }) });
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }

  const active = valid.find(p => p.key === hover);

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between items-end shrink-0 w-16" style={{ height }}>
          {axisTicks(maxV).map((v, i) => (
            <span key={i} className="text-[10px] leading-none tabular-nums text-gray-400">{format(v)}</span>
          ))}
        </div>

        <div className="flex-1 min-w-0 relative" style={{ height }}>
          {[0, 25, 50, 75, 100].map(pct => (
            <div key={pct} className="absolute left-0 right-0 pointer-events-none"
              style={{ bottom: `${pct}%`, borderTop: '1px solid', borderColor: pct === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)' }} />
          ))}
          {months.map(m => (
            <div key={m.t} className="absolute top-0 bottom-0 w-px pointer-events-none"
              style={{ left: `${xPct(m.t)}%`, backgroundColor: 'var(--viz-grid)' }} />
          ))}

          {valid.map(p => {
            const isActive = hover === p.key;
            return (
              <div
                key={p.key}
                className="absolute rounded-full cursor-default transition-all"
                style={{
                  left: `${xPct(p.t)}%`,
                  bottom: `${100 - yPct(p.value)}%`,
                  width: isActive ? 11 : 9,
                  height: isActive ? 11 : 9,
                  transform: 'translate(-50%, 50%)',
                  backgroundColor: color,
                  border: '2px solid var(--viz-surface)',
                  opacity: hover === null || isActive ? 1 : 0.4,
                  zIndex: isActive ? 2 : 1,
                }}
                onMouseEnter={() => setHover(p.key)}
                onMouseLeave={() => setHover(h => (h === p.key ? null : h))}
              />
            );
          })}

          {active && (
            <div
              className="absolute z-20 pointer-events-none"
              style={{
                left: `${xPct(active.t)}%`,
                bottom: `calc(${100 - yPct(active.value)}% + 14px)`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="rounded-lg bg-gray-900 text-white text-[11px] px-2.5 py-1.5 shadow-lg whitespace-nowrap">
                <p className="font-semibold flex items-center gap-1.5">
                  {active.label}
                  {active.tag && <span className="text-gray-300 font-normal">· {active.tag}</span>}
                </p>
                {active.sublabel && <p className="text-gray-300">{active.sublabel}</p>}
                <p className="tabular-nums">{format(active.value)} · {active.date.slice(0, 10)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative h-4 ml-[72px] mt-1">
        {months.map(m => (
          <span key={m.t} className="absolute text-[10px] text-gray-400 -translate-x-1/2 whitespace-nowrap" style={{ left: `${xPct(m.t)}%` }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}
