import * as XLSX from 'xlsx';

export function downloadExcel(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows.map(r => r.map(v => v ?? '')),
  ]);

  // Auto-width columns
  const colWidths = headers.map((h, i) => ({
    wch: Math.max(
      h.length,
      ...rows.map(r => String(r[i] ?? '').length),
    ) + 2,
  }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
