const cache = new Map<string, number>();
const latestCache = new Map<string, { rate: number; fetchedAt: number }>();
const LATEST_TTL_MS = 60 * 60 * 1000; // 1 hour
// An upload waits on this call, so a hung FX service must not hang the request
const FETCH_TIMEOUT_MS = 8000;

async function fetchRate(url: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as { rates: { EUR: number } };
  const rate = data?.rates?.EUR;
  if (typeof rate !== 'number' || !(rate > 0)) throw new Error('No EUR rate in response');
  return rate;
}

/** Any rate already seen for this currency — far closer than 1.0 when the service is down */
function lastKnownRate(currency: string): number | undefined {
  const latest = latestCache.get(currency);
  if (latest) return latest.rate;
  let found: number | undefined;
  for (const [key, rate] of cache) if (key.startsWith(`${currency}-`)) found = rate;
  return found;
}

/**
 * Fetch EUR exchange rate for a given currency on a given date.
 * Uses the Frankfurter API (https://api.frankfurter.app).
 *
 * Pass date = 'latest' to get the most recent available rate (cached 1 h).
 * Historical dates are cached for the lifetime of the process.
 *
 * @param currency - ISO 4217 code (e.g. "USD", "GBP")
 * @param date     - YYYY-MM-DD or 'latest'
 * @returns EUR rate (e.g. 0.92 means 1 USD = 0.92 EUR)
 */
export async function getEurRate(currency: string, date: string): Promise<number> {
  currency = String(currency || '').trim().toUpperCase();
  if (currency === 'EUR') return 1.0;
  if (!/^[A-Z]{3}$/.test(currency)) {
    console.warn(`FX rate requested for invalid currency "${currency}"`);
    return 1.0;
  }

  if (date !== 'latest' && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    // Anything that isn't a plain date (e.g. a full timestamp) is trimmed to one, else latest
    const d = String(date || '').slice(0, 10);
    date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : 'latest';
  }

  if (date === 'latest') {
    const cached = latestCache.get(currency);
    if (cached && Date.now() - cached.fetchedAt < LATEST_TTL_MS) return cached.rate;
    try {
      const rate = await fetchRate(`https://api.frankfurter.app/latest?from=${currency}&to=EUR`);
      latestCache.set(currency, { rate, fetchedAt: Date.now() });
      return rate;
    } catch (err) {
      console.warn(`FX rate fetch failed for ${currency} latest:`, err);
      return lastKnownRate(currency) ?? 1.0;
    }
  }

  const key = `${currency}-${date}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const rate = await fetchRate(`https://api.frankfurter.app/${date}?from=${currency}&to=EUR`);
    cache.set(key, rate);
    return rate;
  } catch (err) {
    console.warn(`FX rate fetch failed for ${currency} on ${date}:`, err);
    return lastKnownRate(currency) ?? 1.0;
  }
}
