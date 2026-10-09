import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { archiveStored, archiveFile, ownerOf, contextOf } from './archive.js';
import type { DocLine } from './document-pdf.js';
import { listProfiles } from './documentPrefill.js';
import { matchProfile } from './profileMatch.js';

/**
 * Non-commercial operations (samples) as a source for the document generators:
 * an NCO has no order, so its own sample lines stand in for the order lines,
 * and generated PDFs are filed under the NCO (`nco_documents`) instead of an
 * operation. NCO invoices never get a recorded `invoices` row — never revenue.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

/** A sample line as stored on the NCO (`non_commercial_operations.items`). */
export interface NcoLine {
  product?: string | null;
  reference?: string | null;
  quantity?: number | string | null;
  quantity_unit?: string | null;
  unit_price?: number | string | null;
  currency?: string | null;
  hs_code?: string | null;
  lots?: string[] | null;
}

export function normalizeNcoLines(raw: unknown): NcoLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l: any) => ({
      product: String(l?.product ?? '').trim(),
      reference: String(l?.reference ?? '').trim(),
      quantity: Number(l?.quantity) || 0,
      quantity_unit: String(l?.quantity_unit ?? 'KG').trim().toUpperCase() || 'KG',
      unit_price: Number(l?.unit_price) || 0,
      currency: String(l?.currency ?? 'EUR').trim().toUpperCase() || 'EUR',
      hs_code: String(l?.hs_code ?? '').trim(),
      lots: Array.isArray(l?.lots) ? l.lots.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : [],
    }))
    .filter(l => l.product || l.quantity);
}

export function parseNcoLines(json: string | null | undefined): NcoLine[] {
  try { return normalizeNcoLines(JSON.parse(json || '[]')); } catch { return []; }
}

/** The NCO with its customer, for drafting a document. */
export function ncoSource(ncoId: number): any | null {
  const row = db.prepare(`
    SELECT n.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
           c.address AS customer_address, c.company AS customer_company,
           c.vat_number AS customer_vat, c.contact_person AS customer_contact
    FROM non_commercial_operations n
    LEFT JOIN customers c ON c.id = n.customer_id
    WHERE n.id = ?
  `).get(ncoId) as any;
  if (!row) return null;
  return { ...row, lines: parseNcoLines(row.items) };
}

/** The NCO's lines as document lines. */
export function ncoDocLines(lines: NcoLine[]): DocLine[] {
  return lines.map((l, i) => ({
    line: i + 1,
    reference: l.reference || '',
    commercial_name: l.product || '',
    packaging: '',
    quantity: Number(l.quantity) || 0,
    quantity_unit: l.quantity_unit || 'KG',
    unit_price: Number(l.unit_price) || 0,
    currency: l.currency || 'EUR',
    hs_code: l.hs_code || '',
    description: '',
    lots: l.lots || [],
    lot: l.lots?.[0] || '',
    note: '',
  }));
}

export const NCO_CURRENCY = (lines: NcoLine[]) => String(lines.find(l => l.currency)?.currency || 'EUR').toUpperCase();

/** The customer's entity profile for an NCO (or the one asked for), plus the list to pick from. */
export function ncoProfile(nco: any, requestedProfileId: number | null) {
  const match = matchProfile(nco.customer_id, { notes: nco.notes }, null, requestedProfileId);
  return { match, profiles: listProfiles(nco.customer_id) };
}

/** Party fields every generated document takes from the customer (profile first). */
export function ncoPartyFields(nco: any, profile: any) {
  const shared = profile?.data?.shared || {};
  return {
    client_code: shared.client_code || '',
    attention: shared.attention || '',
    client_name: shared.legal_name || nco.customer_company || nco.customer_name || '',
    billing_address: shared.billing_address || nco.customer_address || '',
    client_contact: shared.contact_person || nco.customer_contact || '',
    client_phone: shared.contact_phone || nco.customer_phone || '',
    tax_id: shared.tax_id || nco.customer_vat || '',
    eori: shared.eori || '',
    contact_email: shared.contact_email || nco.customer_email || '',
  };
}

