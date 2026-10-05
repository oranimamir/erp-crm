import { Plus, X } from 'lucide-react';
import { acceptPlaceholderOnTab } from '../lib/placeholderTab';

/**
 * A line's lot numbers: one field, plus as many more as "Add lot" asks for.
 * Read from `lots`, else the older `lot` … `lot4` fields.
 */
export function lotsOf(raw: any): string[] {
  const list = Array.isArray(raw?.lots) ? raw.lots : [raw?.lot, raw?.lot2, raw?.lot3, raw?.lot4];
  const lots = list.map((l: unknown) => String(l ?? '')).filter((l: string, i: number) => i === 0 || l.trim());
  return lots.length ? lots : [''];
}

/** What a line saves: the list, with `lot` mirroring the first one. */
export function lotFieldsFor(lots: string[]) {
  const kept = lots.map(l => l.trim()).filter(Boolean);
  return { lots: kept, lot: kept[0] ?? '', lot2: undefined, lot3: undefined, lot4: undefined };
}

const inputCls =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export default function LotFields({ lots, onChange, placeholder, className = '' }: {
  lots: string[]; onChange: (lots: string[]) => void; placeholder?: string; className?: string;
}) {
  const set = (i: number, v: string) => onChange(lots.map((l, j) => (j === i ? v : l)));
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-gray-500">{lots.length > 1 ? 'Lots' : 'Lot'}</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {lots.map((lot, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={lot} placeholder={i === 0 ? placeholder : `Lot ${i + 1}`}
              onChange={e => set(i, e.target.value)}
              onKeyDown={e => i === 0 && acceptPlaceholderOnTab(e, lot, placeholder, v => set(0, v))}
              className={inputCls} />
            {i > 0 && (
              <button type="button" onClick={() => onChange(lots.filter((_, j) => j !== i))} title="Remove this lot"
                className="p-1 rounded text-gray-400 hover:text-red-600"><X size={14} /></button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...lots, ''])}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
        <Plus size={12} /> Add lot
      </button>
    </div>
  );
}
