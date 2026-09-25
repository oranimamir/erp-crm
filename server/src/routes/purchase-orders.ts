import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { entityFromOperationNumber, entityProfile, isEntityCode, type EntityCode } from '../lib/companyEntity.js';
import { deliveryTerms, prefillLines } from '../lib/documentPrefill.js';
import {
  buildPurchaseOrderPdf,
  computeTotals,
  formatLongDate,
  type PurchaseOrderData,
} from '../lib/document-pdf.js';

/**
 * Supplier purchase orders for trading operations: the customer's order bought
 * from a supplier, printed on the Order Confirmation template and issued by the
 * TripleW entity the operation belongs to.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsBase, 'operation-docs');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

/** Purchase orders are filed as `<operation number>PO.pdf`. */
function purchaseOrderFileName(operationNumber: string | null, poNumber: string | null): string {
  const stem = (operationNumber || poNumber || 'purchase-order').trim();
  return `${stem.replace(/[^A-Za-z0-9._-]+/g, '-')}PO.pdf`;
}

function operationNumberFor(operationId: number | null): string | null {
  if (!operationId) return null;
  const row = db.prepare('SELECT operation_number FROM operations WHERE id = ?').get(operationId) as any;
  return row?.operation_number ?? null;
}

function purchaseOrderCategoryId(): number | null {
  const row = db.prepare(`SELECT id FROM document_categories WHERE name = 'Purchase Order'`).get() as any;
  return row?.id ?? null;
}

function parseRecord(row: any) {
  if (!row) return row;
  let data: PurchaseOrderData = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt rows surface as empty */ }
  return { ...row, data };
}

function supplierById(id: number | null | undefined): any {
  if (!id) return null;
  return db.prepare('SELECT id, name, email, phone, address, vat_number FROM suppliers WHERE id = ?').get(id) ?? null;
}

/**
 * Writes the PDF to operation-docs and keeps the operation_documents row in
 * sync, so the purchase order always appears under the operation's documents.
 */
