import type { ReportConfig, SheetData, ColumnDef } from '../excelReportBuilder';

interface ExpenseRow {
  invoice_id: string;
  supplier: string;
  category: string;
  domain: string;
  amount: number;
  vat_amount: number;
  currency: string;
  issue_date: string;
}

interface ExpensesData {
  supplier_expenses: ExpenseRow[];
}

const EXPENSE_COLUMNS: ColumnDef[] = [
  { header: 'Invoice ID', key: 'invoice_id', width: 22 },
  { header: 'Supplier', key: 'supplier', width: 24 },
  { header: 'Category', key: 'category', width: 18 },
  { header: 'Amount (excl. VAT)', key: 'amount', format: 'currency', width: 18 },
  { header: 'VAT', key: 'vat_amount', format: 'currency', width: 14 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Date', key: 'issue_date', format: 'date', width: 14 },
];

function sumField(rows: Record<string, any>[], key: string): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

export function buildExpensesReport(
  data: ExpensesData,
  period: string,
): ReportConfig {
  const sheets: SheetData[] = [];

  // Split by domain
  const demo = data.supplier_expenses.filter(e => e.domain === 'demo');
  const sales = data.supplier_expenses.filter(e => e.domain === 'sales');

  if (demo.length > 0) {
    sheets.push({
      name: 'Demo Expenses',
      columns: EXPENSE_COLUMNS,
      rows: demo,
      totalsRow: {
        invoice_id: 'TOTAL',
        amount: sumField(demo, 'amount'),
        vat_amount: sumField(demo, 'vat_amount'),
      },
      revenueField: 'amount',
      dateField: 'issue_date',
      sourceLabel: 'Demo Expenses',
    });
  }

  if (sales.length > 0) {
    sheets.push({
      name: 'Sales Activities',
      columns: EXPENSE_COLUMNS,
      rows: sales,
      totalsRow: {
        invoice_id: 'TOTAL',
        amount: sumField(sales, 'amount'),
        vat_amount: sumField(sales, 'vat_amount'),
      },
      revenueField: 'amount',
      dateField: 'issue_date',
      sourceLabel: 'Sales Activities',
    });
  }

  // If no domain split, single sheet
  if (sheets.length === 0 && data.supplier_expenses.length > 0) {
    sheets.push({
      name: 'Supplier Expenses',
      columns: EXPENSE_COLUMNS,
      rows: data.supplier_expenses,
      totalsRow: {
        invoice_id: 'TOTAL',
        amount: sumField(data.supplier_expenses, 'amount'),
        vat_amount: sumField(data.supplier_expenses, 'vat_amount'),
      },
      revenueField: 'amount',
      dateField: 'issue_date',
      sourceLabel: 'Supplier Expenses',
    });
  }

  return {
    filename: `TripleW Expenses Summary ${period}`,
    title: 'Expenses Summary',
    subtitle: `Supplier Expenses — ${sheets.map(s => s.name).join(' · ')}`,
    sheets,
    includeSummary: true,
  };
}
