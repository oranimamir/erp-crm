// Shared data-viz tokens.
//
// The eight categorical slots are validated (CVD separation, lightness band,
// chroma floor) against both chart surfaces — see the `--viz-*` block in
// index.css. Rules that keep them valid:
//   • assign slots in fixed order; never generate a 9th hue (fold into "Other")
//   • one chart, one hue, when the job is magnitude (ranked bars) — a value ramp
//     on nominal categories double-encodes bar length and is not used here
//   • colour follows the entity, not its rank, wherever a stable key exists
//   • every chart is paired with its table twin, which is what makes the three
//     low-contrast light slots legal

export const VIZ = [
  'var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)',
  'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)',
] as const;

export const VIZ_MUTED = 'var(--viz-muted)';
export const VIZ_TRACK = 'var(--viz-track)';
export const VIZ_SURFACE = 'var(--viz-surface)';

/** Fixed slot for a known-ahead-of-time category, so filtering never repaints. */
export function slotFor(index: number): string {
  return VIZ[index % VIZ.length];
}

/** Round a max up to a clean axis top (1 / 2 / 2.5 / 5 × 10ⁿ). */
export function niceMax(value: number): number {
  if (!isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5
    : norm <= 3 ? 3 : norm <= 4 ? 4 : norm <= 5 ? 5 : norm <= 8 ? 8 : 10;
  return step * base;
}

/** Five evenly spaced ticks, top → 0. */
export function axisTicks(max: number): number[] {
  return [1, 0.75, 0.5, 0.25, 0].map(f => max * f);
}
