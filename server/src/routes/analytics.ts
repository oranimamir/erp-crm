import { Router, Request, Response } from 'express';
import db from '../database.js';
import { getEurRate } from '../lib/fx.js';
import { resolveCountry } from '../lib/portCountry.js';

const router = Router();

async function sumLiveEur(rows: { amount: number; currency: string }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const currencies = [...new Set(rows.map(r => (r.currency || 'USD').toUpperCase()).filter(c => c !== 'EUR'))];
  const rates: Record<string, number> = {};
  await Promise.all(currencies.map(async c => { rates[c] = await getEurRate(c, 'latest'); }));
  return rows.reduce((sum, row) => {
    const curr = (row.currency || 'USD').toUpperCase();
    return sum + row.amount * (curr === 'EUR' ? 1 : (rates[curr] ?? 1));
  }, 0);
}

const VALID_SUPPLIER_CATEGORIES = ['logistics', 'blenders', 'raw_materials', 'shipping'];

/** Quantity in metric tons, or null when the unit is not a weight. */
function toMt(qty: number, unit?: string | null): number | null {
  const u = String(unit || '').trim().toLowerCase();
  if (['mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't'].includes(u)) return qty;
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(u)) return qty / 1000;
  if (['lb', 'lbs', 'pound', 'pounds'].includes(u)) return qty / 2204.6226218;
  return null;
}

interface TradeLine { name: string; quantity: number; unit: string; unit_price: number; currency: string }

// GET /analytics/trading
//   ?year=2026&month_from=1&month_to=12&customer_id=
// Trading operations: what the customer ordered (sale) against what was bought
// from the supplier — the supplier purchase order, or the supplier invoices
// recorded on the operation when no PO was generated. EUR at today's rates.
router.get('/trading', async (req: Request, res: Response) => {
  const yearNum = parseInt((req.query.year as string) || new Date().getFullYear().toString());
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) { res.status(400).json({ error: 'Invalid year' }); return; }
  const rawFrom = parseInt(req.query.month_from as string || '1');
  const rawTo = parseInt(req.query.month_to as string || '12');
  const monthStart = Math.min(Math.max(isNaN(rawFrom) ? 1 : rawFrom, 1), 12);
  const monthEnd = Math.max(Math.min(isNaN(rawTo) ? 12 : rawTo, 12), monthStart);
  const dateStart = `${yearNum}-${String(monthStart).padStart(2, '0')}-01`;
  const dateEnd = `${yearNum}-${String(monthEnd).padStart(2, '0')}-31`;
  const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;

  const params: any[] = [dateStart, dateEnd];
  let customerClause = '';
  if (customerId && !isNaN(customerId)) { customerClause = 'AND op.customer_id = ?'; params.push(customerId); }

  const ops = db.prepare(`
    SELECT op.id, op.operation_number, op.status, o.id as order_id,
      c.name as customer_name, o.order_number, COALESCE(o.order_date, date(op.created_at)) as order_date
    FROM operations op
    LEFT JOIN customers c ON op.customer_id = c.id
    LEFT JOIN orders o ON op.order_id = o.id
    WHERE op.category = 'trading'
      AND COALESCE(o.order_date, date(op.created_at)) BETWEEN ? AND ?
      ${customerClause}
    ORDER BY COALESCE(o.order_date, op.created_at) DESC
  `).all(...params) as any[];

  const rows = ops.map(op => {
    const sale: TradeLine[] = (op.order_id
      ? db.prepare('SELECT description, quantity, unit, unit_price, currency FROM order_items WHERE order_id = ? ORDER BY id').all(op.order_id) as any[]
      : []
    ).map(i => ({
      name: i.description || '',
      quantity: Number(i.quantity) || 0,
      unit: i.unit || '',
      unit_price: Number(i.unit_price) || 0,
      currency: String(i.currency || 'USD').toUpperCase(),
    }));

    // The supplier side: the generated purchase order first, else supplier invoices
    let source: 'purchase_order' | 'supplier_invoice' | null = null;
    let supplierName: string | null = null;
    let purchase: TradeLine[] = [];
    let freight = 0;
    let invoiceLines: Array<{ amount: number; currency: string; eur_amount: number | null }> = [];

    const po = op.order_id
      ? db.prepare('SELECT data FROM purchase_orders WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(op.order_id) as any
      : null;
    if (po) {
      let data: any = {};
      try { data = JSON.parse(po.data); } catch { /* corrupt row → empty */ }
      source = 'purchase_order';
      supplierName = data.client_name || null;
      purchase = (Array.isArray(data.items) ? data.items : []).map((i: any) => ({
        name: i.commercial_name || '',
        quantity: Number(i.quantity) || 0,
        unit: i.quantity_unit || '',
        unit_price: Number(i.unit_price) || 0,
        currency: String(i.currency || 'EUR').toUpperCase(),
      }));
      freight = Number(data.freight) || 0;
    } else {
      const invs = db.prepare(`
        SELECT i.amount, i.currency, i.eur_amount, s.name as supplier_name
        FROM invoices i LEFT JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.operation_id = ? AND i.type = 'supplier' AND i.status != 'cancelled'
      `).all(op.id) as any[];
      if (invs.length) {
        source = 'supplier_invoice';
        supplierName = invs[0].supplier_name || null;
        invoiceLines = invs.map(i => ({ amount: Number(i.amount) || 0, currency: String(i.currency || 'USD').toUpperCase(), eur_amount: i.eur_amount }));
      }
    }
    return { op, sale, source, supplierName, purchase, freight, invoiceLines };
  });

  // Live EUR rates for every currency involved
  const currencies = new Set<string>();
  for (const r of rows) {
    r.sale.forEach(i => currencies.add(i.currency));
    r.purchase.forEach(i => currencies.add(i.currency));
    r.invoiceLines.forEach(i => currencies.add(i.currency));
  }
  currencies.delete('EUR');
  const rates: Record<string, number> = { EUR: 1 };
  await Promise.all([...currencies].map(async c => {
    try { rates[c] = await getEurRate(c, 'latest'); } catch { rates[c] = 1; }
  }));
  const eur = (amount: number, currency: string) => amount * (rates[currency] ?? 1);

  const mtOf = (items: TradeLine[]): number | null => {
    if (!items.length) return null;
    let total = 0;
    for (const i of items) {
      const mt = toMt(i.quantity, i.unit);
      if (mt == null) return null;
      total += mt;
    }
    return total;
  };

  const operations = rows.map(({ op, sale, source, supplierName, purchase, freight, invoiceLines }) => {
    const saleEur = sale.reduce((s, i) => s + eur(i.quantity * i.unit_price, i.currency), 0);

    let purchaseCurrency: string | null = null;
    let purchaseTotal: number | null = null;
    let purchaseEur: number | null = null;
    if (source === 'purchase_order') {
      purchaseCurrency = purchase[0]?.currency || 'EUR';
      purchaseTotal = purchase.reduce((s, i) => s + i.quantity * i.unit_price, 0) + freight;
      purchaseEur = purchase.reduce((s, i) => s + eur(i.quantity * i.unit_price, i.currency), 0) + eur(freight, purchaseCurrency);
    } else if (source === 'supplier_invoice') {
      purchaseCurrency = invoiceLines[0]?.currency || 'EUR';
      purchaseTotal = invoiceLines.reduce((s, i) => s + i.amount, 0);
      purchaseEur = invoiceLines.reduce((s, i) => s + (i.eur_amount ?? eur(i.amount, i.currency)), 0);
    }
    // A PO still waiting for its prices can't give a margin yet
    const unpriced = source === 'purchase_order' && purchase.some(i => !i.unit_price);

    // Line by line: matched on product name, else by position
    const used = new Set<number>();
    const lines = sale.map((s, idx) => {
      let j = purchase.findIndex((p, k) => !used.has(k) && p.name.trim().toLowerCase() === s.name.trim().toLowerCase());
      if (j < 0 && idx < purchase.length && !used.has(idx)) j = idx;
      if (j >= 0) used.add(j);
      const p = j >= 0 ? purchase[j] : null;
      return {
        product: s.name,
        sale_quantity: s.quantity as number | null, sale_unit: s.unit, sale_price: s.unit_price as number | null, sale_currency: s.currency,
        purchase_quantity: p ? p.quantity : null, purchase_unit: p ? p.unit : null,
        purchase_price: p && p.unit_price ? p.unit_price : null, purchase_currency: p ? p.currency : null,
        unit_margin_eur: p && p.unit_price ? eur(s.unit_price, s.currency) - eur(p.unit_price, p.currency) : null,
      };
    });
    purchase.forEach((p, k) => {
      if (used.has(k)) return;
      lines.push({
        product: p.name, sale_quantity: null, sale_unit: '', sale_price: null, sale_currency: '',
        purchase_quantity: p.quantity, purchase_unit: p.unit, purchase_price: p.unit_price || null,
        purchase_currency: p.currency, unit_margin_eur: null,
      });
    });

    const saleMt = mtOf(sale);
    const purchaseMt = source === 'purchase_order' ? mtOf(purchase) : null;
    const marginEur = purchaseEur != null && !unpriced ? saleEur - purchaseEur : null;

    return {
      operation_id: op.id,
      operation_number: op.operation_number,
      status: op.status,
      order_number: op.order_number,
      order_date: op.order_date,
      customer_name: op.customer_name,
      supplier_name: supplierName,
      source,
      sale_currency: sale[0]?.currency || 'EUR',
      sale_total: sale.reduce((s, i) => s + i.quantity * i.unit_price, 0),
      sale_eur: saleEur,
      purchase_currency: purchaseCurrency,
      purchase_total: purchaseTotal,
      purchase_eur: purchaseEur,
      unpriced,
      margin_eur: marginEur,
      margin_pct: marginEur != null && saleEur ? (marginEur / saleEur) * 100 : null,
      sale_mt: saleMt,
      purchase_mt: purchaseMt,
      quantity_mismatch: saleMt != null && purchaseMt != null && Math.abs(saleMt - purchaseMt) > 0.001,
      lines,
    };
  });

  // Totals only over operations where both sides are known, so the margin is honest
  const compared = operations.filter(o => o.margin_eur != null);
  res.json({
    totals: {
      operations: operations.length,
      compared: compared.length,
      missing_supplier: operations.filter(o => !o.source).length,
      unpriced: operations.filter(o => o.unpriced).length,
      sale_eur: compared.reduce((s, o) => s + o.sale_eur, 0),
      purchase_eur: compared.reduce((s, o) => s + (o.purchase_eur || 0), 0),
      margin_eur: compared.reduce((s, o) => s + (o.margin_eur || 0), 0),
    },
    operations,
  });
});

// GET /analytics/years — list of years that have invoice data
router.get('/years', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT year FROM (
      SELECT DISTINCT strftime('%Y', invoice_date) as year FROM invoices WHERE invoice_date IS NOT NULL
      UNION
      SELECT DISTINCT strftime('%Y', created_at) as year FROM invoices
    ) ORDER BY year DESC
  `).all() as any[];
  res.json(rows.map(r => r.year).filter(Boolean));
});

// GET /analytics/filters — customers and suppliers (with category) for dropdowns
router.get('/filters', (_req: Request, res: Response) => {
  const customers = db.prepare('SELECT id, name FROM customers ORDER BY name').all();
  const suppliers = db.prepare('SELECT id, name, category FROM suppliers ORDER BY name').all();
  res.json({ customers, suppliers });
});

// GET /analytics/summary
//   ?year=2026
//   &month_from=1  (1–12, default 1)
//   &month_to=12   (1–12, default 12, must be >= month_from)
//   &customer_id=
//   &supplier_id=
//   &supplier_category=  (logistics|blenders|raw_materials|shipping)
router.get('/summary', async (req: Request, res: Response) => {
  // ── Year ────────────────────────────────────────────────────────────────────
  const yearNum = parseInt((req.query.year as string) || new Date().getFullYear().toString());
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    res.status(400).json({ error: 'Invalid year' }); return;
  }
  const year = String(yearNum);

  // ── Month range ──────────────────────────────────────────────────────────────
  const rawFrom = parseInt(req.query.month_from as string || '1');
  const rawTo = parseInt(req.query.month_to as string || '12');
  const monthStart = Math.min(Math.max(isNaN(rawFrom) ? 1 : rawFrom, 1), 12);
  const monthEnd = Math.max(Math.min(isNaN(rawTo) ? 12 : rawTo, 12), monthStart);

  const dateStart = `${year}-${String(monthStart).padStart(2, '0')}-01`;
  const dateEnd = `${year}-${String(monthEnd).padStart(2, '0')}-31`;

  // ── Customer / Supplier ID filters ───────────────────────────────────────────
  const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;
  const supplierId = req.query.supplier_id ? parseInt(req.query.supplier_id as string) : null;
  if (req.query.customer_id && (isNaN(customerId!) || customerId! <= 0)) {
    res.status(400).json({ error: 'Invalid customer_id' }); return;
  }
  if (req.query.supplier_id && (isNaN(supplierId!) || supplierId! <= 0)) {
    res.status(400).json({ error: 'Invalid supplier_id' }); return;
  }

  // ── Supplier category filter ─────────────────────────────────────────────────
  const supplierCategory = req.query.supplier_category as string || '';
  if (supplierCategory && !VALID_SUPPLIER_CATEGORIES.includes(supplierCategory)) {
    res.status(400).json({ error: 'Invalid supplier_category' }); return;
  }

  // Parameterized WHERE clauses
  const custWhere = customerId ? `AND i.customer_id = ?` : '';
  const custParams = customerId ? [customerId] : [];
  const suppWhere = supplierId ? `AND i.supplier_id = ?` : '';
  const suppParams = supplierId ? [supplierId] : [];
  const custWhereOnly = customerId ? `AND customer_id = ?` : '';
  const suppWhereOnly = supplierId ? `AND supplier_id = ?` : '';

  // Supplier category: JOIN + condition added to each supplier branch
  const catJoin = supplierCategory ? `JOIN suppliers s ON i.supplier_id = s.id` : '';
  const catCond = supplierCategory ? `AND s.category = ?` : '';
  const catParams = supplierCategory ? [supplierCategory] : [];

  // ── Monthly received (customer invoices paid) ──────────────────────────────
  const receivedRows = db.prepare(`
    SELECT month, SUM(amt) as received FROM (
      SELECT strftime('%Y-%m', wt.transfer_date) as month,
             COALESCE(wt.eur_amount, wt.amount) as amt
      FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
      WHERE i.type = 'customer' AND wt.transfer_date BETWEEN ? AND ? ${custWhere}
      UNION ALL
      SELECT strftime('%Y-%m', p.payment_date) as month,
             COALESCE(p.eur_amount, p.amount * COALESCE(i.fx_rate, 1.0)) as amt
      FROM payments p JOIN invoices i ON p.invoice_id = i.id
      WHERE i.type = 'customer' AND p.payment_date BETWEEN ? AND ? ${custWhere}
      UNION ALL
      SELECT strftime('%Y-%m', i.payment_date) as month,
             COALESCE(i.eur_amount, i.amount) as amt
      FROM invoices i
      WHERE i.type = 'customer' AND i.status = 'paid'
        AND i.payment_date IS NOT NULL AND i.payment_date BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
        ${custWhere}
    ) GROUP BY month
  `).all(dateStart, dateEnd, ...custParams, dateStart, dateEnd, ...custParams, dateStart, dateEnd, ...custParams) as any[];

  // ── Monthly paid out (supplier invoices by invoice_date) ─────────────────
  const paidRows = db.prepare(`
    SELECT strftime('%Y-%m', i.invoice_date) as month,
           SUM(COALESCE(i.eur_amount, i.amount)) as paid_out
    FROM invoices i
    ${catJoin}
    WHERE i.type = 'supplier'
      AND i.status NOT IN ('cancelled')
      AND i.invoice_date IS NOT NULL
      AND i.invoice_date BETWEEN ? AND ?
      ${suppWhere} ${catCond}
    GROUP BY month
  `).all(dateStart, dateEnd, ...suppParams, ...catParams) as any[];

  // ── Build full month grid ──────────────────────────────────────────────────
  const months: Record<string, { month: string; received: number; paid_out: number }> = {};
  for (let m = monthStart; m <= monthEnd; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    months[key] = { month: key, received: 0, paid_out: 0 };
  }
  for (const r of receivedRows) {
    if (months[r.month]) months[r.month].received = Number(r.received) || 0;
  }
  for (const p of paidRows) {
    if (months[p.month]) months[p.month].paid_out = Number(p.paid_out) || 0;
  }
  const monthly = Object.values(months);

  // ── By customer ──────────────────────────────────────────────────────────
  const byCustomer = db.prepare(`
    SELECT c.name as customer_name, c.id as customer_id,
      COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) as total,
      COUNT(*) as invoice_count
    FROM invoices i JOIN customers c ON i.customer_id = c.id
    WHERE i.type = 'customer' AND i.status = 'paid'
      AND COALESCE(
        (SELECT MAX(wt.transfer_date) FROM wire_transfers wt WHERE wt.invoice_id = i.id),
        i.payment_date, i.invoice_date
      ) BETWEEN ? AND ?
      ${custWhere}
    GROUP BY i.customer_id ORDER BY total DESC LIMIT 20
  `).all(dateStart, dateEnd, ...custParams) as any[];

  // ── By region ──────────────────────────────────────────────────────────────
  // Region is derived from the operation's country, falling back to the order's
  // freeform destination (resolved to a country in JS via resolveCountry).
  const regionSrcRows = db.prepare(`
    SELECT COALESCE(i.eur_amount, i.amount) as total,
      op.country as op_country, o.destination as destination
    FROM invoices i
    LEFT JOIN operations op ON op.id = i.operation_id
    LEFT JOIN orders o ON op.order_id = o.id
    WHERE i.type = 'customer' AND i.status = 'paid'
      AND COALESCE(
        (SELECT MAX(wt.transfer_date) FROM wire_transfers wt WHERE wt.invoice_id = i.id),
        i.payment_date, i.invoice_date
      ) BETWEEN ? AND ?
      ${custWhere}
  `).all(dateStart, dateEnd, ...custParams) as any[];
  const regionMap = new Map<string, { region: string; total: number; invoice_count: number }>();
  for (const r of regionSrcRows) {
    const region = resolveCountry(r.op_country || r.destination) || 'Unknown';
    const entry = regionMap.get(region) ?? { region, total: 0, invoice_count: 0 };
    entry.total += Number(r.total) || 0;
    entry.invoice_count += 1;
    regionMap.set(region, entry);
  }
  const byRegion = [...regionMap.values()].sort((a, b) => b.total - a.total);

  // ── By supplier ──────────────────────────────────────────────────────────
  const bySupplier = db.prepare(`
    SELECT s.name as supplier_name, s.id as supplier_id, s.category,
      COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) as total,
      COUNT(*) as invoice_count
    FROM invoices i JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.type = 'supplier' AND i.status NOT IN ('cancelled')
      AND i.invoice_date IS NOT NULL
      AND i.invoice_date BETWEEN ? AND ?
      ${suppWhere} ${catCond}
    GROUP BY i.supplier_id ORDER BY total DESC LIMIT 20
  `).all(dateStart, dateEnd, ...suppParams, ...catParams) as any[];

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalReceived = monthly.reduce((s, m) => s + m.received, 0);
  const totalPaidOut = monthly.reduce((s, m) => s + m.paid_out, 0);

  // Pending: sent/overdue invoices WITH a due_date in the selected year — live FX
  const outstandingRows = db.prepare(`
    SELECT amount, UPPER(COALESCE(currency, 'USD')) as currency
    FROM invoices
    WHERE type = 'customer' AND status IN ('sent', 'overdue') AND due_date IS NOT NULL
      AND strftime('%Y', due_date) = ? ${custWhereOnly}
  `).all(year, ...custParams) as any[];
  const outstanding = await sumLiveEur(outstandingRows);

  // Expected: sent/overdue invoices with NO due_date (unscheduled) — live FX
  const expectedRows = db.prepare(`
    SELECT amount, UPPER(COALESCE(currency, 'USD')) as currency
    FROM invoices
    WHERE type = 'customer' AND status IN ('sent', 'overdue') AND due_date IS NULL ${custWhereOnly}
  `).all(...custParams) as any[];
  const expectedInvoiceReceivable = await sumLiveEur(expectedRows);
  // Expected from orders: customer orders with no invoice yet (counted from orders directly)
  const expectedOrderRows = db.prepare(`
    SELECT o.total_amount as amount, UPPER(COALESCE(oi_cur.currency, 'USD')) as currency
    FROM orders o
    LEFT JOIN (SELECT UPPER(COALESCE(currency, 'USD')) as currency, order_id FROM order_items GROUP BY order_id) oi_cur ON oi_cur.order_id = o.id
    WHERE o.type = 'customer' AND o.status NOT IN ('completed', 'cancelled')
      AND o.total_amount > 0
      AND NOT EXISTS (SELECT 1 FROM invoices i JOIN operations op ON i.operation_id = op.id WHERE op.order_id = o.id)
      ${customerId ? 'AND o.customer_id = ?' : ''}
  `).all(...(customerId ? [customerId] : [])) as any[];
  const expectedReceivable = expectedInvoiceReceivable + await sumLiveEur(expectedOrderRows);

  // Outstanding supplier payable — invoices with no invoice_date OR unpaid status
  const payableRows = db.prepare(`
    SELECT i.amount, UPPER(COALESCE(i.currency, 'USD')) as currency
    FROM invoices i
    ${catJoin}
    WHERE i.type = 'supplier' AND i.status NOT IN ('paid', 'cancelled', 'paid_with_other')
      AND i.invoice_date IS NULL
    ${suppWhereOnly} ${catCond}
  `).all(...suppParams, ...catParams) as any[];
  const outstandingPayable = await sumLiveEur(payableRows);

  res.json({
    monthly,
    by_customer: byCustomer,
    by_region: byRegion,
    by_supplier: bySupplier,
    totals: {
      received: totalReceived,
      paid_out: totalPaidOut,
      net: totalReceived - totalPaidOut,
      outstanding,           // sent/overdue WITH due_date
      expected: expectedReceivable, // sent WITHOUT due_date
      outstanding_payable: outstandingPayable,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /analytics/revenue-breakdown — Orders vs Invoices summaries (kept separate
// to avoid double-counting: an order later becomes an invoice). Each summary is
// bucketed monthly and broken down by customer and by region, all in live-FX EUR.
//   ?year= &month_from= &month_to= &customer_id=
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/revenue-breakdown', async (req: Request, res: Response) => {
  const yearNum = parseInt((req.query.year as string) || new Date().getFullYear().toString());
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    res.status(400).json({ error: 'Invalid year' }); return;
  }
  const year = String(yearNum);

  const rawFrom = parseInt(req.query.month_from as string || '1');
  const rawTo = parseInt(req.query.month_to as string || '12');
  const monthStart = Math.min(Math.max(isNaN(rawFrom) ? 1 : rawFrom, 1), 12);
  const monthEnd = Math.max(Math.min(isNaN(rawTo) ? 12 : rawTo, 12), monthStart);
  const dateStart = `${year}-${String(monthStart).padStart(2, '0')}-01`;
  const dateEnd = `${year}-${String(monthEnd).padStart(2, '0')}-31`;

  const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;
  if (req.query.customer_id && (isNaN(customerId!) || customerId! <= 0)) {
    res.status(400).json({ error: 'Invalid customer_id' }); return;
  }

  // ── Customer orders (by order_date) ──────────────────────────────────────────
  // Count every order that is allocated to an operation (an operation is what an
  // order kicks off); orders not yet promoted to an operation are excluded.
  const orderRows = db.prepare(`
    SELECT o.id, o.total_amount as amount,
      UPPER(COALESCE(oi_cur.currency, 'USD')) as currency,
      strftime('%Y-%m', COALESCE(o.order_date, date(o.created_at))) as month,
      c.id as customer_id, c.name as customer_name,
      o.destination as destination
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN (SELECT UPPER(COALESCE(currency, 'USD')) as currency, order_id FROM order_items GROUP BY order_id) oi_cur ON oi_cur.order_id = o.id
    WHERE o.type = 'customer' AND o.status NOT IN ('cancelled')
      AND EXISTS (SELECT 1 FROM operations op WHERE op.order_id = o.id)
      AND COALESCE(o.order_date, date(o.created_at)) BETWEEN ? AND ?
      ${customerId ? 'AND o.customer_id = ?' : ''}
  `).all(dateStart, dateEnd, ...(customerId ? [customerId] : [])) as any[];

  // ── Customer invoices (by invoice_date) ──────────────────────────────────────
  const invoiceRows = db.prepare(`
    SELECT i.id, i.amount, UPPER(COALESCE(i.currency, 'USD')) as currency,
      i.eur_amount as stored_eur,
      strftime('%Y-%m', i.invoice_date) as month,
      c.id as customer_id, c.name as customer_name,
      op.country as op_country, o.destination as destination
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN operations op ON op.id = i.operation_id
    LEFT JOIN orders o ON op.order_id = o.id
    WHERE i.type = 'customer' AND i.status NOT IN ('cancelled', 'draft')
      AND i.invoice_date IS NOT NULL AND i.invoice_date BETWEEN ? AND ?
      ${customerId ? 'AND i.customer_id = ?' : ''}
  `).all(dateStart, dateEnd, ...(customerId ? [customerId] : [])) as any[];

  // ── Fetch every non-EUR rate once (orders always need FX; invoices only when
  //    no stored eur_amount exists) ───────────────────────────────────────────
  const needed = new Set<string>();
  for (const r of orderRows) { const c = (r.currency || 'USD').toUpperCase(); if (c !== 'EUR') needed.add(c); }
  for (const r of invoiceRows) { if (r.stored_eur == null) { const c = (r.currency || 'USD').toUpperCase(); if (c !== 'EUR') needed.add(c); } }
  const rates: Record<string, number> = {};
  await Promise.all([...needed].map(async c => { rates[c] = await getEurRate(c, 'latest'); }));

  const toEur = (amount: number, currency: string) => {
    const c = (currency || 'USD').toUpperCase();
    return (Number(amount) || 0) * (c === 'EUR' ? 1 : (rates[c] ?? 1));
  };

  // ── Aggregate a set of {month, eur, customer_id, customer_name, region} rows ──
  const buildSummary = (rows: any[]) => {
    const months: Record<string, { month: string; total: number }> = {};
    for (let m = monthStart; m <= monthEnd; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      months[key] = { month: key, total: 0 };
    }
    const custMap = new Map<number, { customer_id: number; customer_name: string; total: number; count: number }>();
    const regionMap = new Map<string, { region: string; total: number; count: number }>();
    let total = 0;
    for (const r of rows) {
      const eur = r.eur || 0;
      total += eur;
      if (months[r.month]) months[r.month].total += eur;
      const cid = r.customer_id ?? 0;
      const cust = custMap.get(cid) ?? { customer_id: cid, customer_name: r.customer_name || 'Unknown', total: 0, count: 0 };
      cust.total += eur; cust.count += 1; custMap.set(cid, cust);
      const region = r.region || 'Unknown';
      const rg = regionMap.get(region) ?? { region, total: 0, count: 0 };
      rg.total += eur; rg.count += 1; regionMap.set(region, rg);
    }
    return {
      monthly: Object.values(months),
      by_customer: [...custMap.values()].sort((a, b) => b.total - a.total),
      by_region: [...regionMap.values()].sort((a, b) => b.total - a.total),
      total,
    };
  };

  const orders = buildSummary(orderRows.map(r => ({
    month: r.month,
    eur: toEur(r.amount, r.currency),
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    region: resolveCountry(r.destination) || 'Unknown',
  })));
  const invoices = buildSummary(invoiceRows.map(r => ({
    month: r.month,
    eur: r.stored_eur != null ? Number(r.stored_eur) : toEur(r.amount, r.currency),
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    region: resolveCountry(r.op_country || r.destination) || 'Unknown',
  })));

  res.json({ orders, invoices });
});

// SQL expression that converts any recognised unit to metric tons (MT).
// 1 MT = 1000 kg = 2204.6226218 lbs
const MT_EXPR = `
  CASE
    WHEN LOWER(oi.unit) IN ('mt', 'metric ton', 'metric tons', 'tonne', 'tonnes', 'tons', 'ton', 't')
      THEN oi.quantity
    WHEN LOWER(oi.unit) IN ('kg', 'kgs', 'kilogram', 'kilograms')
      THEN oi.quantity / 1000.0
    WHEN LOWER(oi.unit) IN ('lbs', 'lb', 'pound', 'pounds')
      THEN oi.quantity / 2204.6226218
    ELSE NULL
  END`;

// GET /analytics/quantity — monthly metric tons (MT) sold from customer orders
router.get('/quantity', (req: Request, res: Response) => {
  const yearNum = parseInt((req.query.year as string) || new Date().getFullYear().toString());
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    res.status(400).json({ error: 'Invalid year' }); return;
  }
  const year = String(yearNum);

  const rawFrom = parseInt(req.query.month_from as string || '1');
  const rawTo = parseInt(req.query.month_to as string || '12');
  const monthStart = Math.min(Math.max(isNaN(rawFrom) ? 1 : rawFrom, 1), 12);
  const monthEnd = Math.max(Math.min(isNaN(rawTo) ? 12 : rawTo, 12), monthStart);

  const dateStart = `${year}-${String(monthStart).padStart(2, '0')}-01`;
  const dateEnd = `${year}-${String(monthEnd).padStart(2, '0')}-31`;

  const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;
  if (req.query.customer_id && (isNaN(customerId!) || customerId! <= 0)) {
    res.status(400).json({ error: 'Invalid customer_id' }); return;
  }
  const custWhere = customerId ? `AND o.customer_id = ?` : '';
  const custParams = customerId ? [customerId] : [];

  const tonsRows = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(o.order_date, date(o.created_at))) as month,
           SUM(${MT_EXPR}) as tons
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.type = 'customer'
      AND COALESCE(o.order_date, date(o.created_at)) BETWEEN ? AND ?
      ${custWhere}
    GROUP BY month
  `).all(dateStart, dateEnd, ...custParams) as any[];

  const months: Record<string, { month: string; tons: number }> = {};
  for (let m = monthStart; m <= monthEnd; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    months[key] = { month: key, tons: 0 };
  }
  for (const r of tonsRows) {
    if (months[r.month]) months[r.month].tons = Number(r.tons) || 0;
  }

  const monthly = Object.values(months);
  const totalTons = monthly.reduce((s, m) => s + m.tons, 0);

  // Per-customer breakdown
  const byCustomer = db.prepare(`
    SELECT o.customer_id, c.name as customer_name, SUM(${MT_EXPR}) as tons
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN customers c ON o.customer_id = c.id
    WHERE o.type = 'customer'
      AND COALESCE(o.order_date, date(o.created_at)) BETWEEN ? AND ?
      ${custWhere}
    GROUP BY o.customer_id
    ORDER BY tons DESC
    LIMIT 30
  `).all(dateStart, dateEnd, ...custParams) as any[];

  // Per-region breakdown (region from operation country / order destination)
  const regionSrc = db.prepare(`
    SELECT SUM(${MT_EXPR}) as tons,
      (SELECT op.country FROM operations op WHERE op.order_id = o.id AND op.country IS NOT NULL ORDER BY op.id DESC LIMIT 1) as op_country,
      o.destination as destination
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.type = 'customer'
      AND COALESCE(o.order_date, date(o.created_at)) BETWEEN ? AND ?
      ${custWhere}
    GROUP BY o.id
  `).all(dateStart, dateEnd, ...custParams) as any[];
  const tonsRegionMap = new Map<string, number>();
  for (const r of regionSrc) {
    const region = resolveCountry(r.op_country || r.destination) || 'Unknown';
    tonsRegionMap.set(region, (tonsRegionMap.get(region) ?? 0) + (Number(r.tons) || 0));
  }
  const byRegion = [...tonsRegionMap.entries()]
    .map(([region, tons]) => ({ region, tons }))
    .filter(r => r.tons > 0)
    .sort((a, b) => b.tons - a.tons);

  res.json({ monthly, total_tons: totalTons, by_customer: byCustomer, by_region: byRegion });
});

