/**
 * Project expenses: supplier invoices (`demo_invoices`, domain 'project') whose
 * sub category is a technology project — a technology operation, named by its
 * title (else its TO number). Each one is mirrored as an expense of that
 * operation (`technology_expenses.demo_invoice_id`), so it can be billed on a TI
 * invoice. The supplier invoice is the source: the mirror follows its edits and
 * goes when it is deleted or moved out of the project — unless the expense is
 * already on a final TI invoice, which locks the supplier invoice.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import db from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const expenseDir = path.join(uploadsBase, 'technology-expenses');

export interface ProjectOption { to_id: number; label: string; to_number: string; title: string | null; status: string }

/** Technology operations as project sub categories (cancelled ones left out). Label = title, else the TO number; a title used twice gets its number. */
export function projectOptions(includeCancelled = false): ProjectOption[] {
  const rows = db.prepare(`SELECT id, to_number, title, status FROM technology_operations ${includeCancelled ? '' : "WHERE status != 'cancelled'"} ORDER BY id`).all() as any[];
  const titles = new Map<string, number>();
  for (const r of rows) if (r.title) titles.set(r.title.toLowerCase(), (titles.get(r.title.toLowerCase()) || 0) + 1);
  return rows.map(r => ({
    to_id: r.id, to_number: r.to_number, title: r.title, status: r.status,
    label: !r.title ? r.to_number : (titles.get(r.title.toLowerCase())! > 1 ? `${r.title} (${r.to_number})` : r.title),
  }));
}

/** The project a sub category names: its label, title or TO number (any case). */
export function projectByLabel(label: string | null | undefined): ProjectOption | null {
  const l = String(label || '').trim().toLowerCase();
  if (!l) return null;
  const all = projectOptions(true);
  return all.find(p => p.label.toLowerCase() === l)
    || all.find(p => (p.title || '').toLowerCase() === l)
    || all.find(p => p.to_number.toLowerCase() === l)
    || null;
}

/** The final TI invoice a project invoice's expense is billed on, if any (then the invoice can't be changed). */
export function billedOn(demoInvoiceId: number): string | null {
  const r = db.prepare(`
    SELECT d.invoice_number FROM technology_expenses e
    JOIN invoice_documents d ON d.id = e.invoice_document_id
    WHERE e.demo_invoice_id = ? AND d.status = 'final'
  `).get(demoInvoiceId) as any;
  return r ? r.invoice_number || 'a TI invoice' : null;
}

function copyPdf(embedded: string | null): { file_path: string | null; sha: string | null } {
  if (!embedded) return { file_path: null, sha: null };
  try {
    const buf = Buffer.from(embedded, 'base64');
    if (!buf.length) return { file_path: null, sha: null };
    fs.mkdirSync(expenseDir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(expenseDir, name), buf);
    return { file_path: name, sha: crypto.createHash('sha256').update(buf).digest('hex') };
  } catch (err: any) {
    console.warn('[project-expenses] could not copy the PDF:', err?.message || err);
    return { file_path: null, sha: null };
  }
}

function removeFile(name: string | null) {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) return;
  try { fs.unlinkSync(path.join(expenseDir, name)); } catch { /* already gone */ }
}

/**
 * Bring every mirror in line with the project invoices. Idempotent and cheap;
 * run after any change to supplier invoices or technology operations.
 */