async function renderAndFile(
  data: PurchaseOrderData,
  opts: { operationId: number | null; existing?: any }
): Promise<{ filePath: string; fileName: string; documentId: number | null }> {
  const pdf = await buildPurchaseOrderPdf(data);

  fs.mkdirSync(docsDir, { recursive: true });
  const storedName = `po-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(docsDir, storedName), pdf);

  const displayName = purchaseOrderFileName(operationNumberFor(opts.operationId), data.po_number ?? null);

  if (opts.existing?.file_path) {
    const old = path.join(docsDir, opts.existing.file_path);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* best effort */ } }
  }

  let documentId: number | null = opts.existing?.document_id ?? null;
  if (opts.operationId) {
    const categoryId = purchaseOrderCategoryId();
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
      ).run(opts.operationId, categoryId, storedName, displayName, `Purchase Order ${data.po_number || ''}`.trim());
      documentId = Number(result.lastInsertRowid);
    }
  } else if (documentId) {
    db.prepare('DELETE FROM operation_documents WHERE id = ?').run(documentId);
    documentId = null;
  }

  return { filePath: storedName, fileName: displayName, documentId };
}

function discardFiled(filed: { filePath: string; documentId: number | null }, keepDocumentId: number | null) {
  const orphan = path.join(docsDir, filed.filePath);
  if (fs.existsSync(orphan)) { try { fs.unlinkSync(orphan); } catch { /* best effort */ } }
  if (filed.documentId && filed.documentId !== keepDocumentId) {
    try { db.prepare('DELETE FROM operation_documents WHERE id = ?').run(filed.documentId); } catch { /* best effort */ }
  }
}

function poNumberTaken(poNumber: string, exceptId?: number): boolean {
  const row = db.prepare('SELECT id FROM purchase_orders WHERE po_number = ?').get(poNumber) as any;
  return !!row && row.id !== exceptId;
}

// ── Prefill a draft from the customer's order ─────────────────────────────

router.get('/prepare', (req: Request, res: Response) => {
  const orderId = parseInt(String(req.query.order_id || ''), 10);
  if (!Number.isInteger(orderId)) { res.status(400).json({ error: 'order_id is required' }); return; }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  const suppliers = db.prepare('SELECT id, name, category FROM suppliers ORDER BY name').all();

  const existing = db.prepare(
    'SELECT * FROM purchase_orders WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId) as any;
  if (existing) { res.json({ existing: parseRecord(existing), suppliers }); return; }

  const requestedOp = parseInt(String(req.query.operation_id || ''), 10);
  const operation = (Number.isInteger(requestedOp)
    ? db.prepare('SELECT id, operation_number, supplier_id, category FROM operations WHERE id = ?').get(requestedOp)
    : db.prepare('SELECT id, operation_number, supplier_id, category FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId)
  ) as any;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as any[];

  // Same entity rule as the order confirmation: SOBE… is Belgian, SONL… Dutch
  const requested = String(req.query.entity || '').toUpperCase();
  const entity: EntityCode = isEntityCode(requested)
    ? requested
    : entityFromOperationNumber(operation?.operation_number || order.order_number);
  // TripleW is paying here, so its own bank details stay off the document
  const { bank_name: _bn, iban: _iban, bic: _bic, bank_address: _ba, ...issuer } = entityProfile(entity);

  const requestedSupplier = parseInt(String(req.query.supplier_id || ''), 10);
  const supplier = supplierById(Number.isInteger(requestedSupplier) ? requestedSupplier : operation?.supplier_id);

  const draft: PurchaseOrderData = {
    ...issuer,
    entity_code: entity,
    po_number: operation?.operation_number || order.order_number || '',
    po_date: new Date().toISOString().slice(0, 10),
    our_ref: operation?.operation_number || '',
    sq_number: '',
    client_code: '',
    client_name: supplier?.name || '',
    billing_address: supplier?.address || '',
    client_phone: supplier?.phone || '',
    tax_id: supplier?.vat_number || '',
    contact_email: supplier?.email || '',
    // Products and quantities from the order; the purchase price is typed in,
    // so the selling price never reaches the supplier.
    items: prefillLines(items).map(line => ({ ...line, unit_price: null })),
    // Trading goods ship straight to the customer
    delivery: deliveryTerms(order),
    delivery_address: order.destination || '',
    delivery_contact: '',
    delivery_date_text: order.delivery_date ? formatLongDate(order.delivery_date) : '',
    freight: 0,
    vat: 0,
    terms: '',
  } as PurchaseOrderData;

  res.json({
    existing: null,
    draft,
    entity,
    supplier_id: supplier?.id ?? null,
    suppliers,
    order: { id: order.id, order_number: order.order_number },
    operation: operation || null,
  });
});

// ── List / read ───────────────────────────────────────────────────────────

router.get('/by-order/:orderId', (req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT * FROM purchase_orders WHERE order_id = ? ORDER BY id DESC'
  ).all(Number(req.params.orderId)) as any[];
  res.json(rows.map(parseRecord));
});

router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  const suppliers = db.prepare('SELECT id, name, category FROM suppliers ORDER BY name').all();
  res.json({ ...parseRecord(row), suppliers });
});

// ── Live preview (nothing is persisted) ───────────────────────────────────

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const pdf = await buildPurchaseOrderPdf((req.body?.data || {}) as PurchaseOrderData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="purchase-order-preview.pdf"');
    res.send(pdf);
  } catch (err: any) {
    console.error('[purchase-orders] preview failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// ── Create ────────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { order_id, operation_id, supplier_id, data } = req.body as {
    order_id?: number; operation_id?: number | null; supplier_id?: number | null; data?: PurchaseOrderData;
  };

  if (!order_id) { res.status(400).json({ error: 'order_id is required' }); return; }
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const order = db.prepare('SELECT id, order_number FROM orders WHERE id = ?').get(order_id) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  let operationId: number | null = operation_id ?? null;
  if (operationId == null) {
    const linked = db.prepare('SELECT id FROM operations WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order_id) as any;
    operationId = linked?.id ?? null;
  }
  if (operationId) {
    const op = db.prepare('SELECT category FROM operations WHERE id = ?').get(operationId) as any;
    if (op && op.category !== 'trading') {
      res.status(400).json({ error: 'Purchase orders are only generated for trading operations' });
      return;
    }
  }

  const payload: PurchaseOrderData = {
    ...data,
    po_number: (data.po_number || '').trim() || operationNumberFor(operationId) || order.order_number || '',
  };
  if (!payload.po_number) { res.status(400).json({ error: 'A purchase order number is required' }); return; }

  if (poNumberTaken(payload.po_number)) {
    res.status(409).json({ error: `Purchase order ${payload.po_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    filed = await renderAndFile(payload, { operationId });

    const result = db.prepare(`
      INSERT INTO purchase_orders (po_number, order_id, operation_id, supplier_id, data, file_path, file_name, document_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.po_number, order_id, operationId, supplier_id ?? null,
      JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, req.user?.userId ?? null
    );

    const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(result.lastInsertRowid);
    notifyAdmin({
      action: 'created', entity: 'Purchase Order', label: payload.po_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.status(201).json(parseRecord(row));
  } catch (err: any) {
    if (filed) discardFiled(filed, null);
    if (err?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: `Purchase order ${payload.po_number} already exists` });
      return;
    }
    console.error('[purchase-orders] create failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to generate the purchase order' });
  }
});

// ── Update (regenerates the PDF and replaces the filed document) ──────────

router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }

  const { data, operation_id, supplier_id } = req.body as { data?: PurchaseOrderData; operation_id?: number | null; supplier_id?: number | null };
  if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }

  const payload: PurchaseOrderData = {
    ...data,
    po_number: (data.po_number || '').trim() || existing.po_number,
  };
  const operationId = operation_id !== undefined ? operation_id : existing.operation_id;

  if (poNumberTaken(payload.po_number!, existing.id)) {
    res.status(409).json({ error: `Purchase order ${payload.po_number} already exists` });
    return;
  }

  let filed: { filePath: string; fileName: string; documentId: number | null } | null = null;
  try {
    filed = await renderAndFile(payload, { operationId, existing });

    db.prepare(`
      UPDATE purchase_orders
      SET po_number = ?, operation_id = ?, supplier_id = ?, data = ?, file_path = ?, file_name = ?, document_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      payload.po_number, operationId, supplier_id !== undefined ? supplier_id : existing.supplier_id,
      JSON.stringify(payload), filed.filePath, filed.fileName, filed.documentId, existing.id
    );

    const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(existing.id);
    notifyAdmin({
      action: 'updated', entity: 'Purchase Order', label: payload.po_number!,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });
    res.json(parseRecord(row));
  } catch (err: any) {
    if (filed) discardFiled(filed, existing.document_id);
    if (err?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: `Purchase order ${payload.po_number} already exists` });
      return;
    }
    console.error('[purchase-orders] update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to regenerate the purchase order' });
  }
});

