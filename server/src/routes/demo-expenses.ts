import { Router, Request, Response } from 'express';
import db from '../database.js';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const DEMO_CATEGORIES = [
  'Salaries', 'Cars', 'Overhead', 'Consumables', 'Materials',
  'Utilities and Maintenance', 'Feedstock', 'Subcontractors and Consultants',
  'Regulatory', 'Equipment', 'Couriers', 'Other',
];

const SALES_CATEGORIES = [
  'Raw Materials', 'Logistics', 'Blenders', 'Shipping',
];

const ALL_CATEGORIES = [...DEMO_CATEGORIES, ...SALES_CATEGORIES];

// ═══════════════════════════════════════════════════════════════════════════════
// HARDCODED DEMO SUPPLIER → CATEGORY MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const DEMO_SUPPLIER_MAP: { pattern: string; category: string }[] = [
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

// Sales Activities category labels to DB category values
const SALES_CAT_DB_MAP: Record<string, string> = {
  logistics: 'Logistics',
  blenders: 'Blenders',
  raw_materials: 'Raw Materials',
  shipping: 'Shipping',
};

/**
 * Classify a supplier into domain + category.
 * Returns { domain, category } or null if unknown.
 */
function classifySupplier(supplierName: string): { domain: string; category: string } | null {
  const lower = supplierName.toLowerCase();

  // Acerta always takes priority → Demo / Salaries
  if (lower.includes('acerta')) return { domain: 'demo', category: 'Salaries' };

  // Check hardcoded demo list
  for (const { pattern, category } of DEMO_SUPPLIER_MAP) {
    if (lower.includes(pattern)) return { domain: 'demo', category };
  }

  // Check Sales Activities suppliers (from the suppliers table)
  const salesSuppliers = db.prepare('SELECT name, category FROM suppliers').all() as any[];
  for (const s of salesSuppliers) {
    const sLower = s.name.toLowerCase();
    if (lower.includes(sLower) || sLower.includes(lower)) {
      const cat = SALES_CAT_DB_MAP[s.category] || s.category;
      return { domain: 'sales', category: cat };
    }
  }

  // Check user-defined mappings
  const userMappings = db.prepare('SELECT supplier_pattern, domain, category FROM demo_supplier_mappings').all() as any[];
  for (const m of userMappings) {
    if (lower.includes(m.supplier_pattern.toLowerCase())) {
      return { domain: m.domain || 'demo', category: m.category };
    }
  }

  return null;
}

function isAcerta(supplierName: string): boolean {
  return supplierName.toLowerCase().includes('acerta');
}

