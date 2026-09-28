/**
 * Edits the shape of a customer's Packing List: heading, header rows, column
 * names and order, kg or lb, what prints under the table. The layout arrives
 * from the customer's last PL (or the one seeded from the PLs they received).
 */
import { ChevronDown, ChevronUp, Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import { RowList, Toggle } from './InvoiceLayoutEditor';
import { DETAIL_FIELDS, FIELD_LABELS } from '../lib/invoiceLayout';
import {
  DEFAULT_PL_LAYOUT, PL_COLUMN_HINTS, PL_COLUMN_KEYS, PL_COLUMN_LABELS, PL_META_FIELDS,
  type PackingListLayout, type PlColumnKey,
} from '../lib/packingListLayout';

const input =
  'block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

/** On a packing list the document number is the PL's own; the invoice's is its own row. */
const PL_FIELD_LABELS: Record<string, string> = {
  ...FIELD_LABELS,
  doc_number: 'Packing list number',
  invoice_number: 'Invoice number',
};

export default function PackingListLayoutEditor({
  layout, source, customerName, canSaveDefault, saving, onChange, onSaveDefault,
}: {
  layout: PackingListLayout;
  source: string;
  customerName: string;
  onChange: (layout: PackingListLayout) => void;
  onSaveDefault: () => void;
  canSaveDefault: boolean;
  saving: boolean;
}) {
  const set = <K extends keyof PackingListLayout>(key: K, value: PackingListLayout[K]) =>
    onChange({ ...layout, [key]: value });
  const setLabel = (key: keyof PackingListLayout['labels'], value: string) =>
    onChange({ ...layout, labels: { ...layout.labels, [key]: value } });

  const unusedColumns = PL_COLUMN_KEYS.filter(k => !layout.columns.some(c => c.key === k));
  const moveColumn = (index: number, by: number) => {
    const next = [...layout.columns];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set('columns', next);
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        Taken from <strong className="text-gray-700">{source}</strong>. Changes apply to this packing list only until you
        save them as {customerName ? <strong className="text-gray-700">{customerName}</strong> : 'the customer'}&rsquo;s format.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Heading</label>
          <input value={layout.title} onChange={e => set('title', e.target.value)} className={input} placeholder="Packing List" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Weights in</label>
          <select value={layout.weight_unit} onChange={e => set('weight_unit', e.target.value as PackingListLayout['weight_unit'])} className={input}>
            <option value="kg">kg</option>
            <option value="lb">lb per unit, kg + lb per pallet and total</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">Where the HS code prints</label>
          <select value={layout.hs_code} onChange={e => set('hs_code', e.target.value as PackingListLayout['hs_code'])} className={input}>
            <option value="line">Under the product name</option>
            <option value="panel">In the panel under the table</option>
            <option value="off">Not printed</option>
          </select>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <RowList
          title="Document details (right-hand column)"
          hint="Printed beside the consignee block, in this order."
          rows={layout.meta} fields={PL_META_FIELDS} fieldLabels={PL_FIELD_LABELS}
          onChange={rows => set('meta', rows)}
        />
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Consignee block labels</h4>
        <p className="text-xs text-gray-400">Leave a label empty to print the value without one.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            ['to', 'Consignee name'], ['contact', 'Contact person'], ['address', 'Address'], ['tax', 'Tax ID'],
          ] as Array<[keyof PackingListLayout['labels'], string]>).map(([key, label]) => (
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
          Headings as the customer sees them (&ldquo;Bags per pallet&rdquo;, &ldquo;Tote&rdquo;). Widths are shares of the page.
        </p>
        {layout.columns.map((col, index) => (
          <div key={col.key} className="flex items-center gap-1.5">
            <span className="w-36 shrink-0 text-xs text-gray-500 leading-tight">
              {PL_COLUMN_LABELS[col.key]}
              {PL_COLUMN_HINTS[col.key] && <span className="block text-[10px] text-gray-400">{PL_COLUMN_HINTS[col.key]}</span>}
            </span>
            <input
              value={col.label}
              onChange={e => set('columns', layout.columns.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)))}
              className={`${input} flex-1`}
            />
            <input
              type="number" min={10} step={1} value={Math.round(col.width)}
              onChange={e => set('columns', layout.columns.map((c, i) => (i === index ? { ...c, width: Number(e.target.value) || c.width } : c)))}
              className={`${input} w-16`}
            />
            <button type="button" onClick={() => moveColumn(index, -1)} disabled={index === 0}
              className="p-1.5 rounded text-gray-400 hover:bg-gray-100 disabled:opacity-30" title="Move left">
              <ChevronUp size={14} />
            </button>
            <button type="button" onClick={() => moveColumn(index, 1)} disabled={index === layout.columns.length - 1}
              className="p-1.5 rounded text-gray-400 hover:bg-gray-100 disabled:opacity-30" title="Move right">
              <ChevronDown size={14} />
            </button>
            <button type="button" onClick={() => set('columns', layout.columns.filter((_, i) => i !== index))}
              disabled={layout.columns.length <= 2}
              className="p-1.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-30" title="Remove column">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {unusedColumns.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {unusedColumns.map((key: PlColumnKey) => (
              <button
                key={key} type="button"
                onClick={() => set('columns', [...layout.columns, { key, label: PL_COLUMN_LABELS[key], width: 50 }])}
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                <Plus size={12} /> {PL_COLUMN_LABELS[key]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">What the document carries</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Toggle label="Lot number" hint="Under the product name, when there is no Lot column" checked={layout.show_lot} onChange={v => set('show_lot', v)} />
          <Toggle label="Product description" hint="The long paragraph in the panel" checked={layout.show_description} onChange={v => set('show_description', v)} />
          <Toggle label="Manufacturer and country of origin" checked={layout.origin} onChange={v => set('origin', v)} />
          <Toggle label="Terms & Conditions" checked={layout.show_terms} onChange={v => set('show_terms', v)} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <RowList
          title="Panel under the table"
          hint="Printed after Total Net Weight, Number of packages and Total Gross Weight."
          rows={layout.details} fields={DETAIL_FIELDS}
          onChange={rows => set('details', rows)}
        />
      </div>

      <div className="border-t border-gray-100 pt-4 flex flex-wrap items-center gap-2">
        <button
          type="button" onClick={onSaveDefault} disabled={!canSaveDefault || saving}
          title={canSaveDefault ? undefined : 'The invoice has no customer profile to save it on'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <Save size={14} /> Save as this customer&rsquo;s format
        </button>
        <button
          type="button" onClick={() => onChange(DEFAULT_PL_LAYOUT)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
        >
          <RotateCcw size={14} /> Reset to the standard template
        </button>
      </div>
    </div>
  );
}
