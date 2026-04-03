import type ExcelJS from 'exceljs';
import type { ReportConfig } from '../excelReportBuilder';
import {
  TITLE_FONT, SUBTITLE_FONT,
  SECTION_HEADER_FONT, SECTION_HEADER_FILL,
  HEADER_FILL, HEADER_FONT, HEADER_ALIGNMENT,
  TOTAL_FILL, TOTAL_FONT, BORDERS_ALL,
  CURRENCY_FMT, TONS_FMT,
} from '../excelStyles';

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

  // Generous column widths
  ws.getColumn(1).width = 4;   // spacer
  ws.getColumn(2).width = 24;  // labels
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 20;
  ws.getColumn(5).width = 20;
  ws.getColumn(6).width = 20;
  ws.getColumn(7).width = 20;

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

  // ── Compute per-sheet totals ─────────────────────────────────────────────

  const hasRevenue = config.sheets.some(s => s.revenueField);
  const hasTonnage = config.sheets.some(s => s.tonnageField);

  interface SheetTotals { label: string; revenue: number; tonnage: number; }
  const sheetTotals: SheetTotals[] = [];

  for (const sheet of config.sheets) {
    let revenue = 0;
    let tonnage = 0;
    for (const r of sheet.rows) {
      if (sheet.revenueField) revenue += Number(r[sheet.revenueField]) || 0;
      if (sheet.tonnageField) tonnage += Number(r[sheet.tonnageField]) || 0;
    }
    sheetTotals.push({ label: sheet.sourceLabel || sheet.name, revenue, tonnage });
  }

  const grandRevenue = sheetTotals.reduce((s, t) => s + t.revenue, 0);
  const grandTonnage = sheetTotals.reduce((s, t) => s + t.tonnage, 0);

  // ── Overall Totals Section ───────────────────────────────────────────────

  // Section header
  ws.mergeCells(row, 2, row, 6);
  const secCell = ws.getCell(row, 2);
  secCell.value = 'OVERALL TOTALS';
  secCell.font = SECTION_HEADER_FONT;
  secCell.fill = SECTION_HEADER_FILL;
  row++;

  // Column headers
  const overallHeaders: string[] = [''];
  for (const t of sheetTotals) overallHeaders.push(t.label);
  overallHeaders.push('GRAND TOTAL');

  const hdrRow = ws.getRow(row);
  for (let c = 0; c < overallHeaders.length; c++) {
    const cell = ws.getCell(row, c + 2);
    cell.value = overallHeaders[c];
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = HEADER_ALIGNMENT;
    cell.border = BORDERS_ALL;
  }
  hdrRow.height = 28;
  row++;

  // Revenue row
  if (hasRevenue) {
    const revenueRow = ws.getRow(row);
    ws.getCell(row, 2).value = 'Total Revenue (EUR)';
    ws.getCell(row, 2).font = { bold: true };
    ws.getCell(row, 2).border = BORDERS_ALL;
    for (let i = 0; i < sheetTotals.length; i++) {
      const cell = ws.getCell(row, 3 + i);
      cell.value = sheetTotals[i].revenue;
      cell.numFmt = CURRENCY_FMT;
      cell.border = BORDERS_ALL;
      cell.alignment = { horizontal: 'right' };
    }
    const gtCell = ws.getCell(row, 3 + sheetTotals.length);
    gtCell.value = grandRevenue;
    gtCell.numFmt = CURRENCY_FMT;
    gtCell.font = TOTAL_FONT;
    gtCell.fill = TOTAL_FILL;
    gtCell.border = BORDERS_ALL;
    gtCell.alignment = { horizontal: 'right' };
    revenueRow.height = 22;
    row++;
  }

  // Tonnage row
  if (hasTonnage) {
    const tonnageRow = ws.getRow(row);
    ws.getCell(row, 2).value = 'Total Tonnage (MT)';
    ws.getCell(row, 2).font = { bold: true };
    ws.getCell(row, 2).border = BORDERS_ALL;
    for (let i = 0; i < sheetTotals.length; i++) {
      const cell = ws.getCell(row, 3 + i);
      cell.value = sheetTotals[i].tonnage;
      cell.numFmt = TONS_FMT;
      cell.border = BORDERS_ALL;
      cell.alignment = { horizontal: 'right' };
    }
    const gtCell = ws.getCell(row, 3 + sheetTotals.length);
    gtCell.value = grandTonnage;
    gtCell.numFmt = TONS_FMT;
    gtCell.font = TOTAL_FONT;
    gtCell.fill = TOTAL_FILL;
    gtCell.border = BORDERS_ALL;
    gtCell.alignment = { horizontal: 'right' };
    tonnageRow.height = 22;
    row++;
  }

  row += 2;

  // ── Quarterly Breakdown Section ──────────────────────────────────────────

  // Gather quarterly data from all sheets
  interface QuarterData { revenue: number; tonnage: number; label: string; }
  const quarterMap = new Map<string, QuarterData>();

  for (const sheet of config.sheets) {
    if (!sheet.dateField) continue;
    for (const r of sheet.rows) {
      const dateVal = r[sheet.dateField];
      if (!dateVal) continue;
      const qInfo = dateToQuarter(String(dateVal));
      if (!qInfo) continue;
      const key = quarterSortKey(qInfo.q, qInfo.year);
      const existing = quarterMap.get(key) || { revenue: 0, tonnage: 0, label: qInfo.label };
      if (sheet.revenueField) existing.revenue += Number(r[sheet.revenueField]) || 0;
      if (sheet.tonnageField) existing.tonnage += Number(r[sheet.tonnageField]) || 0;
      quarterMap.set(key, existing);
    }
  }

  if (quarterMap.size > 0) {
    // Section header
    ws.mergeCells(row, 2, row, 6);
    const qSecCell = ws.getCell(row, 2);
    qSecCell.value = 'QUARTERLY BREAKDOWN';
    qSecCell.font = SECTION_HEADER_FONT;
    qSecCell.fill = SECTION_HEADER_FILL;
    row++;

    // Sort quarters chronologically
    const sortedKeys = [...quarterMap.keys()].sort();
    const quarters = sortedKeys.map(k => quarterMap.get(k)!);

    // Headers
    const qHeaders = ['', ...quarters.map(q => q.label), 'GRAND TOTAL'];
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

    // Revenue row
    if (hasRevenue) {
      ws.getCell(row, 2).value = 'Revenue (EUR)';
      ws.getCell(row, 2).font = { bold: true };
      ws.getCell(row, 2).border = BORDERS_ALL;
      for (let i = 0; i < quarters.length; i++) {
        const cell = ws.getCell(row, 3 + i);
        cell.value = quarters[i].revenue;
        cell.numFmt = CURRENCY_FMT;
        cell.border = BORDERS_ALL;
        cell.alignment = { horizontal: 'right' };
      }
      const gtCell = ws.getCell(row, 3 + quarters.length);
      gtCell.value = grandRevenue;
      gtCell.numFmt = CURRENCY_FMT;
      gtCell.font = TOTAL_FONT;
      gtCell.fill = TOTAL_FILL;
      gtCell.border = BORDERS_ALL;
      gtCell.alignment = { horizontal: 'right' };
      row++;
    }

    // Tonnage row
    if (hasTonnage) {
      ws.getCell(row, 2).value = 'Tonnage (MT)';
      ws.getCell(row, 2).font = { bold: true };
      ws.getCell(row, 2).border = BORDERS_ALL;
      for (let i = 0; i < quarters.length; i++) {
        const cell = ws.getCell(row, 3 + i);
        cell.value = quarters[i].tonnage;
        cell.numFmt = TONS_FMT;
        cell.border = BORDERS_ALL;
        cell.alignment = { horizontal: 'right' };
      }
      const gtCell = ws.getCell(row, 3 + quarters.length);
      gtCell.value = grandTonnage;
      gtCell.numFmt = TONS_FMT;
      gtCell.font = TOTAL_FONT;
      gtCell.fill = TOTAL_FILL;
      gtCell.border = BORDERS_ALL;
      gtCell.alignment = { horizontal: 'right' };
      row++;
    }
  }
}
