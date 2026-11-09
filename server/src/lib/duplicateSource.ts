import db from '../database.js';

/**
 * An operation started as a copy of an earlier one (New Operation → "Start
 * from a previous operation", `operations.duplicated_from`): its order
 * confirmation and invoice drafts fill their blanks from that operation's
 * generated documents — client details, delivery, terms, freight /
 * insurance, remarks and each product line's reference / HS code / note.
 */

/** Header fields a duplicate's draft takes from the earlier document when its own is blank. */
const HEADER_FIELDS = [
  'client_code', 'client_name', 'billing_address', 'client_contact', 'client_phone', 'tax_id', 'eori',
  'contact_email', 'attention', 'delivery', 'delivery_address', 'delivery_contact', 'payment_terms',
  'incoterm', 'terms', 'remarks', 'notes', 'freight', 'insurance', 'vat', 'manufacturer',
  'country_of_origin', 'product_reference', 'bank_index',
];
/** Per line, matched by product name. */
const LINE_FIELDS = ['reference', 'packaging', 'hs_code', 'description', 'note'];

/** The earlier operation's latest generated OC / invoice data, when this order's operation is a duplicate. */
export function duplicateSourceData(orderId: number, kind: 'oc' | 'invoice'): any | null {
  try {
    const op = db.prepare('SELECT duplicated_from FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId) as any;
    if (!op?.duplicated_from) return null;
    const source = db.prepare('SELECT id, order_id FROM operations WHERE id = ?').get(op.duplicated_from) as any;
    if (!source) return null;
    const table = kind === 'oc' ? 'order_confirmations' : 'invoice_documents';
    const row = db.prepare(`
      SELECT data FROM ${table}
      WHERE (order_id = ? OR operation_id = ?) AND status != 'draft' AND nco_id IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(source.order_id ?? -1, source.id) as any;
    return row?.data ? JSON.parse(row.data) : null;
  } catch {
    return null;
  }
}

const blank = (v: unknown) => v == null || String(v).trim() === '' || (typeof v === 'number' && v === 0);

/** Fills the draft's blank fields and lines from the earlier operation's document. */
export function fillFromDuplicate<T extends Record<string, any>>(draft: T, source: any | null): T {
  if (!source) return draft;
  const out: any = { ...draft };
  for (const key of HEADER_FIELDS) {
    if (blank(out[key]) && !blank(source[key])) out[key] = source[key];
  }
  const sourceLines: any[] = Array.isArray(source.items) ? source.items : [];
  if (Array.isArray(out.items) && sourceLines.length) {
    const byName = new Map(sourceLines.map(l => [String(l.commercial_name || '').trim().toLowerCase(), l]));
    out.items = out.items.map((line: any, i: number) => {
      const match = byName.get(String(line.commercial_name || '').trim().toLowerCase()) || (out.items.length === sourceLines.length ? sourceLines[i] : null);
      if (!match) return line;
      const next = { ...line };
      for (const key of LINE_FIELDS) if (blank(next[key]) && !blank(match[key])) next[key] = match[key];
      return next;
    });
  }
  return out as T;
}
