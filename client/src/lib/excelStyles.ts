// Shared style constants for ExcelJS report generation
// All reports use these to maintain consistent formatting

import type { Fill, Font, Border, Alignment } from 'exceljs';

// ── Colors ───────────────────────────────────────────────────────────────────

const DARK = '1F2937';
const WHITE = 'FFFFFF';
const LIGHT_GRAY = 'F3F4F6';
const MED_GRAY = '9CA3AF';
const PRIMARY = '4F46E5';

// ── Borders ──────────────────────────────────────────────────────────────────

const THIN_BORDER: Partial<Border> = { style: 'thin', color: { argb: 'D1D5DB' } };

export const BORDERS_ALL = {
  top: THIN_BORDER, bottom: THIN_BORDER,
  left: THIN_BORDER, right: THIN_BORDER,
};

// ── Header Row (dark background, white text) ─────────────────────────────────

export const HEADER_FILL: Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: DARK },
};

export const HEADER_FONT: Partial<Font> = {
  bold: true, size: 11, color: { argb: WHITE },
};

export const HEADER_ALIGNMENT: Partial<Alignment> = {
  vertical: 'middle', horizontal: 'center', wrapText: true,
};

// ── Total Row (light gray background, bold) ──────────────────────────────────

export const TOTAL_FILL: Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY },
};

export const TOTAL_FONT: Partial<Font> = {
  bold: true, size: 11,
};

// ── Summary Tab — Title ──────────────────────────────────────────────────────

export const TITLE_FONT: Partial<Font> = {
  bold: true, size: 16, color: { argb: DARK },
};

export const SUBTITLE_FONT: Partial<Font> = {
  italic: true, size: 11, color: { argb: MED_GRAY },
};

// ── Summary Tab — Section Header ─────────────────────────────────────────────

export const SECTION_HEADER_FONT: Partial<Font> = {
  bold: true, size: 12, color: { argb: PRIMARY },
};

export const SECTION_HEADER_FILL: Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' },
};

// ── Number Formats ───────────────────────────────────────────────────────────

export const CURRENCY_FMT = '€#,##0.00';
export const CURRENCY_FMT_USD = '$#,##0.00';
export const CURRENCY_FMT_GBP = '£#,##0.00';
export const NUMBER_FMT = '#,##0.00';
export const TONS_FMT = '#,##0.00';
export const DATE_FMT = 'DD/MM/YYYY';
export const PERCENT_FMT = '0.0%';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function currencyFmt(currency?: string): string {
  if (currency === 'GBP') return CURRENCY_FMT_GBP;
  if (currency === 'USD') return CURRENCY_FMT_USD;
  return CURRENCY_FMT;
}