// Debug: show exactly what data contributes to expenses for a given month
router.get('/debug-expenses', (_req: Request, res: Response) => {
  const month = (_req.query.month as string) || `${new Date().getFullYear()}-03`;
  const dateStart = `${month}-01`;
  const dateEnd = `${month}-31`;

  const wireTransfers = db.prepare(`
    SELECT wt.id, wt.amount, wt.transfer_date, wt.eur_amount, i.invoice_number, i.type as invoice_type, i.supplier_id, s.name as supplier_name
    FROM wire_transfers wt JOIN invoices i ON wt.invoice_id = i.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.type = 'supplier' AND wt.transfer_date BETWEEN ? AND ?
  `).all(dateStart, dateEnd);

  const payments = db.prepare(`
    SELECT p.id, p.amount, p.payment_date, i.invoice_number, i.type as invoice_type, s.name as supplier_name
    FROM payments p JOIN invoices i ON p.invoice_id = i.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.type = 'supplier' AND p.payment_date BETWEEN ? AND ?
  `).all(dateStart, dateEnd);

  const legacyPaid = db.prepare(`
    SELECT i.id, i.invoice_number, i.amount, i.eur_amount, i.payment_date, i.invoice_date, s.name as supplier_name
    FROM invoices i
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    WHERE i.type = 'supplier' AND i.status = 'paid'
      AND i.payment_date IS NOT NULL AND i.payment_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)
  `).all(dateStart, dateEnd);

  res.json({ month, wireTransfers, payments, legacyPaid });
});

