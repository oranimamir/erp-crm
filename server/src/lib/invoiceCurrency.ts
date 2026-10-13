/**
 * Invoice currency guard. Supplier invoices from China are nearly always in USD,
 * but readers kept filing them in EUR (the regex reader's default, a reading
 * with no currency, "USD" glued to the figures in the PDF text). Used on upload
 * (routes/demo-expenses.ts readPdfInvoice), in the free text check and in the
 * full check report.
 */

const CN_PLACES = [
  'china', 'prc', 'beijing', 'shanghai', 'tianjin', 'chongqing', 'guangzhou', 'shenzhen', 'hangzhou', 'ningbo',
  'qingdao', 'xiamen', 'suzhou', 'wuxi', 'nanjing', 'wuhan', 'chengdu', 'zhengzhou', 'jinan', 'dalian', 'shenyang',
  'henan', 'hebei', 'hubei', 'hunan', 'jiangsu', 'jiangxi', 'zhejiang', 'shandong', 'shanxi', 'shaanxi', 'anhui',
  'fujian', 'guangdong', 'guangxi', 'sichuan', 'yunnan', 'guizhou', 'liaoning', 'jilin', 'heilongjiang', 'hainan',
  'inner mongolia', 'xinjiang', 'ningxia', 'gansu', 'qinghai', 'lianyungang', 'zibo', 'weifang', 'changzhou',
  'nantong', 'taizhou', 'yantai', 'shijiazhuang', 'hefei', 'fuzhou', 'puyang', 'zhangjiagang',
];
const CN_NAME = new RegExp(`(^|[^a-z])(${CN_PLACES.join('|')})(?![a-z])`, 'i');
const CJK = /[一-鿿]/;

/** Which currencies the text shows. Codes glued to figures ("kgUSD0.98", "AMOUNT:USD20652") count. */
export function currencyMentions(text: string): { USD: boolean; EUR: boolean; GBP: boolean } {
  const t = (text || '').toLowerCase();
  return {
    USD: /usd|us\$|u\.s\.\s?dollars?|us dollars?|\$/.test(t),
    // "euro" alone also matches "europe" (addresses), so only the code, the sign or "euro(s)" as a word
    EUR: /€|eur(?![a-z])|(?<![a-z])euros?(?![a-z])/.test(t),
    GBP: /gbp|£/.test(t),
  };
}

/** A Chinese supplier: by country, its name (a Chinese province / city), or Chinese script in the invoice. */
export function isChineseSupplier(o: { country?: string | null; vat?: string | null; name?: string | null; text?: string | null }): boolean {
  if ((o.country || '').toUpperCase() === 'CN') return true;
  if (/^CN/i.test((o.vat || '').trim())) return true;
  if (o.name && CN_NAME.test(o.name)) return true;
  // Chinese characters on the invoice = a Chinese letterhead (TripleW's own documents never have them)
  return !!o.text && CJK.test(o.text);
}

export interface CurrencyDecision { currency: string; note: string | null }

/**
 * The currency to store. `read` = what the reader found (null = nothing),
 * `text` = the PDF's text layer (blank for a scan), `chinese` = isChineseSupplier.
 * Notes (upload warnings / check reasons):
 *   currency_from_text   the text shows only USD/GBP but the reading said EUR / nothing
 *   currency_china_usd   Chinese supplier, no EUR shown → USD
 *   currency_china_eur   Chinese supplier read as EUR from a scan: kept, but check it
 */
export function decideCurrency(read: string | null | undefined, text: string | null | undefined, chinese: boolean): CurrencyDecision {
  const cur = (read || '').toUpperCase() || null;
  const usable = !!text && text.replace(/\s+/g, '').length >= 80;
  const m = usable ? currencyMentions(text!) : { USD: false, EUR: false, GBP: false };
  if (cur === null || cur === 'EUR') {
    if (usable && !m.EUR && m.USD && !m.GBP) return { currency: 'USD', note: 'currency_from_text' };
    if (usable && !m.EUR && m.GBP && !m.USD) return { currency: 'GBP', note: 'currency_from_text' };
  }
  if (chinese && (cur === null || cur === 'EUR')) {
    if (usable && m.EUR && !m.USD) return { currency: 'EUR', note: null };   // really in euro
    if (cur === 'EUR' && !usable) return { currency: 'EUR', note: 'currency_china_eur' };
    return { currency: 'USD', note: 'currency_china_usd' };
  }
  return { currency: cur || 'EUR', note: null };
}