export function syncProjectExpenses(): void {
  try {
    const invoices = db.prepare(`
      SELECT id, invoice_id, issue_date, supplier, category, to_id, amount, vat_amount, currency, fx_rate, eur_amount, pdf_filename,
        (embedded_pdf IS NOT NULL AND embedded_pdf != '') AS has_pdf
      FROM demo_invoices WHERE domain = 'project'
    `).all() as any[];
    const mirrors = db.prepare(`
      SELECT e.*, d.status AS invoice_status FROM technology_expenses e
      LEFT JOIN invoice_documents d ON d.id = e.invoice_document_id
      WHERE e.demo_invoice_id IS NOT NULL
    `).all() as any[];
    const mirrorOf = new Map<number, any>(mirrors.map(m => [m.demo_invoice_id, m]));
    const wanted = new Set<number>();
    let changed = false;

    for (const inv of invoices) {
      const project = projectByLabel(inv.category)
        || (inv.to_id ? projectOptions(true).find(p => p.to_id === inv.to_id) || null : null);
      const toId = project?.to_id ?? null;
      if (toId !== inv.to_id) { db.prepare('UPDATE demo_invoices SET to_id = ? WHERE id = ?').run(toId, inv.id); changed = true; }
      if (!toId) continue;
      wanted.add(inv.id);
      const m = mirrorOf.get(inv.id);
      if (m && m.invoice_status === 'final') continue; // billed — frozen
      const net = Number(inv.amount) || 0;
      const vat = inv.vat_amount == null ? null : Number(inv.vat_amount);
      const fields = {
        to_id: toId, expense_date: inv.issue_date || null, supplier_name: inv.supplier || null, reference: inv.invoice_id || null,
        net_amount: net, vat_amount: vat, total_amount: Math.round((net + (vat || 0)) * 100) / 100,
        currency: (inv.currency || 'EUR').toUpperCase(),
        fx_rate: inv.fx_rate ?? ((inv.currency || 'EUR').toUpperCase() === 'EUR' ? 1 : null),
        eur_amount: inv.eur_amount ?? ((inv.currency || 'EUR').toUpperCase() === 'EUR' ? net : null),
      };
      if (!m) {
        const pdf = inv.has_pdf ? (db.prepare('SELECT embedded_pdf FROM demo_invoices WHERE id = ?').get(inv.id) as any)?.embedded_pdf : null;
        const file = copyPdf(pdf);
        db.prepare(`
          INSERT INTO technology_expenses (to_id, expense_date, supplier_name, reference, net_amount, vat_amount, total_amount,
            currency, fx_rate, eur_amount, file_path, file_name, sha256, read_by, demo_invoice_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'project', ?)
        `).run(fields.to_id, fields.expense_date, fields.supplier_name, fields.reference, fields.net_amount, fields.vat_amount,
          fields.total_amount, fields.currency, fields.fx_rate, fields.eur_amount, file.file_path,
          file.file_path ? (inv.pdf_filename || `${inv.invoice_id || 'invoice'}.pdf`) : null, file.sha, inv.id);
        changed = true;
        continue;
      }
      const differs = (Object.keys(fields) as (keyof typeof fields)[]).some(k => String(m[k] ?? '') !== String(fields[k] ?? ''));
      if (!differs) continue;
      // Moved to another project: it leaves the draft invoice it was on
      const moved = m.to_id !== toId;
      db.prepare(`
        UPDATE technology_expenses SET to_id = ?, expense_date = ?, supplier_name = ?, reference = ?, net_amount = ?, vat_amount = ?,
          total_amount = ?, currency = ?, fx_rate = ?, eur_amount = ?${moved ? ', invoice_document_id = NULL' : ''}, read_warning = NULL
        WHERE id = ?
      `).run(fields.to_id, fields.expense_date, fields.supplier_name, fields.reference, fields.net_amount, fields.vat_amount,
        fields.total_amount, fields.currency, fields.fx_rate, fields.eur_amount, m.id);
      changed = true;
    }

    // Mirrors whose supplier invoice is gone or no longer a project expense (billed ones stay)
    for (const m of mirrors) {
      if (wanted.has(m.demo_invoice_id) || m.invoice_status === 'final') continue;
      db.prepare('DELETE FROM technology_expenses WHERE id = ?').run(m.id);
      removeFile(m.file_path); // a copy — the supplier invoice keeps (or archived) the original
      changed = true;
    }
    if (changed) db.saveToDisk();
  } catch (err: any) {
    console.error('[project-expenses] sync failed:', err?.message || err);
  }
}

/** A TO's title changed: its project invoices follow the new label. */
export function relabelProject(toId: number): void {
  const p = projectOptions(true).find(o => o.to_id === toId);
  if (!p) return;
  db.prepare("UPDATE demo_invoices SET category = ? WHERE domain = 'project' AND to_id = ?").run(p.label, toId);
}
