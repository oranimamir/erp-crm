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
// same sale twice; expenses are a different sign entirely.

const MEASURE_ORDER: SheetMeasure[] = ['revenue', 'orders', 'expenses'];

const MEASURE_LABEL: Record<SheetMeasure, { amount: string; tonnage: string }> = {
  revenue:  { amount: 'Invoiced revenue (EUR)', tonnage: 'Invoiced tonnage (MT)' },
  orders:   { amount: 'Orders placed (EUR)',    tonnage: 'Ordered tonnage (MT)' },
  expenses: { amount: 'Expenses (EUR)',         tonnage: 'Expensed tonnage (MT)' },
};

function measureOf(sheet: SheetData): SheetMeasure {
  return sheet.measure || 'revenue';
}

// ── Quarter helpers ──────────────────────────────────────────────────────────

const QUARTER_MONTHS: Record<number, string> = {
  1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec',
};

function dateToQuarter(dateStr: string): { q: number; year: number; label: string } | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();
  const q = Math.ceil(month / 3);
  return { q, year, label: `Q${q} ${year}\n(${QUARTER_MONTHS[q]})` };
}

function quarterSortKey(q: number, year: number): string {
  return `${year}-${q}`;
}

// ── Build Summary Sheet ──────────────────────────────────────────────────────

export function buildSummarySheet(wb: ExcelJS.Workbook, config: ReportConfig): void {
  const ws = wb.addWorksheet('Summary');

  ws.getColumn(1).width = 4;   // spacer
  ws.getColumn(2).width = 26;  // labels
  for (let c = 3; c <= 9; c++) ws.getColumn(c).width = 20;

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

  // ── Overall Totals ───────────────────────────────────────────────────────

  ws.mergeCells(row, 2, row, 6);
  const secCell = ws.getCell(row, 2);
  secCell.value = 'TOTALS BY MEASURE';
  secCell.font = SECTION_HEADER_FONT;
  secCell.fill = SECTION_HEADER_FILL;
  row++;

  const headers = ['', ...sheetTotals.map(t => t.label), 'MEASURE TOTAL'];
  const hdrRow = ws.getRow(row);
  for (let c = 0; c < headers.length; c++) {
    const cell = ws.getCell(row, c + 2);
    cell.value = headers[c];
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = HEADER_ALIGNMENT;
    cell.border = BORDERS_ALL;
  }
  hdrRow.height = 28;
  row++;

  // One row per measure × metric. A cell is only filled for sheets belonging to
  // that measure, and the final column totals that measure alone.
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

  // Net only makes sense when both sides are in the workbook.
  if (measuresPresent.includes('revenue') && measuresPresent.includes('expenses')) {
    const net = measureTotal('revenue', 'revenue') - measureTotal('expenses', 'revenue');
    ws.getCell(row, 2).value = 'Net (revenue − expenses)';
    ws.getCell(row, 2).font = { bold: true };
    ws.getCell(row, 2).border = BORDERS_ALL;
    for (let i = 0; i < sheetTotals.length; i++) {
      const cell = ws.getCell(row, 3 + i);
      cell.border = BORDERS_ALL;
    }
    const netCell = ws.getCell(row, 3 + sheetTotals.length);
    netCell.value = net;
    netCell.numFmt = CURRENCY_FMT;
    netCell.font = TOTAL_FONT;
    netCell.fill = TOTAL_FILL;
    netCell.border = BORDERS_ALL;
    netCell.alignment = { horizontal: 'right' };
    row++;
  }

  // The reason there is no single grand total.
  if (measuresPresent.length > 1) {
    ws.mergeCells(row, 2, row, Math.max(6, 3 + sheetTotals.length));
    const note = ws.getCell(row, 2);
    note.value = measuresPresent.includes('orders')
      ? 'Measures are totalled separately and never added: an order becomes an invoice once billed, so combining them would count the same sale twice.'
      : 'Measures are totalled separately and never added together.';
    note.font = SUBTITLE_FONT;
    note.alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(row).height = 26;
    row++;
  }

  row += 2;

  // ── Quarterly Breakdown ──────────────────────────────────────────────────

  interface QuarterData { label: string; byMeasure: Record<string, { revenue: number; tonnage: number }>; }
  const quarterMap = new Map<string, QuarterData>();

  for (const sheet of config.sheets) {
    if (!sheet.dateField) continue;
    const measure = measureOf(sheet);
    for (const r of sheet.rows) {
      const dateVal = r[sheet.dateField];
      if (!dateVal) continue;
      const qInfo = dateToQuarter(String(dateVal));
      if (!qInfo) continue;
      const key = quarterSortKey(qInfo.q, qInfo.year);
      const entry = quarterMap.get(key) || { label: qInfo.label, byMeasure: {} };
      const bucket = entry.byMeasure[measure] || { revenue: 0, tonnage: 0 };
      if (sheet.revenueField) bucket.revenue += Number(r[sheet.revenueField]) || 0;
      if (sheet.tonnageField) bucket.tonnage += Number(r[sheet.tonnageField]) || 0;
      entry.byMeasure[measure] = bucket;
      quarterMap.set(key, entry);
    }
  }

  if (quarterMap.size > 0) {
    ws.mergeCells(row, 2, row, 6);
    const qSecCell = ws.getCell(row, 2);
    qSecCell.value = 'QUARTERLY BREAKDOWN';
    qSecCell.font = SECTION_HEADER_FONT;
    qSecCell.fill = SECTION_HEADER_FILL;
    row++;

    const quarters = [...quarterMap.keys()].sort().map(k => quarterMap.get(k)!);

    const qHeaders = ['', ...quarters.map(q => q.label), 'TOTAL'];
    const qHdrRow = ws.getRow(row);
    for (let c = 0; c < qHeaders.length; c++) {
      const cell = ws.getCell(row, c + 2);
      cell.value = qHeaders[c];
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { ...HEADER_ALIGNMENT, wrapText: true };
      cell.border = BORDERS_ALL;
    }
    qHdrRow.height = 36;
    row++;

    const writeQuarterRow = (label: string, measure: SheetMeasure, field: 'revenue' | 'tonnage', numFmt: string) => {
      ws.getCell(row, 2).value = label;
      ws.getCell(row, 2).font = { bold: true };
      ws.getCell(row, 2).border = BORDERS_ALL;
      for (let i = 0; i < quarters.length; i++) {
        const cell = ws.getCell(row, 3 + i);
        cell.value = quarters[i].byMeasure[measure]?.[field] ?? 0;
        cell.numFmt = numFmt;
        cell.border = BORDERS_ALL;
        cell.alignment = { horizontal: 'right' };
      }
      const totalCell = ws.getCell(row, 3 + quarters.length);
      totalCell.value = measureTotal(measure, field);
      totalCell.numFmt = numFmt;
      totalCell.font = TOTAL_FONT;
      totalCell.fill = TOTAL_FILL;
      totalCell.border = BORDERS_ALL;
      totalCell.alignment = { horizontal: 'right' };
      row++;
    };

    for (const m of measuresPresent) {
      if (sheetTotals.some(t => t.measure === m && t.hasRevenue)) {
        writeQuarterRow(MEASURE_LABEL[m].amount, m, 'revenue', CURRENCY_FMT);
      }
      if (sheetTotals.some(t => t.measure === m && t.hasTonnage)) {
        writeQuarterRow(MEASURE_LABEL[m].tonnage, m, 'tonnage', TONS_FMT);
      }
    }
  }
}
