import type ExcelJS from 'exceljs';
import type { ReportConfig, SheetData, SheetMeasure } from '../excelReportBuilder';
import {
  TITLE_FONT, SUBTITLE_FONT,
  SECTION_HEADER_FONT, SECTION_HEADER_FILL,
  HEADER_FILL, HEADER_FONT, HEADER_ALIGNMENT,
  TOTAL_FILL, TOTAL_FONT, BORDERS_ALL,
  CURRENCY_FMT, TONS_FMT,
} from '../excelStyles';

// ── Measures ─────────────────────────────────────────────────────────────────
// Sheets are totalled *within* their measure and never across measures. An order
// becomes an invoice once billed, so adding orders to invoiced revenue counts the
// same sale twice; expenses are the other side of the ledger entirely. Every
// section below therefore gives each measure its own column.

const MEASURE_ORDER: SheetMeasure[] = ['revenue', 'orders', 'expenses'];

const MEASURE_LABEL: Record<SheetMeasure, { amount: string; tonnage: string }> = {
  revenue:  { amount: 'Invoiced revenue (EUR)', tonnage: 'Invoiced tonnage (MT)' },
  orders:   { amount: 'Orders placed (EUR)',    tonnage: 'Ordered tonnage (MT)' },
  expenses: { amount: 'Expenses (EUR)',         tonnage: 'Expensed tonnage (MT)' },
};

function measureOf(sheet: SheetData): SheetMeasure {
  return sheet.measure || 'revenue';
}

// ── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTER_MONTHS: Record<number, string> = {
  1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec',
};

function parseDate(value: any): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

// ── Build Summary Sheet ──────────────────────────────────────────────────────

