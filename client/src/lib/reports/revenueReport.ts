import type { ReportConfig, SheetData, ColumnDef } from '../excelReportBuilder';

interface RevenueData {
  customer_invoices: {
    invoice_number: string;
    customer_name: string;
    quantity_mt: number;
    amount: number;
    currency: string;
    eur_amount: number;
    invoice_date: string;
  }[];
  confirmed_orders: {
    order_number: string;
    party_name: string;
    status: string;
    quantity_mt: number;
    total_eur: number;
    order_date: string;
  }[];
}

const INVOICE_COLUMNS: ColumnDef[] = [
  { header: 'Invoice #', key: 'invoice_number', width: 22 },
  { header: 'Customer', key: 'customer_name', width: 22 },
  { header: 'Quantity (MT)', key: 'quantity_mt', format: 'tons' },
  { header: 'Amount', key: 'amount', format: 'currency_native', width: 16 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'EUR Amount', key: 'eur_amount', format: 'currency', width: 16 },
  { header: 'Invoice Date', key: 'invoice_date', format: 'date', width: 14 },
];

const ORDER_COLUMNS: ColumnDef[] = [
  { header: 'Order #', key: 'order_number', width: 22 },
  { header: 'Customer / Supplier', key: 'party_name', width: 22 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Quantity (MT)', key: 'quantity_mt', format: 'tons' },
  { header: 'Invoice Total (EUR)', key: 'total_eur', format: 'currency', width: 18 },
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
      revenueField: 'eur_amount',
      tonnageField: 'quantity_mt',
      dateField: 'invoice_date',
      sourceLabel: `Invoices ${year}`,
    });
  }

  // Orders sheet
  if (includeOrders && data.confirmed_orders.length > 0) {
    sheets.push({
      name: 'Orders Confirmed',
      columns: ORDER_COLUMNS,
      rows: data.confirmed_orders,
      totalsRow: {
        order_number: 'TOTAL',
        quantity_mt: sumField(data.confirmed_orders, 'quantity_mt'),
        total_eur: sumField(data.confirmed_orders, 'total_eur'),
      },
      revenueField: 'total_eur',
      tonnageField: 'quantity_mt',
      dateField: 'order_date',
      sourceLabel: 'Orders Confirmed',
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
