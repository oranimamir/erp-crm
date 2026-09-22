import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { entityFromOperationNumber, entityProfile, isEntityCode, type EntityCode } from '../lib/companyEntity.js';
import { deliveryTerms, listProfiles, prefillLines } from '../lib/documentPrefill.js';
import { matchProfile } from '../lib/profileMatch.js';
import {
  buildOrderConfirmationPdf,
  computeTotals,
  formatLongDate,
  type OrderConfirmationData,
} from '../lib/document-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Confirmations are filed as `<operation number>OC.pdf`. Without an operation
 * the confirmation number stands in, so the name is never just "OC.pdf".
 */
function confirmationFileName(operationNumber: string | null, ocNumber: string | null): string {
  const stem = (operationNumber || ocNumber || 'order-confirmation').trim();
  return `${stem.replace(/[^A-Za-z0-9._-]+/g, '-')}OC.pdf`;
}

function operationNumberFor(operationId: number | null): string | null {
  if (!operationId) return null;
  const row = db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(operationId) as any;
  return row?.operation_number ?? null;
}

function orderConfirmationCategoryId(): number | null {
  const row = db.prepare(`SELECT id FROM document_categories WHERE name = 'Order Confirmation'`).get() as any;
  return row?.id ?? null;
}

function parseRecord(row: any) {
  if (!row) return row;
  let data: OrderConfirmationData = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt rows surface as empty */ }
  return { ...row, data };
}

/**
 * Writes the PDF to operation-docs and keeps the operation_documents row in
 * sync, so the confirmation always appears under the operation's documents.
 * Returns the stored file name and document id.
 */
