import type ExcelJS from 'exceljs';
import type { ReportConfig, SheetData, SheetMeasure } from '../excelReportBuilder';
import {
  TITLE_FONT, SUBTITLE_FONT,
  SECTION_HEADER_FONT, SECTION_HEADER_FILL,
  GROUP_HEADER_FONT, GROUP_HEADER_FILL,
  HEADER_FILL, HEADER_FONT, HEADER_ALIGNMENT,
  TOTAL_FILL, TOTAL_FONT, BORDERS_ALL,
  CURRENCY_FMT, TONS_FMT, PERCENT_FMT,
} from '../excelStyles';
import { CHART_HEX, renderBarChartPng, chartEurAxis } from './chartImage';

// ── Measures ─────────────────────────────────────────────────────────────────
// Sheets are totalled *within* their measure and never across measures. An order
// becomes an invoice once billed, so adding orders to invoiced revenue counts the
// same sale twice; expenses are the other side of the ledger entirely. Each
// measure therefore gets its own breakdown section below, not a shared table.

const MEASURE_ORDER: SheetMeasure[] = ['revenue', 'orders', 'expenses'];

const MEASURE_LABEL: Record<SheetMeasure, { amount: string; tonnage: string }> = {
  revenue:  { amount: 'Invoiced revenue (EUR)', tonnage: 'Invoiced tonnage (MT)' },
  orders:   { amount: 'Orders placed (EUR)',    tonnage: 'Ordered tonnage (MT)' },
  expenses: { amount: 'Expenses (EUR)',         tonnage: 'Expensed tonnage (MT)' },
};

// Banner over each measure's four breakdown blocks, plus the noun used when
// reporting how many of that measure's rows carry a tonnage figure.
const MEASURE_GROUP: Record<SheetMeasure, { banner: string; one: string; many: string }> = {
  revenue:  { banner: 'INVOICES — BREAKDOWN',      one: 'invoice',         many: 'invoices' },
  orders:   { banner: 'ORDERS PLACED — BREAKDOWN', one: 'order',           many: 'orders' },
  expenses: { banner: 'EXPENSES — BREAKDOWN',      one: 'expense invoice', many: 'expense invoices' },
};

// Same colors as each measure's own sheet chart, so a reader flipping between
// tabs sees one consistent color per measure throughout the workbook.
const MEASURE_COLOR: Record<SheetMeasure, string> = {
  revenue: CHART_HEX.aqua,
  orders: CHART_HEX.blue,
  expenses: CHART_HEX.orange,
};

function measureOf(sheet: SheetData): SheetMeasure {
  return sheet.measure || 'revenue';
}

