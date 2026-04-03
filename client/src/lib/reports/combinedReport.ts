import type { ReportConfig } from '../excelReportBuilder';
import { buildRevenueReport } from './revenueReport';
import { buildExpensesReport } from './expensesReport';

interface CombinedData {
  customer_invoices: any[];
  confirmed_orders: any[];
  supplier_expenses: any[];
}

export function buildCombinedReport(
  data: CombinedData,
  period: string,
  includeOrders: boolean = true,
): ReportConfig {
  const revenueConfig = buildRevenueReport(
    { customer_invoices: data.customer_invoices, confirmed_orders: data.confirmed_orders },
    period,
    includeOrders,
  );

  const expensesConfig = buildExpensesReport(
    { supplier_expenses: data.supplier_expenses },
    period,
  );

  const allSheets = [...revenueConfig.sheets, ...expensesConfig.sheets];
  const sheetLabels = allSheets.map(s => s.name).join(' · ');

  return {
    filename: `TripleW Full Report ${period}`,
    title: 'Revenue & Expenses Summary',
    subtitle: `${sheetLabels}`,
    sheets: allSheets,
    includeSummary: true,
  };
}