async function renderAndFile(
  data: OrderConfirmationData,
  opts: { operationId: number | null; existing?: any; userId?: number }
): Promise<{ filePath: string; fileName: string; documentId: number | null }> {
  const pdf = await buildOrderConfirmationPdf(data);

  fs.mkdirSync(docsDir, { recursive: true });
  const storedName = `oc-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, storedName), pdf);

  const displayName = confirmationFileName(operationNumberFor(opts.operationId), data.oc_number ?? null);

  // Drop the superseded file once the new one is safely on disk
  if (opts.existing?.file_path) {
    const old = path.join(docsDir, opts.existing.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }

  let documentId: number | null = opts.existing?.document_id ?? null;
  if (opts.operationId) {
    const categoryId = orderConfirmationCategoryId();
    const stillLinked = documentId
      ? db.prepare('SELECT id FROM operation_documents WHERE id = ?').get(documentId)
      : null;

    if (stillLinked) {
      db.prepare(
        `UPDATE operation_documents SET operation_id = ?, category_id = ?, file_path = ?, file_name = ? WHERE id = ?`
      ).run(opts.operationId, categoryId, storedName, displayName, documentId);
    } else {
      const result = db.prepare(
        `INSERT INTO operation_documents (operation_id, category_id, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?)`
      ).run(opts.operationId, categoryId, storedName, displayName, `Order Confirmation ${data.oc_number || ''}`.trim());
      documentId = Number(result.lastInsertRowid);
    }
  } else if (documentId) {
    // Operation link was removed — drop the stale document row
    db.prepare('DELETE FROM operation_documents WHERE id = ?').run(documentId);
    documentId = null;
  }

  return { filePath: storedName, fileName: displayName, documentId };
}

/** Undo a renderAndFile when the row it belongs to could not be written. */
function discardFiled(filed: { filePath: string; documentId: number | null }, keepDocumentId: number | null) {
  const orphan = path.join(docsDir, filed.filePath);
  if (fs.existsSync(orphan)) { try { fs.unlinkSync(orphan); } catch { /* best effort */ } }
  if (filed.documentId && filed.documentId !== keepDocumentId) {
    try { db.prepare('DELETE FROM operation_documents WHERE id = ?').run(filed.documentId); } catch { /* best effort */ }
  }
}

/** True when `ocNumber` is already taken by a different confirmation. */
function ocNumberTaken(ocNumber: string, exceptId?: number): boolean {
  const row = db.prepare('SELECT id FROM order_confirmations WHERE oc_number = ?').get(ocNumber) as any;
  return !!row && row.id !== exceptId;
}

// ── Prefill a draft from the uploaded order ───────────────────────────────

router.get('/prepare', (req: Request, res: Response) => {
  const orderId = parseInt(String(req.query.order_id || ''), 10);
  if (!Number.isInteger(orderId)) { res.status(400).json({ error: 'order_id is required' }); return; }

  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           c.address as customer_address, c.company as customer_company,
           s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone,
           s.address as supplier_address
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id
    WHERE o.id = ?
  `).get(orderId) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  // An order confirmation already issued for this order is the source of truth
  const existing = db.prepare(
    'SELECT * FROM order_confirmations WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;
  if (existing) { res.json({ existing: parseRecord(existing) }); return; }

  const operation = db.prepare(
    'SELECT id, operation_number, country FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as any[];

  const today = new Date().toISOString().slice(0, 10);
  const isSupplier = order.type === 'supplier';

  // Which TripleW entity issues this — SOBE… is Belgian, SONL… Dutch. An
  // explicit ?entity= wins so the heuristic can always be overridden.
  const requested = String(req.query.entity || '').toUpperCase();
  const entity: EntityCode = isEntityCode(requested)
    ? requested
    : entityFromOperationNumber(operation?.operation_number || order.order_number);
  const issuer = entityProfile(entity);

  // The customer's saved defaults (client code, tax id, terms, delivery…)
  // Which of the customer's legal entities this order belongs to. Never applied
  // silently — the client asks the user to confirm before generating.
  const requestedProfile = parseInt(String(req.query.profile_id || ''), 10);
  const match = matchProfile(
    isSupplier ? null : order.customer_id,
    order,
    operation?.country,
    Number.isInteger(requestedProfile) ? requestedProfile : null
  );
  const profile = match.profile;
  const shared = profile?.data.shared || {};
  const ocDefaults = profile?.data.order_confirmation || {};

  const draft: OrderConfirmationData = {
    ...issuer,
    // The operation number is the document's reference, per the master template
    oc_number: operation?.operation_number || order.order_number || '',
    oc_date: today,
    sq_number: '',
    our_ref: items[0]?.description || order.description || '',
    po_number: order.order_number || '',
    client_code: shared.client_code || '',
    client_name: shared.legal_name || (isSupplier ? order.supplier_name : order.customer_name) || '',
    billing_address: shared.billing_address || (isSupplier ? order.supplier_address : order.customer_address) || '',
    client_phone: shared.contact_phone || (isSupplier ? order.supplier_phone : order.customer_phone) || '',
    tax_id: shared.tax_id || '',
    contact_email: shared.contact_email || (isSupplier ? order.supplier_email : order.customer_email) || '',
    items: prefillLines(items),
    // The order's own terms win; the customer default fills the gap
    delivery: deliveryTerms(order) || ocDefaults.delivery || '',
    delivery_address: ocDefaults.delivery_address || issuer.delivery_address || '',
    delivery_contact: issuer.delivery_contact || '',
    delivery_date_text: order.delivery_date ? formatLongDate(order.delivery_date) : '',
    freight: 0,
    vat: 0,
    terms: order.payment_terms || ocDefaults.terms || '',
  };

  res.json({
    existing: null,
    draft,
    entity,
    profiles: listProfiles(isSupplier ? null : order.customer_id),
    profile_id: profile?.id ?? null,
    profile_name: profile?.name ?? null,
    matched_by: match.matchedBy,
    match_confident: match.confident,
    order: {
      id: order.id,
      order_number: order.order_number,
      type: order.type,
      customer_name: order.customer_name,
      supplier_name: order.supplier_name,
    },
    operation: operation || null,
  });
});

