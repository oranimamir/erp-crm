import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import Modal from './ui/Modal';
import api from '../lib/api';
import { buildReport } from '../lib/excelReportBuilder';
import { buildRevenueReport } from '../lib/reports/revenueReport';
import { buildExpensesReport } from '../lib/reports/expensesReport';
import { buildCombinedReport } from '../lib/reports/combinedReport';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type ReportType = 'revenue' | 'expenses' | 'combined';

interface Props {
  open: boolean;
  onClose: () => void;
  years: string[];
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

function periodLabel(yearFrom: string, yearTo: string, monthFrom: number, monthTo: number): string {
  if (yearFrom === yearTo) {
    if (monthFrom === 1 && monthTo === 12) return yearFrom;
    // Check for quarter
    if ((monthTo - monthFrom + 1) === 3 && (monthFrom - 1) % 3 === 0) {
      const q = Math.ceil(monthFrom / 3);
      return `Q${q}-${yearFrom.slice(2)}`;
    }
    return `${MONTHS[monthFrom - 1]}-${MONTHS[monthTo - 1]} ${yearFrom}`;
  }
  // Multi-year
  if (monthFrom === 1 && monthTo === 12) return `${yearFrom}-${yearTo}`;
  return `${MONTHS[monthFrom - 1]} ${yearFrom} – ${MONTHS[monthTo - 1]} ${yearTo}`;
}

export default function ExportReportModal({ open, onClose, years, addToast }: Props) {
  const currentYear = new Date().getFullYear().toString();
  const [reportType, setReportType] = useState<ReportType>('revenue');
  const [yearFrom, setYearFrom] = useState(years.length > 1 ? years[years.length - 2] : currentYear);
  const [yearTo, setYearTo] = useState(currentYear);
  const [monthFrom, setMonthFrom] = useState(1);
  const [monthTo, setMonthTo] = useState(12);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeOrders, setIncludeOrders] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filename, setFilename] = useState('');

  const period = periodLabel(yearFrom, yearTo, monthFrom, monthTo);
  const autoFilename = `TripleW ${reportType === 'revenue' ? 'Revenues' : reportType === 'expenses' ? 'Expenses' : 'Full Report'} Summary ${period}`;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const apiType = reportType === 'revenue' ? 'revenue' : reportType === 'expenses' ? 'expenses' : 'combined';
      const res = await api.get('/analytics/export-data', {
        params: {
          type: apiType,
          year_from: yearFrom,
          year_to: yearTo,
          month_from: monthFrom,
          month_to: monthTo,
        },
      });

      let config;
      switch (reportType) {
        case 'revenue':
          config = buildRevenueReport(res.data, period, includeOrders);
          break;
        case 'expenses':
          config = buildExpensesReport(res.data, period);
          break;
        case 'combined':
          config = buildCombinedReport(res.data, period, includeOrders);
          break;
      }

      config.includeSummary = includeSummary;
      config.filename = filename || autoFilename;

      await buildReport(config);
      addToast(`Report "${config.filename}" downloaded`, 'success');
      onClose();
    } catch (err: any) {
      console.error('[ExportReport] Error:', err);
      addToast(err?.response?.data?.error || 'Failed to generate report', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // Quick quarter presets
  const setQuarter = (q: number, y: string) => {
    setYearFrom(y);
    setYearTo(y);
    setMonthFrom((q - 1) * 3 + 1);
    setMonthTo(q * 3);
  };

  const setFullYear = (y: string) => {
    setYearFrom(y);
    setYearTo(y);
    setMonthFrom(1);
    setMonthTo(12);
  };

  return (
    <Modal open={open} onClose={onClose} title="Generate Excel Report" size="lg">
      <div className="space-y-5">

        {/* Report Type */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">Report Type</label>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium">
            {([
              { value: 'revenue', label: 'Revenue', color: 'bg-green-600 text-white' },
              { value: 'expenses', label: 'Expenses', color: 'bg-indigo-600 text-white' },
              { value: 'combined', label: 'Combined', color: 'bg-gray-700 text-white' },
            ] as { value: ReportType; label: string; color: string }[]).map((opt, i) => (
              <button key={opt.value}
                onClick={() => setReportType(opt.value)}
                className={`flex-1 px-3 py-2 transition-colors ${
                  reportType === opt.value ? opt.color : 'bg-white text-gray-600 hover:bg-gray-50'
                } ${i > 0 ? 'border-l border-gray-300' : ''}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Period */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">Period</label>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">Year From</label>
              <select value={yearFrom} onChange={e => { setYearFrom(e.target.value); if (e.target.value > yearTo) setYearTo(e.target.value); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">Year To</label>
              <select value={yearTo} onChange={e => { setYearTo(e.target.value); if (e.target.value < yearFrom) setYearFrom(e.target.value); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">Month From</label>
              <select value={monthFrom} onChange={e => { const v = +e.target.value; setMonthFrom(v); if (yearFrom === yearTo && v > monthTo) setMonthTo(v); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">Month To</label>
              <select value={monthTo} onChange={e => { const v = +e.target.value; setMonthTo(v); if (yearFrom === yearTo && v < monthFrom) setMonthFrom(v); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {years.slice(-2).map(y => (
              <button key={`fy-${y}`} onClick={() => setFullYear(y)}
                className="px-2 py-0.5 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50">{y}</button>
            ))}
            {[1, 2, 3, 4].map(q => (
              <button key={`q${q}`} onClick={() => setQuarter(q, yearTo)}
                className="px-2 py-0.5 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50">Q{q} {yearTo.slice(2)}</button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">Options</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={includeSummary} onChange={e => setIncludeSummary(e.target.checked)}
                className="rounded border-gray-300" />
              Include Summary tab
            </label>
            {(reportType === 'revenue' || reportType === 'combined') && (
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={includeOrders} onChange={e => setIncludeOrders(e.target.checked)}
                  className="rounded border-gray-300" />
                Include confirmed orders
              </label>
            )}
          </div>
        </div>

        {/* Filename */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Filename</label>
          <input type="text" value={filename || autoFilename}
            onChange={e => setFilename(e.target.value)}
            placeholder={autoFilename}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          <p className="text-[11px] text-gray-400 mt-0.5">.xlsx will be added automatically</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50">
            {generating ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {generating ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