// GET /analytics/demo-expenses — analytics for demo_invoices (demo expenses + sales activities)
router.get('/demo-expenses', (req: Request, res: Response) => {
  const yearNum = parseInt((req.query.year as string) || new Date().getFullYear().toString());
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    res.status(400).json({ error: 'Invalid year' }); return;
  }
  const year = String(yearNum);

  const rawFrom = parseInt(req.query.month_from as string || '1');
  const rawTo = parseInt(req.query.month_to as string || '12');
  const monthStart = Math.min(Math.max(isNaN(rawFrom) ? 1 : rawFrom, 1), 12);
  const monthEnd = Math.max(Math.min(isNaN(rawTo) ? 12 : rawTo, 12), monthStart);

  const domain = req.query.domain as string || '';
  const category = req.query.category as string || '';

  let where = `month >= ? AND month <= ?`;
  const params: any[] = [
    `${year}-${String(monthStart).padStart(2, '0')}`,
    `${year}-${String(monthEnd).padStart(2, '0')}`,
  ];
  if (domain) { where += ' AND domain = ?'; params.push(domain); }
  if (category) { where += ' AND category = ?'; params.push(category); }

  // Monthly totals by domain
  const monthly = db.prepare(
    `SELECT month, domain, SUM(COALESCE(eur_amount, amount)) as total, SUM(COALESCE(vat_eur_amount, vat_amount)) as vat_total, COUNT(*) as count
     FROM demo_invoices WHERE ${where} GROUP BY month, domain ORDER BY month ASC`
  ).all(...params) as any[];

  // By category
  const byCategory = db.prepare(
    `SELECT category, domain, SUM(COALESCE(eur_amount, amount)) as total, SUM(COALESCE(vat_eur_amount, vat_amount)) as vat_total, COUNT(*) as count
     FROM demo_invoices WHERE ${where} GROUP BY category, domain ORDER BY total DESC`
  ).all(...params) as any[];

  // By supplier
  const bySupplier = db.prepare(
    `SELECT supplier, domain, category, SUM(COALESCE(eur_amount, amount)) as total, SUM(COALESCE(vat_eur_amount, vat_amount)) as vat_total, COUNT(*) as count
     FROM demo_invoices WHERE ${where} GROUP BY supplier ORDER BY total DESC LIMIT 30`
  ).all(...params) as any[];

  // Grand totals
  const totals = db.prepare(
    `SELECT SUM(COALESCE(eur_amount, amount)) as total_amount, SUM(COALESCE(vat_eur_amount, vat_amount)) as total_vat, COUNT(*) as invoice_count
     FROM demo_invoices WHERE ${where}`
  ).get(...params) as any;

  // Domain totals
  const domainTotals = db.prepare(
    `SELECT domain, SUM(COALESCE(eur_amount, amount)) as total, SUM(COALESCE(vat_eur_amount, vat_amount)) as vat_total, COUNT(*) as count
     FROM demo_invoices WHERE ${where} GROUP BY domain`
  ).all(...params) as any[];

  // Build full month grid
  const monthGrid: Record<string, { month: string; demo: number; sales: number; demo_vat: number; sales_vat: number }> = {};
  for (let m = monthStart; m <= monthEnd; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    monthGrid[key] = { month: key, demo: 0, sales: 0, demo_vat: 0, sales_vat: 0 };
  }
  for (const r of monthly) {
    if (monthGrid[r.month]) {
      if (r.domain === 'demo') {
        monthGrid[r.month].demo = Number(r.total) || 0;
        monthGrid[r.month].demo_vat = Number(r.vat_total) || 0;
      } else {
        monthGrid[r.month].sales = Number(r.total) || 0;
        monthGrid[r.month].sales_vat = Number(r.vat_total) || 0;
      }
    }
  }

  // Available years
  const years = db.prepare(
    `SELECT DISTINCT SUBSTR(month, 1, 4) as year FROM demo_invoices ORDER BY year DESC`
  ).all() as any[];

  // Available categories
  const categories = db.prepare(
    `SELECT DISTINCT category FROM demo_invoices ORDER BY category`
  ).all() as any[];

  res.json({
    monthly: Object.values(monthGrid),
    by_category: byCategory,
    by_supplier: bySupplier,
    domain_totals: domainTotals,
    totals: {
      total_amount: totals?.total_amount || 0,
      total_vat: totals?.total_vat || 0,
      invoice_count: totals?.invoice_count || 0,
    },
    years: years.map((y: any) => y.year),
    categories: categories.map((c: any) => c.category),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /analytics/export-data — row-level data for Excel report generation
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/export-data', (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string) || 'revenue'; // revenue | expenses | combined
    const yearFrom = parseInt((req.query.year_from as string) || new Date().getFullYear().toString());
    const yearTo = parseInt((req.query.year_to as string) || String(yearFrom));
    const monthFrom = parseInt((req.query.month_from as string) || '1');
    const monthTo = parseInt((req.query.month_to as string) || '12');

    if (isNaN(yearFrom) || isNaN(yearTo) || yearFrom > yearTo) {
      res.status(400).json({ error: 'Invalid year range' }); return;
    }

    const dateStart = `${yearFrom}-${String(Math.max(1, monthFrom)).padStart(2, '0')}-01`;
    const dateEnd = `${yearTo}-${String(Math.min(12, monthTo)).padStart(2, '0')}-31`;

    const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string) : null;
    const custWhere = customerId ? `AND i.customer_id = ?` : '';
    const custParams = customerId ? [customerId] : [];

    const result: any = {};

    // ── Revenue data: customer invoices + confirmed orders ────────────────
    if (type === 'revenue' || type === 'combined') {
      // Tonnage comes off the invoice itself first — that is the document the
      // quantity was actually billed on. The operation's order items are only a
      // fallback for invoices predating the invoice-level field, and an invoice
      // with neither stays NULL so the report can say the figure is unknown
      // instead of silently adding a zero to the total.
      const invoiceRows = db.prepare(`
        SELECT i.invoice_number, c.name as customer_name,
          COALESCE(i.quantity_mt, oi_tons.quantity_mt) as quantity_mt,
          i.amount, UPPER(COALESCE(i.currency, 'USD')) as currency,
          COALESCE(i.eur_amount, i.amount) as eur_amount,
          i.invoice_date,
          op.operation_number as operation_number,
          op.country as op_country, o_op.destination as destination
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN operations op ON op.id = i.operation_id
        LEFT JOIN orders o_op ON o_op.id = op.order_id
        LEFT JOIN (
          SELECT op.id as op_id, SUM(${MT_EXPR}) as quantity_mt
          FROM operations op
          JOIN orders o ON op.order_id = o.id
          JOIN order_items oi ON oi.order_id = o.id
          GROUP BY op.id
        ) oi_tons ON oi_tons.op_id = i.operation_id
        WHERE i.type = 'customer' AND i.status NOT IN ('cancelled', 'draft')
          AND i.invoice_date BETWEEN ? AND ?
          ${custWhere}
        ORDER BY i.invoice_date
      `).all(dateStart, dateEnd, ...custParams) as any[];
      // Region is resolved in JS — the operation's country wins, falling back to
      // the order's freeform destination (e.g. "Puerto Quetzal" → Guatemala).
      result.customer_invoices = invoiceRows.map(({ op_country, destination, ...r }) => ({
        ...r, region: resolveCountry(op_country || destination) || 'Unknown',
      }));

      // Same "allocated to an operation, not cancelled" definition as
      // /revenue-breakdown's orders-placed measure — this list must reconcile
      // with the on-screen "Orders placed" total and the Summary tab, and must
      // include every order regardless of downstream status (an order that has
      // already been delivered/completed is still an order that was placed).
      const orderRows = db.prepare(`
        SELECT o.order_number, COALESCE(c.name, s.name) as party_name,
          o.status,
          oi_tons.quantity_mt as quantity_mt,
          o.total_amount as total_eur,
          COALESCE(o.order_date, date(o.created_at)) as order_date,
          (SELECT op.operation_number FROM operations op WHERE op.order_id = o.id ORDER BY op.id DESC LIMIT 1) as operation_number,
          (SELECT op.country FROM operations op WHERE op.order_id = o.id AND op.country IS NOT NULL ORDER BY op.id DESC LIMIT 1) as op_country,
          o.destination as destination
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN suppliers s ON o.supplier_id = s.id
        LEFT JOIN (
          SELECT oi.order_id, SUM(${MT_EXPR}) as quantity_mt
          FROM order_items oi
          GROUP BY oi.order_id
        ) oi_tons ON oi_tons.order_id = o.id
        WHERE o.type = 'customer'
          AND o.status NOT IN ('cancelled')
          AND EXISTS (SELECT 1 FROM operations op WHERE op.order_id = o.id)
          AND COALESCE(o.order_date, date(o.created_at)) BETWEEN ? AND ?
          ${customerId ? 'AND o.customer_id = ?' : ''}
        ORDER BY COALESCE(o.order_date, date(o.created_at))
      `).all(dateStart, dateEnd, ...(customerId ? [customerId] : [])) as any[];
      result.orders = orderRows.map(({ op_country, destination, ...r }) => ({
        ...r, region: resolveCountry(op_country || destination) || 'Unknown',
      }));
    }

    // ── Expense data: demo_invoices ──────────────────────────────────────
    if (type === 'expenses' || type === 'combined') {
      const domain = req.query.domain as string || '';
      const domainWhere = domain ? `AND domain = ?` : '';
      const domainParams = domain ? [domain] : [];

      result.supplier_expenses = db.prepare(`
        SELECT invoice_id, supplier, category, domain, amount, vat_amount,
          currency, issue_date,
          COALESCE(eur_amount, amount) as eur_amount,
          COALESCE(vat_eur_amount, vat_amount) as vat_eur_amount
        FROM demo_invoices
        WHERE issue_date BETWEEN ? AND ?
          ${domainWhere}
        ORDER BY issue_date
      `).all(dateStart, dateEnd, ...domainParams) as any[];
    }

    res.json(result);
  } catch (err: any) {
    console.error('[analytics] export-data error:', err);
    res.status(500).json({ error: 'Failed to fetch export data' });
  }
});

export default router;