/** A recorded quantity. Blank/null means "not recorded" and must never read as 0. */
function tonnageOf(row: Record<string, any>, field: string | undefined): number | null {
  if (!field) return null;
  const raw = row[field];
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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

// ── Breakdown definitions, applied identically to every measure ──────────────

type KeyFn = (sheet: SheetData, dataRow: Record<string, any>) => { key: string; label: string } | null;

interface BlockDef {
  title: string;
  firstHeader: string;
  keyOf: KeyFn;
  sortBy: 'key' | 'value';
  chart?: boolean;
}

const BLOCKS: BlockDef[] = [
  {
    title: 'MONTHLY BREAKDOWN', firstHeader: 'Month', sortBy: 'key', chart: true,
    keyOf: (sheet, dataRow) => {
      if (!sheet.dateField) return null;
      const d = parseDate(dataRow[sheet.dateField]);
      if (!d) return null;
      const y = d.getFullYear();
      const m = d.getMonth();
      return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[m]} ${y}` };
    },
  },
  {
    title: 'QUARTERLY BREAKDOWN', firstHeader: 'Quarter', sortBy: 'key',
    keyOf: (sheet, dataRow) => {
      if (!sheet.dateField) return null;
      const d = parseDate(dataRow[sheet.dateField]);
      if (!d) return null;
      const y = d.getFullYear();
      const q = Math.ceil((d.getMonth() + 1) / 3);
      return { key: `${y}-${q}`, label: `Q${q} ${y} (${QUARTER_MONTHS[q]})` };
    },
  },
  {
    title: 'BY CUSTOMER', firstHeader: 'Customer', sortBy: 'value',
    keyOf: (sheet, dataRow) => {
      if (!sheet.customerField) return null;
      const name = String(dataRow[sheet.customerField] ?? '').trim() || 'Unknown';
      return { key: name.toLowerCase(), label: name };
    },
  },
  {
    title: 'BY REGION', firstHeader: 'Region', sortBy: 'value',
    keyOf: (sheet, dataRow) => {
      if (!sheet.regionField) return null;
      const name = String(dataRow[sheet.regionField] ?? '').trim() || 'Unknown';
      return { key: name.toLowerCase(), label: name };
    },
  },
];

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

  interface SheetTotals {
    label: string; measure: SheetMeasure;
    revenue: number; tonnage: number;
    hasRevenue: boolean; hasTonnage: boolean;
    // Tonnage coverage: how many of this sheet's rows actually carry a figure.
    tonnageRows: number; rowCount: number;
  }
  const sheetTotals: SheetTotals[] = config.sheets.map(sheet => {
    let revenue = 0;
    let tonnage = 0;
    let tonnageRows = 0;
    for (const r of sheet.rows) {
      if (sheet.revenueField) revenue += Number(r[sheet.revenueField]) || 0;
      const t = tonnageOf(r, sheet.tonnageField);
      if (t !== null) { tonnage += t; tonnageRows++; }
    }
    return {
      label: sheet.sourceLabel || sheet.name,
      measure: measureOf(sheet),
      revenue, tonnage,
      hasRevenue: !!sheet.revenueField,
      hasTonnage: !!sheet.tonnageField,
      tonnageRows, rowCount: sheet.rows.length,
    };
  });

  const measuresPresent = MEASURE_ORDER.filter(m => sheetTotals.some(t => t.measure === m));
  const measureTotal = (m: SheetMeasure, field: 'revenue' | 'tonnage') =>
    sheetTotals.filter(t => t.measure === m).reduce((s, t) => s + t[field], 0);

  interface MetricCol { label: string; measure: SheetMeasure; field: 'revenue' | 'tonnage'; numFmt: string; }
  const metricColsFor = (m: SheetMeasure): MetricCol[] => {
    const cols: MetricCol[] = [];
    if (sheetTotals.some(t => t.measure === m && t.hasRevenue)) {
      cols.push({ label: MEASURE_LABEL[m].amount, measure: m, field: 'revenue', numFmt: CURRENCY_FMT });
    }
    if (sheetTotals.some(t => t.measure === m && t.hasTonnage)) {
      cols.push({ label: MEASURE_LABEL[m].tonnage, measure: m, field: 'tonnage', numFmt: TONS_FMT });
    }
    return cols;
  };

  // ── Shared writers ───────────────────────────────────────────────────────

  const writeGroupBanner = (label: string, span: number) => {
    ws.mergeCells(row, 2, row, Math.max(6, 1 + span));
    const cell = ws.getCell(row, 2);
    cell.value = label;
    cell.font = GROUP_HEADER_FONT;
    cell.fill = GROUP_HEADER_FILL;
    cell.alignment = { vertical: 'middle' };
    ws.getRow(row).height = 26;
    row += 2;
  };

  const writeSectionHeader = (label: string, span: number) => {
    ws.mergeCells(row, 2, row, Math.max(6, 1 + span));
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

  const writeNote = (text: string, span: number) => {
    ws.mergeCells(row, 2, row, Math.max(6, 1 + span));
    const note = ws.getCell(row, 2);
    note.value = text;
    note.font = SUBTITLE_FONT;
    note.alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(row).height = 26;
    row++;
  };

  /**
   * One breakdown block for a single measure: a row per entity, and for each
   * metric a value column followed by its share of the block total. Only the
   * named measure's sheets contribute, so every column totals to the figure
   * shown for that measure in TOTALS BY MEASURE.
   */
  const writeBlock = (def: BlockDef, measure: SheetMeasure, cols: MetricCol[]): void => {
    interface Bucket { label: string; values: Map<string, number>; }
    const buckets = new Map<string, Bucket>();
    const contributed = new Set<string>();

    for (const sheet of config.sheets) {
      if (measureOf(sheet) !== measure) continue;
      for (const dataRow of sheet.rows) {
        const k = def.keyOf(sheet, dataRow);
        if (!k) continue;
        const bucket = buckets.get(k.key) ?? { label: k.label, values: new Map() };
        if (sheet.revenueField) {
          contributed.add('revenue');
          bucket.values.set('revenue', (bucket.values.get('revenue') || 0) + (Number(dataRow[sheet.revenueField]) || 0));
        }
        const tons = tonnageOf(dataRow, sheet.tonnageField);
        if (tons !== null) {
          contributed.add('tonnage');
          bucket.values.set('tonnage', (bucket.values.get('tonnage') || 0) + tons);
        }
        buckets.set(k.key, bucket);
      }
    }

    if (buckets.size === 0) return;

    const active = cols.filter(c => contributed.has(c.field));
    if (active.length === 0) return;

    const entries = [...buckets.entries()];
    if (def.sortBy === 'key') {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    } else {
      const first = active[0].field;
      entries.sort((a, b) => (b[1].values.get(first) ?? 0) - (a[1].values.get(first) ?? 0));
    }

    // Column totals, needed up front so each row can show its share.
    const totals = new Map<string, number>(
      active.map(c => [c.field, entries.reduce((s, [, b]) => s + (b.values.get(c.field) || 0), 0)]),
    );

    // Each metric occupies two columns: the value, then its % of the total.
    const span = 1 + active.length * 2;
    const blockStartRow = row;
    writeSectionHeader(def.title, span);
    writeHeaderRow([def.firstHeader, ...active.flatMap(c => [c.label, '% of Total'])]);

    // `null` from `get` means the bucket recorded nothing for that metric, which
    // is left blank — a month whose invoices carry no quantity has an unknown
    // tonnage, and printing 0.00 MT would assert that nothing shipped.
    const writeRow = (label: string, get: (field: string) => number | null, emphasise: boolean) => {
      const labelCell = ws.getCell(row, 2);
      labelCell.value = label;
      labelCell.border = BORDERS_ALL;
      if (emphasise) { labelCell.font = TOTAL_FONT; labelCell.fill = TOTAL_FILL; }
      active.forEach((col, i) => {
        const value = get(col.field);
        const total = totals.get(col.field) || 0;
        const valueCell = ws.getCell(row, 3 + i * 2);
        valueCell.value = value;
        valueCell.numFmt = col.numFmt;
        const pctCell = ws.getCell(row, 4 + i * 2);
        pctCell.value = value === null ? null : (total ? value / total : 0);
        pctCell.numFmt = PERCENT_FMT;
        for (const cell of [valueCell, pctCell]) {
          cell.border = BORDERS_ALL;
          cell.alignment = { horizontal: 'right' };
          if (emphasise) { cell.font = TOTAL_FONT; cell.fill = TOTAL_FILL; }
        }
      });
      row++;
    };

    for (const [, bucket] of entries) {
      writeRow(bucket.label, field => (bucket.values.has(field) ? bucket.values.get(field)! : null), false);
    }
    writeRow('TOTAL', field => totals.get(field) || 0, true);

    // Chart — the monetary column only (EUR and MT never share one axis),
    // placed to the right of the table, anchored at the block's own header row.
    if (def.chart && active.some(c => c.field === 'revenue')) {
      const img = renderBarChartPng(
        entries.map(([, b]) => b.label),
        [{
          label: MEASURE_LABEL[measure].amount,
          color: MEASURE_COLOR[measure],
          values: entries.map(([, b]) => b.values.get('revenue') || 0),
        }],
        { title: `${MEASURE_GROUP[measure].many} — ${def.title.toLowerCase()}`, valueFormatter: chartEurAxis },
      );
      if (img) {
        const imageId = wb.addImage({ base64: img.base64, extension: 'png' });
        ws.addImage(imageId, {
          tl: { col: 1 + span + 1, row: blockStartRow - 1 },
          ext: { width: img.width, height: img.height },
        });
      }
    }

    row += 3;
  };

  // ── 1. Totals by measure (per source sheet) ──────────────────────────────

  const totalsSpan = 2 + sheetTotals.length;
  writeSectionHeader('TOTALS BY MEASURE', totalsSpan);
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
      // A tonnage total is only as complete as the rows behind it. Say so on the
      // face of the report rather than letting a partial figure read as final.
      const mine = sheetTotals.filter(t => t.measure === m && t.hasTonnage);
      const known = mine.reduce((s, t) => s + t.tonnageRows, 0);
      const all = mine.reduce((s, t) => s + t.rowCount, 0);
      const missing = all - known;
      if (all > 0 && missing > 0) {
        const g = MEASURE_GROUP[m];
        writeNote(
          `Tonnage is recorded on ${known} of ${all} ${g.many}; ` +
          (missing === 1
            ? `one ${g.one} carries no quantity and is excluded`
            : `the other ${missing} carry no quantity and are excluded`) +
          ' from every MT figure in this report. Revenue totals are unaffected.',
          totalsSpan,
        );
      }
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
    writeNote(
      measuresPresent.includes('orders')
        ? 'There is no single grand total on purpose: an order becomes an invoice once billed, so adding the columns would count the same sale twice. Each measure totals on its own.'
        : 'Each measure totals on its own — the columns are never added together.',
      totalsSpan,
    );
  }

  row += 2;

  // ── 2. One full breakdown section per measure ────────────────────────────
  // Invoices and orders each get the same four blocks, so either can be read as
  // a standalone report without the reader having to pick columns out of a
  // shared table.

  for (const m of measuresPresent) {
    const cols = metricColsFor(m);
    if (cols.length === 0) continue;
    writeGroupBanner(MEASURE_GROUP[m].banner, 1 + cols.length * 2);
    for (const def of BLOCKS) writeBlock(def, m, cols);
  }
}
