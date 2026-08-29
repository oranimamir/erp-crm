import type { ReportConfig, SheetData, ColumnDef } from '../excelReportBuilder';
import { CHART_HEX, chartEurAxis, monthlyTotals } from './chartImage';

interface RevenueData {
  customer_invoices: {
    invoice_number: string;
    customer_name: string;
    quantity_mt: number;
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
    quantity_mt: number;
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

export function buildRevenueReport(
  data: RevenueData,
  period: string,
  includeOrders: boolean = true,
): ReportConfig {
  const sheets: SheetData[] = [];

  // Group invoices by year
  const byYear = new Map<string, typeof data.customer_invoices>();
  for (const inv of data.customer_invoices) {
    const year = inv.invoice_date?.substring(0, 4) || 'Unknown';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(inv);
  }

  // One sheet per year, sorted
  for (const [year, invoices] of [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sheets.push({
      name: `Invoices ${year}`,
      columns: INVOICE_COLUMNS,
      rows: invoices,
      totalsRow: {
        invoice_number: 'TOTAL',
        quantity_mt: sumField(invoices, 'quantity_mt'),
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

  // Orders sheet — every customer order allocated to an operation, regardless
  // of its downstream status (an order already delivered/invoiced was still
  // placed). Same definition as the on-screen "Orders placed" measure, so this
  // sheet's total reconciles with the Summary tab.
  if (includeOrders && data.orders.length > 0) {
    sheets.push({
      name: 'Orders Placed',
      columns: ORDER_COLUMNS,
      rows: data.orders,
      totalsRow: {
        order_number: 'TOTAL',
        quantity_mt: sumField(data.orders, 'quantity_mt'),
        total_eur: sumField(data.orders, 'total_eur'),
      },
      // Orders are their own measure — the Summary tab never adds them to
      // invoiced revenue, since an order becomes an invoice once billed.
      measure: 'orders',
      revenueField: 'total_eur',
      tonnageField: 'quantity_mt',
      dateField: 'order_date',
      customerField: 'party_name',
      regionField: 'region',
      sourceLabel: 'Orders Placed',
      chart: (() => {
        const { categories, values } = monthlyTotals(data.orders, 'order_date', 'total_eur');
        return categories.length ? {
          categories, series: [{ label: 'Orders Placed', color: CHART_HEX.blue, values }],
          title: 'Orders Placed by month', valueFormatter: chartEurAxis,
        } : undefined;
      })(),
    });
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