// ── List / read ───────────────────────────────────────────────────────────

router.get('/by-order/:orderId', (req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT * FROM order_confirmations WHERE order_id = ? ORDER BY id DESC'
  ).all(Number(req.params.orderId)) as any[];
  res.json(rows.map(parseRecord));
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Order confirmation not found' }); return; }
  res.json(parseRecord(row));
});

// ── Live preview (nothing is persisted) ───────────────────────────────────

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const pdf = await buildOrderConfirmationPdf((req.body?.data || {}) as OrderConfirmationData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="order-confirmation-preview.pdf"');
    res.send(pdf);
  } catch (err: any) {
    console.error('[order-confirmations] preview failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// ── Create ────────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { order_id, operation_id, profile_id, data } = req.body as {
    order_id?: number; operation_id?: number | null; profile_id?: number | null; data?: OrderConfirmationData;
  };

  if (!order_id) { res.status(400).json({ error: 'order_id is required' }); return; }
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const order = db.prepare('SELECT id, order_number FROM orders WHERE id = ?').get(order_id) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  // Fall back to the operation already linked to the order
  let operationId: number | null = operation_id ?? null;
  if (operationId == null) {
    const linked = db.prepare('SELECT id FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order_id) as any;
    operationId = linked?.id ?? null;
  }

  const payload: OrderConfirmationData = {
    ...data,
    oc_number: (data.oc_number || '').trim()
      || operationNumberFor(operationId)
      || (order as any).order_number
      || '',
  };
  if (!payload.oc_number) { res.status(400).json({ error: 'A confirmation number is required' }); return; }

  // Reject before rendering, so a clash never leaves a stray PDF behind
  if (ocNumberTaken(payload.oc_number)) {
    res.status(409).json({ error: `Order confirmation ${payload.oc_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    filed = await renderAndFile(payload, { operationId, userId: req.user?.userId });

    const result = db.prepare(`
      INSERT INTO order_confirmations (oc_number, order_id, operation_id, profile_id, data, file_path, file_name, document_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.oc_number, order_id, operationId, profile_id ?? null,
      JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, req.user?.userId ?? null
    );

    const row = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(result.lastInsertRowid);
    notifyAdmin({
      action: 'created', entity: 'Order Confirmation', label: payload.oc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.status(201).json(parseRecord(row));
  } catch (err: any) {
    if (filed) discardFiled(filed, null);
    if (err?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: `Order confirmation ${payload.oc_number} already exists` });
      return;
    }
    console.error('[order-confirmations] create failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to generate the order confirmation' });
  }
});

// ── Update (regenerates the PDF and replaces the filed document) ──────────

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Order confirmation not found' }); return; }

  const { data, operation_id, profile_id } = req.body as { data?: OrderConfirmationData; operation_id?: number | null; profile_id?: number | null };
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const payload: OrderConfirmationData = {
    ...data,
    oc_number: (data.oc_number || '').trim() || existing.oc_number,
  };
  const operationId = operation_id !== undefined ? operation_id : existing.operation_id;

  if (ocNumberTaken(payload.oc_number!, existing.id)) {
    res.status(409).json({ error: `Order confirmation ${payload.oc_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    filed = await renderAndFile(payload, { operationId, existing, userId: req.user?.userId });

    db.prepare(`
      UPDATE order_confirmations
      SET oc_number = ?, operation_id = ?, profile_id = ?, data = ?, file_path = ?, file_name = ?, document_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(payload.oc_number, operationId, profile_id ?? existing.profile_id ?? null, JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, existing.id);

    const row = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(existing.id);
    notifyAdmin({
      action: 'updated', entity: 'Order Confirmation', label: payload.oc_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json(parseRecord(row));
  } catch (err: any) {
    // The superseded file is already gone, so only discard what this call wrote
    if (filed) discardFiled(filed, existing.document_id);
    if (err?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: `Order confirmation ${payload.oc_number} already exists` });
      return;
    }
    console.error('[order-confirmations] update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to regenerate the order confirmation' });
  }
});

