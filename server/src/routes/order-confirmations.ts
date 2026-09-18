import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import {
  buildOrderConfirmationPdf,
  formatLongDate,
  lineAmount,
  type OrderConfirmationData,
  type OcLine,
} from '../lib/order-confirmation-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

function companyDefaults(): Record<string, string> {
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'order_confirmation_company'`).get() as any;
    if (row?.value) return JSON.parse(row.value);
  } catch { /* fall through to built-in defaults */ }
  return {
    company_name: 'TripleW NL BV',
    company_address1: 'Blokstallen 2-B.',
    company_address2: '4611WB Bergen Op Zoom',
    company_country: 'The Netherlands',
  };
}

/** Next free `SONL<year><seq>OC` number, e.g. SONL20260107OC. */
function nextOcNumber(dateIso: string): string {
  const year = (dateIso || new Date().toISOString()).slice(0, 4);
  const prefix = `SONL${year}`;
  const rows = db.prepare(
    `SELECT oc_number FROM order_confirmations WHERE oc_number LIKE ?`
  ).all(`${prefix}%OC`) as Array<{ oc_number: string }>;

  let max = 0;
  for (const row of rows) {
    const m = row.oc_number.match(new RegExp(`^${prefix}(\\d+)OC$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}OC`;
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

/** Amounts grouped by currency — a confirmation may mix currencies per line. */
function totalsByCurrency(items: OcLine[]): Array<{ currency: string; amount: number }> {
  const totals: Record<string, number> = {};
  for (const item of items) {
    const cur = (item.currency || 'USD').toUpperCase();
    totals[cur] = (totals[cur] || 0) + lineAmount(item);
  }
  return Object.entries(totals).map(([currency, amount]) => ({ currency, amount }));
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

  const displayName = `${(data.oc_number || 'order-confirmation').replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;

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
    'SELECT id, operation_number FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as any[];

  // Reuse HS code / description last confirmed for the same product, so repeat
  // business doesn't retype the catalog text every time.
  const previous = db.prepare(
    'SELECT data FROM order_confirmations ORDER BY id DESC LIMIT 50'
  ).all() as Array<{ data: string }>;
  const knownByName: Record<string, { hs_code?: string; description?: string; reference?: string }> = {};
  for (const row of previous) {
    try {
      const parsed = JSON.parse(row.data) as OrderConfirmationData;
      for (const line of parsed.items || []) {
        const key = (line.commercial_name || '').trim().toLowerCase();
        if (key && !knownByName[key]) {
          knownByName[key] = {
            hs_code: line.hs_code || undefined,
            description: line.description || undefined,
            reference: line.reference || undefined,
          };
        }
      }
    } catch { /* skip unreadable rows */ }
  }

  const today = new Date().toISOString().slice(0, 10);
  const isSupplier = order.type === 'supplier';
  const clientName = isSupplier ? order.supplier_name : order.customer_name;

  const draft: OrderConfirmationData = {
    ...companyDefaults(),
    oc_number: nextOcNumber(order.order_date || today),
    client_name: clientName || '',
    contact_person: '',
    contact_phone: '',
    contact_email: (isSupplier ? order.supplier_email : order.customer_email) || '',
    client_phone: (isSupplier ? order.supplier_phone : order.customer_phone) || '',
    billing_address: (isSupplier ? order.supplier_address : order.customer_address) || '',
    tax_id: '',
    client_code: '',
    oc_date: today,
    sq_number: '',
    our_ref: items[0]?.description || order.description || '',
    po_number: order.order_number || '',
    items: items.map((item, index) => {
      const known = knownByName[(item.description || '').trim().toLowerCase()] || {};
      return {
        line: index + 1,
        reference: known.reference || '',
        commercial_name: item.description || '',
        packaging: item.packaging || '',
        quantity: Number(item.quantity) || 0,
        quantity_unit: (item.unit || 'tons').toUpperCase(),
        unit_price: Number(item.unit_price) || 0,
        price_unit: (item.unit || 'tons').toUpperCase(),
        currency: (item.currency || 'USD').toUpperCase(),
        hs_code: known.hs_code || '',
        description: known.description || '',
      };
    }),
    delivery: [order.inco_terms, order.destination].filter(Boolean).join(' ') || '',
    delivery_date_text: order.delivery_date ? formatLongDate(order.delivery_date) : '',
    note: order.notes || '',
    terms: order.payment_terms || '',
  };

  res.json({
    existing: null,
    draft,
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
  const { order_id, operation_id, data } = req.body as {
    order_id?: number; operation_id?: number | null; data?: OrderConfirmationData;
  };

  if (!order_id) { res.status(400).json({ error: 'order_id is required' }); return; }
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(order_id);
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  const payload: OrderConfirmationData = {
    ...data,
    oc_number: (data.oc_number || '').trim() || nextOcNumber(data.oc_date || ''),
  };

  // Reject before rendering, so a clash never leaves a stray PDF behind
  if (ocNumberTaken(payload.oc_number!)) {
    res.status(409).json({ error: `Order confirmation ${payload.oc_number} already exists` });
    return;
  }

  // Fall back to the operation already linked to the order
  let operationId: number | null = operation_id ?? null;
  if (operationId == null) {
    const linked = db.prepare('SELECT id FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order_id) as any;
    operationId = linked?.id ?? null;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    filed = await renderAndFile(payload, { operationId, userId: req.user?.userId });

    const result = db.prepare(`
      INSERT INTO order_confirmations (oc_number, order_id, operation_id, data, file_path, file_name, document_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.oc_number, order_id, operationId,
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

  const { data, operation_id } = req.body as { data?: OrderConfirmationData; operation_id?: number | null };
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
      SET oc_number = ?, operation_id = ?, data = ?, file_path = ?, file_name = ?, document_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(payload.oc_number, operationId, JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, existing.id);

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

  const totals = totalsByCurrency(data.items || [])
    .map(t => `${t.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t.currency}`)
    .join(' + ');

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p style="font-size:15px;">Dear ${escapeHtml(data.contact_person || data.client_name || 'Sir/Madam')},</p>
  ${bodyText
      ? `<p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>`
      : `<p style="font-size:14px;">Please find attached our order confirmation <strong>${escapeHtml(row.oc_number)}</strong>.</p>`}
  <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;margin-top:16px;">
    <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Confirmation</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(row.oc_number)}</td></tr>
    <tr><td style="padding:8px 12px;color:#6b7280;">Date</td><td style="padding:8px 12px;">${escapeHtml(formatLongDate(data.oc_date))}</td></tr>
    ${data.po_number ? `<tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">PO number</td><td style="padding:8px 12px;">${escapeHtml(data.po_number)}</td></tr>` : ''}
    ${totals ? `<tr><td style="padding:8px 12px;color:#6b7280;">Total</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(totals)}</td></tr>` : ''}
  </table>
  <p style="font-size:14px;margin-top:20px;">Kind regards,<br/>${escapeHtml(data.company_name || 'TripleW NL BV')}</p>
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