// ═══════════════════════════════════════════════════════════════════════════════
// UBL/PEPPOL XML PARSER
// ═══════════════════════════════════════════════════════════════════════════════

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
  if (typeof supplierName === 'object' && supplierName['#text']) supplierName = supplierName['#text'];

  // Tax-exclusive amount
  const lmt = root['LegalMonetaryTotal'];
  let amount = 0;
  if (lmt) {
    const tea = lmt['TaxExclusiveAmount'];
    if (typeof tea === 'object' && tea['#text']) {
      amount = parseFloat(tea['#text']);
    } else if (typeof tea === 'object') {
      for (const v of Object.values(tea)) {
        const n = parseFloat(v as string);
        if (!isNaN(n) && n > 0) { amount = n; break; }
      }
    } else {
      amount = parseFloat(tea) || 0;
    }
  }

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

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD ZIP — shared endpoint, classifies into demo/sales domains
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/upload-zip', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const filename = req.file.originalname || 'upload.zip';
    const zip = await JSZip.loadAsync(req.file.buffer);
    const xmlFiles: { name: string; content: string }[] = [];
    const pdfFiles: Map<string, Buffer> = new Map();
    const allFileNames: string[] = [];

    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      allFileNames.push(name);
      const lower = name.toLowerCase();
      if (lower.endsWith('.xml')) {
        const content = await entry.async('string');
        xmlFiles.push({ name, content });
      } else if (lower.endsWith('.pdf')) {
        pdfFiles.set((name.replace(/\.pdf$/i, '').split('/').pop() || '').toLowerCase(), await entry.async('nodebuffer'));
      }
    }

    console.log(`[upload-zip] ZIP "${filename}" contains ${allFileNames.length} files:`, allFileNames.slice(0, 20));

    // If no XML files found, check if there are files with UBL content but different extensions
    if (xmlFiles.length === 0) {
      // Try to detect XML content in non-.xml files (some systems use different extensions)
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const lower = name.toLowerCase();
        if (lower.endsWith('.xml')) continue; // already processed
        if (lower.endsWith('.pdf') || lower.endsWith('.jpg') || lower.endsWith('.png')) continue;
        try {
          const content = await entry.async('string');
          if (content.trim().startsWith('<?xml') || content.includes('<Invoice') || content.includes('<CreditNote')) {
            xmlFiles.push({ name, content });
          }
        } catch { /* binary file, skip */ }
      }
    }

    if (xmlFiles.length === 0) {
      const extensions = [...new Set(allFileNames.map(f => f.split('.').pop()?.toLowerCase() || 'unknown'))];
      res.status(400).json({
        error: `No XML invoices found in the ZIP. Found ${allFileNames.length} file(s) with extensions: ${extensions.join(', ')}. This feature requires UBL/PEPPOL XML invoices.`,
      });
      return;
    }

    // Parse all invoices
    const parsed: any[] = [];
    for (const xml of xmlFiles) {
      const inv = parseUBLInvoice(xml.content);
      if (!inv) continue;
      const xmlBaseName = xml.name.replace(/\.xml$/i, '').split('/').pop() || '';
      const pairedPdf = pdfFiles.get(xmlBaseName.toLowerCase());
      parsed.push({
        ...inv,
        xmlFilename: xml.name,
        embeddedPdf: inv.embeddedPdf || (pairedPdf ? pairedPdf.toString('base64') : null),
        pdfFilename: inv.pdfFilename || (pairedPdf ? xmlBaseName + '.pdf' : null),
      });
    }

    if (parsed.length === 0) { res.status(400).json({ error: 'No valid UBL invoices found in the XML files' }); return; }

    // Infer month
    const monthCounts: Record<string, number> = {};
    for (const inv of parsed) {
      if (inv.issueDate) {
        const m = inv.issueDate.substring(0, 7);
        monthCounts[m] = (monthCounts[m] || 0) + 1;
      }
    }
    const inferredMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
      || new Date().toISOString().substring(0, 7);

    // Classify each invoice into domain + category
    const classified = parsed.map(inv => {
      const match = classifySupplier(inv.supplierName);
      return {
        ...inv,
        domain: match?.domain || null,
        category: match?.category || null,
        isAcerta: isAcerta(inv.supplierName),
      };
    });

    // Find unknown suppliers (no domain match)
    const unknownSuppliers = classified
      .filter(inv => !inv.domain)
      .map(inv => ({ supplier: inv.supplierName, amount: inv.amount, date: inv.issueDate, invoiceId: inv.invoiceId }));
    const uniqueUnknowns = [...new Map(unknownSuppliers.map(u => [u.supplier.toLowerCase(), u])).values()];

    // Duplicate detection across both domains
    const existingInvoices = db.prepare('SELECT invoice_id, supplier, amount, issue_date, domain FROM demo_invoices').all() as any[];
    const duplicates: any[] = [];
    for (const inv of classified) {
      for (const existing of existingInvoices) {
        let matchScore = 0;
        if (inv.invoiceId === existing.invoice_id) matchScore++;
        if (inv.supplierName.toLowerCase() === existing.supplier.toLowerCase() && Math.abs(inv.amount - existing.amount) < 0.01 && inv.issueDate === existing.issue_date) matchScore++;
        if (inv.supplierName.toLowerCase() === existing.supplier.toLowerCase() && Math.abs(inv.amount - existing.amount) < 0.01) {
          const d1 = new Date(inv.issueDate);
          const d2 = new Date(existing.issue_date);
          if (Math.abs(d1.getTime() - d2.getTime()) <= 7 * 24 * 60 * 60 * 1000) matchScore++;
        }
        if (matchScore >= 2) {
          duplicates.push({
            new: { invoiceId: inv.invoiceId, supplier: inv.supplierName, date: inv.issueDate, amount: inv.amount },
            existing: { invoiceId: existing.invoice_id, supplier: existing.supplier, date: existing.issue_date, amount: existing.amount, domain: existing.domain },
          });
          break;
        }
      }
    }

    // Check if month already exists in either domain
    const existingDemoBatch = db.prepare("SELECT id, filename FROM demo_upload_batches WHERE month = ? AND domain = 'demo'").get(inferredMonth) as any;
    const existingSalesBatch = db.prepare("SELECT id, filename FROM demo_upload_batches WHERE month = ? AND domain = 'sales'").get(inferredMonth) as any;

    res.json({
      parsed: classified.map(inv => ({
        invoiceId: inv.invoiceId,
        issueDate: inv.issueDate,
        supplier: inv.supplierName,
        domain: inv.domain,
        category: inv.category,
        amount: inv.amount,
        currency: inv.currency,
        lineItems: inv.lineItems,
        xmlFilename: inv.xmlFilename,
        hasPdf: !!inv.embeddedPdf,
        isAcerta: inv.isAcerta,
      })),
      inferredMonth,
      unknownSuppliers: uniqueUnknowns,
      duplicates,
      existingDemoBatch: existingDemoBatch ? { id: existingDemoBatch.id, filename: existingDemoBatch.filename } : null,
      existingSalesBatch: existingSalesBatch ? { id: existingSalesBatch.id, filename: existingSalesBatch.filename } : null,
      filename,
      _fullData: classified.map(inv => ({
        invoiceId: inv.invoiceId,
        issueDate: inv.issueDate,
        supplier: inv.supplierName,
        domain: inv.domain,
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
    console.error('[expense-upload] upload-zip error:', err);
    res.status(500).json({ error: 'Failed to process ZIP file: ' + (err.message || '') });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRM IMPORT — creates batches per domain
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/confirm-import', (req: Request, res: Response) => {
  try {
    const {
      invoices,
      month,
      filename,
      categoryOverrides,   // { supplier: { domain, category } }
      domainOverrides,     // { supplier: domain } — for unknowns
      rememberSuppliers,   // string[] of supplier names to persist
      skipInvoiceIds,
      replaceDemoMonth,
      replaceSalesMonth,
    } = req.body;

    if (!invoices || !month || !filename) {
      res.status(400).json({ error: 'invoices, month, and filename required' });
      return;
    }

    const userId = (req as any).user?.userId;
    const skipSet = new Set(skipInvoiceIds || []);

    const doImport = db.transaction(() => {
      // If replacing, delete existing batches
      if (replaceDemoMonth) {
        const old = db.prepare("SELECT id FROM demo_upload_batches WHERE month = ? AND domain = 'demo'").get(month) as any;
        if (old) {
          db.prepare('DELETE FROM demo_invoices WHERE batch_id = ?').run(old.id);
          db.prepare('DELETE FROM demo_upload_batches WHERE id = ?').run(old.id);
        }
      }
      if (replaceSalesMonth) {
        const old = db.prepare("SELECT id FROM demo_upload_batches WHERE month = ? AND domain = 'sales'").get(month) as any;
        if (old) {
          db.prepare('DELETE FROM demo_invoices WHERE batch_id = ?').run(old.id);
          db.prepare('DELETE FROM demo_upload_batches WHERE id = ?').run(old.id);
        }
      }

      // Save remembered supplier mappings
      if (rememberSuppliers && categoryOverrides) {
        const upsert = db.prepare(
          'INSERT OR REPLACE INTO demo_supplier_mappings (supplier_pattern, domain, category) VALUES (?, ?, ?)'
        );
        for (const supplier of rememberSuppliers) {
          const override = categoryOverrides[supplier];
          if (override) {
            upsert.run(supplier.toLowerCase(), override.domain || 'demo', override.category);
          }
        }
      }

      // Split invoices by domain and create separate batches
      const filtered = invoices.filter((inv: any) => !skipSet.has(inv.invoiceId));

      // Resolve final domain + category for each invoice
      const resolved = filtered.map((inv: any) => {
        let domain = inv.domain || 'demo';
        let category = inv.category || 'Other';

        if (inv.isAcerta) {
          domain = 'demo';
          category = 'Salaries';
        } else if (!inv.domain && domainOverrides && domainOverrides[inv.supplier]) {
          domain = domainOverrides[inv.supplier];
        }
        if (!inv.category && categoryOverrides && categoryOverrides[inv.supplier]) {
          category = categoryOverrides[inv.supplier].category || category;
          if (categoryOverrides[inv.supplier].domain) domain = categoryOverrides[inv.supplier].domain;
        }

        return { ...inv, domain, category };
      });

      // Group by domain
      const byDomain: Record<string, any[]> = {};
      for (const inv of resolved) {
        if (!byDomain[inv.domain]) byDomain[inv.domain] = [];
        byDomain[inv.domain].push(inv);
      }

      const results: any[] = [];
      const insertInv = db.prepare(`
        INSERT INTO demo_invoices (batch_id, invoice_id, issue_date, supplier, category, domain, amount, currency, month, line_items, embedded_pdf, pdf_filename, xml_filename, duplicate_warning)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [domain, domainInvoices] of Object.entries(byDomain)) {
        const totalAmount = domainInvoices.reduce((s: number, inv: any) => s + (inv.amount || 0), 0);

        const batchResult = db.prepare(
          'INSERT INTO demo_upload_batches (filename, month, domain, invoice_count, total_amount, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(filename, month, domain, domainInvoices.length, totalAmount, userId);
        const batchId = batchResult.lastInsertRowid;

        for (const inv of domainInvoices) {
          const isDuplicateIncluded = skipInvoiceIds && !skipSet.has(inv.invoiceId) && (req.body.duplicateInvoiceIds || []).includes(inv.invoiceId);
          insertInv.run(
            batchId, inv.invoiceId, inv.issueDate, inv.supplier, inv.category, domain,
            inv.amount, inv.currency || 'EUR', month,
            inv.lineItems || '[]', inv.embeddedPdf || null, inv.pdfFilename || null,
            inv.xmlFilename || null, isDuplicateIncluded ? 1 : 0,
          );
        }

        results.push({ domain, count: domainInvoices.length, totalAmount });
      }

      return results;
    });

    const results = doImport();
    db.saveToDisk();
    res.json({ success: true, results });
  } catch (err: any) {
    console.error('[expense-upload] confirm-import error:', err);
    res.status(500).json({ error: 'Failed to import invoices' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN-FILTERED QUERY ENDPOINTS
// All accept ?domain=demo|sales to filter
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/invoices', (req: Request, res: Response) => {
  try {
    const { domain, categories, suppliers, month, date_from, date_to, sort_by, sort_dir } = req.query;
    let sql = 'SELECT id, invoice_id, issue_date, supplier, category, domain, amount, currency, month, xml_filename, duplicate_warning, created_at FROM demo_invoices WHERE 1=1';
    const params: any[] = [];

    if (domain) { sql += ' AND domain = ?'; params.push(domain); }
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
    if (month) { sql += ' AND month = ?'; params.push(month); }
    if (date_from) { sql += ' AND issue_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND issue_date <= ?'; params.push(date_to); }

    const validSortCols = ['invoice_id', 'issue_date', 'supplier', 'category', 'amount', 'month', 'created_at'];
    const sortCol = validSortCols.includes(sort_by as string) ? sort_by : 'issue_date';
    const sortDirection = (sort_dir as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDirection}`;

    res.json(db.prepare(sql).all(...params));
  } catch (err: any) {
    console.error('[demo-expenses] invoices error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

router.get('/invoices/:id', (req: Request, res: Response) => {
  try {
    const inv = db.prepare('SELECT * FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json(inv);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

router.get('/summary', (req: Request, res: Response) => {
  try {
    const { domain, categories, suppliers, month, date_from, date_to } = req.query;
    let where = '1=1';
    const params: any[] = [];

    if (domain) { where += ' AND domain = ?'; params.push(domain); }
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

    const byCategory = db.prepare(`SELECT category, SUM(amount) as total FROM demo_invoices WHERE ${where} GROUP BY category ORDER BY total DESC`).all(...params);
    const bySupplier = db.prepare(`SELECT supplier, SUM(amount) as total FROM demo_invoices WHERE ${where} GROUP BY supplier ORDER BY total DESC`).all(...params);
    const monthlyByCategory = db.prepare(`SELECT month, category, SUM(amount) as total FROM demo_invoices WHERE ${where} GROUP BY month, category ORDER BY month ASC`).all(...params);
    const months = db.prepare(`SELECT DISTINCT month FROM demo_invoices WHERE ${where.replace('1=1', '1=1')} ORDER BY month ASC`).all(...(domain ? [domain] : []));
    const allSuppliers = db.prepare(`SELECT DISTINCT supplier FROM demo_invoices WHERE ${domain ? 'domain = ?' : '1=1'} ORDER BY supplier ASC`).all(...(domain ? [domain] : []));
    const allCategories = db.prepare(`SELECT DISTINCT category FROM demo_invoices WHERE ${domain ? 'domain = ?' : '1=1'} ORDER BY category ASC`).all(...(domain ? [domain] : []));
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

router.get('/batches', (req: Request, res: Response) => {
  try {
    const { domain } = req.query;
    let sql = 'SELECT * FROM demo_upload_batches';
    const params: any[] = [];
    if (domain) { sql += ' WHERE domain = ?'; params.push(domain); }
    sql += ' ORDER BY uploaded_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

router.delete('/batches/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM demo_invoices WHERE batch_id = ?').run(req.params.id);
    db.prepare('DELETE FROM demo_upload_batches WHERE id = ?').run(req.params.id);
    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete batch' });
  }
});

router.patch('/invoices/:id/category', (req: Request, res: Response) => {
  try {
    const { category, domain, applyToAll } = req.body;
    if (!category) { res.status(400).json({ error: 'Category required' }); return; }

    const inv = db.prepare('SELECT supplier, domain FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    if (isAcerta(inv.supplier)) {
      res.status(400).json({ error: 'Cannot override category for Acerta invoices' });
      return;
    }

    const newDomain = domain || inv.domain;
    db.prepare('UPDATE demo_invoices SET category = ?, domain = ? WHERE id = ?').run(category, newDomain, req.params.id);

    if (applyToAll) {
      db.prepare('UPDATE demo_invoices SET category = ?, domain = ? WHERE LOWER(supplier) = LOWER(?) AND LOWER(supplier) NOT LIKE ?')
        .run(category, newDomain, inv.supplier, '%acerta%');
      db.prepare('INSERT OR REPLACE INTO demo_supplier_mappings (supplier_pattern, domain, category) VALUES (?, ?, ?)')
        .run(inv.supplier.toLowerCase(), newDomain, category);
    }

    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update category' });
  }
});

router.get('/categories', (req: Request, res: Response) => {
  const { domain } = req.query;
  if (domain === 'sales') res.json(SALES_CATEGORIES);
  else if (domain === 'demo') res.json(DEMO_CATEGORIES);
  else res.json(ALL_CATEGORIES);
});

// Demo supplier list (from hardcoded + user-defined demo mappings)
router.get('/demo-suppliers', (_req: Request, res: Response) => {
  try {
    const hardcoded = [...new Set(DEMO_SUPPLIER_MAP.map(m => ({ pattern: m.pattern, category: m.category, source: 'hardcoded' })))];
    const userDefined = db.prepare("SELECT supplier_pattern as pattern, category FROM demo_supplier_mappings WHERE domain = 'demo'").all() as any[];
    res.json({ hardcoded, userDefined: userDefined.map((u: any) => ({ ...u, source: 'user' })) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch demo suppliers' });
  }
});

export default router;
