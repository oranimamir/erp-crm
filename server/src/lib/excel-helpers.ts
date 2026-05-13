import ExcelJS from 'exceljs';

export function cellText(v: any): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink ?? '');
  }
  return String(v);
}

export function cellNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'object' && 'result' in v && typeof v.result === 'number') return v.result;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.,\-]/g, '').replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }
  return null;
}

export function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/[:：\s]+$/, '');
}

export const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export function derivePeriodMonth(raw: any): string | null {
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  const s = cellText(raw).toLowerCase();
  if (!s) return null;
  let m = s.match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/(\d{4})(\d{2})/);
  if (m) {
    const mm = parseInt(m[2], 10);
    if (mm >= 1 && mm <= 12) return `${m[1]}-${m[2]}`;
  }
  m = s.match(/([a-z]{3,9})[\s\-/]*\d{0,2}[\s\-/]*(\d{4})/);
  if (m) {
    const monKey = m[1].slice(0, 3);
    if (MONTHS[monKey]) return `${m[2]}-${String(MONTHS[monKey]).padStart(2, '0')}`;
  }
  return null;
}
