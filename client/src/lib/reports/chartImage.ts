// Renders a small, on-brand bar chart to a PNG for embedding in an Excel
// worksheet. ExcelJS (the library this project's exports run on) has no
// native chart-object API — only `addImage` — so a canvas-rendered bitmap is
// the only way to put "a graph" inside a worksheet tab.
//
// Colors are the same validated categorical palette as the on-screen charts
// (see client/src/components/charts/viz.ts / index.css --viz-*), just as
// literal hex — canvas fills can't resolve CSS custom properties.

export const CHART_HEX = {
  blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100',
  magenta: '#e87ba4', green: '#008300', violet: '#4a3aa7', red: '#e34948',
};

const INK = '#52514e';
const INK_STRONG = '#0b0b0b';
const GRID = '#e5e7eb';
const AXIS = '#c3c2b7';
const SURFACE = '#ffffff';

export interface ChartSeriesInput {
  label: string;
  color: string;
  values: number[];
}

export interface ChartImage {
  base64: string;
  width: number;
  height: number;
}

function niceMax(value: number): number {
  if (!isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5
    : norm <= 5 ? 5 : 10;
  return step * base;
}

function roundedTopRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/**
 * Grouped/single-series column chart. `categories` is the x-axis (typically
 * months); each series contributes one bar per category, in its own color.
 */
export function renderBarChartPng(
  categories: string[],
  series: ChartSeriesInput[],
  opts: { title?: string; valueFormatter?: (n: number) => string; width?: number; height?: number } = {},
): ChartImage | null {
  if (categories.length === 0 || series.length === 0) return null;

  const width = opts.width ?? 640;
  const height = opts.height ?? 300;
  const pad = { top: series.length > 1 ? 30 : 14, right: 16, bottom: 30, left: 60 };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, width, height);

  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxRaw = Math.max(0, ...series.flatMap(s => s.values));
  const top = niceMax(maxRaw || 1);
  const fmt = opts.valueFormatter || ((n: number) => String(Math.round(n)));

  // Gridlines + axis labels
  ctx.font = '11px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const y = pad.top + plotH - frac * plotH;
    ctx.strokeStyle = i === 0 ? AXIS : GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(fmt(top * frac), pad.left - 8, y);
  }

  // Bars
  const n = categories.length;
  const groupW = plotW / n;
  const seriesCount = series.length;
  const gap = 2;
  const barW = Math.max(2, Math.min(22, (groupW * 0.72 - gap * (seriesCount - 1)) / seriesCount));
  const groupContentW = barW * seriesCount + gap * (seriesCount - 1);

  categories.forEach((cat, ci) => {
    const groupX = pad.left + ci * groupW + (groupW - groupContentW) / 2;
    series.forEach((s, si) => {
      const v = s.values[ci] || 0;
      if (v <= 0) return;
      const h = Math.max(1, (v / top) * plotH);
      const x = groupX + si * (barW + gap);
      const y = pad.top + plotH - h;
      ctx.fillStyle = s.color;
      roundedTopRect(ctx, x, y, barW, h, 3);
      ctx.fill();
    });
    ctx.fillStyle = INK;
    ctx.font = '10px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(cat, pad.left + ci * groupW + groupW / 2, pad.top + plotH + 6);
  });

  // Legend — only meaningful with more than one series; a single series is
  // already named by the sheet/chart title.
  if (series.length > 1) {
    let lx = pad.left;
    const ly = 12;
    ctx.font = '11px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly - 5, 10, 10);
      ctx.fillStyle = INK_STRONG;
      ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 14, ly);
      lx += 14 + ctx.measureText(s.label).width + 18;
    }
  }

  if (opts.title) {
    ctx.fillStyle = INK_STRONG;
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.title, width - pad.right, 14);
  }

  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.split(',')[1], width, height };
}

/** Compact axis formatter for EUR values (matches the on-screen dashboard's). */
export function chartEurAxis(n: number): string {
  if (!n) return '0';
  if (Math.abs(n) >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `€${Math.round(n / 1_000)}k`;
  return `€${Math.round(n)}`;
}

/** Compact axis formatter for tonnage values. */
export function chartTonsAxis(n: number): string {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bucket rows into calendar months by a date field, summing a value field. */
export function monthlyTotals(rows: Record<string, any>[], dateField: string, valueField: string): { categories: string[]; values: number[] } {
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const raw = r[dateField];
    if (!raw) continue;
    const d = raw instanceof Date ? raw : new Date(String(raw));
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + (Number(r[valueField]) || 0));
  }
  const keys = [...buckets.keys()].sort();
  return {
    categories: keys.map(k => {
      const [y, m] = k.split('-');
      return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}`;
    }),
    values: keys.map(k => buckets.get(k) || 0),
  };
}
