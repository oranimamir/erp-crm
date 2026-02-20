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
