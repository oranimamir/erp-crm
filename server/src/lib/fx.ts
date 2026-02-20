const cache = new Map<string, number>();

/**
 * Fetch EUR exchange rate for a given currency on a given date.
 * Uses the Frankfurter API (https://api.frankfurter.app).
 * Results are cached in-memory for the lifetime of the process.
 *
 * @param currency - ISO 4217 code (e.g. "USD", "GBP")
 * @param date     - YYYY-MM-DD
 * @returns EUR rate (e.g. 0.92 means 1 USD = 0.92 EUR)
 */
export async function getEurRate(currency: string, date: string): Promise<number> {
  if (currency === 'EUR') return 1.0;

  const key = `${currency}-${date}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const url = `https://api.frankfurter.app/${date}?from=${currency}&to=EUR`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { rates: { EUR: number } };
    const rate = data.rates.EUR;
    cache.set(key, rate);
    return rate;
  } catch (err) {
    console.warn(`FX rate fetch failed for ${currency} on ${date}:`, err);
    return 1.0;
  }
}
