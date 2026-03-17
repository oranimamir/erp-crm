import { Router, Request, Response } from 'express';
import db from '../database.js';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const CATEGORIES = [
  'Salaries', 'Cars', 'Overhead', 'Consumables', 'Materials',
  'Utilities and Maintenance', 'Feedstock', 'Subcontractors and Consultants',
  'Regulatory', 'Equipment', 'Couriers', 'Other',
];

// Hardcoded supplier → category mapping
const SUPPLIER_CATEGORY_MAP: { pattern: string; category: string }[] = [
  // Salaries — Acerta always first, highest priority
  { pattern: 'acerta', category: 'Salaries' },
  { pattern: 'dutch taxes', category: 'Salaries' },
  // Cars
  { pattern: 'directlease', category: 'Cars' },
  { pattern: 'ciac', category: 'Cars' },
  { pattern: 'gas', category: 'Cars' },
  { pattern: 'blossom', category: 'Cars' },
  { pattern: 'modalizzy', category: 'Cars' },
  // Overhead
  { pattern: 'fruitsnack', category: 'Overhead' },
  { pattern: 'clean shark', category: 'Overhead' },
  { pattern: 'supermarket', category: 'Overhead' },
  { pattern: 'katy corluy', category: 'Overhead' },
  { pattern: 'internet', category: 'Overhead' },
  { pattern: 'proximus', category: 'Overhead' },
  { pattern: 'afval alternatief', category: 'Overhead' },
  { pattern: 'kbc', category: 'Overhead' },
  { pattern: 'port of antwerp', category: 'Overhead' },
  { pattern: 'citymesh flex', category: 'Overhead' },
  { pattern: 'arivic', category: 'Overhead' },
  { pattern: 'spirax sarco', category: 'Overhead' },
  { pattern: 'toolmax', category: 'Overhead' },
  // Consumables
  { pattern: 'gemu', category: 'Consumables' },
  { pattern: 'roth', category: 'Consumables' },
  { pattern: 'avantor', category: 'Consumables' },
  { pattern: 'vwr', category: 'Consumables' },
  { pattern: 'endress hauser', category: 'Consumables' },
  { pattern: 'proforto', category: 'Consumables' },
  { pattern: 'merck', category: 'Consumables' },
  { pattern: 'bruco', category: 'Consumables' },
  { pattern: 'klium', category: 'Consumables' },
  // Materials
  { pattern: 'durme natie', category: 'Materials' },
  { pattern: 'lyphar', category: 'Materials' },
  { pattern: 'brentag', category: 'Materials' },
  { pattern: 'brenntag', category: 'Materials' },
  { pattern: 'azelis', category: 'Materials' },
  { pattern: 'altec', category: 'Materials' },
  { pattern: 'fisher scientific', category: 'Materials' },
  { pattern: 'imcd', category: 'Materials' },
  { pattern: 'ractem', category: 'Materials' },
  // Utilities and Maintenance
  { pattern: 'bbc', category: 'Utilities and Maintenance' },
  { pattern: 'bolt', category: 'Utilities and Maintenance' },
  { pattern: 'water link', category: 'Utilities and Maintenance' },
  { pattern: 'ecoson', category: 'Utilities and Maintenance' },
  { pattern: 'eriks', category: 'Utilities and Maintenance' },
  { pattern: 'gea', category: 'Utilities and Maintenance' },
  { pattern: 'cebeo', category: 'Utilities and Maintenance' },
  { pattern: 'fabory', category: 'Utilities and Maintenance' },
  { pattern: 'conrad', category: 'Utilities and Maintenance' },
  { pattern: 'renewi', category: 'Utilities and Maintenance' },
  { pattern: 'dewofire', category: 'Utilities and Maintenance' },
  { pattern: 'de smedt', category: 'Utilities and Maintenance' },
  // Feedstock
  { pattern: 'looop', category: 'Feedstock' },
  { pattern: 'vandemoortel', category: 'Feedstock' },
  // Subcontractors and Consultants
  { pattern: 'growth', category: 'Subcontractors and Consultants' },
  { pattern: 'bratavi', category: 'Subcontractors and Consultants' },
  { pattern: 'cerda', category: 'Subcontractors and Consultants' },
  { pattern: 'idewe', category: 'Subcontractors and Consultants' },
  { pattern: 'ey', category: 'Subcontractors and Consultants' },
  { pattern: '10am', category: 'Subcontractors and Consultants' },
  { pattern: 'one4finance', category: 'Subcontractors and Consultants' },
  { pattern: 'argo law', category: 'Subcontractors and Consultants' },
  { pattern: 'regionis', category: 'Subcontractors and Consultants' },
  { pattern: 'vta', category: 'Subcontractors and Consultants' },
  // Regulatory
  { pattern: 'apeiron', category: 'Regulatory' },
  { pattern: 'normec', category: 'Regulatory' },
  { pattern: 'profex', category: 'Regulatory' },
  { pattern: 'echa', category: 'Regulatory' },
  { pattern: 'corbion', category: 'Regulatory' },
  // Equipment
  { pattern: 'foeth', category: 'Equipment' },
  { pattern: 'rvs', category: 'Equipment' },
  { pattern: 'smolders', category: 'Equipment' },
  { pattern: 'thyssenkruyp', category: 'Equipment' },
  { pattern: 'thyssenkrupp', category: 'Equipment' },
  { pattern: 'denios', category: 'Equipment' },
  { pattern: 'eurodia', category: 'Equipment' },
  { pattern: 'agidens', category: 'Equipment' },
  // Couriers
  { pattern: 'dhl', category: 'Couriers' },
  { pattern: 'fedex', category: 'Couriers' },
  // Other
  { pattern: 'ais antwerp', category: 'Other' },
];