// ── Download ──────────────────────────────────────────────────────────────

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row?.file_path) { res.status(404).json({ error: 'Order confirmation not found' }); return; }

  const filePath = path.join(docsDir, row.file_path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.file_name || 'order-confirmation.pdf'}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ── Email to the customer ─────────────────────────────────────────────────

router.post('/:id/email', async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Order confirmation not found' }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(501).json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }); return; }

  const recipients = String(req.body?.to || '')
    .split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if (!recipients.length) { res.status(400).json({ error: 'At least one recipient email is required' }); return; }

  const invalid = recipients.filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.join(', ')}` }); return; }

  const filePath = row.file_path ? path.join(docsDir, row.file_path) : null;
  if (!filePath || !fs.existsSync(filePath)) { res.status(404).json({ error: 'Generated PDF is missing — save the confirmation again' }); return; }

  const data = parseRecord(row).data as OrderConfirmationData;
  const subject = String(req.body?.subject || '').trim()
    || `Order Confirmation ${row.oc_number}${data.client_name ? ` — ${data.client_name}` : ''}`;
  const bodyText = String(req.body?.message || '').trim();

  const { total, currency } = computeTotals(data);
  const totals = `${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p style="font-size:15px;">Dear ${escapeHtml(data.client_name || 'Sir/Madam')},</p>
  ${bodyText
      ? `<p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>`
      : `<p style="font-size:14px;">Please find attached our order confirmation <strong>${escapeHtml(row.oc_number)}</strong>.</p>`}
  <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;margin-top:16px;">
    <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Confirmation</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(row.oc_number)}</td></tr>
    <tr><td style="padding:8px 12px;color:#6b7280;">Date</td><td style="padding:8px 12px;">${escapeHtml(formatLongDate(data.oc_date))}</td></tr>
    ${data.po_number ? `<tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">PO number</td><td style="padding:8px 12px;">${escapeHtml(data.po_number)}</td></tr>` : ''}
    ${totals ? `<tr><td style="padding:8px 12px;color:#6b7280;">Total</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(totals)}</td></tr>` : ''}
  </table>
  <p style="font-size:14px;margin-top:20px;">Kind regards,<br/>${escapeHtml(data.company_name || 'TripleW BV')}</p>
</div>`;

  try {
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || 'CirculERP <onboarding@resend.dev>';
    const { error } = await resend.emails.send({
      from,
      to: recipients,
      subject,
      html,
      attachments: [{ filename: row.file_name || 'order-confirmation.pdf', content: fs.readFileSync(filePath).toString('base64') }],
    });
    if (error) throw new Error(error.message || 'Resend rejected the message');

    db.prepare(`UPDATE order_confirmations SET sent_to = ?, sent_at = datetime('now') WHERE id = ?`)
      .run(recipients.join(', '), row.id);

    notifyAdmin({
      action: 'updated', entity: 'Order Confirmation', label: row.oc_number,
      detail: `emailed to ${recipients.join(', ')}`,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });

    const updated = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(row.id);
    res.json({ message: `Order confirmation sent to ${recipients.join(', ')}`, confirmation: parseRecord(updated) });
  } catch (err: any) {
    console.error('[order-confirmations] email failed:', err?.message || err);
    res.status(502).json({ error: `Failed to send email: ${err?.message || 'unknown error'}` });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM order_confirmations WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Order confirmation not found' }); return; }

  if (row.file_path) {
    const filePath = path.join(docsDir, row.file_path);
    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch { /* best effort */ } }
  }
  if (row.document_id) db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
  db.prepare('DELETE FROM order_confirmations WHERE id = ?').run(row.id);

  notifyAdmin({
    action: 'deleted', entity: 'Order Confirmation', label: row.oc_number,
    performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
  });
  res.json({ message: 'Order confirmation deleted' });
});

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default router;
