import ExcelJS from 'exceljs';

export async function downloadExcel(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r.map(v => v ?? ''));

  // Auto-width columns
  ws.columns.forEach((col, i) => {
    col.width = Math.max(
      (headers[i] ?? '').length,
      ...rows.map(r => String(r[i] ?? '').length),
    ) + 2;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