function matchSupplierCategory(supplierName: string): string | null {
  const lower = supplierName.toLowerCase();

  // Acerta always takes priority
  if (lower.includes('acerta')) return 'Salaries';

  // Check hardcoded list
  for (const { pattern, category } of SUPPLIER_CATEGORY_MAP) {
    if (lower.includes(pattern)) return category;
  }

  // Check user-defined mappings
  const userMappings = db.prepare('SELECT supplier_pattern, category FROM demo_supplier_mappings').all() as any[];
  for (const m of userMappings) {
    if (lower.includes(m.supplier_pattern.toLowerCase())) return m.category;
  }

  return null;
}

function isAcerta(supplierName: string): boolean {
  return supplierName.toLowerCase().includes('acerta');
}

// Parse a UBL/PEPPOL XML invoice/credit note
function parseUBLInvoice(xmlString: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['InvoiceLine', 'CreditNoteLine', 'AdditionalDocumentReference'].includes(name),
  });
  const doc = parser.parse(xmlString);
  const root = doc.Invoice || doc.CreditNote;
  if (!root) return null;

  const isCreditNote = !!doc.CreditNote;

  const invoiceId = root['ID'] || '';
  const issueDate = root['IssueDate'] || '';
  const currency = root['DocumentCurrencyCode'] || 'EUR';

  // Supplier name
  const supplier = root['AccountingSupplierParty']?.['Party'];
  let supplierName = '';
  if (supplier) {
    supplierName = supplier['PartyName']?.['Name']
      || supplier['PartyLegalEntity']?.['RegistrationName']
      || '';
  }
  // Handle nested text nodes
  if (typeof supplierName === 'object' && supplierName['#text']) supplierName = supplierName['#text'];

  // Tax-exclusive amount
  const lmt = root['LegalMonetaryTotal'];
  let amount = 0;
  if (lmt) {
    const tea = lmt['TaxExclusiveAmount'];
    amount = typeof tea === 'object' ? parseFloat(tea['#text'] || tea['@_currencyID'] ? Object.values(tea).find(v => typeof v === 'string' && !isNaN(parseFloat(v as string))) as any : 0) : parseFloat(tea) || 0;
    if (typeof tea === 'object' && tea['#text']) amount = parseFloat(tea['#text']);
    else if (typeof tea === 'object') {
      // Try to get the numeric value
      for (const v of Object.values(tea)) {
        const n = parseFloat(v as string);
        if (!isNaN(n) && n > 0) { amount = n; break; }
      }
    } else {
      amount = parseFloat(tea) || 0;
    }
  }

  // For credit notes, amount should be negative
  if (isCreditNote && amount > 0) amount = -amount;

  // Line items
  const lineItems: { description: string; amount: number }[] = [];
  const lines = root['InvoiceLine'] || root['CreditNoteLine'] || [];
  const linesArr = Array.isArray(lines) ? lines : [lines];
  for (const line of linesArr) {
    if (!line) continue;
    const desc = line['Item']?.['Name'] || line['Item']?.['Description'] || '';
    const lineAmt = line['LineExtensionAmount'];
    let la = 0;
    if (typeof lineAmt === 'object' && lineAmt['#text']) la = parseFloat(lineAmt['#text']);
    else if (typeof lineAmt === 'object') {
      for (const v of Object.values(lineAmt)) { const n = parseFloat(v as string); if (!isNaN(n)) { la = n; break; } }
    } else la = parseFloat(lineAmt) || 0;
    lineItems.push({ description: typeof desc === 'object' ? (desc['#text'] || JSON.stringify(desc)) : String(desc), amount: la });
  }

  // Embedded PDF
  let embeddedPdf: string | null = null;
  let pdfFilename: string | null = null;
  const additionalDocs = root['AdditionalDocumentReference'] || [];
  const docsArr = Array.isArray(additionalDocs) ? additionalDocs : [additionalDocs];
  for (const docRef of docsArr) {
    if (!docRef) continue;
    const attachment = docRef['Attachment'];
    if (!attachment) continue;
    const binary = attachment['EmbeddedDocumentBinaryObject'];
    if (binary) {
      const base64 = typeof binary === 'object' ? binary['#text'] : binary;
      if (base64 && typeof base64 === 'string' && base64.length > 100) {
        embeddedPdf = base64;
        pdfFilename = typeof docRef['ID'] === 'object' ? docRef['ID']['#text'] : docRef['ID'];
        break;
      }
    }
  }

  return {
    invoiceId: typeof invoiceId === 'object' ? (invoiceId as any)['#text'] || String(invoiceId) : String(invoiceId),
    issueDate: typeof issueDate === 'object' ? (issueDate as any)['#text'] || String(issueDate) : String(issueDate),
    supplierName: String(supplierName).trim(),
    amount,
    currency: typeof currency === 'object' ? (currency as any)['#text'] || 'EUR' : String(currency),
    lineItems,
    embeddedPdf,
    pdfFilename,
  };
}

