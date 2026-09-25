import { Router, Request, Response } from 'express';
import fs from 'fs';
import db from '../database.js';
import { notifyAdmin } from '../lib/notify.js';
import { resolveUpload } from '../lib/zipFiles.js';
import { extractParty, type PartyDetails, type PartyRole } from '../lib/partyDetails.js';

/**
 * Fill in customer and supplier records from the documents already on file.
 *
 * GET /suggestions proposes values per record, each with the document it came
 * from; nothing is written until POST /apply, which takes only the values the
 * user ticked. Suppliers are the sales-activity ones: those in the Suppliers
 * tab plus any that bill sales activities but aren't in the tab yet.
 */
const router = Router();

type Field = 'company' | 'address' | 'vat_number' | 'email' | 'phone' | 'contact_person';
const CUSTOMER_FIELDS: Field[] = ['company', 'address', 'vat_number', 'email', 'phone', 'contact_person'];
const SUPPLIER_FIELDS: Field[] = ['address', 'vat_number', 'email', 'phone', 'contact_person'];
const SUPPLIER_CATEGORIES = ['raw_materials', 'blenders', 'shipping', 'logistics'];

type Proposal = Partial<Record<Field, { value: string; source: string }>>;

/** First value wins: sources are offered in order of trust. */
function offer(p: Proposal, field: Field, value: unknown, source: string) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v && !p[field]) p[field] = { value: v, source };
}

function offerParty(p: Proposal, d: PartyDetails | null, source: string, withCompany: boolean) {
  if (!d) return;
  if (withCompany) offer(p, 'company', d.legal_name, source);
  offer(p, 'address', d.address, source);
  offer(p, 'vat_number', d.vat_number, source);
  offer(p, 'email', d.email, source);
  offer(p, 'phone', d.phone, source);
  offer(p, 'contact_person', d.contact_person, source);
}

