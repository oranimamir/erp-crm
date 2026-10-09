/**
 * Today's date (YYYY-MM-DD) where the business is — the server runs in UTC, so
 * `toISOString()` still gives yesterday until 01:00 / 02:00 in Brussels.
 */
export function todayISO(timeZone = 'Europe/Brussels'): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
