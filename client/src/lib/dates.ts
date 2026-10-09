/**
 * Format a date string as DD/MM/YYYY (EU format).
 * Handles YYYY-MM-DD and ISO datetime strings.
 * Returns '' if the input is falsy.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return '';
}

/**
 * Return a YYYY-MM-DD string suitable for <input type="date">.
 * Returns '' if the input is falsy.
 */
export function toInputDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return '';
}

/**
 * Today as YYYY-MM-DD in the user's own time zone. `toISOString()` is UTC, so
 * in Belgium it still says yesterday until 01:00 / 02:00 at night.
 */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
