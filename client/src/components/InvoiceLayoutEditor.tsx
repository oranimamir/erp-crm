/**
 * Edits the shape of a customer's Commercial Invoice: what the rows are
 * called, which of them appear, where the HS code and lot print, which totals
 * are carried. The layout arrives pre-filled from that customer's last invoice
 * — this is how the user changes it.
 */
import { ChevronDown, ChevronUp, Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import {
  COLUMN_KEYS, DEFAULT_LAYOUT, DETAIL_FIELDS, FIELD_LABELS, META_FIELDS, TOTAL_FIELDS,
  type ColumnKey, type InvoiceLayout, type LayoutRow,
} from '../lib/invoiceLayout';

const input =
  'block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function Toggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
      <span className="text-sm text-gray-700 leading-tight">
        {label}
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * An ordered list of label/field rows — used for the meta column, the detail
 * panel and the totals, which differ only in which fields they offer.
 */
function RowList<F extends string>({ title, hint, rows, fields, onChange }: {
  title: string; hint: string;
  rows: Array<LayoutRow<F>>; fields: F[];
  onChange: (rows: Array<LayoutRow<F>>) => void;
}) {
  const unused = fields.filter(f => !rows.some(r => r.field === f));

  const move = (index: number, by: number) => {
    const next = [...rows];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
        <p className="text-xs text-gray-400">{hint}</p>
      </div>

      {rows.length === 0 && <p className="text-xs text-gray-400 italic">No rows — this block is left off the invoice.</p>}

      {rows.map((row, index) => (
        <div key={`${row.field}-${index}`} className="flex items-center gap-1.5">
          <input
            value={row.label}
            placeholder="Label as printed"
            onChange={e => onChange(rows.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))}
            className={`${input} flex-1`}
          />
          <select
            value={row.field}
            onChange={e => onChange(rows.map((r, i) => (i === index ? { ...r, field: e.target.value as F } : r)))}
            className={`${input} flex-1`}
          >
            {[row.field, ...unused].map(f => (
              <option key={f} value={f}>{FIELD_LABELS[f] || f}</option>
            ))}
          </select>
          <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 disabled:opacity-30" title="Move up">
            <ChevronUp size={14} />
          </button>
          <button type="button" onClick={() => move(index, 1)} disabled={index === rows.length - 1}
            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 disabled:opacity-30" title="Move down">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== index))}
            className="p-1.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50" title="Remove row">
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {unused.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...rows, { label: `${FIELD_LABELS[unused[0]] || unused[0]} :`, field: unused[0] }])}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
        >
          <Plus size={12} /> Add {FIELD_LABELS[unused[0]] || unused[0]}
        </button>
      )}
    </div>
  );
}

