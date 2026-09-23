import { Router, Request, Response } from 'express';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { resolveInvoiceLayout } from '../lib/documentPrefill.js';
import { normalizeLayout } from '../lib/invoiceLayout.js';

const router = Router();

// List customers with pagination and search
router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const offset = (page - 1) * limit;

  let where = '';
  const params: any[] = [];
  if (search) {
    where = 'WHERE name LIKE ? OR email LIKE ? OR company LIKE ?';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM customers ${where}`).get(...params) as any).count;
  const customers = db.prepare(`SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  res.json({ data: customers, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// Get single customer
router.get('/:id', (req: Request, res: Response) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }
  res.json(customer);
});

// Create customer
router.post('/', (req: Request, res: Response) => {
  const { name, email, phone, address, company, notes } = req.body;
  if (!name) { res.status(400).json({ error: 'Name is required' }); return; }

  const result = db.prepare(
    'INSERT INTO customers (name, email, phone, address, company, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, email || null, phone || null, address || null, company || null, notes || null);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid) as any;
  notifyAdmin({ action: 'created', entity: 'Customer', label: customer.name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.status(201).json(customer);
});

// Update customer
router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Customer not found' }); return; }

  const { name, email, phone, address, company, notes } = req.body;
  if (!name) { res.status(400).json({ error: 'Name is required' }); return; }

  db.prepare(
    `UPDATE customers SET name=?, email=?, phone=?, address=?, company=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, email || null, phone || null, address || null, company || null, notes || null, req.params.id);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
  notifyAdmin({ action: 'updated', entity: 'Customer', label: customer.name, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json(customer);
});

// Delete customer
router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT name FROM customers WHERE id = ?').get(req.params.id) as any;
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Customer not found' }); return; }
  notifyAdmin({ action: 'deleted', entity: 'Customer', label: existing?.name || `#${req.params.id}`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.json({ message: 'Customer deleted' });
});

// Get customer's invoices
router.get('/:id/invoices', (req: Request, res: Response) => {
  const invoices = db.prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(invoices);
});

// Get customer's orders
router.get('/:id/orders', (req: Request, res: Response) => {
  const orders = db.prepare(`
    SELECT o.*,
      (SELECT UPPER(COALESCE(oi.currency, 'USD')) FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id LIMIT 1) as currency
    FROM orders o
    WHERE o.customer_id = ?
    ORDER BY o.created_at DESC
  `).all(req.params.id);
  res.json(orders);
});

// Get customer's shipments
router.get('/:id/shipments', (req: Request, res: Response) => {
  const shipments = db.prepare('SELECT * FROM shipments WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(shipments);
});

// ── Document profiles ─────────────────────────────────────────────────────
// Defaults reused whenever a document is generated for this customer. A
// customer may trade as several legal entities, hence one row per profile.

const EMPTY_PROFILE = {
  shared: {
    legal_name: '', client_code: '', billing_address: '', tax_id: '', eori: '',
    contact_person: '', contact_phone: '', contact_email: '', attention: '',
  },
  order_confirmation: { terms: '', delivery: '', delivery_address: '', sq_suffix: '', note: '' },
  // The bank block is per profile: blank fields fall back to the issuing entity
  invoice: {
    terms: '', delivery: '', delivery_address: '', note: '',
    bank_name: '', iban: '', bic: '', bank_address: '',
  },
  packing_list: { delivery_address: '', port_of_loading: '', port_of_discharge: '', note: '' },
  // How an incoming order is recognised as belonging to this entity
  match: { country: '', keywords: '' },
};

/**
 * `customerName` lets an unsaved profile fall back to the layout read off the
 * invoices this customer has actually received.
 */
function parseProfile(row: any, customerName?: string | null) {
  if (!row) return row;
  let data: any = {};
  try { data = JSON.parse(row.data); } catch { /* corrupt rows surface as empty */ }

  const profile = {
    ...row,
    is_default: !!row.is_default,
    data: {
      shared: { ...EMPTY_PROFILE.shared, ...(data.shared || {}) },
      order_confirmation: { ...EMPTY_PROFILE.order_confirmation, ...(data.order_confirmation || {}) },
      invoice: { ...EMPTY_PROFILE.invoice, ...(data.invoice || {}) },
      packing_list: { ...EMPTY_PROFILE.packing_list, ...(data.packing_list || {}) },
      match: { ...EMPTY_PROFILE.match, ...(data.match || {}) },
    },
  };

  // Show the layout that will actually be used, not an empty editor: what was
  // saved here, else this customer's last invoice, else the shape read off the
  // invoices supplied as masters, else the house default. Saving the screen
  // pins whatever was shown, which is the point — what you see is what you get.
  const resolved = resolveInvoiceLayout(
    row.customer_id,
    { id: row.id, name: row.name, is_default: !!row.is_default, data },
    customerName
  );
  (profile.data as any).invoice_layout = resolved.layout;
  (profile as any).invoice_layout_source = resolved.source;

  return profile;
}

router.get('/:id/profiles', (req: Request, res: Response) => {
  const customer = db.prepare('SELECT name FROM customers WHERE id = ?').get(req.params.id) as any;
  const rows = db.prepare(
    'SELECT * FROM customer_document_profiles WHERE customer_id = ? ORDER BY is_default DESC, id'
  ).all(req.params.id) as any[];
  res.json(rows.map(row => parseProfile(row, customer?.name)));
});

router.post('/:id/profiles', (req: Request, res: Response) => {
  const customer = db.prepare('SELECT id, name FROM customers WHERE id = ?').get(req.params.id) as any;
  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

  const name = String(req.body?.name || '').trim() || 'Default';
  const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : EMPTY_PROFILE;

  const isFirst = !db.prepare('SELECT id FROM customer_document_profiles WHERE customer_id = ?').get(customer.id);
  const result = db.prepare(
    'INSERT INTO customer_document_profiles (customer_id, name, is_default, data) VALUES (?, ?, ?, ?)'
  ).run(customer.id, name, isFirst ? 1 : 0, JSON.stringify(data));

  const row = db.prepare('SELECT * FROM customer_document_profiles WHERE id = ?').get(result.lastInsertRowid);
  notifyAdmin({ action: 'created', entity: 'Customer Profile', label: `${customer.name} — ${name}`, performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId });
  res.status(201).json(parseProfile(row, customer.name));
});

router.put('/:id/profiles/:profileId', (req: Request, res: Response) => {
  const existing = db.prepare(
    'SELECT * FROM customer_document_profiles WHERE id = ? AND customer_id = ?'
  ).get(Number(req.params.profileId), Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Profile not found' }); return; }

  const name = req.body?.name !== undefined ? String(req.body.name).trim() || existing.name : existing.name;
  const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : JSON.parse(existing.data);

  // A hand-edited or stale layout must never reach the renderer malformed
  if (data.invoice_layout) data.invoice_layout = normalizeLayout(data.invoice_layout);

  // Exactly one profile per customer carries the default flag
  if (req.body?.is_default) {
    db.prepare('UPDATE customer_document_profiles SET is_default = 0 WHERE customer_id = ?').run(existing.customer_id);
  }

  db.prepare(`
    UPDATE customer_document_profiles
    SET name = ?, data = ?, is_default = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, JSON.stringify(data), req.body?.is_default ? 1 : existing.is_default, existing.id);

  const row = db.prepare('SELECT * FROM customer_document_profiles WHERE id = ?').get(existing.id);
  const owner = db.prepare('SELECT name FROM customers WHERE id = ?').get(existing.customer_id) as any;
  res.json(parseProfile(row, owner?.name));
});

router.delete('/:id/profiles/:profileId', (req: Request, res: Response) => {
  const existing = db.prepare(
    'SELECT * FROM customer_document_profiles WHERE id = ? AND customer_id = ?'
  ).get(Number(req.params.profileId), Number(req.params.id)) as any;
  if (!existing) { res.status(404).json({ error: 'Profile not found' }); return; }

  db.prepare('DELETE FROM customer_document_profiles WHERE id = ?').run(existing.id);

  // Never leave a customer with profiles but no default
  if (existing.is_default) {
    const next = db.prepare('SELECT id FROM customer_document_profiles WHERE customer_id = ? ORDER BY id LIMIT 1').get(existing.customer_id) as any;
    if (next) db.prepare('UPDATE customer_document_profiles SET is_default = 1 WHERE id = ?').run(next.id);
  }

  res.json({ message: 'Profile deleted' });
});

export default router;
