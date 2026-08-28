import { ReactNode, useState } from 'react';
import Card from '../ui/Card';
import { ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react';
import ColumnChart from './ColumnChart';
import RankedBars from './RankedBars';
import DonutChart from './DonutChart';
import { VIZ } from './viz';

export interface VizSeries { name: string; color: string; }
export interface VizRow { key: string; label: string; values: number[]; count?: number; }

// ── Card shell ────────────────────────────────────────────────────────────────

export function PanelCard({ title, icon, subtitle, right, onExport, children }: {
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  right?: ReactNode;
  onExport?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <div
        className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3 cursor-pointer select-none hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={15} className="text-gray-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-400 shrink-0" />}
        {icon}
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900 leading-tight truncate">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="ml-auto flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
          {right}
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1 text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50"
              title="Export this table to Excel"
            >
              <FileSpreadsheet size={13} /> Export
            </button>
          )}
        </div>
      </div>
      {open && <div className="p-5">{children}</div>}
    </Card>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

export function StatTile({ label, value, hint, color, icon }: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={color ? { backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color } : undefined}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          {/* Proportional figures — this is a display number, not a column */}
          <p className="text-xl font-semibold text-gray-900 truncate">{value}</p>
          {hint && <p className="text-[11px] text-gray-400 truncate mt-0.5">{hint}</p>}
        </div>
      </div>
    </Card>
  );
}

// ── Table twin ────────────────────────────────────────────────────────────────
// Every chart ships with the same numbers in a table: the accessible equivalent,
// and the relief the palette's low-contrast light slots require.

function TableTwin({ firstHeader, rows, series, format, countLabel, showShare = true }: {
  firstHeader: string;
  rows: VizRow[];
  series: VizSeries[];
  format: (n: number) => string;
  countLabel?: string;
  showShare?: boolean;
}) {
  const totals = series.map((_, si) => rows.reduce((s, r) => s + (r.values[si] || 0), 0));
  const totalCount = rows.reduce((s, r) => s + (r.count || 0), 0);
  return (
    <div className="overflow-x-auto -mx-5 mt-5 border-t border-gray-100">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-500">
            <th className="text-left px-5 py-2 font-medium">{firstHeader}</th>
            {countLabel && <th className="text-right px-3 py-2 font-medium">{countLabel}</th>}
            {series.map(s => (
              <th key={s.name} className="text-right px-3 py-2 font-medium whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
              </th>
            ))}
            {showShare && <th className="text-right px-5 py-2 font-medium">Share</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-5 py-2 text-gray-700 font-medium">{r.label}</td>
              {countLabel && <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.count ?? ''}</td>}
              {series.map((s, si) => (
                <td key={s.name} className="px-3 py-2 text-right tabular-nums text-gray-900">{format(r.values[si] || 0)}</td>
              ))}
              {showShare && (
                <td className="px-5 py-2 text-right tabular-nums text-gray-400">
                  {totals[0] > 0 ? `${Math.round(((r.values[0] || 0) / totals[0]) * 100)}%` : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
            <td className="px-5 py-2 text-gray-700">Total</td>
            {countLabel && <td className="px-3 py-2 text-right tabular-nums text-gray-600">{totalCount || ''}</td>}
            {/* Each column totals on its own — orders and invoices are never added together */}
            {totals.map((t, i) => (
              <td key={i} className="px-3 py-2 text-right tabular-nums text-gray-900">{format(t)}</td>
            ))}
            {showShare && <td className="px-5 py-2" />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Period panel (column chart + table) ───────────────────────────────────────

export function PeriodPanel({ title, icon, subtitle, periodHeader, categories, series, format, formatAxis, onExport, right }: {
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  periodHeader: string;
  categories: string[];
  series: (VizSeries & { values: number[] })[];
  format: (n: number) => string;
  formatAxis: (n: number) => string;
  onExport?: () => void;
  right?: ReactNode;
}) {
  const rows: VizRow[] = categories.map((c, i) => ({
    key: `${c}-${i}`, label: c, values: series.map(s => s.values[i] || 0),
  }));
  return (
    <PanelCard title={title} icon={icon} subtitle={subtitle} onExport={onExport} right={right}>
      <ColumnChart categories={categories} series={series} format={format} formatAxis={formatAxis} />
      <TableTwin firstHeader={periodHeader} rows={rows} series={series} format={format} showShare={false} />
    </PanelCard>
  );
}

// ── Breakdown panel (ranked bars or donut + table) ────────────────────────────

export function BreakdownPanel({ title, icon, subtitle, dimensionHeader, rows, series, format, chart = 'bars', countLabel, onExport, right }: {
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  dimensionHeader: string;
  rows: VizRow[];
  series: VizSeries[];
  format: (n: number) => string;
  chart?: 'bars' | 'donut';
  countLabel?: string;
  onExport?: () => void;
  right?: ReactNode;
}) {
  const sorted = [...rows].sort((a, b) => (b.values[0] || 0) - (a.values[0] || 0));
  return (
    <PanelCard title={title} icon={icon} subtitle={subtitle} onExport={onExport} right={right}>
      {chart === 'donut' && series.length === 1 ? (
        <DonutChart
          slices={sorted.map((r, i) => ({ key: r.key, label: r.label, value: r.values[0] || 0, color: slotFrom(series[0].color, i) }))}
          format={format}
        />
      ) : (
        <RankedBars rows={sorted} series={series} format={format} />
      )}
      {sorted.length > 0 && (
        <TableTwin firstHeader={dimensionHeader} rows={sorted} series={series} format={format} countLabel={countLabel} />
      )}
    </PanelCard>
  );
}

// A donut needs a distinct hue per slice; ranked bars keep one. Slots are walked
// in fixed order from the panel's accent — a 9th hue is never generated, the
// tail folds into a neutral "Other" inside DonutChart.
function slotFrom(accent: string, i: number): string {
  const start = Math.max(0, VIZ.indexOf(accent as typeof VIZ[number]));
  return VIZ[(start + i) % VIZ.length];
}