export default function InvoiceLayoutEditor({
  layout, source, customerName, canSaveDefault, saving, onChange, onSaveDefault,
}: {
  layout: InvoiceLayout;
  source: string;
  customerName: string;
  canSaveDefault: boolean;
  saving: boolean;
  onChange: (layout: InvoiceLayout) => void;
  onSaveDefault: () => void;
}) {
  const set = <K extends keyof InvoiceLayout>(key: K, value: InvoiceLayout[K]) =>
    onChange({ ...layout, [key]: value });

  const setLabel = (key: keyof InvoiceLayout['labels'], value: string) =>
    onChange({ ...layout, labels: { ...layout.labels, [key]: value } });

  const unusedColumns = COLUMN_KEYS.filter(k => !layout.columns.some(c => c.key === k));

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        Taken from <strong className="text-gray-700">{source}</strong>. Changes apply to this invoice only
        until you save them as {customerName ? <strong className="text-gray-700">{customerName}</strong> : 'the customer'}&rsquo;s format.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Heading</label>
          <input value={layout.title} onChange={e => set('title', e.target.value)} className={input}
            placeholder="Commercial Invoice" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Where the HS code prints</label>
          <select value={layout.hs_code} onChange={e => set('hs_code', e.target.value as InvoiceLayout['hs_code'])} className={input}>
            <option value="line">Inside the product cell</option>
            <option value="panel">In the panel under the table</option>
            <option value="off">Not printed</option>
          </select>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <RowList
          title="Document details (right-hand column)"
          hint="Printed beside the client block, in this order."
          rows={layout.meta} fields={META_FIELDS}
          onChange={rows => set('meta', rows)}
        />
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Client block labels</h4>
        <p className="text-xs text-gray-400">Leave a label empty to print the value without one.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            ['to', 'Client name'], ['contact', 'Contact person'], ['address', 'Address'],
            ['tax', 'Tax ID'], ['eori', 'EORI'],
          ] as Array<[keyof InvoiceLayout['labels'], string]>).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">{label}</label>
              <input value={layout.labels[key]} onChange={e => setLabel(key, e.target.value)} className={input} />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Table columns</h4>
        <p className="text-xs text-gray-400">
          Column headings as the customer sees them — Independent Chemical&rsquo;s read &ldquo;Quantity lb&rdquo; and
          &ldquo;Price/lb USD&rdquo;. Widths are shares of the page and are rescaled to fit.
        </p>
        {layout.columns.map((col, index) => (
          <div key={col.key} className="flex items-center gap-1.5">
            <span className="w-32 shrink-0 text-xs text-gray-500">{FIELD_LABELS[col.key] || col.key}</span>
            <input
              value={col.label}
              onChange={e => set('columns', layout.columns.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)))}
              className={`${input} flex-1`}
            />
            <input
              type="number" min={10} step={1} value={Math.round(col.width)}
              onChange={e => set('columns', layout.columns.map((c, i) => (i === index ? { ...c, width: Number(e.target.value) || c.width } : c)))}
              className={`${input} w-20`}
            />
            <button type="button" onClick={() => set('columns', layout.columns.filter((_, i) => i !== index))}
              disabled={layout.columns.length <= 2}
              className="p-1.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-30" title="Remove column">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {unusedColumns.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {unusedColumns.map((key: ColumnKey) => (
              <button
                key={key} type="button"
                onClick={() => set('columns', [...layout.columns, { key, label: FIELD_LABELS[key] || key, width: 72 }])}
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                <Plus size={12} /> {FIELD_LABELS[key] || key}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">What each line carries</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Toggle label="Lot number" hint="Printed under the product name" checked={layout.show_lot} onChange={v => set('show_lot', v)} />
          <Toggle label="Packing note" hint="e.g. 80 drums on 20 pallets" checked={layout.show_line_note} onChange={v => set('show_line_note', v)} />
          <Toggle label="Product description" hint="The long paragraph in the panel" checked={layout.show_description} onChange={v => set('show_description', v)} />
          <Toggle label="TOTAL row across the table" hint="Sums quantity and amount when there is more than one line" checked={layout.show_quantity_total} onChange={v => set('show_quantity_total', v)} />
          <Toggle label="Offer manufacturer and origin" hint="Pre-ticks the origin block for this customer" checked={layout.origin} onChange={v => set('origin', v)} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <RowList
          title="Panel under the table"
          hint="Delivery, payment terms and any remarks."
          rows={layout.details} fields={DETAIL_FIELDS}
          onChange={rows => set('details', rows)}
        />
      </div>

      <div className="border-t border-gray-100 pt-4">
        <RowList
          title="Totals"
          hint="Total is always subtotal plus freight, insurance and VAT."
          rows={layout.totals} fields={TOTAL_FIELDS}
          onChange={rows => set('totals', rows)}
        />
      </div>

      <div className="border-t border-gray-100 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Terms heading</label>
          <input value={layout.terms_heading} onChange={e => set('terms_heading', e.target.value)} className={input} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Bank heading</label>
          <input value={layout.bank_heading} onChange={e => set('bank_heading', e.target.value)} className={input} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4 flex flex-wrap items-center gap-2">
        <button
          type="button" onClick={onSaveDefault} disabled={!canSaveDefault || saving}
          title={canSaveDefault ? undefined : 'Pick the customer entity first'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <Save size={14} /> Save as this customer&rsquo;s format
        </button>
        <button
          type="button" onClick={() => onChange(DEFAULT_LAYOUT)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
        >
          <RotateCcw size={14} /> Reset to the standard template
        </button>
      </div>
    </div>
  );
}