// ─── POST /api/demo-expenses/upload-zip ─────────────────────────────────────
router.post('/upload-zip', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const filename = req.file.originalname || 'upload.zip';
    const zip = await JSZip.loadAsync(req.file.buffer);
    const xmlFiles: { name: string; content: string }[] = [];
    const pdfFiles: Map<string, Buffer> = new Map();

    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const lower = name.toLowerCase();
      if (lower.endsWith('.xml')) {
        const content = await entry.async('string');
        xmlFiles.push({ name, content });
      } else if (lower.endsWith('.pdf')) {
        const buf = await entry.async('nodebuffer');
        const baseName = name.replace(/\.pdf$/i, '').split('/').pop() || '';
        pdfFiles.set(baseName.toLowerCase(), buf);
      }
    }

    if (xmlFiles.length === 0) {
      res.status(400).json({ error: 'No XML invoices found in the ZIP' });
      return;
    }

    // Parse all invoices
    const parsed: any[] = [];
    for (const xml of xmlFiles) {
      const inv = parseUBLInvoice(xml.content);
      if (!inv) continue;

      // Check for paired PDF
      const xmlBaseName = xml.name.replace(/\.xml$/i, '').split('/').pop() || '';
      const pairedPdf = pdfFiles.get(xmlBaseName.toLowerCase());

      parsed.push({
        ...inv,
        xmlFilename: xml.name,
        // Use embedded PDF from XML or paired PDF from ZIP
        embeddedPdf: inv.embeddedPdf || (pairedPdf ? pairedPdf.toString('base64') : null),
        pdfFilename: inv.pdfFilename || (pairedPdf ? xmlBaseName + '.pdf' : null),
      });
    }

    if (parsed.length === 0) {
      res.status(400).json({ error: 'No valid UBL invoices found in the XML files' });
      return;
    }

    // Infer month from invoice dates (most common month)
    const monthCounts: Record<string, number> = {};
    for (const inv of parsed) {
      if (inv.issueDate) {
        const m = inv.issueDate.substring(0, 7); // YYYY-MM
        monthCounts[m] = (monthCounts[m] || 0) + 1;
      }
    }
    const inferredMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
      || new Date().toISOString().substring(0, 7);

    // Assign categories
    const invoicesWithCategories = parsed.map(inv => {
      const category = matchSupplierCategory(inv.supplierName);
      return {
        ...inv,
        category: category || null,
        isAcerta: isAcerta(inv.supplierName),
      };
    });

    // Find unknown suppliers
    const unknownSuppliers = invoicesWithCategories
      .filter(inv => !inv.category)
      .map(inv => ({
        supplier: inv.supplierName,
        amount: inv.amount,
        date: inv.issueDate,
        invoiceId: inv.invoiceId,
      }));
    // Deduplicate by supplier name
    const uniqueUnknowns = [...new Map(unknownSuppliers.map(u => [u.supplier.toLowerCase(), u])).values()];

    // Check for duplicates against existing data
    const existingInvoices = db.prepare('SELECT invoice_id, supplier, amount, issue_date FROM demo_invoices').all() as any[];
    const duplicates: any[] = [];

    for (const inv of invoicesWithCategories) {
      for (const existing of existingInvoices) {
        let matchScore = 0;
        if (inv.invoiceId === existing.invoice_id) matchScore++;
        if (inv.supplierName.toLowerCase() === existing.supplier.toLowerCase() && Math.abs(inv.amount - existing.amount) < 0.01 && inv.issueDate === existing.issue_date) matchScore++;
        if (inv.supplierName.toLowerCase() === existing.supplier.toLowerCase() && Math.abs(inv.amount - existing.amount) < 0.01) {
          // Check 7-day window
          const d1 = new Date(inv.issueDate);
          const d2 = new Date(existing.issue_date);
          if (Math.abs(d1.getTime() - d2.getTime()) <= 7 * 24 * 60 * 60 * 1000) matchScore++;
        }
        if (matchScore >= 2) {
          duplicates.push({
            new: { invoiceId: inv.invoiceId, supplier: inv.supplierName, date: inv.issueDate, amount: inv.amount },
            existing: { invoiceId: existing.invoice_id, supplier: existing.supplier, date: existing.issue_date, amount: existing.amount },
          });
          break;
        }
      }
    }

    // Check if month already exists
    const existingBatch = db.prepare('SELECT id, filename FROM demo_upload_batches WHERE month = ?').get(inferredMonth) as any;

    res.json({
      parsed: invoicesWithCategories.map(inv => ({
        invoiceId: inv.invoiceId,
        issueDate: inv.issueDate,
        supplier: inv.supplierName,
        category: inv.category,
        amount: inv.amount,
        currency: inv.currency,
        lineItems: inv.lineItems,
        xmlFilename: inv.xmlFilename,
        hasPdf: !!inv.embeddedPdf,
        isAcerta: inv.isAcerta,
        duplicateWarning: false,
      })),
      inferredMonth,
      unknownSuppliers: uniqueUnknowns,
      duplicates,
      existingBatch: existingBatch ? { id: existingBatch.id, filename: existingBatch.filename } : null,
      filename,
      // Store full data temporarily in the response for the confirm step
      _fullData: invoicesWithCategories.map(inv => ({
        invoiceId: inv.invoiceId,
        issueDate: inv.issueDate,
        supplier: inv.supplierName,
        category: inv.category,
        amount: inv.amount,
        currency: inv.currency,
        lineItems: JSON.stringify(inv.lineItems),
        embeddedPdf: inv.embeddedPdf,
        pdfFilename: inv.pdfFilename,
        xmlFilename: inv.xmlFilename,
        isAcerta: inv.isAcerta,
      })),
    });
  } catch (err: any) {
    console.error('[demo-expenses] upload-zip error:', err);
    res.status(500).json({ error: 'Failed to process ZIP file: ' + (err.message || '') });
  }
});