// ── Download ──────────────────────────────────────────────────────────────

router.get('/:id/pdf', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row?.file_path) { res.status(404).json({ error: 'Purchase order not found' }); return; }

  const filePath = path.join(docsDir, row.file_path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.file_name || 'purchase-order.pdf'}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ── Email to the supplier ─────────────────────────────────────────────────

router.post('/:id/email', async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Purchase order not found' }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(501).json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }); return; }

  const recipients = String(req.body?.to || '')
    .split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if (!recipients.length) { res.status(400).json({ error: 'At least one recipient email is required' }); return; }

  const invalid = recipients.filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (invalid.length) { res.status(400).json({ error: `Invalid email address: ${invalid.join(', ')}` }); return; }

  const filePath = row.file_path ? path.join(docsDir, row.file_path) : null;
  if (!filePath || !fs.existsSync(filePath)) { res.status(404).json({ error: 'Generated PDF is missing — save the purchase order again' }); return; }

  const data = parseRecord(row).data as PurchaseOrderData;
  const subject = String(req.body?.subject || '').trim()
    || `Purchase Order ${row.po_number}${data.company_name ? ` — ${data.company_name}` : ''}`;
  const bodyText = String(req.body?.message || '').trim();

  const { total, currency } = computeTotals(data);
  const totals = total ? `${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}` : '';

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p style="font-size:15px;">Dear ${escapeHtml(data.client_name || 'Sir/Madam')},</p>
  ${bodyText
      ? `<p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>`
      : `<p style="font-size:14px;">Please find attached our purchase order <strong>${escapeHtml(row.po_number)}</strong>.</p>`}
  <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;margin-top:16px;">
    <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Purchase order</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(row.po_number)}</td></tr>
    <tr><td style="padding:8px 12px;color:#6b7280;">Date</td><td style="padding:8px 12px;">${escapeHtml(formatLongDate(data.po_date))}</td></tr>
    ${totals ? `<tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;">Total</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(totals)}</td></tr>` : ''}
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
      attachments: [{ filename: row.file_name || 'purchase-order.pdf', content: fs.readFileSync(filePath).toString('base64') }],
    });
    if (error) throw new Error(error.message || 'Resend rejected the message');

    db.prepare(`UPDATE purchase_orders SET sent_to = ?, sent_at = datetime('now') WHERE id = ?`)
      .run(recipients.join(', '), row.id);

    notifyAdmin({
      action: 'updated', entity: 'Purchase Order', label: row.po_number,
      detail: `emailed to ${recipients.join(', ')}`,
      performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
    });

    const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(row.id);
    res.json({ message: `Purchase order sent to ${recipients.join(', ')}`, purchase_order: parseRecord(updated) });
  } catch (err: any) {
    console.error('[purchase-orders] email failed:', err?.message || err);
    res.status(502).json({ error: `Failed to send email: ${err?.message || 'unknown error'}` });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) { res.status(404).json({ error: 'Purchase order not found' }); return; }

  if (row.file_path) {
    const filePath = path.join(docsDir, row.file_path);
    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch { /* best effort */ } }
  }
  if (row.document_id) db.prepare('DELETE FROM operation_documents WHERE id = ?').run(row.document_id);
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(row.id);

  notifyAdmin({
    action: 'deleted', entity: 'Purchase Order', label: row.po_number,
    performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
  });
  res.json({ message: 'Purchase order deleted' });
});

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default router;
