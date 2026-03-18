import { Router, Request, Response } from 'express';
import db from '../database.js';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import multer from 'multer';
// @ts-ignore — import lib directly to avoid pdf-parse's debug-mode crash in ESM
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

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
// OWN-COMPANY DETECTION (used by both UBL and PDF parsers)
// ═══════════════════════════════════════════════════════════════════════════════

const OWN_COMPANY_PATTERNS = ['triplew', '3plw', 'triple w', 'triple-w'];

function isOwnCompany(name: string): boolean {
  const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return OWN_COMPANY_PATTERNS.some(p => lower.includes(p.replace(/[^a-z0-9]/g, '')));
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

  // Supplier name — extract both parties, use the one that isn't our own company
  function extractPartyName(party: any): string {
    if (!party) return '';
    let name = party['PartyName']?.['Name']
      || party['PartyLegalEntity']?.['RegistrationName']
      || '';
    if (typeof name === 'object' && name['#text']) name = name['#text'];
    return String(name).trim();
  }
  const supplierParty = root['AccountingSupplierParty']?.['Party'];
  const customerParty = root['AccountingCustomerParty']?.['Party'];
  let supplierName = extractPartyName(supplierParty);
  // If the "supplier" is actually our own company, the real counterparty is the customer
  if (isOwnCompany(supplierName) && customerParty) {
    supplierName = extractPartyName(customerParty) || supplierName;
  }

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

  // VAT/Tax amount
  let vatAmount = 0;
  const taxTotal = root['TaxTotal'];
  if (taxTotal) {
    const ta = Array.isArray(taxTotal) ? taxTotal[0]?.['TaxAmount'] : taxTotal['TaxAmount'];
    if (typeof ta === 'object' && ta?.['#text']) {
      vatAmount = parseFloat(ta['#text']) || 0;
    } else if (typeof ta === 'object') {
      for (const v of Object.values(ta)) {
        const n = parseFloat(v as string);
        if (!isNaN(n) && n > 0) { vatAmount = n; break; }
      }
    } else {
      vatAmount = parseFloat(ta) || 0;
    }
  }
  if (isCreditNote && vatAmount > 0) vatAmount = -vatAmount;

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
    vatAmount,
    currency: typeof currency === 'object' ? (currency as any)['#text'] || 'EUR' : String(currency),
    lineItems,
    embeddedPdf,
    pdfFilename,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF INVOICE PARSER — extracts data from PDF text
// ═══════════════════════════════════════════════════════════════════════════════

function parseEuropeanNumber(raw: string): number {
  let numStr = raw.replace(/[€EUR\s]/g, '').trim();
  if (!numStr) return 0;
  if (numStr.includes(',') && numStr.includes('.')) {
    if (numStr.lastIndexOf(',') > numStr.lastIndexOf('.')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  } else if (numStr.includes(',')) {
    const parts = numStr.split(',');
    if (parts[parts.length - 1].length <= 2) {
      numStr = numStr.replace(/,/g, '.'); // decimal comma
    } else {
      numStr = numStr.replace(/,/g, ''); // thousands comma
    }
  }
  const n = parseFloat(numStr);
  return isNaN(n) ? 0 : n;
}

/** Reject numbers that look like date fragments (YYYYMMDD, YYYYMM, or year-like) */
function looksLikeDateNumber(raw: string, parsed: number): boolean {
  const stripped = raw.replace(/[€EUR\s.,]/g, '');
  // Exactly 8 digits starting with 20XX → YYYYMMDD
  if (/^20\d{6}$/.test(stripped)) return true;
  // Exactly 6 digits starting with 20XX → YYYYMM
  if (/^20\d{4}$/.test(stripped)) return true;
  // Plain year 2020-2035 with no decimal separators
  if (parsed >= 2020 && parsed <= 2035 && !raw.includes(',') && !raw.includes('.')) return true;
  // Unreasonably large: > €999,999 for a single expense invoice
  if (parsed > 999999) return true;
  return false;
}

function parseDateToISO(d: string): string | null {
  // DD/MM/YYYY or DD.MM.YYYY
  const eu = d.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (eu) return `${eu[3]}-${eu[2].padStart(2, '0')}-${eu[1].padStart(2, '0')}`;
  // DD-MM-YYYY
  const dm = d.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return null;
}

async function parsePDFInvoice(pdfBuffer: Buffer, pdfFilename: string) {
  let text = '';
  try {
    const result = await (pdfParse as any)(pdfBuffer);
    text = result.text || '';
  } catch (err) {
    console.error(`[pdf-parse] Failed to parse ${pdfFilename}:`, err);
  }

  // Even if text extraction fails, still create an entry from filename
  const fileBaseName = pdfFilename.replace(/\.pdf$/i, '').split('/').pop() || pdfFilename;
  if (!text.trim()) {
    return {
      invoiceId: fileBaseName,
      issueDate: new Date().toISOString().substring(0, 10),
      supplierName: 'Unknown',
      amount: 0,
      vatAmount: 0,
      currency: 'EUR',
      lineItems: [] as { description: string; amount: number }[],
      embeddedPdf: null as string | null,
      pdfFilename,
    };
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ─── INVOICE ID ──────────────────────────────────────────────────────
  // Require a label followed by separator then the actual value
  let invoiceId = '';
  const invIdPatterns = [
    // "Factuurnummer: F2026-001", "Factuur nr: 123", "Factuurnr.: ABC-123"
    /(?:factu(?:ur|re)\s*(?:no|nr|nummer|num)?\.?)[\s.:]+([A-Z0-9][\w\-\/\.]+)/i,
    // "Invoice Number: INV-123", "Invoice nr.: 456", "Invoice: ABC/2026"
    /(?:invoice\s*(?:no|nr|number|num|#|id)\.?)[\s.:]+([A-Z0-9][\w\-\/\.]+)/i,
    // "Credit note nr: CN-123"
    /(?:credit\s*(?:note|nota)\s*(?:no|nr|num)?\.?)[\s.:]+([A-Z0-9][\w\-\/\.]+)/i,
    // "Document nr: 12345"
    /(?:document\s*(?:no|nr|number|num)?\.?)[\s.:]+([A-Z0-9][\w\-\/\.]+)/i,
    // "Bestellnummer: PO-123"  "Bestelnummer: 123"
    /(?:bestell?\s*(?:nummer|nr)\.?)[\s.:]+([A-Z0-9][\w\-\/\.]+)/i,
    // Standalone invoice-like codes: INV-2026-001, F2026/001, VF20260001
    /\b((?:INV|VF|F|CR|CN)[\-\/]?\d{2,}[\w\-\/]*)\b/,
  ];
  for (const pat of invIdPatterns) {
    const m = text.match(pat);
    if (m && m[1].length >= 2) {
      // Reject if the "ID" is just a common label word
      const val = m[1].trim();
      if (/^(invoice|factuur|facture|credit|debiteur|datum|date|nummer|number|btw|tva|page|total)$/i.test(val)) continue;
      // Reject if it looks like a date
      if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(val)) continue;
      invoiceId = val;
      break;
    }
  }
  if (!invoiceId) {
    invoiceId = fileBaseName;
  }

  // ─── DATE ────────────────────────────────────────────────────────────
  let issueDate = '';
  // Try near date-related keywords first
  const dateKwPatterns = [
    /(?:invoice\s*date|factuurdatum|datum\s*factuur|date\s*de\s*facture|datum|date)[\s.:]*(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/i,
    /(?:invoice\s*date|factuurdatum|datum|date)[\s.:]*(\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})/i,
    /(?:invoice\s*date|factuurdatum|datum|date)[\s.:]*(\d{1,2}-\d{1,2}-\d{4})/i,
  ];
  for (const pat of dateKwPatterns) {
    const m = text.match(pat);
    if (m) {
      const d = parseDateToISO(m[1]);
      if (d) { issueDate = d; break; }
    }
  }
  // Fallback: any date in the first ~30 lines
  if (!issueDate) {
    const topText = lines.slice(0, 30).join('\n');
    const anyDate = topText.match(/(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/);
    if (anyDate) {
      const d = parseDateToISO(anyDate[1]);
      if (d) issueDate = d;
    }
    if (!issueDate) {
      const isoDate = topText.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoDate) issueDate = isoDate[1];
    }
  }
  if (!issueDate) {
    issueDate = new Date().toISOString().substring(0, 10);
  }

  // ─── SUPPLIER NAME ──────────────────────────────────────────────────
  // Strategy: find ALL company names (with legal suffixes), exclude own company, take the first non-own one
  let supplierName = '';
  const companySuffixRegex = /^(.+?)\s*(?:BV|NV|BVBA|SA\/NV|SA|SRL|GmbH|B\.V\.|N\.V\.|S\.A\.|VOF|CV|CVBA|AG|Ltd|LLC|Inc)\b/im;

  // Collect all company names found
  const companyNames: string[] = [];
  const companyGlobalRegex = /(.{2,60}?)\s*\b(?:BV|NV|BVBA|SA\/NV|SRL|GmbH|B\.V\.|N\.V\.|S\.A\.|VOF|CV|CVBA|AG|Ltd|LLC|Inc)\b/gi;
  let cm;
  while ((cm = companyGlobalRegex.exec(text)) !== null) {
    const name = cm[0].trim();
    // Clean up: remove leading punctuation / numbers
    const cleaned = name.replace(/^[\d\s.,:;()\-]+/, '').trim();
    if (cleaned.length > 2) companyNames.push(cleaned);
  }

  // Pick the first company that is NOT our own company
  for (const name of companyNames) {
    if (!isOwnCompany(name)) {
      supplierName = name;
      break;
    }
  }

  // If all found companies are own company, try "From" / "Van" / "Leverancier" label approach
  if (!supplierName) {
    const fromPatterns = [
      /(?:van|from|leverancier|supplier|fournisseur)[\s.:]+(.{3,80})/i,
    ];
    for (const pat of fromPatterns) {
      const m = text.match(pat);
      if (m && !isOwnCompany(m[1].trim())) {
        supplierName = m[1].split('\n')[0].trim();
        break;
      }
    }
  }

  // Last resort: first non-trivial, non-own-company line
  if (!supplierName) {
    for (const line of lines.slice(0, 20)) {
      if (line.length < 3 || line.length > 100) continue;
      if (/^\d+[\/.\\-]/.test(line)) continue;
      if (/^(page|pagina|invoice|factu|credit|btw|tva|date|datum|total|amount|€|eur|debiteur|bestelling|bestel|order|iban|bic|rek)/i.test(line)) continue;
      if (/^\d+[,.]?\d*$/.test(line)) continue;
      if (isOwnCompany(line)) continue;
      supplierName = line;
      break;
    }
  }

  // ─── AMOUNT (excl. BTW/VAT) ─────────────────────────────────────────
  // European number regex fragment: handles "1.431,25" or "1,431.25" or "431,25"
  const eurNum = '([\\d]+(?:[.,]\\d{3})*[.,]\\d{2})';

  let amount = 0;
  const amountPatterns = [
    // "Totaal van de items" (Belgian/Dutch — excl. BTW)
    new RegExp(`(?:totaal\\s*van\\s*de\\s*items|totaal\\s*van\\s*de\\s*artikelen)\\s*[:.]*\\s*(?:€|EUR)?\\s*${eurNum}`, 'i'),
    // Tax exclusive totals
    new RegExp(`(?:total\\s*(?:excl|hors|zonder|ex)\\.?\\s*(?:btw|tva|vat)?|subtotal|sous[\\s-]*total|netto\\s*bedrag|netto|taxable\\s*amount|maatstaf\\s*van\\s*heffing)\\s*[:.€]*\\s*(?:EUR)?\\s*${eurNum}`, 'i'),
    new RegExp(`(?:totaal\\s*(?:excl|exclusief|zonder)\\.?\\s*(?:btw|tva)?|bedrag\\s*excl)\\s*[:.€]*\\s*(?:EUR)?\\s*${eurNum}`, 'i'),
    new RegExp(`(?:total\\s*h\\.?t\\.?)\\s*[:.€]*\\s*(?:EUR)?\\s*${eurNum}`, 'i'),
    // Generic total (but NOT "totaal van factuur" which is incl. VAT)
    new RegExp(`(?:totaal|total|totale|montant)\\s*[:.]*\\s*(?:€|EUR)?\\s*${eurNum}`, 'i'),
  ];
  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m) {
      const parsed = parseEuropeanNumber(m[1]);
      if (parsed > 0 && !looksLikeDateNumber(m[1], parsed)) {
        amount = parsed;
        break;
      }
    }
  }

  // Fallback: find €-prefixed or EUR-prefixed amounts, take the largest reasonable one
  if (amount === 0) {
    const euroAmounts: number[] = [];
    const euroPattern = new RegExp(`(?:€|EUR)\\s*${eurNum}`, 'gi');
    let em;
    while ((em = euroPattern.exec(text)) !== null) {
      const n = parseEuropeanNumber(em[1]);
      if (n > 1 && !looksLikeDateNumber(em[1], n)) {
        euroAmounts.push(n);
      }
    }
    if (euroAmounts.length > 0) {
      amount = Math.max(...euroAmounts);
    }
  }

  // Second fallback: look for the largest European-format number with decimals
  if (amount === 0) {
    const allAmounts: number[] = [];
    const numPattern = /([\d]+(?:[.,]\d{3})*[.,]\d{2})\b/g;
    let nm;
    while ((nm = numPattern.exec(text)) !== null) {
      const n = parseEuropeanNumber(nm[1]);
      if (n > 1 && !looksLikeDateNumber(nm[1], n)) {
        allAmounts.push(n);
      }
    }
    if (allAmounts.length > 0) {
      amount = Math.max(...allAmounts);
    }
  }

  // ─── VAT/BTW AMOUNT ──────────────────────────────────────────────────
  let vatAmount = 0;
  const vatPatterns = [
    // "BTW 21,00%: EUR 300,56" or "BTW: EUR 300,56" or "BTW 21%: 300,56"
    new RegExp(`(?:btw|tva)\\s*(?:\\d+[.,]?\\d*\\s*%)?\\s*[:.]*\\s*(?:€|EUR)?\\s*${eurNum}`, 'i'),
    // "VAT Amount: 300.56" or "Tax amount: EUR 300,56"
    new RegExp(`(?:vat|tax|mwst)\\s*(?:amount|bedrag)?\\s*[:.]*\\s*(?:€|EUR)?\\s*${eurNum}`, 'i'),
  ];
  for (const pat of vatPatterns) {
    const m = text.match(pat);
    if (m) {
      const parsed = parseEuropeanNumber(m[1]);
      if (parsed > 0 && !looksLikeDateNumber(m[1], parsed)) {
        vatAmount = parsed;
        break;
      }
    }
  }

  console.log(`[pdf-parse] ${pdfFilename}: id="${invoiceId}" supplier="${supplierName}" date=${issueDate} amount=${amount} vat=${vatAmount}`);

  return {
    invoiceId,
    issueDate,
    supplierName: supplierName || fileBaseName,
    amount,
    vatAmount,
    currency: 'EUR',
    lineItems: [] as { description: string; amount: number }[],
    embeddedPdf: null as string | null,
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

    console.log(`[upload-zip] ZIP "${filename}" contains ${allFileNames.length} files:`, allFileNames.slice(0, 30));

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

    // Parse all invoices
    const parsed: any[] = [];

    // Process XML files (UBL/PEPPOL)
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

    // Process PDF files that weren't paired with XML files
    const pairedPdfNames = new Set<string>();
    for (const xml of xmlFiles) {
      const xmlBaseName = (xml.name.replace(/\.xml$/i, '').split('/').pop() || '').toLowerCase();
      if (pdfFiles.has(xmlBaseName)) pairedPdfNames.add(xmlBaseName);
    }

    // Parse standalone PDFs (not paired with XML)
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (!name.toLowerCase().endsWith('.pdf')) continue;
      const pdfBaseName = (name.replace(/\.pdf$/i, '').split('/').pop() || '').toLowerCase();
      if (pairedPdfNames.has(pdfBaseName)) continue; // already paired with XML
      try {
        const pdfBuffer = await entry.async('nodebuffer');
        const inv = await parsePDFInvoice(pdfBuffer, name);
        if (!inv) continue;
        parsed.push({
          ...inv,
          xmlFilename: null,
          embeddedPdf: pdfBuffer.toString('base64'),
          pdfFilename: name,
        });
      } catch (err) {
        console.error(`[upload-zip] Failed to parse PDF ${name}:`, err);
      }
    }

    if (parsed.length === 0) {
      const extensions = [...new Set(allFileNames.map(f => f.split('.').pop()?.toLowerCase() || 'unknown'))];
      res.status(400).json({ error: `No valid invoices found in the ZIP. Found ${allFileNames.length} file(s) with extensions: ${extensions.join(', ')}.` });
      return;
    }

    // --- Deduplicate within the ZIP itself (by invoiceId, or by supplier+amount+date) ---
    // Only dedup by combo when amount > 0 (don't lump together unparsed invoices)
    const seenKeys = new Set<string>();
    const deduped: typeof parsed = [];
    let inZipDuplicateCount = 0;
    for (const inv of parsed) {
      const key1 = inv.invoiceId ? `id:${inv.invoiceId}` : null;
      const key2 = inv.amount > 0
        ? `combo:${inv.supplierName.toLowerCase()}|${inv.amount}|${inv.issueDate}`
        : null;
      if ((key1 && seenKeys.has(key1)) || (key2 && seenKeys.has(key2))) {
        console.log(`[upload-zip] Dedup skipping: "${inv.supplierName}" ${inv.invoiceId} €${inv.amount} (key1=${key1}, key2=${key2})`);
        inZipDuplicateCount++;
        continue;
      }
      if (key1) seenKeys.add(key1);
      if (key2) seenKeys.add(key2);
      deduped.push(inv);
    }
    if (inZipDuplicateCount > 0) {
      console.log(`[upload-zip] Removed ${inZipDuplicateCount} duplicate(s) within the ZIP`);
    }

    // Infer month
    const monthCounts: Record<string, number> = {};
    for (const inv of deduped) {
      if (inv.issueDate) {
        const m = inv.issueDate.substring(0, 7);
        monthCounts[m] = (monthCounts[m] || 0) + 1;
      }
    }
    const inferredMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
      || new Date().toISOString().substring(0, 7);

    // Classify each invoice into domain + category
    const classified = deduped.map(inv => {
      const match = classifySupplier(inv.supplierName);
      return {
        ...inv,
        domain: match?.domain || null,
        category: match?.category || null,
        isAcerta: isAcerta(inv.supplierName),
      };
    });

    // Find unknown suppliers (no domain match), excluding own-company names
    const unknownSuppliers = classified
      .filter(inv => !inv.domain && !isOwnCompany(inv.supplierName))
      .map(inv => ({ supplier: inv.supplierName, amount: inv.amount, date: inv.issueDate, invoiceId: inv.invoiceId }));
    const uniqueUnknowns = [...new Map(unknownSuppliers.map(u => [u.supplier.toLowerCase(), u])).values()];

    // --- Duplicate detection against existing DB invoices ---
    // An invoice is a duplicate if: same invoice_id, OR same supplier+amount+date
    const existingInvoices = db.prepare('SELECT invoice_id, supplier, amount, issue_date, domain FROM demo_invoices').all() as any[];
    const existingIdSet = new Set(existingInvoices.map((e: any) => e.invoice_id));
    const existingComboSet = new Set(existingInvoices.map((e: any) =>
      `${e.supplier.toLowerCase()}|${e.amount}|${e.issue_date}`
    ));

    const duplicates: any[] = [];
    const duplicateInvoiceIds = new Set<string>();
    for (const inv of classified) {
      const idMatch = inv.invoiceId && existingIdSet.has(inv.invoiceId);
      const comboMatch = existingComboSet.has(`${inv.supplierName.toLowerCase()}|${inv.amount}|${inv.issueDate}`);
      if (idMatch || comboMatch) {
        duplicateInvoiceIds.add(inv.invoiceId);
        const existing = existingInvoices.find((e: any) =>
          e.invoice_id === inv.invoiceId ||
          (e.supplier.toLowerCase() === inv.supplierName.toLowerCase() && Math.abs(e.amount - inv.amount) < 0.01 && e.issue_date === inv.issueDate)
        );
        duplicates.push({
          new: { invoiceId: inv.invoiceId, supplier: inv.supplierName, date: inv.issueDate, amount: inv.amount },
          existing: existing ? { invoiceId: existing.invoice_id, supplier: existing.supplier, date: existing.issue_date, amount: existing.amount, domain: existing.domain } : null,
        });
      }
    }

    // Check if month already exists in either domain
    const existingDemoBatch = db.prepare("SELECT id, filename FROM demo_upload_batches WHERE month = ? AND domain = 'demo'").get(inferredMonth) as any;
    const existingSalesBatch = db.prepare("SELECT id, filename FROM demo_upload_batches WHERE month = ? AND domain = 'sales'").get(inferredMonth) as any;

    // Auto-exclude duplicates: only return non-duplicate invoices for import
    // Also exclude invoices where supplier is still own company (outgoing invoices with no counterparty found)
    const newInvoices = classified.filter(inv =>
      !duplicateInvoiceIds.has(inv.invoiceId) && !isOwnCompany(inv.supplierName)
    );

    console.log(`[upload-zip] Summary: ${allFileNames.length} files → ${xmlFiles.length} XML + ${pdfFiles.size} PDF → ${parsed.length} parsed → ${deduped.length} deduped → ${classified.length} classified → ${newInvoices.length} new (${duplicates.length} DB duplicates, ${inZipDuplicateCount} in-ZIP duplicates)`);

    res.json({
      parsed: newInvoices.map(inv => ({
        invoiceId: inv.invoiceId,
        issueDate: inv.issueDate,
        supplier: inv.supplierName,
        domain: inv.domain,
        category: inv.category,
        amount: inv.amount,
        vatAmount: inv.vatAmount || 0,
        currency: inv.currency,
        lineItems: inv.lineItems,
        xmlFilename: inv.xmlFilename,
        hasPdf: !!inv.embeddedPdf,
        isAcerta: inv.isAcerta,
      })),
      inferredMonth,
      unknownSuppliers: uniqueUnknowns.filter(u => !duplicateInvoiceIds.has(u.invoiceId)),
      duplicates,
      duplicatesSkipped: duplicates.length,
      inZipDuplicatesRemoved: inZipDuplicateCount,
      totalParsed: parsed.length,
      existingDemoBatch: existingDemoBatch ? { id: existingDemoBatch.id, filename: existingDemoBatch.filename } : null,
      existingSalesBatch: existingSalesBatch ? { id: existingSalesBatch.id, filename: existingSalesBatch.filename } : null,
      filename,
      _fullData: newInvoices.map(inv => ({
        invoiceId: inv.invoiceId,
        issueDate: inv.issueDate,
        supplier: inv.supplierName,
        domain: inv.domain,
        category: inv.category,
        amount: inv.amount,
        vatAmount: inv.vatAmount || 0,
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

      // Server-side duplicate guard: remove any invoice already in the DB
      const existingIds = new Set(
        (db.prepare('SELECT invoice_id FROM demo_invoices').all() as any[]).map((r: any) => r.invoice_id)
      );
      const existingCombos = new Set(
        (db.prepare('SELECT supplier, amount, issue_date FROM demo_invoices').all() as any[]).map(
          (r: any) => `${r.supplier.toLowerCase()}|${r.amount}|${r.issue_date}`
        )
      );
      const nonDuplicate = filtered.filter((inv: any) => {
        if (inv.invoiceId && existingIds.has(inv.invoiceId)) return false;
        if (existingCombos.has(`${(inv.supplier || '').toLowerCase()}|${inv.amount}|${inv.issueDate}`)) return false;
        return true;
      });

      if (nonDuplicate.length === 0) {
        return { skippedAll: true, message: 'All invoices already exist in the system' };
      }

      // Resolve final domain + category for each invoice
      const resolved = nonDuplicate.map((inv: any) => {
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
        INSERT INTO demo_invoices (batch_id, invoice_id, issue_date, supplier, category, domain, amount, vat_amount, currency, month, line_items, embedded_pdf, pdf_filename, xml_filename, duplicate_warning)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            inv.amount, inv.vatAmount || 0, inv.currency || 'EUR', month,
            inv.lineItems || '[]', inv.embeddedPdf || null, inv.pdfFilename || null,
            inv.xmlFilename || null, isDuplicateIncluded ? 1 : 0,
          );
        }

        results.push({ domain, count: domainInvoices.length, totalAmount });
      }

      return results;
    });

    const results = doImport();
    if (results && (results as any).skippedAll) {
      res.json({ success: true, results: [], message: (results as any).message });
      return;
    }
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
    let sql = 'SELECT id, invoice_id, issue_date, supplier, category, domain, amount, vat_amount, currency, month, xml_filename, duplicate_warning, created_at FROM demo_invoices WHERE 1=1';
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

    const validSortCols = ['invoice_id', 'issue_date', 'supplier', 'category', 'domain', 'amount', 'month', 'created_at'];
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

    const byCategory = db.prepare(`SELECT category, SUM(amount) as total, SUM(vat_amount) as vat_total FROM demo_invoices WHERE ${where} GROUP BY category ORDER BY total DESC`).all(...params);
    const bySupplier = db.prepare(`SELECT supplier, SUM(amount) as total, SUM(vat_amount) as vat_total FROM demo_invoices WHERE ${where} GROUP BY supplier ORDER BY total DESC`).all(...params);
    const monthlyByCategory = db.prepare(`SELECT month, category, SUM(amount) as total, SUM(vat_amount) as vat_total FROM demo_invoices WHERE ${where} GROUP BY month, category ORDER BY month ASC`).all(...params);
    const months = db.prepare(`SELECT DISTINCT month FROM demo_invoices WHERE ${where.replace('1=1', '1=1')} ORDER BY month ASC`).all(...(domain ? [domain] : []));
    const allSuppliers = db.prepare(`SELECT DISTINCT supplier FROM demo_invoices WHERE ${domain ? 'domain = ?' : '1=1'} ORDER BY supplier ASC`).all(...(domain ? [domain] : []));
    const allCategories = db.prepare(`SELECT DISTINCT category FROM demo_invoices WHERE ${domain ? 'domain = ?' : '1=1'} ORDER BY category ASC`).all(...(domain ? [domain] : []));
    const avgByCategory = db.prepare(
      `SELECT category, AVG(monthly_total) as avg_total FROM (
        SELECT month, category, SUM(amount) as monthly_total FROM demo_invoices WHERE ${where} GROUP BY month, category
      ) GROUP BY category ORDER BY avg_total DESC`
    ).all(...params);
    const totals = db.prepare(`SELECT SUM(amount) as total_amount, SUM(vat_amount) as total_vat, COUNT(*) as invoice_count FROM demo_invoices WHERE ${where}`).get(...params) as any;

    res.json({
      by_category: byCategory,
      by_supplier: bySupplier,
      monthly_by_category: monthlyByCategory,
      avg_by_category: avgByCategory,
      months: months.map((m: any) => m.month),
      suppliers: allSuppliers.map((s: any) => s.supplier),
      categories: allCategories.map((c: any) => c.category),
      total_amount: totals?.total_amount || 0,
      total_vat: totals?.total_vat || 0,
      invoice_count: totals?.invoice_count || 0,
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

// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY SUMMARY (cross-domain aggregation for Summary tab)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/monthly-summary', (req: Request, res: Response) => {
  try {
    const { month } = req.query;
    let where = '1=1';
    const params: any[] = [];
    if (month) { where += ' AND month = ?'; params.push(month); }

    // Per-month totals by domain
    const byMonth = db.prepare(
      `SELECT month, domain, SUM(amount) as total, SUM(vat_amount) as vat_total, COUNT(*) as count
       FROM demo_invoices WHERE ${where} GROUP BY month, domain ORDER BY month ASC`
    ).all(...params) as any[];

    // Per-month + category breakdown
    const byMonthCategory = db.prepare(
      `SELECT month, domain, category, SUM(amount) as total, SUM(vat_amount) as vat_total, COUNT(*) as count
       FROM demo_invoices WHERE ${where} GROUP BY month, domain, category ORDER BY month ASC, total DESC`
    ).all(...params) as any[];

    // Grand totals
    const grandTotals = db.prepare(
      `SELECT SUM(amount) as total_amount, SUM(vat_amount) as total_vat, COUNT(*) as invoice_count
       FROM demo_invoices WHERE ${where}`
    ).get(...params) as any;

    // Domain totals
    const domainTotals = db.prepare(
      `SELECT domain, SUM(amount) as total, SUM(vat_amount) as vat_total, COUNT(*) as count
       FROM demo_invoices WHERE ${where} GROUP BY domain`
    ).all(...params) as any[];

    // Available months
    const months = db.prepare('SELECT DISTINCT month FROM demo_invoices ORDER BY month ASC').all() as any[];

    res.json({
      by_month: byMonth,
      by_month_category: byMonthCategory,
      grand_totals: {
        total_amount: grandTotals?.total_amount || 0,
        total_vat: grandTotals?.total_vat || 0,
        invoice_count: grandTotals?.invoice_count || 0,
      },
      domain_totals: domainTotals,
      months: months.map((m: any) => m.month),
    });
  } catch (err: any) {
    console.error('[demo-expenses] monthly-summary error:', err);
    res.status(500).json({ error: 'Failed to fetch monthly summary' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE INVOICE UPLOAD (manual upload with review-before-confirm)
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/upload-single', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const filename = file.originalname.toLowerCase();
    let parsed: any = null;

    if (filename.endsWith('.xml')) {
      const xmlString = file.buffer.toString('utf-8');
      parsed = parseUBLInvoice(xmlString);
      if (parsed) {
        parsed.xmlFilename = file.originalname;
        parsed.pdfFilename = null;
        parsed.embeddedPdf = null;
      }
    } else if (filename.endsWith('.pdf')) {
      parsed = await parsePDFInvoice(file.buffer, file.originalname);
      if (parsed) {
        parsed.pdfFilename = file.originalname;
        parsed.embeddedPdf = file.buffer.toString('base64');
        parsed.xmlFilename = null;
      }
    } else {
      res.status(400).json({ error: 'Unsupported file type. Please upload XML or PDF.' });
      return;
    }

    if (!parsed) {
      res.status(400).json({ error: 'Could not parse invoice from file' });
      return;
    }

    // Auto-classify
    const classification = classifySupplier(parsed.supplier || '');
    if (classification) {
      parsed.domain = classification.domain;
      parsed.category = classification.category;
    } else {
      parsed.domain = 'demo';
      parsed.category = 'Other';
    }

    // Derive month
    if (parsed.date) {
      const d = new Date(parsed.date);
      if (!isNaN(d.getTime())) {
        parsed.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
    }

    res.json({
      invoice: {
        invoiceId: parsed.invoiceId || '',
        date: parsed.date || '',
        supplier: parsed.supplier || 'Unknown',
        amount: parsed.amount || 0,
        vatAmount: parsed.vatAmount || 0,
        currency: parsed.currency || 'EUR',
        domain: parsed.domain,
        category: parsed.category,
        month: parsed.month || '',
        lineItems: parsed.lineItems || '',
        pdfFilename: parsed.pdfFilename || null,
        xmlFilename: parsed.xmlFilename || null,
        embeddedPdf: parsed.embeddedPdf || null,
      },
    });
  } catch (err: any) {
    console.error('[demo-expenses] upload-single error:', err);
    res.status(500).json({ error: 'Failed to parse invoice' });
  }
});

router.post('/confirm-single', (req: Request, res: Response) => {
  try {
    const { invoice } = req.body;
    if (!invoice) { res.status(400).json({ error: 'No invoice data' }); return; }

    // Check for duplicate
    if (invoice.invoiceId) {
      const existing = db.prepare('SELECT id FROM demo_invoices WHERE invoice_id = ?').get(invoice.invoiceId) as any;
      if (existing) {
        res.status(409).json({ error: `Invoice ${invoice.invoiceId} already exists` });
        return;
      }
    }

    // Create a single-invoice batch
    const batchResult = db.prepare(
      'INSERT INTO demo_upload_batches (filename, invoice_count, domain, uploaded_at) VALUES (?, 1, ?, ?)'
    ).run(invoice.pdfFilename || invoice.xmlFilename || 'manual-upload', invoice.domain, new Date().toISOString());
    const batchId = batchResult.lastInsertRowid;

    db.prepare(
      `INSERT INTO demo_invoices (batch_id, invoice_id, issue_date, supplier, category, domain, amount, vat_amount, currency, month, line_items, embedded_pdf, pdf_filename, xml_filename, duplicate_warning)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      batchId,
      invoice.invoiceId || '',
      invoice.date || '',
      invoice.supplier || 'Unknown',
      invoice.category || 'Other',
      invoice.domain || 'demo',
      invoice.amount || 0,
      invoice.vatAmount || 0,
      invoice.currency || 'EUR',
      invoice.month || '',
      invoice.lineItems || '',
      invoice.embeddedPdf || null,
      invoice.pdfFilename || null,
      invoice.xmlFilename || null,
    );

    db.saveToDisk();
    res.json({ success: true, batchId });
  } catch (err: any) {
    console.error('[demo-expenses] confirm-single error:', err);
    res.status(500).json({ error: 'Failed to save invoice' });
  }
});

export default router;