// ─── POST /api/demo-expenses/confirm-import ─────────────────────────────────
router.post('/confirm-import', (req: Request, res: Response) => {
  try {
    const {
      invoices, // full invoice data array
      month,
      filename,
      categoryOverrides, // { supplier: category } for unknowns
      rememberSuppliers, // string[] of supplier names to persist
      skipInvoiceIds, // string[] of invoice IDs to skip (duplicates)
      replaceMonth, // boolean — replace existing month data
    } = req.body;

    if (!invoices || !month || !filename) {
      res.status(400).json({ error: 'invoices, month, and filename required' });
      return;
    }

    const userId = (req as any).user?.userId;
    const skipSet = new Set(skipInvoiceIds || []);

    const doImport = db.transaction(() => {
      // If replacing, delete existing batch for this month
      if (replaceMonth) {
        const oldBatch = db.prepare('SELECT id FROM demo_upload_batches WHERE month = ?').get(month) as any;
        if (oldBatch) {
          db.prepare('DELETE FROM demo_invoices WHERE batch_id = ?').run(oldBatch.id);
          db.prepare('DELETE FROM demo_upload_batches WHERE id = ?').run(oldBatch.id);
        }
      }

      // Save remembered supplier mappings
      if (rememberSuppliers && categoryOverrides) {
        const upsert = db.prepare(
          'INSERT OR REPLACE INTO demo_supplier_mappings (supplier_pattern, category) VALUES (?, ?)'
        );
        for (const supplier of rememberSuppliers) {
          const cat = categoryOverrides[supplier];
          if (cat) upsert.run(supplier.toLowerCase(), cat);
        }
      }

      // Create batch
      const filteredInvoices = invoices.filter((inv: any) => !skipSet.has(inv.invoiceId));
      const totalAmount = filteredInvoices.reduce((s: number, inv: any) => s + (inv.amount || 0), 0);

      const batchResult = db.prepare(
        'INSERT INTO demo_upload_batches (filename, month, invoice_count, total_amount, uploaded_by) VALUES (?, ?, ?, ?, ?)'
      ).run(filename, month, filteredInvoices.length, totalAmount, userId);
      const batchId = batchResult.lastInsertRowid;

      // Insert invoices
      const insertInv = db.prepare(`
        INSERT INTO demo_invoices (batch_id, invoice_id, issue_date, supplier, category, amount, currency, month, line_items, embedded_pdf, pdf_filename, xml_filename, duplicate_warning)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let count = 0;
      for (const inv of filteredInvoices) {
        // Resolve category: Acerta locked, then overrides, then detected
        let category = inv.category || 'Other';
        if (inv.isAcerta) {
          category = 'Salaries';
        } else if (!inv.category && categoryOverrides && categoryOverrides[inv.supplier]) {
          category = categoryOverrides[inv.supplier];
        }

        const isDuplicateIncluded = skipInvoiceIds && !skipSet.has(inv.invoiceId) && (req.body.duplicateInvoiceIds || []).includes(inv.invoiceId);

        insertInv.run(
          batchId,
          inv.invoiceId,
          inv.issueDate,
          inv.supplier,
          category,
          inv.amount,
          inv.currency || 'EUR',
          month,
          inv.lineItems || '[]',
          inv.embeddedPdf || null,
          inv.pdfFilename || null,
          inv.xmlFilename || null,
          isDuplicateIncluded ? 1 : 0,
        );
        count++;
      }

      return { batchId, count, totalAmount };
    });

    const result = doImport();
    db.saveToDisk();
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[demo-expenses] confirm-import error:', err);
    res.status(500).json({ error: 'Failed to import invoices' });
  }
});

// ─── GET /api/demo-expenses/invoices ────────────────────────────────────────
router.get('/invoices', (req: Request, res: Response) => {
  try {
    const { categories, suppliers, month, date_from, date_to, sort_by, sort_dir } = req.query;
    let sql = 'SELECT id, invoice_id, issue_date, supplier, category, amount, currency, month, xml_filename, duplicate_warning, created_at FROM demo_invoices WHERE 1=1';
    const params: any[] = [];

    if (categories) {
      const cats = (categories as string).split(',');
      sql += ` AND category IN (${cats.map(() => '?').join(',')})`;
      params.push(...cats);
    }
    if (suppliers) {
      const supps = (suppliers as string).split(',');
      sql += ` AND supplier IN (${supps.map(() => '?').join(',')})`;
      params.push(...supps);
    }
    if (month) {
      sql += ' AND month = ?';
      params.push(month);
    }
    if (date_from) {
      sql += ' AND issue_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      sql += ' AND issue_date <= ?';
      params.push(date_to);
    }

    const validSortCols = ['invoice_id', 'issue_date', 'supplier', 'category', 'amount', 'month', 'created_at'];
    const sortCol = validSortCols.includes(sort_by as string) ? sort_by : 'issue_date';
    const sortDirection = (sort_dir as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDirection}`;

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[demo-expenses] invoices error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// ─── GET /api/demo-expenses/invoices/:id — full invoice detail with PDF ─────
router.get('/invoices/:id', (req: Request, res: Response) => {
  try {
    const inv = db.prepare('SELECT * FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json(inv);
  } catch (err: any) {
    console.error('[demo-expenses] invoice detail error:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// ─── GET /api/demo-expenses/summary ─────────────────────────────────────────
router.get('/summary', (req: Request, res: Response) => {
  try {
    const { categories, suppliers, month, date_from, date_to } = req.query;
    let where = '1=1';
    const params: any[] = [];

    if (categories) {
      const cats = (categories as string).split(',');
      where += ` AND category IN (${cats.map(() => '?').join(',')})`;
      params.push(...cats);
    }
    if (suppliers) {
      const supps = (suppliers as string).split(',');
      where += ` AND supplier IN (${supps.map(() => '?').join(',')})`;
      params.push(...supps);
    }
    if (month) { where += ' AND month = ?'; params.push(month); }
    if (date_from) { where += ' AND issue_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND issue_date <= ?'; params.push(date_to); }

    const byCategory = db.prepare(
      `SELECT category, SUM(amount) as total FROM demo_invoices WHERE ${where} GROUP BY category ORDER BY total DESC`
    ).all(...params);

    const bySupplier = db.prepare(
      `SELECT supplier, SUM(amount) as total FROM demo_invoices WHERE ${where} GROUP BY supplier ORDER BY total DESC`
    ).all(...params);

    const monthlyByCategory = db.prepare(
      `SELECT month, category, SUM(amount) as total FROM demo_invoices WHERE ${where} GROUP BY month, category ORDER BY month ASC`
    ).all(...params);

    const months = db.prepare('SELECT DISTINCT month FROM demo_invoices ORDER BY month ASC').all();
    const allSuppliers = db.prepare('SELECT DISTINCT supplier FROM demo_invoices ORDER BY supplier ASC').all();
    const allCategories = db.prepare('SELECT DISTINCT category FROM demo_invoices ORDER BY category ASC').all();

    // Average monthly spend per category
    const avgByCategory = db.prepare(
      `SELECT category, AVG(monthly_total) as avg_total FROM (
        SELECT month, category, SUM(amount) as monthly_total FROM demo_invoices WHERE ${where} GROUP BY month, category
      ) GROUP BY category ORDER BY avg_total DESC`
    ).all(...params);

    res.json({
      by_category: byCategory,
      by_supplier: bySupplier,
      monthly_by_category: monthlyByCategory,
      avg_by_category: avgByCategory,
      months: months.map((m: any) => m.month),
      suppliers: allSuppliers.map((s: any) => s.supplier),
      categories: allCategories.map((c: any) => c.category),
    });
  } catch (err: any) {
    console.error('[demo-expenses] summary error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ─── GET /api/demo-expenses/batches — upload history ────────────────────────
router.get('/batches', (_req: Request, res: Response) => {
  try {
    const batches = db.prepare(
      'SELECT * FROM demo_upload_batches ORDER BY uploaded_at DESC'
    ).all();
    res.json(batches);
  } catch (err: any) {
    console.error('[demo-expenses] batches error:', err);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// ─── DELETE /api/demo-expenses/batches/:id ──────────────────────────────────
router.delete('/batches/:id', (req: Request, res: Response) => {
  try {
    const batchId = req.params.id;
    db.prepare('DELETE FROM demo_invoices WHERE batch_id = ?').run(batchId);
    db.prepare('DELETE FROM demo_upload_batches WHERE id = ?').run(batchId);
    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[demo-expenses] delete batch error:', err);
    res.status(500).json({ error: 'Failed to delete batch' });
  }
});

// ─── PATCH /api/demo-expenses/invoices/:id/category — override category ─────
router.patch('/invoices/:id/category', (req: Request, res: Response) => {
  try {
    const { category, applyToAll } = req.body;
    if (!category || !CATEGORIES.includes(category)) {
      res.status(400).json({ error: 'Invalid category' });
      return;
    }

    const inv = db.prepare('SELECT supplier FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    // Block Acerta overrides
    if (isAcerta(inv.supplier)) {
      res.status(400).json({ error: 'Cannot override category for Acerta invoices' });
      return;
    }

    db.prepare('UPDATE demo_invoices SET category = ? WHERE id = ?').run(category, req.params.id);

    if (applyToAll) {
      // Update all invoices from this supplier
      db.prepare('UPDATE demo_invoices SET category = ? WHERE LOWER(supplier) = LOWER(?) AND LOWER(supplier) NOT LIKE ?')
        .run(category, inv.supplier, '%acerta%');
      // Persist mapping
      db.prepare('INSERT OR REPLACE INTO demo_supplier_mappings (supplier_pattern, category) VALUES (?, ?)')
        .run(inv.supplier.toLowerCase(), category);
    }

    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[demo-expenses] category update error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// ─── GET /api/demo-expenses/categories — list available categories ──────────
router.get('/categories', (_req: Request, res: Response) => {
  res.json(CATEGORIES);
});

export default router;