export function buildSummarySheet(wb: ExcelJS.Workbook, config: ReportConfig): void {
  const ws = wb.addWorksheet('Summary');

  ws.getColumn(1).width = 4;   // spacer
  ws.getColumn(2).width = 30;  // labels
  for (let c = 3; c <= 12; c++) ws.getColumn(c).width = 22;

  let row = 1;

  // ── Title & Subtitle ────────────────────────────────────────────────────

  ws.mergeCells(row, 2, row, 6);
  const titleCell = ws.getCell(row, 2);
  titleCell.value = config.title || 'Report Summary';
  titleCell.font = TITLE_FONT;
  row++;

  if (config.subtitle) {
    ws.mergeCells(row, 2, row, 6);
    const subCell = ws.getCell(row, 2);
    subCell.value = config.subtitle;
    subCell.font = SUBTITLE_FONT;
  }
  row += 2;

  // ── Per-sheet totals, tagged with their measure ──────────────────────────

  interface SheetTotals { label: string; measure: SheetMeasure; revenue: number; tonnage: number; hasRevenue: boolean; hasTonnage: boolean; }
  const sheetTotals: SheetTotals[] = config.sheets.map(sheet => {
    let revenue = 0;
    let tonnage = 0;
    for (const r of sheet.rows) {
      if (sheet.revenueField) revenue += Number(r[sheet.revenueField]) || 0;
      if (sheet.tonnageField) tonnage += Number(r[sheet.tonnageField]) || 0;
    }
    return {
      label: sheet.sourceLabel || sheet.name,
      measure: measureOf(sheet),
      revenue, tonnage,
      hasRevenue: !!sheet.revenueField,
      hasTonnage: !!sheet.tonnageField,
    };
  });

  const measuresPresent = MEASURE_ORDER.filter(m => sheetTotals.some(t => t.measure === m));
  const measureTotal = (m: SheetMeasure, field: 'revenue' | 'tonnage') =>
    sheetTotals.filter(t => t.measure === m).reduce((s, t) => s + t[field], 0);

  // The column set shared by every breakdown below: one per measure × metric.
  interface MetricCol { label: string; measure: SheetMeasure; field: 'revenue' | 'tonnage'; numFmt: string; }
  const metricCols: MetricCol[] = [];
  for (const m of measuresPresent) {
    if (sheetTotals.some(t => t.measure === m && t.hasRevenue)) {
      metricCols.push({ label: MEASURE_LABEL[m].amount, measure: m, field: 'revenue', numFmt: CURRENCY_FMT });
    }
    if (sheetTotals.some(t => t.measure === m && t.hasTonnage)) {
      metricCols.push({ label: MEASURE_LABEL[m].tonnage, measure: m, field: 'tonnage', numFmt: TONS_FMT });
    }
  }

  // ── Shared writers ───────────────────────────────────────────────────────

  const writeSectionHeader = (label: string) => {
    ws.mergeCells(row, 2, row, Math.max(6, 2 + metricCols.length));
    const cell = ws.getCell(row, 2);
    cell.value = label;
    cell.font = SECTION_HEADER_FONT;
    cell.fill = SECTION_HEADER_FILL;
    row++;
  };

  const writeHeaderRow = (headers: string[]) => {
    const r = ws.getRow(row);
    for (let c = 0; c < headers.length; c++) {
      const cell = ws.getCell(row, c + 2);
      cell.value = headers[c];
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { ...HEADER_ALIGNMENT, wrapText: true };
      cell.border = BORDERS_ALL;
    }
    r.height = 32;
    row++;
  };

  /**
   * A breakdown block: one row per entity, one column per measure × metric.
   * `keyOf` returns the grouping key for a row, or null to skip it.
   */
  const writeBlock = (
    title: string,
    firstHeader: string,
    keyOf: (sheet: SheetData, dataRow: Record<string, any>) => { key: string; label: string } | null,
    sortBy: 'key' | 'value',
  ): boolean => {
    interface Bucket { label: string; values: Map<string, number>; }
    const buckets = new Map<string, Bucket>();
    // Only the measures that actually contributed rows get a column, so a block's
    // column total always equals the rows printed above it.
    const contributed = new Set<string>();

    for (const sheet of config.sheets) {
      const measure = measureOf(sheet);
      for (const dataRow of sheet.rows) {
        const k = keyOf(sheet, dataRow);
        if (!k) continue;
        const bucket = buckets.get(k.key) ?? { label: k.label, values: new Map() };
        if (sheet.revenueField) {
          const key = `${measure}:revenue`;
          contributed.add(key);
          bucket.values.set(key, (bucket.values.get(key) || 0) + (Number(dataRow[sheet.revenueField]) || 0));
        }
        if (sheet.tonnageField) {
          const key = `${measure}:tonnage`;
          contributed.add(key);
          bucket.values.set(key, (bucket.values.get(key) || 0) + (Number(dataRow[sheet.tonnageField]) || 0));
        }
        buckets.set(k.key, bucket);
      }
    }

    if (buckets.size === 0) return false;

    const cols = metricCols.filter(c => contributed.has(`${c.measure}:${c.field}`));
    if (cols.length === 0) return false;

    const entries = [...buckets.entries()];
    if (sortBy === 'key') {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    } else {
      const first = cols[0];
      const val = (b: Bucket) => b.values.get(`${first.measure}:${first.field}`) || 0;
      entries.sort((a, b) => val(b[1]) - val(a[1]));
    }

    writeSectionHeader(title);
    writeHeaderRow([firstHeader, ...cols.map(c => c.label)]);

    for (const [, bucket] of entries) {
      ws.getCell(row, 2).value = bucket.label;
      ws.getCell(row, 2).border = BORDERS_ALL;
      cols.forEach((col, i) => {
        const cell = ws.getCell(row, 3 + i);
        cell.value = bucket.values.get(`${col.measure}:${col.field}`) || 0;
        cell.numFmt = col.numFmt;
        cell.border = BORDERS_ALL;
        cell.alignment = { horizontal: 'right' };
      });
      row++;
    }

    // Totals stay inside their own column — never across measures.
    ws.getCell(row, 2).value = 'TOTAL';
    ws.getCell(row, 2).font = TOTAL_FONT;
    ws.getCell(row, 2).fill = TOTAL_FILL;
    ws.getCell(row, 2).border = BORDERS_ALL;
    cols.forEach((col, i) => {
      const cell = ws.getCell(row, 3 + i);
      const key = `${col.measure}:${col.field}`;
      cell.value = entries.reduce((s, [, b]) => s + (b.values.get(key) || 0), 0);
      cell.numFmt = col.numFmt;
      cell.font = TOTAL_FONT;
      cell.fill = TOTAL_FILL;
      cell.border = BORDERS_ALL;
      cell.alignment = { horizontal: 'right' };
    });
    row += 3;
    return true;
  };

  // ── 1. Totals by measure (per source sheet) ──────────────────────────────

  writeSectionHeader('TOTALS BY MEASURE');
  writeHeaderRow(['', ...sheetTotals.map(t => t.label), 'MEASURE TOTAL']);

  const writeMeasureRow = (
    label: string,
    measure: SheetMeasure,
    field: 'revenue' | 'tonnage',
    numFmt: string,
    has: (t: SheetTotals) => boolean,
  ) => {
    const r = ws.getRow(row);
    ws.getCell(row, 2).value = label;
    ws.getCell(row, 2).font = { bold: true };
    ws.getCell(row, 2).border = BORDERS_ALL;
    for (let i = 0; i < sheetTotals.length; i++) {
      const cell = ws.getCell(row, 3 + i);
      const t = sheetTotals[i];
      cell.value = t.measure === measure && has(t) ? t[field] : null;
      cell.numFmt = numFmt;
      cell.border = BORDERS_ALL;
      cell.alignment = { horizontal: 'right' };
    }
    const totalCell = ws.getCell(row, 3 + sheetTotals.length);
    totalCell.value = measureTotal(measure, field);
    totalCell.numFmt = numFmt;
    totalCell.font = TOTAL_FONT;
    totalCell.fill = TOTAL_FILL;
    totalCell.border = BORDERS_ALL;
    totalCell.alignment = { horizontal: 'right' };
    r.height = 22;
    row++;
  };

  for (const m of measuresPresent) {
    if (sheetTotals.some(t => t.measure === m && t.hasRevenue)) {
      writeMeasureRow(MEASURE_LABEL[m].amount, m, 'revenue', CURRENCY_FMT, t => t.hasRevenue);
    }
    if (sheetTotals.some(t => t.measure === m && t.hasTonnage)) {
      writeMeasureRow(MEASURE_LABEL[m].tonnage, m, 'tonnage', TONS_FMT, t => t.hasTonnage);
    }
  }

  if (measuresPresent.includes('revenue') && measuresPresent.includes('expenses')) {
    const net = measureTotal('revenue', 'revenue') - measureTotal('expenses', 'revenue');
    ws.getCell(row, 2).value = 'Net (revenue − expenses)';
    ws.getCell(row, 2).font = { bold: true };
    ws.getCell(row, 2).border = BORDERS_ALL;
    for (let i = 0; i < sheetTotals.length; i++) ws.getCell(row, 3 + i).border = BORDERS_ALL;
    const netCell = ws.getCell(row, 3 + sheetTotals.length);
    netCell.value = net;
    netCell.numFmt = CURRENCY_FMT;
    netCell.font = TOTAL_FONT;
    netCell.fill = TOTAL_FILL;
    netCell.border = BORDERS_ALL;
    netCell.alignment = { horizontal: 'right' };
    row++;
  }

  if (measuresPresent.length > 1) {
    ws.mergeCells(row, 2, row, Math.max(6, 3 + sheetTotals.length));
    const note = ws.getCell(row, 2);
    note.value = measuresPresent.includes('orders')
      ? 'There is no single grand total on purpose: an order becomes an invoice once billed, so adding the columns would count the same sale twice. Each measure totals on its own.'
      : 'Each measure totals on its own — the columns are never added together.';
    note.font = SUBTITLE_FONT;
    note.alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(row).height = 26;
    row++;
  }

  row += 2;

  // ── 2. Monthly ───────────────────────────────────────────────────────────

  writeBlock('MONTHLY BREAKDOWN', 'Month', (sheet, dataRow) => {
    if (!sheet.dateField) return null;
    const d = parseDate(dataRow[sheet.dateField]);
    if (!d) return null;
    const y = d.getFullYear();
    const m = d.getMonth();
    return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[m]} ${y}` };
  }, 'key');

  // ── 3. Quarterly ─────────────────────────────────────────────────────────

  writeBlock('QUARTERLY BREAKDOWN', 'Quarter', (sheet, dataRow) => {
    if (!sheet.dateField) return null;
    const d = parseDate(dataRow[sheet.dateField]);
    if (!d) return null;
    const y = d.getFullYear();
    const q = Math.ceil((d.getMonth() + 1) / 3);
    return { key: `${y}-${q}`, label: `Q${q} ${y} (${QUARTER_MONTHS[q]})` };
  }, 'key');

  // ── 4. By customer ───────────────────────────────────────────────────────

  writeBlock('BY CUSTOMER', 'Customer', (sheet, dataRow) => {
    if (!sheet.customerField) return null;
    const name = String(dataRow[sheet.customerField] ?? '').trim() || 'Unknown';
    return { key: name.toLowerCase(), label: name };
  }, 'value');

  // ── 5. By region ─────────────────────────────────────────────────────────

  writeBlock('BY REGION', 'Region', (sheet, dataRow) => {
    if (!sheet.regionField) return null;
    const name = String(dataRow[sheet.regionField] ?? '').trim() || 'Unknown';
    return { key: name.toLowerCase(), label: name };
  }, 'value');
}
