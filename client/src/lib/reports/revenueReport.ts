import type { ReportConfig, SheetData, ColumnDef } from '../excelReportBuilder';
import { CHART_HEX, chartEurAxis, monthlyTotals } from './chartImage';

interface RevenueData {
  customer_invoices: {
    invoice_number: string;
    customer_name: string;
    // null when no quantity was recorded on the invoice — distinct from 0.
    quantity_mt: number | null;
    amount: number;
    currency: string;
    eur_amount: number;
    operation_number?: string;
    region?: string;
    invoice_date: string;
  }[];
  orders: {
    order_number: string;
    party_name: string;
    status: string;
    quantity_mt: number | null;
    total_eur: number;
    operation_number?: string;
    region?: string;
    order_date: string;
  }[];
}

const INVOICE_COLUMNS: ColumnDef[] = [
  { header: 'Invoice #', key: 'invoice_number', width: 22 },
  { header: 'Customer', key: 'customer_name', width: 22 },
  { header: 'Operation #', key: 'operation_number', width: 18 },
  { header: 'Quantity (MT)', key: 'quantity_mt', format: 'tons' },
  { header: 'Amount', key: 'amount', format: 'currency_native', width: 16 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'EUR Amount', key: 'eur_amount', format: 'currency', width: 16 },
  { header: 'Region', key: 'region', width: 16 },
  { header: 'Invoice Date', key: 'invoice_date', format: 'date', width: 14 },
];

const ORDER_COLUMNS: ColumnDef[] = [
  { header: 'Order #', key: 'order_number', width: 22 },
  { header: 'Customer / Supplier', key: 'party_name', width: 22 },
  { header: 'Operation #', key: 'operation_number', width: 18 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Quantity (MT)', key: 'quantity_mt', format: 'tons' },
  { header: 'Order Total (EUR)', key: 'total_eur', format: 'currency', width: 18 },
  { header: 'Region', key: 'region', width: 16 },
  { header: 'Order Date', key: 'order_date', format: 'date', width: 14 },
];

function sumField(rows: Record<string, any>[], key: string): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

/**
 * Totals only the rows that actually carry a quantity, and returns null when
 * none do — a tonnage column of blanks must foot to a blank, not to 0.00, or
 * the total reads as "nothing shipped" instead of "nothing recorded".
 */
function sumTonnage(rows: Record<string, any>[], key: string): number | null {
  let total = 0;
  let seen = 0;
  for (const r of rows) {
    const raw = r[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    total += n;
    seen++;
  }
  return seen > 0 ? total : null;
}

/** Groups rows into one bucket per calendar year of `dateField`, oldest first. */
function byYear<T extends Record<string, any>>(rows: T[], dateField: string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const year = String(r[dateField] ?? '').substring(0, 4) || 'Unknown';
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year)!.push(r);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * One sheet of customer orders — every order allocated to an operation,
 * regardless of its downstream status (an order already delivered or invoiced
 * was still placed). Same definition as the on-screen "Orders placed" measure,
 * so the sheet total reconciles with the Summary tab.
 *
 * Shared by the Revenue report's single orders tab and the standalone Orders
 * report's per-year tabs, so both carry identical columns and totals.
 */
function ordersSheet(orders: RevenueData['orders'], name: string): SheetData {
  return {
    name,
    columns: ORDER_COLUMNS,
    rows: orders,
    totalsRow: {
      order_number: 'TOTAL',
      quantity_mt: sumTonnage(orders, 'quantity_mt'),
      total_eur: sumField(orders, 'total_eur'),
    },
    // Orders are their own measure — the Summary tab never adds them to
    // invoiced revenue, since an order becomes an invoice once billed.
    measure: 'orders',
    revenueField: 'total_eur',
    tonnageField: 'quantity_mt',
    dateField: 'order_date',
    customerField: 'party_name',
    regionField: 'region',
    sourceLabel: name,
    chart: (() => {
      const { categories, values } = monthlyTotals(orders, 'order_date', 'total_eur');
      return categories.length ? {
        categories, series: [{ label: name, color: CHART_HEX.blue, values }],
        title: `${name} by month`, valueFormatter: chartEurAxis,
      } : undefined;
    })(),
  };
}

/**
 * Orders reported the same way invoices are: a sheet per year, then a Summary
 * tab whose monthly, quarterly, customer and region blocks are built from the
 * orders alone. Use it to answer "what did we sell" from the order book rather
 * than from what has been billed so far.
 */
export function buildOrdersReport(
  data: { orders: RevenueData['orders'] },
  period: string,
): ReportConfig {
  const sheets: SheetData[] = byYear(data.orders, 'order_date')
    .map(([year, orders]) => ordersSheet(orders, `Orders ${year}`));

  return {
    filename: `TripleW Orders Summary ${period}`,
    title: 'Orders Placed Summary',
    subtitle: `Order value & Tonnage — ${sheets.map(s => s.name).join(' · ') || 'no orders in period'}`,
    sheets,
    includeSummary: true,
  };
}

export function buildRevenueReport(
  data: RevenueData,
  period: string,
  includeOrders: boolean = true,
): ReportConfig {
  const sheets: SheetData[] = [];

  // One sheet per year, oldest first
  for (const [year, invoices] of byYear(data.customer_invoices, 'invoice_date')) {
    sheets.push({
      name: `Invoices ${year}`,
      columns: INVOICE_COLUMNS,
      rows: invoices,
      totalsRow: {
        invoice_number: 'TOTAL',
        quantity_mt: sumTonnage(invoices, 'quantity_mt'),
        eur_amount: sumField(invoices, 'eur_amount'),
      },
      measure: 'revenue',
      revenueField: 'eur_amount',
      tonnageField: 'quantity_mt',
      dateField: 'invoice_date',
      customerField: 'customer_name',
      regionField: 'region',
      sourceLabel: `Invoices ${year}`,
      chart: (() => {
        const { categories, values } = monthlyTotals(invoices, 'invoice_date', 'eur_amount');
        return categories.length ? {
          categories, series: [{ label: `Invoices ${year}`, color: CHART_HEX.aqua, values }],
          title: `Invoices ${year} by month`, valueFormatter: chartEurAxis,
        } : undefined;
      })(),
    });
  }

  if (includeOrders && data.orders.length > 0) {
    sheets.push(ordersSheet(data.orders, 'Orders Placed'));
  }

  const sheetLabels = sheets.map(s => s.name).join(' · ');

  return {
    filename: `TripleW Revenues Summary ${period}`,
    title: 'Invoices and Orders Summary',
    subtitle: `Revenues & Tonnage — ${sheetLabels}`,
    sheets,
    includeSummary: true,
  };
}
