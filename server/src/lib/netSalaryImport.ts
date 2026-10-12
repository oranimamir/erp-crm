/**
 * Net salaries paid to employees, read off the Acerta "Total paid by month"
 * workbook: one sheet per salary (pay-period) month with its payments
 * (Payment date | Pay period from | Pay period to | Number of payments |
 * Total net paid), plus an Overview (Month | Number of payments | Total net
 * paid). Grouped by salary month — late / corrective payments belong to the
 * month they relate to. The month sheets are used; the Overview only fills a
 * month that has no sheet of its own.
 */
import ExcelJS from 'exceljs';
import { cellText, cellNumber, derivePeriodMonth } from './excel-helpers.js';

export interface SalaryPayment { payment_date: string | null; period_from: string | null; period_to: string | null; payments: number; amount: number }
export interface SalaryMonth { month: string; total: number; payments: number; lines: SalaryPayment[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const label = (v: any) => cellText(v).trim().toLowerCase();
const isoDate = (v: any): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = cellText(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** "Jan 2026", "January 2026", "2026-01", a date → 'YYYY-MM'. */
function monthOf(v: any): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 7);
  const s = cellText(v).trim();
  const named = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (named) {
    const d = new Date(`${named[1]} 1, ${named[2]} 12:00 UTC`);
    if (!isNaN(d.getTime())) return `${named[2]}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const m = derivePeriodMonth(v);
  return m && /^\d{4}-\d{2}$/.test(m) ? m : null;
}

/** The header row (within the first 15) with all the wanted labels: column of each, else null. */
function findHeader(ws: ExcelJS.Worksheet, wanted: Record<string, (l: string) => boolean>): { row: number; cols: Record<string, number> } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const row = ws.getRow(r);
    const cols: Record<string, number> = {};
    for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
      const l = label(row.getCell(c).value);
      if (!l) continue;
      for (const [key, test] of Object.entries(wanted)) if (cols[key] == null && test(l)) cols[key] = c;
    }
    if (Object.keys(wanted).every(k => cols[k] != null)) return { row: r, cols };
  }
  return null;
}

const isNetTotal = (l: string) => l.includes('net') && (l.includes('total') || l.includes('paid') || l.includes('amount'));
const isCount = (l: string) => l.includes('number of payments') || l === 'payments' || l === 'count';

export async function readNetSalaryWorkbook(file: Buffer | ArrayBuffer): Promise<SalaryMonth[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as any);
  const months = new Map<string, SalaryMonth>();
  const overview = new Map<string, { total: number; payments: number }>();

  for (const ws of wb.worksheets) {
    // A month sheet: one row per payment, the pay period says which month
    const detail = findHeader(ws, { from: l => l.includes('period from') || l === 'from', amount: isNetTotal });
    if (detail) {
      const pay = findHeader(ws, { pay: l => l.includes('payment date') })?.cols.pay;
      const to = findHeader(ws, { to: l => l.includes('period to') })?.cols.to;
      const count = findHeader(ws, { count: isCount })?.cols.count;
      for (let r = detail.row + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const from = row.getCell(detail.cols.from).value;
        const month = from == null || from === '' ? null : monthOf(from);
        const amount = cellNumber(row.getCell(detail.cols.amount).value);
        if (!month || amount == null) continue; // blank and "Total" rows
        const entry = months.get(month) ?? { month, total: 0, payments: 0, lines: [] };
        const n = count ? cellNumber(row.getCell(count).value) ?? 0 : 0;
        entry.lines.push({
          payment_date: pay ? isoDate(row.getCell(pay).value) : null,
          period_from: isoDate(from), period_to: to ? isoDate(row.getCell(to).value) : null,
          payments: n, amount: r2(amount),
        });
        entry.total = r2(entry.total + amount);
        entry.payments += n;
        months.set(month, entry);
      }
      continue;
    }
    // The overview: one row per month
    const ov = findHeader(ws, { month: l => l === 'month' || l.startsWith('month') || l.includes('salary month'), amount: isNetTotal });
    if (ov) {
      const count = findHeader(ws, { count: isCount })?.cols.count;
      for (let r = ov.row + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const month = monthOf(row.getCell(ov.cols.month).value);
        const amount = cellNumber(row.getCell(ov.cols.amount).value);
        if (!month || amount == null) continue;
        overview.set(month, { total: r2(amount), payments: count ? cellNumber(row.getCell(count).value) ?? 0 : 0 });
      }
    }
  }

  for (const [month, o] of overview) {
    if (!months.has(month)) months.set(month, { month, total: o.total, payments: o.payments, lines: [] });
  }
  return [...months.values()].filter(m => Math.abs(m.total) >= 0.005).sort((a, b) => a.month.localeCompare(b.month));
}

/** Last day of a 'YYYY-MM' month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