const SUFFIXES = /\b(b\.?v\.?|n\.?v\.?|s\.?a\.?|s\.?p\.?a\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|ltd|limited|inc|co|corp|company|gmbh|bvba|llc|plc|the)\b/g;
export function nameKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[.,]/g, ' ').replace(SUFFIXES, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameCompany(a: string, b: string): boolean {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "FF" vs "FF chemicals": a whole-word prefix, reviewed by the user before saving
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.startsWith(short + ' ');
}

function categoryFor(demoCategory: string): string {
  const c = String(demoCategory || '').toLowerCase();
  if (c.includes('blend')) return 'blenders';
  if (c.includes('ship')) return 'shipping';
  if (c.includes('logist') || c.includes('courier') || c.includes('transport')) return 'logistics';
  return 'raw_materials';
}

function parseJson(raw: string | null): any {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

/** Run async jobs a few at a time — AI calls are slow but the list is short. */
async function pool<T>(jobs: Array<() => Promise<T>>, size = 4): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

/** One AI read, reporting failures instead of throwing. */
async function readDocument(args: Parameters<typeof extractParty>[0], errors: string[]): Promise<PartyDetails | null> {
  try {
    return await extractParty(args);
  } catch (err: any) {
    if (err?.message === 'NO_API_KEY') throw err;
    errors.push(`${args.expectedName}: ${err?.message || 'could not read the document'}`);
    return null;
  }
}

router.get('/suggestions', async (req: Request, res: Response) => {
  const useAi = req.query.ai === '1';
  const errors: string[] = [];

  // ── Customers ────────────────────────────────────────────────────────────
  const customers = db.prepare('SELECT * FROM customers ORDER BY name').all() as any[];
  const customerRows: any[] = [];
  const customerJobs: Array<() => Promise<void>> = [];

  for (const c of customers) {
    const p: Proposal = {};

    // 1. The billing profile, itself taken from the invoices they received
    const profile = db.prepare(
      'SELECT name, data FROM customer_document_profiles WHERE customer_id = ? ORDER BY is_default DESC, id LIMIT 1'
    ).get(c.id) as any;
    if (profile) {
      const shared = parseJson(profile.data).shared || {};
      const src = `billing profile "${profile.name}"`;
      offer(p, 'company', shared.legal_name, src);
      offer(p, 'address', shared.billing_address, src);
      offer(p, 'vat_number', shared.tax_id, src);
      offer(p, 'email', shared.contact_email, src);
      offer(p, 'phone', shared.contact_phone, src);
      offer(p, 'contact_person', shared.contact_person, src);
    }

    // 2. Invoices and confirmations generated here for their orders
    for (const [table, label, numberCol] of [
      ['invoice_documents', 'invoice', 'invoice_number'],
      ['order_confirmations', 'order confirmation', 'oc_number'],
    ] as const) {
      const doc = db.prepare(`
        SELECT d.${numberCol} as number, d.data FROM ${table} d JOIN orders o ON o.id = d.order_id
        WHERE o.customer_id = ? ORDER BY d.id DESC LIMIT 1
      `).get(c.id) as any;
      if (!doc) continue;
      const d = parseJson(doc.data);
      const src = `${label} ${doc.number}`;
      offer(p, 'company', d.client_name, src);
      offer(p, 'address', d.billing_address, src);
      offer(p, 'vat_number', d.tax_id, src);
      offer(p, 'email', d.contact_email, src);
      offer(p, 'phone', d.client_phone, src);
    }

    // 3. What was read off their orders when they were uploaded
    const order = db.prepare(`
      SELECT order_number, client_entity_name, client_tax_id FROM orders
      WHERE customer_id = ? AND (client_entity_name IS NOT NULL OR client_tax_id IS NOT NULL)
      ORDER BY id DESC LIMIT 1
    `).get(c.id) as any;
    if (order) {
      offer(p, 'company', order.client_entity_name, `order ${order.order_number}`);
      offer(p, 'vat_number', order.client_tax_id, `order ${order.order_number}`);
    }

    const row = { kind: 'customer', id: c.id, name: c.name, current: pick(c, CUSTOMER_FIELDS), proposed: p };
    customerRows.push(row);

    // 4. With AI: the latest invoice we sent them, else their latest order
    if (useAi && CUSTOMER_FIELDS.some(f => !p[f] && !c[f])) {
      const inv = db.prepare(`
        SELECT invoice_number, file_path, file_name FROM invoices
        WHERE type = 'customer' AND customer_id = ? AND file_path IS NOT NULL ORDER BY id DESC LIMIT 1
      `).get(c.id) as any;
      const ord = db.prepare(`
        SELECT order_number, file_path, file_name FROM orders
        WHERE customer_id = ? AND file_path IS NOT NULL ORDER BY id DESC LIMIT 1
      `).get(c.id) as any;
      const source = inv
        ? { folder: 'invoices', file: inv.file_path, name: inv.file_name || inv.file_path, role: 'recipient' as PartyRole, label: `invoice ${inv.invoice_number} (read by AI)` }
        : ord
          ? { folder: 'orders', file: ord.file_path, name: ord.file_name || ord.file_path, role: 'issuer' as PartyRole, label: `order ${ord.order_number} (read by AI)` }
          : null;
      const abs = source ? resolveUpload(source.folder, source.file) : null;
      if (source && abs) {
        customerJobs.push(async () => {
          const d = await readDocument({
            sourceKey: `${source.folder}/${source.file}#${source.role}`,
            file: fs.readFileSync(abs), fileName: source.name, role: source.role, expectedName: c.name,
          }, errors);
          offerParty(row.proposed, d, source.label, true);
        });
      }
    }
  }

  // ── Sales-activity suppliers ─────────────────────────────────────────────
  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all() as any[];
  const billed = db.prepare(`
    SELECT supplier, category, COUNT(*) as invoices, MAX(id) as last_id
    FROM demo_invoices WHERE domain = 'sales' GROUP BY supplier
  `).all() as any[];

  const supplierRows: any[] = [];
  const supplierJobs: Array<() => Promise<void>> = [];
  const matched = new Set<string>();

  const queueSupplierRead = (row: any, demoId: number | null, supplierId: number | null) => {
    if (!useAi || !SUPPLIER_FIELDS.some(f => !row.current[f])) return;
    // Their latest sales-activity invoice, else a supplier invoice filed on an operation
    const demo = demoId ? db.prepare('SELECT id, invoice_id, embedded_pdf, pdf_filename FROM demo_invoices WHERE id = ?').get(demoId) as any : null;
    if (demo?.embedded_pdf) {
      supplierJobs.push(async () => {
        const d = await readDocument({
          sourceKey: `demo_invoices/${demo.id}#issuer`,
          file: Buffer.from(demo.embedded_pdf, 'base64'), fileName: demo.pdf_filename || 'invoice.pdf',
          role: 'issuer', expectedName: row.name,
        }, errors);
        offerParty(row.proposed, d, `invoice ${demo.invoice_id} (read by AI)`, false);
      });
      return;
    }
    const inv = supplierId ? db.prepare(`
      SELECT invoice_number, file_path, file_name FROM invoices
      WHERE type = 'supplier' AND supplier_id = ? AND file_path IS NOT NULL ORDER BY id DESC LIMIT 1
    `).get(supplierId) as any : null;
    const abs = inv ? resolveUpload('invoices', inv.file_path) : null;
    if (inv && abs) {
      supplierJobs.push(async () => {
        const d = await readDocument({
          sourceKey: `invoices/${inv.file_path}#issuer`,
          file: fs.readFileSync(abs), fileName: inv.file_name || inv.file_path, role: 'issuer', expectedName: row.name,
        }, errors);
        offerParty(row.proposed, d, `invoice ${inv.invoice_number} (read by AI)`, false);
      });
    }
  };

  for (const s of suppliers) {
    const hits = billed.filter(b => sameCompany(b.supplier, s.name));
    hits.forEach(h => matched.add(h.supplier));
    const latest = hits.sort((a, b) => b.last_id - a.last_id)[0];
    const row = {
      kind: 'supplier', id: s.id, name: s.name, category: s.category,
      billed_as: hits.map(h => h.supplier), invoices: hits.reduce((n, h) => n + h.invoices, 0),
      current: pick(s, SUPPLIER_FIELDS), proposed: {} as Proposal,
    };
    supplierRows.push(row);
    queueSupplierRead(row, latest?.last_id ?? null, s.id);
  }

  // Billed for sales activities but not in the Suppliers tab yet
  for (const b of billed) {
    if (matched.has(b.supplier)) continue;
    const row = {
      kind: 'new_supplier', id: null, name: b.supplier, category: categoryFor(b.category),
      billed_as: [b.supplier], invoices: b.invoices,
      current: pick({}, SUPPLIER_FIELDS), proposed: {} as Proposal,
    };
    supplierRows.push(row);
    queueSupplierRead(row, b.last_id, null);
  }

  if (useAi) {
    try {
      await pool([...customerJobs, ...supplierJobs]);
    } catch (err: any) {
      if (err?.message === 'NO_API_KEY') {
        res.status(501).json({ error: 'Reading documents needs an Anthropic API key (ANTHROPIC_API_KEY) on the server' });
        return;
      }
      throw err;
    }
  }

  res.json({
    customers: customerRows,
    suppliers: supplierRows,
    ai: useAi,
    documents_read: customerJobs.length + supplierJobs.length,
    errors,
  });
});

function pick(obj: any, fields: Field[]): Record<string, string> {
  return Object.fromEntries(fields.map(f => [f, obj?.[f] ? String(obj[f]) : '']));
}

// ── Apply what the user ticked ──────────────────────────────────────────────

router.post('/apply', (req: Request, res: Response) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  let customersUpdated = 0, suppliersUpdated = 0, suppliersCreated = 0;

  const clean = (fields: any, allowed: Field[]) =>
    Object.fromEntries(Object.entries(fields || {})
      .filter(([k, v]) => allowed.includes(k as Field) && typeof v === 'string')
      .map(([k, v]) => [k, (v as string).trim() || null]));

  const run = db.transaction(() => {
    for (const u of updates) {
      if (u.kind === 'customer') {
        const fields = clean(u.fields, CUSTOMER_FIELDS);
        const keys = Object.keys(fields);
        if (!keys.length || !db.prepare('SELECT id FROM customers WHERE id = ?').get(u.id)) continue;
        db.prepare(`UPDATE customers SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...keys.map(k => fields[k]), u.id);
        customersUpdated++;
      } else if (u.kind === 'supplier') {
        const fields = clean(u.fields, SUPPLIER_FIELDS);
        const keys = Object.keys(fields);
        if (!keys.length || !db.prepare('SELECT id FROM suppliers WHERE id = ?').get(u.id)) continue;
        db.prepare(`UPDATE suppliers SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...keys.map(k => fields[k]), u.id);
        suppliersUpdated++;
      } else if (u.kind === 'new_supplier') {
        const name = String(u.name || '').trim();
        const category = SUPPLIER_CATEGORIES.includes(u.category) ? u.category : 'raw_materials';
        if (!name) continue;
        if (db.prepare('SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(?)').get(name)) continue;
        const fields = clean(u.fields, SUPPLIER_FIELDS);
        db.prepare(`
          INSERT INTO suppliers (name, category, address, vat_number, email, phone, contact_person)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(name, category, fields.address ?? null, fields.vat_number ?? null, fields.email ?? null, fields.phone ?? null, fields.contact_person ?? null);
        suppliersCreated++;
      }
    }
  });
  run();
  db.saveToDisk();

  notifyAdmin({
    action: 'updated', entity: 'Customer & Supplier Details',
    label: `${customersUpdated} customers, ${suppliersUpdated} suppliers updated, ${suppliersCreated} suppliers added`,
    performedBy: req.user?.display_name || 'Unknown', performedById: req.user?.userId,
  });
  res.json({ customersUpdated, suppliersUpdated, suppliersCreated });
});

export default router;