export const NO_COMMERCIAL_VALUE = 'No commercial value — samples for testing purposes only. Value for customs purposes only.';

// ── Filing under the NCO ──────────────────────────────────────────────────

function categoryId(name: string): number | null {
  db.prepare('INSERT OR IGNORE INTO document_categories (name) VALUES (?)').run(name);
  return (db.prepare('SELECT id FROM document_categories WHERE name = ?').get(name) as any)?.id ?? null;
}

/**
 * Keeps one `nco_documents` row in step with a generated PDF: updates the row
 * `existingId` when it still exists, else adds one. Returns its id.
 */
export function fileUnderNco(
  ncoId: number, existingId: number | null | undefined,
  category: string, storedName: string, displayName: string, notes: string,
): number {
  const catId = categoryId(category);
  const still = existingId ? db.prepare('SELECT id FROM nco_documents WHERE id = ?').get(existingId) : null;
  if (still) {
    db.prepare('UPDATE nco_documents SET nco_id = ?, category_id = ?, file_path = ?, file_name = ?, notes = ? WHERE id = ?')
      .run(ncoId, catId, storedName, displayName, notes, existingId);
    return existingId!;
  }
  const result = db.prepare('INSERT INTO nco_documents (nco_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)')
    .run(ncoId, catId, storedName, displayName, notes);
  return Number(result.lastInsertRowid);
}

/** Drops an NCO document row (the file belongs to its generated document, which removes it). */
export function dropNcoDocumentRow(id: number | null | undefined): void {
  if (id) { try { db.prepare('DELETE FROM nco_documents WHERE id = ?').run(id); } catch { /* best effort */ } }
}

/** Deletes an uploaded NCO document: row and file. */
export function deleteNcoUpload(row: { id: number; file_path: string; file_name?: string; nco_id?: number }): void {
  if (/^[a-zA-Z0-9._-]+$/.test(row.file_path)) {
    const abs = path.join(docsDir, row.file_path);
    if (row.id > 0) {
      // A document the user deletes goes to the Archive (id -1 = a refused upload, just removed)
      archiveFile(abs, { section: 'Non-commercial operations', context: ownerOf(null, row.nco_id ?? null).number, fileName: row.file_name });
    } else if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch { /* best effort */ } }
  }
  db.prepare('DELETE FROM nco_documents WHERE id = ?').run(row.id);
}

// ── Sample invoices ────────────────────────────────────────────────────────

/**
 * Sample invoice numbers: SI + entity + invoice date + a 3-digit running
 * number per entity and day (SIBE20260813001). Separate from the commercial
 * invoice series, which they never enter.
 */
export function nextSampleInvoiceNumber(entity: string, date?: string | null): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : new Date().toISOString().slice(0, 10);
  const prefix = `SI${entity}${d.replace(/-/g, '')}`;
  const rows = db.prepare(`SELECT invoice_number FROM invoice_documents WHERE invoice_number LIKE ?`).all(`${prefix}%`) as any[];
  let max = 0;
  for (const r of rows) {
    const m = String(r.invoice_number).slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** The sample quantity in words, as the sample invoices print it: "1 * 0.25KG sample". */
export function sampleQuantityText(quantity: unknown, unit?: string | null): string {
  const q = Number(quantity) || 0;
  if (!q) return '';
  const qty = q.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return `1 * ${qty}${(unit || 'KG').toUpperCase()} sample`;
}

/** NCO lines as sample-invoice lines: packaging and the quantity in words filled in. */
export function ncoSampleLines(lines: NcoLine[]): DocLine[] {
  return ncoDocLines(lines).map(l => ({
    ...l,
    packaging: l.packaging || 'Sample bottle',
    note: l.note || sampleQuantityText(l.quantity, l.quantity_unit),
  }));
}
