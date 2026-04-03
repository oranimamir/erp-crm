import ExcelJS from 'exceljs';
import {
  HEADER_FILL, HEADER_FONT, HEADER_ALIGNMENT, BORDERS_ALL,
  TOTAL_FILL, TOTAL_FONT,
  CURRENCY_FMT, NUMBER_FMT, TONS_FMT, DATE_FMT, currencyFmt,
} from './excelStyles';
import { buildSummarySheet } from './reports/summarySheet';

// ── Public Interfaces ────────────────────────────────────────────────────────

export interface ColumnDef {
  header: string;
  key: string;
  width?: number;
  format?: 'currency' | 'currency_native' | 'number' | 'date' | 'tons' | 'text';
}

export interface SheetData {
  name: string;
  columns: ColumnDef[];
  rows: Record<string, any>[];
  totalsRow?: Record<string, any>;
  // Summary tab metadata
  revenueField?: string;
  tonnageField?: string;
  dateField?: string;
  sourceLabel?: string;
}

export interface ReportConfig {
  filename: string;
  title?: string;
  subtitle?: string;
  sheets: SheetData[];
  includeSummary?: boolean;
}

// ── Report Builder ───────────────────────────────────────────────────────────

export async function buildReport(config: ReportConfig): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TripleW ERP';
  wb.created = new Date();

  // Add data sheets
  for (const sheet of config.sheets) {
    addDataSheet(wb, sheet);
  }

  // Add summary tab as first sheet
  if (config.includeSummary !== false && config.sheets.length > 0) {
    buildSummarySheet(wb, config);
    // Move summary to front
    const summaryWs = wb.getWorksheet('Summary');
    if (summaryWs) {
      wb.removeWorksheet(summaryWs.id);
      const newSummary = wb.addWorksheet('Summary', {});
      // Re-build in new sheet (simplest approach since exceljs doesn't support reordering)
      wb.removeWorksheet(newSummary.id);
    }
    // Rebuild: create workbook with summary first
    const wb2 = new ExcelJS.Workbook();
    wb2.creator = 'TripleW ERP';
    wb2.created = new Date();
    buildSummarySheet(wb2, config);
    for (const sheet of config.sheets) {
      addDataSheet(wb2, sheet);
    }
    return downloadWorkbook(wb2, config.filename);
  }

  return downloadWorkbook(wb, config.filename);
}

// ── Data Sheet ───────────────────────────────────────────────────────────────

function addDataSheet(wb: ExcelJS.Workbook, sheet: SheetData): void {
  const ws = wb.addWorksheet(sheet.name);

  // Column definitions
  ws.columns = sheet.columns.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width || autoWidth(col, sheet.rows),
  }));

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = HEADER_ALIGNMENT;
    cell.border = BORDERS_ALL;
  });

  // Data rows
  for (const rowData of sheet.rows) {
    const row = ws.addRow(rowData);
    row.eachCell((cell, colNumber) => {
      const colDef = sheet.columns[colNumber - 1];
      if (!colDef) return;
      applyFormat(cell, colDef, rowData);
      cell.border = BORDERS_ALL;
      cell.alignment = { vertical: 'middle' };
    });
  }

  // Totals row
  if (sheet.totalsRow) {
    const row = ws.addRow(sheet.totalsRow);
    row.eachCell((cell, colNumber) => {
      const colDef = sheet.columns[colNumber - 1];
      cell.fill = TOTAL_FILL;
      cell.font = TOTAL_FONT;
      cell.border = BORDERS_ALL;
      cell.alignment = { vertical: 'middle' };
      if (colDef) applyFormat(cell, colDef, sheet.totalsRow!);
    });
  }

  // Auto-filter
  if (sheet.rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function applyFormat(cell: ExcelJS.Cell, col: ColumnDef, rowData: Record<string, any>): void {
  switch (col.format) {
    case 'currency':
      cell.numFmt = CURRENCY_FMT;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      break;
    case 'currency_native': {
      const cur = rowData.currency || 'EUR';
      cell.numFmt = currencyFmt(cur);
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      break;
    }
    case 'number':
      cell.numFmt = NUMBER_FMT;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      break;
    case 'tons':
      cell.numFmt = TONS_FMT;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      break;
    case 'date':
      if (cell.value && typeof cell.value === 'string') {
        const d = new Date(cell.value);
        if (!isNaN(d.getTime())) cell.value = d;
      }
      cell.numFmt = DATE_FMT;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      break;
  }
}

// ── Auto Width ───────────────────────────────────────────────────────────────

function autoWidth(col: ColumnDef, rows: Record<string, any>[]): number {
  let max = col.header.length;
  for (const r of rows) {
    const val = r[col.key];
    const len = val != null ? String(val).length : 0;
    if (len > max) max = len;
  }
  // Add padding, cap at reasonable limits
  return Math.min(Math.max(max + 3, 10), 35);
}

// ── Download ─────────────────────────────────────────────────────────────────

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
