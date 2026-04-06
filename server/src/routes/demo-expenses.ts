import { Router, Request, Response } from 'express';
import db from '../database.js';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import multer from 'multer';
// @ts-ignore — import lib directly to avoid pdf-parse's debug-mode crash in ESM
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { notifyAdmin } from '../lib/notify.js';

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
function classifySupplier(supplierName: string): { domain: string; category: string; displayName?: string } | null {
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

  // Check user-defined mappings (may include display_name for renamed suppliers)
  const userMappings = db.prepare('SELECT supplier_pattern, domain, category, display_name FROM demo_supplier_mappings').all() as any[];
  for (const m of userMappings) {
    if (lower.includes(m.supplier_pattern.toLowerCase())) {
      return {
        domain: m.domain || 'demo',
        category: m.category,
        displayName: m.display_name || undefined,
      };
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
  let doc: any;
  try {
    doc = parser.parse(xmlString);
  } catch (err) {
    console.error('[ubl-parse] Failed to parse XML:', err);
    return null;
  }
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
  const supplierIsOwnCompany = isOwnCompany(supplierName);
  if (supplierIsOwnCompany && customerParty) {
    supplierName = extractPartyName(customerParty) || supplierName;
  }

  // Extract supplier country from postal address or VAT number
  function extractCountry(party: any): string {
    if (!party) return '';
    const country = party['PostalAddress']?.['Country']?.['IdentificationCode'];
    if (country) {
      const code = typeof country === 'object' ? country['#text'] : String(country);
      if (code) return code.toUpperCase();
    }
    // Fallback: extract from VAT number prefix (e.g. "BE0725717772")
    const taxScheme = party['PartyTaxScheme'];
    const taxId = Array.isArray(taxScheme) ? taxScheme[0]?.['CompanyID'] : taxScheme?.['CompanyID'];
    const vatNum = typeof taxId === 'object' ? taxId?.['#text'] : String(taxId || '');
    const countryPrefix = vatNum.match(/^([A-Z]{2})/)?.[1];
    if (countryPrefix) return countryPrefix;
    return '';
  }
  // The actual supplier's country (not our own company's)
  const supplierCountry = supplierIsOwnCompany && customerParty
    ? extractCountry(customerParty)
    : extractCountry(supplierParty);

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
        const rawId = docRef['ID'];
        pdfFilename = rawId == null ? null : typeof rawId === 'object' ? String(rawId['#text'] || '') : String(rawId);
        break;
      }
    }
  }

  // VAT sanity check based on supplier country
  // Non-Belgian suppliers typically don't charge VAT to a Belgian company (intra-community / reverse charge)
  const isBelgian = supplierCountry === 'BE';
  if (!isBelgian && vatAmount > 0) {
    // Non-Belgian supplier charging VAT is unusual — likely a parsing artifact
    // Keep it but log for awareness
    console.log(`[ubl-parse] Non-Belgian supplier (${supplierCountry || '??'}) "${supplierName}" has VAT ${vatAmount} — keeping as-is`);
  }

  return {
    invoiceId: typeof invoiceId === 'object' ? (invoiceId as any)['#text'] || String(invoiceId) : String(invoiceId),
    issueDate: typeof issueDate === 'object' ? (issueDate as any)['#text'] || String(issueDate) : String(issueDate),
    supplierName: String(supplierName).trim(),
    amount,
    vatAmount,
    currency: typeof currency === 'object' ? (currency as any)['#text'] || 'EUR' : String(currency),
    supplierCountry,
    lineItems,
    embeddedPdf,
    pdfFilename,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF INVOICE PARSER — extracts data from PDF text
// ═══════════════════════════════════════════════════════════════════════════════

function parseEuropeanNumber(raw: string): number {
  let numStr = raw.replace(/[€£$\s]/g, '').replace(/\b(?:EUR|USD|GBP)\b/g, '').trim();
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

// Month name → number mapping (Dutch, French, English — short & full)
const MONTH_NAMES: Record<string, number> = {
  // Dutch
  jan: 1, januari: 1, feb: 2, februari: 2, mrt: 3, maart: 3, apr: 4, april: 4,
  mei: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, augustus: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12,
  // French
  janv: 1, janvier: 1, fév: 2, fevr: 2, février: 2, fevrier: 2, mars: 3, avr: 4, avril: 4,
  mai_fr: 5, juin: 6, juil: 7, juillet: 7, août: 8, aout: 8,
  // sept already covered
  oct: 10, octobre: 10,
  // nov, dec already covered
  // English
  january: 1, february: 2, mar: 3, march: 3, may: 5, june: 6,
  july: 7, august: 8, october: 10,
};
// Special case: "mai" maps to 5 in both Dutch and French
MONTH_NAMES['mai'] = 5;

function monthNameToNumber(name: string): number | null {
  return MONTH_NAMES[name.toLowerCase().replace(/[.]/g, '')] || null;
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
  // "15 mrt 2026", "3 februari 2026", "15-feb-2026", "1 jan. 2026"
  const monthName = d.match(/^(\d{1,2})[\s\-./]+([a-zA-Zéû.]+)[\s\-./]+(\d{4})$/);
  if (monthName) {
    const m = monthNameToNumber(monthName[2]);
    if (m) return `${monthName[3]}-${String(m).padStart(2, '0')}-${monthName[1].padStart(2, '0')}`;
  }
  // "maart 15, 2026", "February 3, 2026"
  const monthFirst = d.match(/^([a-zA-Zéû.]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthFirst) {
    const m = monthNameToNumber(monthFirst[1]);
    if (m) return `${monthFirst[3]}-${String(m).padStart(2, '0')}-${monthFirst[2].padStart(2, '0')}`;
  }
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
  let fileBaseName = (pdfFilename.replace(/\.pdf$/i, '').split('/').pop() || '').trim();
  // Guard against empty/blank/generic basenames from files like ".pdf", "  .pdf", "(2).pdf"
  if (!fileBaseName || fileBaseName.length <= 1) {
    fileBaseName = `PDF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
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
  // Prefer filename-derived ID when it looks like an invoice number.
  // PDF text extraction often jumbles multi-column layouts, making regex ID
  // extraction unreliable (e.g. matching a phone number next to "Invoice No.").
  // Filenames are typically more reliable since users name files by invoice number.
  let invoiceId = '';

  // Check if filename itself is a usable invoice ID.
  // Filenames are far more reliable than PDF text extraction (which jumbles columns).
  // Only fall back to text parsing for truly generic/unusable filenames.
  const filenameId = fileBaseName.replace(/\s+/g, ' ').trim();
  const isGenericFilename = /^(invoice|factuur|facture|proforma|credit|debit|document|unknown|pdf|scan|img|image|page|receipt|spaces)\b/i.test(filenameId)
    || /^(Loonaangifte|Uitnodiging|Sales Invoice Header|PDFOnly)/i.test(filenameId);
  const looksLikeInvoiceId = !isGenericFilename && filenameId.length >= 3
    && /[A-Z0-9]/i.test(filenameId);

  if (looksLikeInvoiceId) {
    invoiceId = filenameId;
  }

  // Fall back to text-based extraction if filename didn't provide a good ID
  if (!invoiceId) {
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
  }
  if (!invoiceId) {
    invoiceId = fileBaseName;
  }

  // ─── DATE ──────────────────────────────��─────────────────────────────
  let issueDate = '';
  // Due-date keywords to EXCLUDE (Dutch, French, English)
  const dueDateKw = /(?:vervaldatum|vervaldag|vervaldag|échéance|date\s*d['']?échéance|due\s*date|payment\s*date|betaaldatum|uiterste\s*betaaldatum)/i;
  // Invoice-date keywords (prefer these matches)
  const dateKw = /(?:invoice\s*date|factuurdatum|datum\s*factuur|date\s*(?:de\s*)?facture|datum|date)/i;

  // Helper: check if a match position is near a due-date keyword (within 60 chars before)
  const isNearDueDate = (fullText: string, matchIndex: number): boolean => {
    const preceding = fullText.substring(Math.max(0, matchIndex - 60), matchIndex);
    return dueDateKw.test(preceding);
  };

  // Strategy 1: keyword-anchored line search — look for date keyword lines, extract date from same/next line
  for (let i = 0; i < lines.length && !issueDate; i++) {
    const line = lines[i];
    if (!dateKw.test(line)) continue;
    if (dueDateKw.test(line)) continue; // skip due-date lines

    // Search this line and the next line for a date
    const searchText = line + (lines[i + 1] ? ' ' + lines[i + 1] : '');

    // Try numeric formats: DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY
    const numDate = searchText.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
    if (numDate) {
      const d = parseDateToISO(numDate[0]);
      if (d) { issueDate = d; break; }
    }
    // Try YYYY-MM-DD
    const isoMatch = searchText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) { issueDate = isoMatch[0]; break; }
    // Try month name: "15 mrt 2026", "3 februari 2026"
    const monthNameMatch = searchText.match(/(\d{1,2})[\s\-./]+([a-zA-Zéû.]+)[\s\-./]+(\d{4})/);
    if (monthNameMatch) {
      const d = parseDateToISO(monthNameMatch[0]);
      if (d) { issueDate = d; break; }
    }
    // Try "Month DD, YYYY": "March 15, 2026"
    const monthFirstMatch = searchText.match(/([a-zA-Zéû.]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (monthFirstMatch) {
      const d = parseDateToISO(monthFirstMatch[0]);
      if (d) { issueDate = d; break; }
    }
  }

  // Strategy 2: regex scan of full text with keyword proximity
  if (!issueDate) {
    const dateKwPatterns = [
      new RegExp(dateKw.source + '[\\s.:]*' + '(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{4})', 'gi'),
      new RegExp(dateKw.source + '[\\s.:]*' + '(\\d{4}[\\-\\/]\\d{1,2}[\\-\\/]\\d{1,2})', 'gi'),
      new RegExp(dateKw.source + '[\\s.:]*' + '(\\d{1,2}[\\s\\-./]+[a-zA-Zéû.]+[\\s\\-./]+\\d{4})', 'gi'),
      new RegExp(dateKw.source + '[\\s.:]*' + '([a-zA-Zéû.]+\\s+\\d{1,2},?\\s+\\d{4})', 'gi'),
    ];
    for (const pat of dateKwPatterns) {
      let m;
      while ((m = pat.exec(text)) !== null) {
        if (isNearDueDate(text, m.index)) continue;
        const dateStr = m[m.length - 1]; // last capture group is the date
        const d = parseDateToISO(dateStr);
        if (d) { issueDate = d; break; }
      }
      if (issueDate) break;
    }
  }

  // Strategy 3: Fallback — scan first ~30 lines for any date, excluding due-date proximity
  if (!issueDate) {
    const topText = lines.slice(0, 30).join('\n');
    // Numeric dates: DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY
    const numericDateRe = /\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}/g;
    let match;
    while ((match = numericDateRe.exec(topText)) !== null) {
      if (isNearDueDate(topText, match.index)) continue;
      const d = parseDateToISO(match[0]);
      if (d) { issueDate = d; break; }
    }
    // YYYY-MM-DD
    if (!issueDate) {
      const isoRe = /\d{4}-\d{2}-\d{2}/g;
      while ((match = isoRe.exec(topText)) !== null) {
        if (isNearDueDate(topText, match.index)) continue;
        issueDate = match[0]; break;
      }
    }
    // YYYYMMDD compact format (e.g. 20260315)
    if (!issueDate) {
      const compactRe = /\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g;
      while ((match = compactRe.exec(topText)) !== null) {
        if (isNearDueDate(topText, match.index)) continue;
        issueDate = `${match[1]}-${match[2]}-${match[3]}`; break;
      }
    }
    // Month name dates: "15 mrt 2026", "3 februari 2026"
    if (!issueDate) {
      const monthNameRe = /(\d{1,2})[\s\-./]+(?:jan(?:uari)?|feb(?:ruari)?|mrt|maart|apr(?:il)?|mei|jun[i]?|jul[i]?|aug(?:ustus)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|january|february|march|may|june|july|august|october)\.?[\s\-./]+(\d{4})/gi;
      while ((match = monthNameRe.exec(topText)) !== null) {
        if (isNearDueDate(topText, match.index)) continue;
        const d = parseDateToISO(match[0]);
        if (d) { issueDate = d; break; }
      }
    }
  }
  if (!issueDate) {
    issueDate = new Date().toISOString().substring(0, 10);
  }

  // ─── SUPPLIER NAME ──────────────────────────────────────────────────
  // STRATEGY: Match known suppliers first (highest accuracy), then fall back to extraction
  let supplierName = '';
  const textLower = text.toLowerCase();

  // 1. Search for known suppliers from hardcoded map, DB suppliers, and user-defined mappings
  const knownSuppliers: { name: string; pattern: string }[] = [];
  for (const { pattern } of DEMO_SUPPLIER_MAP) {
    knownSuppliers.push({ name: pattern, pattern: pattern.toLowerCase() });
  }
  try {
    const salesSuppliers = db.prepare('SELECT name FROM suppliers').all() as any[];
    for (const s of salesSuppliers) {
      if (s.name) knownSuppliers.push({ name: s.name, pattern: s.name.toLowerCase() });
    }
    const userMappings = db.prepare('SELECT supplier_pattern FROM demo_supplier_mappings').all() as any[];
    for (const m of userMappings) {
      if (m.supplier_pattern) knownSuppliers.push({ name: m.supplier_pattern, pattern: m.supplier_pattern.toLowerCase() });
    }
  } catch { /* ignore DB errors during parsing */ }

  // Sort by pattern length descending so longer/more specific names match first
  knownSuppliers.sort((a, b) => b.pattern.length - a.pattern.length);

  // Search the full text for each known supplier (skip very short patterns that cause false positives)
  for (const ks of knownSuppliers) {
    if (ks.pattern.length < 3) continue;
    // Use word boundary check to avoid partial matches (e.g. "gas" inside "gastronomie")
    const escaped = ks.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryRegex = ks.pattern.length <= 4
      ? new RegExp(`\\b${escaped}\\b`, 'i')  // short patterns need strict word boundaries
      : new RegExp(escaped, 'i');              // longer patterns can be substring matches
    if (wordBoundaryRegex.test(textLower) && !isOwnCompany(ks.name)) {
      // Try to find the actual full name from the text (with legal suffix if present)
      const nameEscaped = ks.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fullNameMatch = text.match(new RegExp(`(${nameEscaped}[^\\n]{0,40}?)(?:\\n|$)`, 'i'));
      if (fullNameMatch) {
        let extracted = fullNameMatch[1].trim();
        // Trim trailing noise (numbers, punctuation, common labels)
        extracted = extracted.replace(/[\s]*[-–—:;,.]?\s*(?:€|EUR|BTW|VAT|TVA|\d{2}[\/.-]\d{2}[\/.-]\d{4}|BE\s?\d).*/i, '').trim();
        // Keep it reasonable length
        if (extracted.length > 80) extracted = extracted.substring(0, 80).trim();
        supplierName = extracted || ks.name;
      } else {
        supplierName = ks.name;
      }
      break;
    }
  }

  // 2. If no known supplier matched, try extracting company names with legal suffixes
  if (!supplierName) {
    const companyNames: string[] = [];
    const companyGlobalRegex = /(.{2,60}?)\s*\b(?:BV|NV|BVBA|SA\/NV|SRL|GmbH|B\.V\.|N\.V\.|S\.A\.|VOF|CV|CVBA|AG|Ltd|LLC|Inc)\b/gi;
    let cm;
    while ((cm = companyGlobalRegex.exec(text)) !== null) {
      const name = cm[0].trim();
      const cleaned = name.replace(/^[\d\s.,:;()\-]+/, '').trim();
      if (cleaned.length > 2) companyNames.push(cleaned);
    }
    for (const name of companyNames) {
      if (!isOwnCompany(name)) {
        supplierName = name;
        break;
      }
    }
  }

  // 3. Try "From" / "Van" / "Leverancier" label approach
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

  // 4. Last resort: first non-trivial, non-own-company line
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

  // ─── CURRENCY DETECTION ──────────────────────────────────────────────
  // Detect currency from explicit codes and symbols in the text
  let currency = 'EUR'; // default
  // Count occurrences of currency indicators near amount-related keywords
  const currencyContext = textLower;
  const usdCodeCount = (currencyContext.match(/\busd\b/g) || []).length;
  const gbpCodeCount = (currencyContext.match(/\bgbp\b/g) || []).length;
  const eurCodeCount = (currencyContext.match(/\beur\b/g) || []).length;
  // Symbol-based detection (less reliable, used as tiebreaker)
  const dollarCount = (text.match(/\$/g) || []).length;
  const poundCount = (text.match(/£/g) || []).length;
  const euroCount = (text.match(/€/g) || []).length;

  // Explicit currency codes take priority
  if (usdCodeCount > eurCodeCount && usdCodeCount > gbpCodeCount) {
    currency = 'USD';
  } else if (gbpCodeCount > eurCodeCount && gbpCodeCount > usdCodeCount) {
    currency = 'GBP';
  } else if (eurCodeCount === 0 && usdCodeCount === 0 && gbpCodeCount === 0) {
    // No explicit codes — fall back to symbols
    if (dollarCount > euroCount && dollarCount > poundCount) {
      currency = 'USD';
    } else if (poundCount > euroCount && poundCount > dollarCount) {
      currency = 'GBP';
    }
  }

  // ─── AMOUNT (excl. BTW/VAT) ─────────────────────────────────────────
  // European number regex fragment: handles "1.431,25" or "1,431.25" or "431,25"
  const eurNum = '([\\d]+(?:[.,]\\d{3})*[.,]\\d{2})';

  let amount = 0;
  let matchedInclVat = false;
  // Search from bottom of document — invoice totals are always near the end.
  // Reverse lines so the first regex match corresponds to the last occurrence in the original text.
  const reversedText = lines.slice().reverse().join('\n');

  // Currency-aware symbol group for amount patterns
  const curSym = '(?:€|\\$|£|EUR|USD|GBP)';

  const amountPatterns: { pattern: RegExp; inclVat?: boolean }[] = [
    // ── Commercial invoice patterns (Chinese/Asian suppliers) ──
    // "AMOUNT" column with currency-prefixed value: "AMOUNT USD31,200.00"
    { pattern: new RegExp(`\\bAMOUNT\\b.{0,20}?${curSym}\\s*${eurNum}`, 'i') },
    // TOTAL line with currency-prefixed amount (skip quantity info between): "TOTAL 24.000MTS USD31,200.00"
    { pattern: new RegExp(`(?:totaal|total|totale|montant)\\b.{0,60}?${curSym}\\s*${eurNum}`, 'i') },

    // ── European invoice patterns ──
    // "Te betalen" / "Te betalen bedrag" (Dutch: amount to pay — usually incl. BTW)
    { pattern: new RegExp(`(?:te\\s*betalen(?:\\s*bedrag)?|verschuldigd\\s*bedrag)\\s*[:. ]*\\s*${curSym}?\\s*${eurNum}`, 'i'), inclVat: true },
    // "Totaalbedrag" (Dutch: grand total — usually incl. BTW)
    { pattern: new RegExp(`(?:totaalbedrag)\\s*[:. ]*\\s*${curSym}?\\s*${eurNum}`, 'i'), inclVat: true },
    // "Totaal van de items" (Belgian/Dutch — excl. BTW)
    { pattern: new RegExp(`(?:totaal\\s*van\\s*de\\s*items|totaal\\s*van\\s*de\\s*artikelen)\\s*[:.]*\\s*${curSym}?\\s*${eurNum}`, 'i') },
    // Tax exclusive totals — "bedrag excl. btw" (with optional period after excl)
    { pattern: new RegExp(`(?:total\\s*(?:excl|hors|zonder|ex)\\.?\\s*(?:btw|tva|vat)?|subtotal|sous[\\s-]*total|netto\\s*bedrag|netto|taxable\\s*amount|maatstaf\\s*van\\s*heffing)\\s*[:. ]*\\s*${curSym}?\\s*${eurNum}`, 'i') },
    { pattern: new RegExp(`(?:totaal\\s*(?:excl|exclusief|zonder)\\.?\\s*(?:btw|tva)?|bedrag\\s*excl\\.?\\s*(?:btw|tva)?)\\s*[:. ]*\\s*${curSym}?\\s*${eurNum}`, 'i') },
    { pattern: new RegExp(`(?:total\\s*h\\.?t\\.?)\\s*[:. ]*\\s*${curSym}?\\s*${eurNum}`, 'i') },
    // Totaal incl. BTW patterns — flagged so we can subtract VAT if available
    { pattern: new RegExp(`(?:totaal\\s*incl\\.?\\s*(?:btw|tva)?|total\\s*incl\\.?\\s*(?:btw|tva|vat)?)\\s*[:. ]*\\s*${curSym}?\\s*${eurNum}`, 'i'), inclVat: true },
    // Generic total (but NOT "totaal van factuur" which is incl. VAT)
    { pattern: new RegExp(`(?:totaal|total|totale|montant)\\s*[:.]*\\s*${curSym}?\\s*${eurNum}`, 'i') },
  ];
  for (const { pattern: pat, inclVat } of amountPatterns) {
    // Search reversed text so we find the LAST occurrence (closest to bottom of document)
    const m = reversedText.match(pat);
    if (m) {
      const parsed = parseEuropeanNumber(m[1]);
      if (parsed > 0 && !looksLikeDateNumber(m[1], parsed)) {
        amount = parsed;
        if (inclVat) matchedInclVat = true;
        break;
      }
    }
  }

  // Fallback: find currency-prefixed amounts, take the LAST reasonable one
  // (not the largest — the last one in the document is most likely the total)
  if (amount === 0) {
    let lastCurrencyAmount = 0;
    const currencyPattern = new RegExp(`${curSym}\\s*${eurNum}`, 'gi');
    let em;
    while ((em = currencyPattern.exec(text)) !== null) {
      const n = parseEuropeanNumber(em[1]);
      if (n > 1 && n <= 500000 && !looksLikeDateNumber(em[1], n)) {
        lastCurrencyAmount = n;
      }
    }
    if (lastCurrencyAmount > 0) {
      amount = lastCurrencyAmount;
    }
  }

  // Second fallback: look for the LAST reasonable European-format number with decimals
  if (amount === 0) {
    let lastAmount = 0;
    const numPattern = /([\d]+(?:[.,]\d{3})*[.,]\d{2})\b/g;
    let nm;
    while ((nm = numPattern.exec(text)) !== null) {
      const n = parseEuropeanNumber(nm[1]);
      if (n > 1 && n <= 500000 && !looksLikeDateNumber(nm[1], n)) {
        lastAmount = n;
      }
    }
    if (lastAmount > 0) {
      amount = lastAmount;
    }
  }

  // ─── SUPPLIER COUNTRY DETECTION ──────────────────────────────────────
  // Detect if supplier is Belgian from VAT number (BE0...) or address
  let supplierCountry = '';
  // Look for Belgian VAT number: BE0xxxxxxxxx or BE 0xxx.xxx.xxx
  const beVatMatch = text.match(/\bBE\s?0[\d.\s]{8,12}\b/);
  if (beVatMatch) {
    // Check this isn't OUR VAT number (TripleW is Belgian too)
    // If we find 2+ BE VAT numbers, supplier is likely Belgian
    // If we find 1, check if it's near supplier-related context vs customer
    const beVatAll = text.match(/\bBE\s?0[\d.\s]{8,12}\b/g) || [];
    if (beVatAll.length >= 2) {
      supplierCountry = 'BE'; // Both parties are Belgian
    } else {
      // Single BE VAT — could be ours or theirs. Check text context.
      // If supplier name or nearby text has Belgian indicators, mark as BE
      const hasNonBelgianIndicator = /\b(united kingdom|UK|germany|deutschland|france|nederland|netherlands|china|india|usa|ireland)\b/i.test(text);
      if (!hasNonBelgianIndicator) supplierCountry = 'BE';
    }
  }
  // Check for explicit country indicators if no VAT number found
  if (!supplierCountry) {
    if (/\b(United Kingdom|England|Scotland|Wales)\b/i.test(text)) supplierCountry = 'GB';
    else if (/\b(Deutschland|Germany)\b/i.test(text)) supplierCountry = 'DE';
    else if (/\b(Nederland|Netherlands|Pays-Bas)\b/i.test(text)) supplierCountry = 'NL';
    else if (/\b(France|République Française)\b/i.test(text)) supplierCountry = 'FR';
    else if (/\b(Ireland|Éire)\b/i.test(text)) supplierCountry = 'IE';
    else if (/\b(China|中国|P\.?R\.?\s*C)\b/i.test(text)) supplierCountry = 'CN';
    else if (/\b(India)\b/i.test(text)) supplierCountry = 'IN';
  }
  const isBelgianSupplier = supplierCountry === 'BE' || supplierCountry === '';
  // If no country detected and we found Belgian-specific keywords, assume Belgian
  if (!supplierCountry && /\b(btw|belgisch|belgi[eë]|bruxelles|brussel|antwerp|gent|liège)\b/i.test(text)) {
    supplierCountry = 'BE';
  }

  // ─── VAT/BTW AMOUNT ──────────────────────────────────────────────────
  let vatAmount = 0;
  const vatPatterns = [
    // "BTW 21,00%: EUR 300,56" or "BTW: EUR 300,56" or "BTW 21%: 300,56"
    new RegExp(`(?:btw|tva)\\s*(?:\\d+[.,]?\\d*\\s*%)?\\s*[:.]*\\s*(?:€|EUR)?\\s*${eurNum}`, 'i'),
    // "VAT Amount: 300.56" or "Tax amount: EUR 300,56"
    new RegExp(`(?:vat|tax|mwst)\\s*(?:amount|bedrag)?\\s*[:.]*\\s*(?:€|EUR)?\\s*${eurNum}`, 'i'),
    // "Vat Amount In GBP0.00" (Chemoxy-style)
    new RegExp(`(?:vat|btw|tva)\\s*(?:amount)?\\s*(?:in)?\\s*(?:€|EUR|GBP|USD)?\\s*${eurNum}`, 'i'),
  ];
  for (const pat of vatPatterns) {
    // Search reversed text to prefer the last (bottom-of-document) match
    const m = reversedText.match(pat);
    if (m) {
      const parsed = parseEuropeanNumber(m[1]);
      if (!looksLikeDateNumber(m[1], parsed)) {
        vatAmount = parsed;
        break;
      }
    }
  }

  // VAT sanity checks based on supplier country
  if (!isBelgianSupplier && vatAmount > 0) {
    // Non-Belgian suppliers typically don't charge VAT to a Belgian company
    // (intra-community supply / reverse charge). The parsed VAT is likely noise.
    console.log(`[pdf-parse] Non-Belgian supplier (${supplierCountry}) "${supplierName}" — zeroing parsed VAT ${vatAmount} (reverse charge expected)`);
    vatAmount = 0;
  }

  // For Belgian suppliers: if no VAT was parsed but amount > 0,
  // check if the "total incl. VAT" was used as amount (common for Belgian invoices)
  // Belgian standard VAT is 21%. If amount / 1.21 gives a clean-ish number, flag it.
  // We don't auto-correct — just log for awareness.
  if (isBelgianSupplier && vatAmount === 0 && amount > 0 && !matchedInclVat) {
    const possibleExcl = amount / 1.21;
    const possibleVat = amount - possibleExcl;
    // Check if "21%" appears in the text — strong indicator that VAT should be present
    if (/\b21\s*%/.test(text) || /\b21,00\s*%/.test(text)) {
      console.log(`[pdf-parse] Belgian supplier "${supplierName}" mentions 21% but no VAT parsed — amount=${amount}, possible VAT=${possibleVat.toFixed(2)}`);
    }
  }

  // Safety net: if we matched an "incl. VAT" pattern and have a VAT amount, subtract it
  if (matchedInclVat && vatAmount > 0 && vatAmount < amount) {
    amount = Math.round((amount - vatAmount) * 100) / 100;
  }

  console.log(`[pdf-parse] ${pdfFilename}: id="${invoiceId}" supplier="${supplierName}" country=${supplierCountry || '??'} date=${issueDate} amount=${amount} vat=${vatAmount} currency=${currency}`);

  return {
    invoiceId,
    issueDate,
    supplierName: supplierName || fileBaseName,
    amount,
    vatAmount,
    currency,
    supplierCountry,
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
        const pdfKey = (name.replace(/\.pdf$/i, '').split('/').pop() || '').trim().toLowerCase();
        if (pdfKey) pdfFiles.set(pdfKey, await entry.async('nodebuffer'));
        else pdfFiles.set(`__blank_pdf_${pdfFiles.size}`, await entry.async('nodebuffer'));
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

    // Parse all invoices — track every file's fate
    const parsed: any[] = [];
    const failedFiles: { name: string; type: string; reason: string }[] = [];

    // Process XML files (UBL/PEPPOL)
    for (const xml of xmlFiles) {
      const inv = parseUBLInvoice(xml.content);
      if (!inv) {
        failedFiles.push({ name: xml.name, type: 'xml', reason: 'Failed to parse XML structure (not valid UBL/PEPPOL)' });
        console.warn(`[upload-zip] XML parse failed — skipped: ${xml.name}`);
        continue;
      }
      const xmlBaseName = (xml.name.replace(/\.xml$/i, '').split('/').pop() || '').trim();
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
      const xmlBaseName = (xml.name.replace(/\.xml$/i, '').split('/').pop() || '').trim().toLowerCase();
      if (pdfFiles.has(xmlBaseName)) pairedPdfNames.add(xmlBaseName);
    }

    // Parse standalone PDFs (not paired with XML)
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (!name.toLowerCase().endsWith('.pdf')) continue;
      const pdfBaseName = (name.replace(/\.pdf$/i, '').split('/').pop() || '').trim().toLowerCase();
      if (pairedPdfNames.has(pdfBaseName)) continue; // already paired with XML
      try {
        const pdfBuffer = await entry.async('nodebuffer');
        const inv = await parsePDFInvoice(pdfBuffer, name);
        if (!inv) {
          failedFiles.push({ name, type: 'pdf', reason: 'PDF parser returned no data' });
          continue;
        }
        parsed.push({
          ...inv,
          xmlFilename: null,
          embeddedPdf: pdfBuffer.toString('base64'),
          pdfFilename: name,
        });
      } catch (err: any) {
        failedFiles.push({ name, type: 'pdf', reason: err?.message || 'Exception during PDF parsing' });
        console.error(`[upload-zip] Failed to parse PDF ${name}:`, err);
      }
    }

    if (failedFiles.length > 0) {
      console.warn(`[upload-zip] ${failedFiles.length} file(s) failed to parse:`, failedFiles.map(f => f.name));
    }

    if (parsed.length === 0) {
      const extensions = [...new Set(allFileNames.map(f => f.split('.').pop()?.toLowerCase() || 'unknown'))];
      res.status(400).json({ error: `No valid invoices found in the ZIP. Found ${allFileNames.length} file(s) with extensions: ${extensions.join(', ')}.` });
      return;
    }

    // --- Deduplicate within the ZIP itself ---
    // ONLY exact invoice ID matches are auto-deduped (XML+PDF pair for same invoice).
    // Combo matches (same supplier+amount+date but different IDs) are kept but flagged —
    // they could be legitimate separate invoices from the same supplier on the same day.
    const seenIds = new Set<string>();
    const seenCombos = new Map<string, string>(); // combo-key → first invoiceId
    const deduped: typeof parsed = [];
    let inZipDuplicateCount = 0;
    const comboDuplicateWarnings: { invoiceId: string; supplier: string; matchedId: string }[] = [];
    for (const inv of parsed) {
      // Exact invoice ID dedup — safe to auto-remove (e.g. XML and standalone PDF for same invoice)
      if (inv.invoiceId && seenIds.has(inv.invoiceId)) {
        console.log(`[upload-zip] Dedup skipping (exact ID): "${inv.supplierName}" ${inv.invoiceId}`);
        inZipDuplicateCount++;
        continue;
      }
      if (inv.invoiceId) seenIds.add(inv.invoiceId);

      // Combo match — keep the invoice but flag it as potential duplicate
      if (inv.amount > 0) {
        const comboKey = `${inv.supplierName.toLowerCase()}|${inv.amount}|${inv.issueDate}`;
        if (seenCombos.has(comboKey)) {
          comboDuplicateWarnings.push({
            invoiceId: inv.invoiceId,
            supplier: inv.supplierName,
            matchedId: seenCombos.get(comboKey)!,
          });
          inv.duplicateWarning = true;
        } else {
          seenCombos.set(comboKey, inv.invoiceId);
        }
      }

      deduped.push(inv);
    }
    if (inZipDuplicateCount > 0) {
      console.log(`[upload-zip] Removed ${inZipDuplicateCount} exact ID duplicate(s) within the ZIP`);
    }
    if (comboDuplicateWarnings.length > 0) {
      console.log(`[upload-zip] ${comboDuplicateWarnings.length} potential combo duplicate(s) kept but flagged`);
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
        // Apply display name if the mapping has one (renamed supplier)
        supplierName: match?.displayName || inv.supplierName,
        domain: match?.domain || null,
        category: match?.category || null,
        isAcerta: isAcerta(inv.supplierName),
      };
    });

    // Find unknown suppliers (no domain match), excluding own-company names
    // Include embeddedPdf + lineItems so client can show a preview
    const unknownSuppliers = classified
      .filter(inv => !inv.domain && !isOwnCompany(inv.supplierName))
      .map(inv => ({
        supplier: inv.supplierName,
        amount: inv.amount,
        vatAmount: inv.vatAmount || 0,
        date: inv.issueDate,
        invoiceId: inv.invoiceId,
        currency: inv.currency,
        lineItems: inv.lineItems,
        embeddedPdf: inv.embeddedPdf || null,
      }));
    // Show ALL unknown invoices (not just unique-per-supplier) so user reviews each one
    const uniqueUnknowns = [...new Map(unknownSuppliers.map(u => [u.invoiceId, u])).values()];

    // --- Duplicate detection against existing DB invoices ---
    // An invoice is a duplicate if: same invoice_id, OR same supplier+amount+date
    // Supplier matching must account for renamed suppliers (display_name ↔ original pattern)
    const existingInvoices = db.prepare('SELECT invoice_id, supplier, amount, issue_date, domain FROM demo_invoices').all() as any[];
    const existingIdSet = new Set(existingInvoices.map((e: any) => e.invoice_id));

    // Build combo set with BOTH stored name AND any known original patterns from supplier mappings
    const supplierMappings = db.prepare('SELECT supplier_pattern, display_name FROM demo_supplier_mappings').all() as any[];
    const nameToAliases = new Map<string, string[]>(); // lowercase name → [aliases]
    for (const m of supplierMappings) {
      const names: string[] = [m.supplier_pattern.toLowerCase()];
      if (m.display_name) names.push(m.display_name.toLowerCase());
      for (const n of names) {
        const existing = nameToAliases.get(n) || [];
        for (const other of names) { if (!existing.includes(other)) existing.push(other); }
        nameToAliases.set(n, existing);
      }
    }

    const existingComboSet = new Set<string>();
    for (const e of existingInvoices) {
      if (e.amount === 0) continue; // skip zero-amount from combo dedup — too many false matches
      const baseName = e.supplier.toLowerCase();
      const combo = `${baseName}|${e.amount}|${e.issue_date}`;
      existingComboSet.add(combo);
      // Also add combos for known aliases of this supplier
      const aliases = nameToAliases.get(baseName) || [];
      for (const alias of aliases) {
        existingComboSet.add(`${alias}|${e.amount}|${e.issue_date}`);
      }
    }

    const duplicates: any[] = [];
    const duplicateInvoiceIds = new Set<string>();
    for (const inv of classified) {
      const idMatch = inv.invoiceId && existingIdSet.has(inv.invoiceId);
      // Skip combo match for zero-amount invoices to avoid false positives
      const comboMatch = inv.amount > 0 && existingComboSet.has(`${inv.supplierName.toLowerCase()}|${inv.amount}|${inv.issueDate}`);
      if (idMatch || comboMatch) {
        duplicateInvoiceIds.add(inv.invoiceId);
        const invNameLower = inv.supplierName.toLowerCase();
        const invAliases = new Set([invNameLower, ...(nameToAliases.get(invNameLower) || [])]);
        const existing = existingInvoices.find((e: any) =>
          e.invoice_id === inv.invoiceId ||
          (invAliases.has(e.supplier.toLowerCase()) && Math.abs(e.amount - inv.amount) < 0.01 && e.issue_date === inv.issueDate)
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

    // Detect category conflicts: supplier already exists in DB with a different category
    const existingSupplierCategories = db.prepare(
      'SELECT supplier, category, domain, COUNT(*) as cnt FROM demo_invoices GROUP BY supplier, category, domain'
    ).all() as { supplier: string; category: string; domain: string; cnt: number }[];
    const supplierCatMap = new Map<string, { category: string; domain: string; cnt: number }[]>();
    for (const row of existingSupplierCategories) {
      const key = row.supplier.toLowerCase();
      if (!supplierCatMap.has(key)) supplierCatMap.set(key, []);
      supplierCatMap.get(key)!.push(row);
    }
    const categoryConflicts: { supplier: string; newCategory: string; newDomain: string; existingCategories: { category: string; domain: string; count: number }[] }[] = [];
    for (const inv of classified) {
      if (!inv.category || !inv.domain) continue;
      const existing = supplierCatMap.get(inv.supplierName.toLowerCase());
      if (!existing) continue;
      const hasConflict = existing.some(e => e.category !== inv.category || e.domain !== inv.domain);
      if (hasConflict && !categoryConflicts.some(c => c.supplier.toLowerCase() === inv.supplierName.toLowerCase())) {
        categoryConflicts.push({
          supplier: inv.supplierName,
          newCategory: inv.category,
          newDomain: inv.domain,
          existingCategories: existing.map(e => ({ category: e.category, domain: e.domain, count: e.cnt })),
        });
      }
    }

    // Separate own-company invoices so we can report them to the user
    const ownCompanyInvoices = classified.filter(inv => isOwnCompany(inv.supplierName));

    // Exclude duplicates — silently skip them (user doesn't want to review duplicates)
    const newInvoices = classified.filter(inv => !duplicateInvoiceIds.has(inv.invoiceId));

    // Flag invoices that need user attention (amount=0, fallback date, unknown supplier, own-company, bad dates)
    const today = new Date().toISOString().substring(0, 10);
    const currentYear = new Date().getFullYear();
    const warnings: { invoiceId: string; supplier: string; issues: string[] }[] = [];
    for (const inv of newInvoices) {
      const issues: string[] = [];
      if (isOwnCompany(inv.supplierName)) issues.push('own_company');
      if (inv.amount === 0) issues.push('amount_zero');
      if (!inv.issueDate || inv.issueDate === today) issues.push('date_uncertain');
      // Date sanity checks
      if (inv.issueDate && inv.issueDate !== today) {
        const invoiceDate = new Date(inv.issueDate);
        const invoiceYear = invoiceDate.getFullYear();
        if (inv.issueDate > today) issues.push('date_future');
        if (invoiceYear < 2020 || invoiceYear > currentYear + 1) issues.push('date_illogical');
      }
      const pdfBase = typeof inv.pdfFilename === 'string' ? inv.pdfFilename.replace(/\.pdf$/i, '').split('/').pop() : null;
      if (inv.supplierName === 'Unknown' || inv.supplierName === pdfBase) {
        issues.push('supplier_uncertain');
      }
      if (issues.length > 0) {
        warnings.push({ invoiceId: inv.invoiceId, supplier: inv.supplierName, issues });
      }
    }

    // Reconciliation counts
    const xmlOnlyCount = parsed.filter(inv => inv.xmlFilename && !inv.embeddedPdf).length;
    const pdfOnlyCount = parsed.filter(inv => !inv.xmlFilename && inv.embeddedPdf).length;
    const pairedCount = parsed.filter(inv => inv.xmlFilename && inv.embeddedPdf).length;
    const existingDbCount = (db.prepare('SELECT COUNT(*) as cnt FROM demo_invoices').get() as any).cnt;

    console.log(`[upload-zip] Summary: ${allFileNames.length} files (${xmlFiles.length} XML + ${pdfFiles.size} PDF, ${failedFiles.length} failed) → ${parsed.length} parsed (${pairedCount} paired, ${xmlOnlyCount} XML-only, ${pdfOnlyCount} PDF-only) → ${deduped.length} after in-ZIP dedup → ${newInvoices.length} new (${duplicates.length} DB duplicates skipped, ${inZipDuplicateCount} in-ZIP duplicates, ${ownCompanyInvoices.length} own-company, ${warnings.length} with warnings). DB has ${existingDbCount} invoices.`);

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
      unknownSuppliers: uniqueUnknowns,
      duplicates,
      duplicatesSkipped: duplicates.length,
      inZipDuplicatesRemoved: inZipDuplicateCount,
      totalParsed: parsed.length,
      existingDemoBatch: existingDemoBatch ? { id: existingDemoBatch.id, filename: existingDemoBatch.filename } : null,
      existingSalesBatch: existingSalesBatch ? { id: existingSalesBatch.id, filename: existingSalesBatch.filename } : null,
      filename,
      ownCompanyExcluded: ownCompanyInvoices.map(inv => ({
        invoiceId: inv.invoiceId,
        supplier: inv.supplierName,
        amount: inv.amount,
        date: inv.issueDate,
      })),
      categoryConflicts,
      warnings,
      // Reconciliation data
      reconciliation: {
        totalFilesInZip: allFileNames.length,
        xmlFiles: xmlFiles.length,
        pdfFiles: pdfFiles.size,
        totalParsed: parsed.length,
        pairedXmlPdf: pairedCount,
        xmlOnly: xmlOnlyCount,
        pdfOnly: pdfOnlyCount,
        inZipDuplicatesRemoved: inZipDuplicateCount,
        dbDuplicatesSkipped: duplicates.length,
        ownCompanyExcluded: ownCompanyInvoices.length,
        warningsCount: warnings.length,
        failedToParse: failedFiles.length,
        failedFiles: failedFiles,
        readyToImport: newInvoices.length,
        existingDbTotal: existingDbCount,
      },
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
      nameOverrides,       // { originalName: correctedName } — renamed suppliers
      rememberSuppliers,   // string[] of supplier names to persist
      skipInvoiceIds,
      replaceDemoMonth,
      replaceSalesMonth,
      note,
    } = req.body;

    if (!invoices || !month || !filename) {
      res.status(400).json({ error: 'invoices, month, and filename required' });
      return;
    }

    const userId = (req as any).user?.userId;
    const userRow = userId ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as any : null;
    const uploadedByName = userRow?.display_name || 'Unknown';
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

      // Save remembered supplier mappings (with optional display_name for renamed suppliers)
      if (rememberSuppliers && categoryOverrides) {
        const upsert = db.prepare(
          'INSERT OR REPLACE INTO demo_supplier_mappings (supplier_pattern, domain, category, display_name) VALUES (?, ?, ?, ?)'
        );
        for (const supplier of rememberSuppliers) {
          const override = categoryOverrides[supplier];
          if (override) {
            // Store the original extracted name as pattern, corrected name as display_name
            const correctedName = nameOverrides?.[supplier] || '';
            upsert.run(supplier.toLowerCase(), override.domain || 'demo', override.category, correctedName);
          }
        }
      }

      // Split invoices by domain and create separate batches
      const filtered = invoices.filter((inv: any) => !skipSet.has(inv.invoiceId));

      // Server-side duplicate guard: remove any invoice already in the DB
      // Must check with BOTH original parsed name AND corrected name (nameOverrides)
      const existingIds = new Set(
        (db.prepare('SELECT invoice_id FROM demo_invoices').all() as any[]).map((r: any) => r.invoice_id)
      );
      const existingDbInvoices = db.prepare('SELECT supplier, amount, issue_date FROM demo_invoices').all() as any[];
      const existingCombos = new Set<string>();
      // Build alias map from supplier mappings for cross-name matching
      const mappings = db.prepare('SELECT supplier_pattern, display_name FROM demo_supplier_mappings').all() as any[];
      const aliasMap = new Map<string, string[]>();
      for (const m of mappings) {
        const names: string[] = [m.supplier_pattern.toLowerCase()];
        if (m.display_name) names.push(m.display_name.toLowerCase());
        for (const n of names) {
          const ex = aliasMap.get(n) || [];
          for (const o of names) { if (!ex.includes(o)) ex.push(o); }
          aliasMap.set(n, ex);
        }
      }
      for (const r of existingDbInvoices) {
        if (r.amount === 0) continue; // skip zero-amount from combo dedup
        const baseName = r.supplier.toLowerCase();
        existingCombos.add(`${baseName}|${r.amount}|${r.issue_date}`);
        for (const alias of (aliasMap.get(baseName) || [])) {
          existingCombos.add(`${alias}|${r.amount}|${r.issue_date}`);
        }
      }
      const nonDuplicate: any[] = [];
      const skippedDetails: { invoiceId: string; supplier: string; reason: string }[] = [];
      for (const inv of filtered) {
        if (inv.invoiceId && existingIds.has(inv.invoiceId)) {
          skippedDetails.push({ invoiceId: inv.invoiceId, supplier: inv.supplier, reason: 'duplicate_id' });
          continue;
        }
        if (inv.amount === 0) { nonDuplicate.push(inv); continue; }
        const originalName = (inv.supplier || '').toLowerCase();
        const correctedName = (nameOverrides?.[inv.supplier] || '').toLowerCase();
        if (existingCombos.has(`${originalName}|${inv.amount}|${inv.issueDate}`)) {
          skippedDetails.push({ invoiceId: inv.invoiceId, supplier: inv.supplier, reason: 'duplicate_combo' });
          continue;
        }
        if (correctedName && existingCombos.has(`${correctedName}|${inv.amount}|${inv.issueDate}`)) {
          skippedDetails.push({ invoiceId: inv.invoiceId, supplier: inv.supplier, reason: 'duplicate_combo' });
          continue;
        }
        nonDuplicate.push(inv);
      }

      if (nonDuplicate.length === 0) {
        return { skippedAll: true, message: 'All invoices already exist in the system', skippedDetails };
      }

      // Resolve final domain + category + supplier name for each invoice
      const resolved = nonDuplicate.map((inv: any) => {
        let domain = inv.domain || 'demo';
        let category = inv.category || 'Other';
        let supplier = inv.supplier;

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

        // Apply supplier name correction
        if (nameOverrides && nameOverrides[inv.supplier]) {
          supplier = nameOverrides[inv.supplier];
        }

        return { ...inv, domain, category, supplier };
      });

      // Group by domain
      const byDomain: Record<string, any[]> = {};
      for (const inv of resolved) {
        if (!byDomain[inv.domain]) byDomain[inv.domain] = [];
        byDomain[inv.domain].push(inv);
      }

      const results: any[] = [];
      const insertInv = db.prepare(`
        INSERT INTO demo_invoices (batch_id, invoice_id, issue_date, supplier, category, domain, amount, vat_amount, currency, month, line_items, embedded_pdf, pdf_filename, xml_filename, duplicate_warning, flagged)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [domain, domainInvoices] of Object.entries(byDomain)) {
        const totalAmount = domainInvoices.reduce((s: number, inv: any) => s + (inv.amount || 0), 0);

        const batchResult = db.prepare(
          'INSERT INTO demo_upload_batches (filename, month, domain, invoice_count, total_amount, uploaded_by, note, uploaded_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(filename, month, domain, domainInvoices.length, totalAmount, userId, note || '', uploadedByName);
        const batchId = batchResult.lastInsertRowid;

        for (const inv of domainInvoices) {
          const isDuplicateIncluded = skipInvoiceIds && !skipSet.has(inv.invoiceId) && (req.body.duplicateInvoiceIds || []).includes(inv.invoiceId);
          // Derive month from the invoice's own issue_date, falling back to batch month
          const invMonth = inv.issueDate ? inv.issueDate.substring(0, 7) : month;
          insertInv.run(
            batchId, inv.invoiceId, inv.issueDate, inv.supplier, inv.category, domain,
            inv.amount, inv.vatAmount || 0, inv.currency || 'EUR', invMonth,
            inv.lineItems || '[]', inv.embeddedPdf || null, inv.pdfFilename || null,
            inv.xmlFilename || null, isDuplicateIncluded ? 1 : 0, inv.flagged ? 1 : 0,
          );
        }

        results.push({ domain, count: domainInvoices.length, totalAmount });
      }

      return { results, submitted: invoices.length, skippedByUser: skipSet.size, skippedAsDuplicate: filtered.length - nonDuplicate.length, skippedDetails };
    });

    const txResult = doImport();
    if (txResult && (txResult as any).skippedAll) {
      res.json({ success: true, results: [], message: (txResult as any).message, skippedDetails: (txResult as any).skippedDetails });
      return;
    }
    db.saveToDisk();
    const { results: importResults, submitted, skippedByUser, skippedAsDuplicate } = txResult as any;
    const totalImported = (importResults as any[]).reduce((s: number, r: any) => s + r.count, 0);
    notifyAdmin({
      entity: 'Invoice Batch',
      action: 'created',
      label: `${totalImported} invoices (${filename})`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    // Return reconciliation with current DB totals
    const dbTotal = (db.prepare('SELECT COUNT(*) as cnt FROM demo_invoices').get() as any).cnt;
    const demoTotal = (db.prepare("SELECT COUNT(*) as cnt FROM demo_invoices WHERE domain = 'demo'").get() as any).cnt;
    const salesTotal = (db.prepare("SELECT COUNT(*) as cnt FROM demo_invoices WHERE domain = 'sales'").get() as any).cnt;
    const { skippedDetails: txSkipped } = txResult as any;
    res.json({
      success: true,
      results: importResults,
      skippedDetails: txSkipped || [],
      reconciliation: {
        submitted,
        skippedByUser,
        skippedAsDuplicate,
        imported: totalImported,
        dbTotalAfterImport: dbTotal,
        dbDemoCount: demoTotal,
        dbSalesCount: salesTotal,
      },
    });
  } catch (err: any) {
    console.error('[expense-upload] confirm-import error:', err);
    res.status(500).json({ error: 'Failed to import invoices: ' + (err.message || String(err)) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN-FILTERED QUERY ENDPOINTS
// All accept ?domain=demo|sales to filter
// ═══════════════════════════════════════════════════════════════════════════════

// Reconciliation endpoint — verify total invoice counts after bulk uploads
// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/categories', (_req: Request, res: Response) => {
  try {
    const custom = db.prepare('SELECT id, name, domain FROM demo_custom_categories ORDER BY domain, name').all();
    res.json({ custom });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', (req: Request, res: Response) => {
  try {
    const { name, domain } = req.body;
    if (!name || !domain) { res.status(400).json({ error: 'name and domain required' }); return; }
    if (!['demo', 'sales'].includes(domain)) { res.status(400).json({ error: 'domain must be demo or sales' }); return; }
    const trimmed = name.trim();
    if (!trimmed) { res.status(400).json({ error: 'Category name cannot be empty' }); return; }
    db.prepare('INSERT OR IGNORE INTO demo_custom_categories (name, domain) VALUES (?, ?)').run(trimmed, domain);
    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM demo_custom_categories WHERE id = ?').run(req.params.id);
    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reconciliation', (_req: Request, res: Response) => {
  try {
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM demo_invoices').get() as any).cnt;
    const demoCount = (db.prepare("SELECT COUNT(*) as cnt FROM demo_invoices WHERE domain = 'demo'").get() as any).cnt;
    const salesCount = (db.prepare("SELECT COUNT(*) as cnt FROM demo_invoices WHERE domain = 'sales'").get() as any).cnt;
    const batchCount = (db.prepare('SELECT COUNT(*) as cnt FROM demo_upload_batches').get() as any).cnt;
    const bySupplier = db.prepare('SELECT supplier, COUNT(*) as cnt, SUM(amount) as total FROM demo_invoices GROUP BY supplier ORDER BY cnt DESC').all();
    const byMonth = db.prepare('SELECT month, domain, COUNT(*) as cnt, SUM(amount) as total FROM demo_invoices GROUP BY month, domain ORDER BY month').all();
    const duplicateWarnings = (db.prepare('SELECT COUNT(*) as cnt FROM demo_invoices WHERE duplicate_warning = 1').get() as any).cnt;
    const zeroAmount = (db.prepare('SELECT COUNT(*) as cnt FROM demo_invoices WHERE amount = 0').get() as any).cnt;
    const noDate = (db.prepare("SELECT COUNT(*) as cnt FROM demo_invoices WHERE issue_date IS NULL OR issue_date = ''").get() as any).cnt;
    const uniqueSuppliers = (db.prepare('SELECT COUNT(DISTINCT supplier) as cnt FROM demo_invoices').get() as any).cnt;
    res.json({
      total, demoCount, salesCount, batchCount,
      uniqueSuppliers, duplicateWarnings, zeroAmount, noDate,
      bySupplier, byMonth,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/data-quality', (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().substring(0, 10);
    const currentYear = new Date().getFullYear();
    const invoices = db.prepare('SELECT id, invoice_id, issue_date, supplier, amount, created_at FROM demo_invoices').all() as any[];
    const issues: { id: number; invoice_id: string; supplier: string; issue: string; detail: string }[] = [];
    for (const inv of invoices) {
      if (inv.issue_date) {
        const d = new Date(inv.issue_date);
        const y = d.getFullYear();
        if (inv.issue_date > today) {
          issues.push({ id: inv.id, invoice_id: inv.invoice_id, supplier: inv.supplier, issue: 'date_future', detail: `Invoice date ${inv.issue_date} is in the future` });
        }
        if (y < 2020 || y > currentYear + 1) {
          issues.push({ id: inv.id, invoice_id: inv.invoice_id, supplier: inv.supplier, issue: 'date_illogical', detail: `Invoice date ${inv.issue_date} has illogical year ${y}` });
        }
        // Invoice date after upload date (created_at)
        if (inv.created_at) {
          const uploadDate = inv.created_at.substring(0, 10);
          if (inv.issue_date > uploadDate) {
            issues.push({ id: inv.id, invoice_id: inv.invoice_id, supplier: inv.supplier, issue: 'date_after_upload', detail: `Invoice date ${inv.issue_date} is after upload date ${uploadDate}` });
          }
        }
      }
      if (inv.amount === 0) {
        issues.push({ id: inv.id, invoice_id: inv.invoice_id, supplier: inv.supplier, issue: 'amount_zero', detail: 'Amount is 0' });
      }
      if (!inv.issue_date) {
        issues.push({ id: inv.id, invoice_id: inv.invoice_id, supplier: inv.supplier, issue: 'date_missing', detail: 'No issue date' });
      }
    }
    res.json({ total_invoices: invoices.length, issues_found: issues.length, issues });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices', (req: Request, res: Response) => {
  try {
    const { domain, categories, suppliers, month, date_from, date_to, sort_by, sort_dir, search, flagged } = req.query;
    let sql = 'SELECT id, invoice_id, issue_date, supplier, category, domain, amount, vat_amount, currency, month, xml_filename, duplicate_warning, flagged, created_at FROM demo_invoices WHERE 1=1';
    const params: any[] = [];

    if (search) {
      sql += ' AND (invoice_id LIKE ? OR supplier LIKE ? OR category LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (domain) { sql += ' AND domain = ?'; params.push(domain); }
    if (categories) {
      const cats = (categories as string).split(',');
      sql += ` AND category IN (${cats.map(() => '?').join(',')})`;
      params.push(...cats);
    }
    if (suppliers) {
      const supps = (suppliers as string).split(',');
      sql += ` AND (${supps.map(() => 'LOWER(supplier) = LOWER(?)').join(' OR ')})`;
      params.push(...supps);
    }
    if (month) { sql += ' AND month = ?'; params.push(month); }
    if (date_from) { sql += ' AND issue_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND issue_date <= ?'; params.push(date_to); }
    if (flagged === '1') { sql += ' AND flagged = 1'; }

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
      where += ` AND (${supps.map(() => 'LOWER(supplier) = LOWER(?)').join(' OR ')})`;
      params.push(...supps);
    }
    if (month) { where += ' AND month = ?'; params.push(month); }
    if (date_from) { where += ' AND issue_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND issue_date <= ?'; params.push(date_to); }

    const byCategory = db.prepare(`SELECT category, SUM(amount) as total, SUM(vat_amount) as vat_total FROM demo_invoices WHERE ${where} GROUP BY category ORDER BY total DESC`).all(...params);
    const bySupplier = db.prepare(`SELECT supplier, SUM(amount) as total, SUM(vat_amount) as vat_total FROM demo_invoices WHERE ${where} GROUP BY supplier ORDER BY total DESC`).all(...params);
    const monthlyByCategory = db.prepare(`SELECT month, category, SUM(amount) as total, SUM(vat_amount) as vat_total FROM demo_invoices WHERE ${where} GROUP BY month, category ORDER BY month ASC`).all(...params);
    const months = db.prepare(`SELECT DISTINCT month FROM demo_invoices WHERE ${domain ? 'domain = ?' : '1=1'} ORDER BY month ASC`).all(...(domain ? [domain] : []));
    const allSuppliers = db.prepare(`SELECT DISTINCT supplier FROM demo_invoices WHERE ${domain ? 'domain = ?' : '1=1'} ORDER BY supplier ASC`).all(...(domain ? [domain] : []));
    const allCategories = db.prepare(`SELECT DISTINCT category FROM demo_invoices WHERE ${domain ? 'domain = ?' : '1=1'} ORDER BY category ASC`).all(...(domain ? [domain] : []));
    const avgByCategory = db.prepare(
      `SELECT category, AVG(monthly_total) as avg_total FROM (
        SELECT month, category, SUM(amount) as monthly_total FROM demo_invoices WHERE ${where} GROUP BY month, category
      ) GROUP BY category ORDER BY avg_total DESC`
    ).all(...params);
    const totals = db.prepare(`SELECT SUM(amount) as total_amount, SUM(vat_amount) as total_vat, COUNT(*) as invoice_count FROM demo_invoices WHERE ${where}`).get(...params) as any;
    // Monthly breakdown by domain (for amount and VAT tables)
    const monthlyByDomain = db.prepare(
      `SELECT month, domain, SUM(amount) as total, SUM(vat_amount) as vat_total, COUNT(*) as cnt FROM demo_invoices WHERE ${where} GROUP BY month, domain ORDER BY month ASC`
    ).all(...params);

    res.json({
      by_category: byCategory,
      by_supplier: bySupplier,
      monthly_by_category: monthlyByCategory,
      monthly_by_domain: monthlyByDomain,
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
    const batch = db.prepare('SELECT filename, month FROM demo_upload_batches WHERE id = ?').get(req.params.id) as any;
    if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
    db.prepare('DELETE FROM demo_invoices WHERE batch_id = ?').run(req.params.id);
    db.prepare('DELETE FROM demo_upload_batches WHERE id = ?').run(req.params.id);
    db.saveToDisk();
    notifyAdmin({
      entity: 'Invoice Batch',
      action: 'deleted',
      label: batch ? `${batch.filename} (${batch.month})` : `Batch #${req.params.id}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete batch' });
  }
});

router.delete('/invoices/:id', (req: Request, res: Response) => {
  try {
    const inv = db.prepare('SELECT id, batch_id, invoice_id, supplier, amount FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    db.prepare('DELETE FROM demo_invoices WHERE id = ?').run(req.params.id);

    // Check if the parent batch has remaining invoices
    const remaining = db.prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total FROM demo_invoices WHERE batch_id = ?').get(inv.batch_id) as any;
    let batchDeleted = false;

    if (remaining.cnt === 0) {
      db.prepare('DELETE FROM demo_upload_batches WHERE id = ?').run(inv.batch_id);
      batchDeleted = true;
    } else {
      db.prepare('UPDATE demo_upload_batches SET invoice_count = ?, total_amount = ? WHERE id = ?')
        .run(remaining.cnt, remaining.total, inv.batch_id);
    }

    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'deleted',
      label: `${inv.invoice_id} — ${inv.supplier}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true, batchDeleted });
  } catch (err: any) {
    console.error('[demo-expenses] delete invoice error:', err);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

router.patch('/invoices/:id/category', (req: Request, res: Response) => {
  try {
    const { category, domain, applyToAll } = req.body;
    if (!category) { res.status(400).json({ error: 'Category required' }); return; }

    const inv = db.prepare('SELECT supplier, domain FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    if (false && isAcerta(inv.supplier)) { // Acerta lock removed — allow editing all invoices
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
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'updated',
      label: `${inv.supplier} — category → ${category}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
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
    const classification = classifySupplier(parsed.supplierName || '');
    if (classification) {
      parsed.domain = classification.domain;
      parsed.category = classification.category;
    } else {
      parsed.domain = 'demo';
      parsed.category = 'Other';
    }

    // Derive month
    if (parsed.issueDate) {
      const d = new Date(parsed.issueDate);
      if (!isNaN(d.getTime())) {
        parsed.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
    }

    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'created',
      label: `${parsed.supplierName || 'Unknown'} — ${file.originalname}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });

    res.json({
      invoice: {
        invoiceId: parsed.invoiceId || '',
        date: parsed.issueDate || '',
        supplier: parsed.supplierName || 'Unknown',
        amount: parsed.amount || 0,
        vatAmount: parsed.vatAmount || 0,
        currency: parsed.currency || 'EUR',
        domain: parsed.domain,
        category: parsed.category,
        month: parsed.month || '',
        lineItems: parsed.lineItems || [],
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

    const userId = (req as any).user?.userId;
    const userRow = userId ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as any : null;
    const uploadedByName = userRow?.display_name || 'Unknown';

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
      'INSERT INTO demo_upload_batches (filename, month, domain, invoice_count, total_amount, uploaded_by, uploaded_by_name, uploaded_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)'
    ).run(invoice.pdfFilename || invoice.xmlFilename || 'manual-upload', invoice.month || '', invoice.domain, invoice.amount || 0, userId, uploadedByName, new Date().toISOString());
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
      typeof invoice.lineItems === 'string' ? invoice.lineItems : JSON.stringify(invoice.lineItems || []),
      invoice.embeddedPdf || null,
      invoice.pdfFilename || null,
      invoice.xmlFilename || null,
    );

    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'created',
      label: `${invoice.supplier || 'Unknown'} — ${invoice.invoiceId || 'no ID'}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true, batchId });
  } catch (err: any) {
    console.error('[demo-expenses] confirm-single error:', err);
    res.status(500).json({ error: 'Failed to save invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPLIER NAME UPDATE
// ═══════════════════════════════════════════════════════════════════════════════

router.patch('/invoices/:id/supplier', (req: Request, res: Response) => {
  try {
    const { supplier } = req.body;
    if (!supplier) { res.status(400).json({ error: 'Supplier name required' }); return; }

    const inv = db.prepare('SELECT id FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    db.prepare('UPDATE demo_invoices SET supplier = ? WHERE id = ?').run(supplier, req.params.id);
    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'updated',
      label: `Supplier renamed to "${supplier}"`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AMOUNT / CURRENCY UPDATE
// ═══════════════════════════════════════════════════════════════════════════════

router.patch('/invoices/:id/amount', (req: Request, res: Response) => {
  try {
    const { amount, currency } = req.body;
    if (amount == null && !currency) { res.status(400).json({ error: 'amount or currency required' }); return; }

    const inv = db.prepare('SELECT id, amount, currency, batch_id FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const newAmount = amount != null ? Number(amount) : inv.amount;
    if (isNaN(newAmount) || newAmount < 0) { res.status(400).json({ error: 'Invalid amount' }); return; }
    const newCurrency = currency || inv.currency;
    db.prepare('UPDATE demo_invoices SET amount = ?, currency = ? WHERE id = ?').run(newAmount, newCurrency, req.params.id);

    // Update batch total
    if (inv.batch_id) {
      const totals = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM demo_invoices WHERE batch_id = ?').get(inv.batch_id) as any;
      db.prepare('UPDATE demo_upload_batches SET total_amount = ? WHERE id = ?').run(totals.total, inv.batch_id);
    }

    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'updated',
      label: `Amount updated to ${newCurrency} ${newAmount}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update amount' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATE UPDATE
// ═══════════════════════════════════════════════════════════════════════════════

router.patch('/invoices/:id/date', (req: Request, res: Response) => {
  try {
    const { issue_date } = req.body;
    if (!issue_date) { res.status(400).json({ error: 'issue_date required' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}/.test(issue_date)) { res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' }); return; }

    // Validate date sanity
    const dateObj = new Date(issue_date);
    const year = dateObj.getFullYear();
    const today = new Date().toISOString().substring(0, 10);
    const dateWarnings: string[] = [];
    if (year < 2020 || year > new Date().getFullYear() + 1) dateWarnings.push(`Year ${year} looks illogical`);
    if (issue_date > today) dateWarnings.push('Date is in the future');

    const inv = db.prepare('SELECT id FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    // Derive month (YYYY-MM) from the new date
    const month = issue_date.substring(0, 7); // e.g. "2026-03-15" → "2026-03"
    db.prepare('UPDATE demo_invoices SET issue_date = ?, month = ? WHERE id = ?').run(issue_date, month, req.params.id);
    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'updated',
      label: `Date updated to ${issue_date}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true, warnings: dateWarnings.length > 0 ? dateWarnings : undefined });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update date' });
  }
});

router.patch('/invoices/:id/flag', (req: Request, res: Response) => {
  try {
    const { flagged } = req.body;
    const inv = db.prepare('SELECT id FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
    db.prepare('UPDATE demo_invoices SET flagged = ? WHERE id = ?').run(flagged ? 1 : 0, req.params.id);
    db.saveToDisk();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update flag' });
  }
});

router.patch('/invoices/:id/vat', (req: Request, res: Response) => {
  try {
    const { vat_amount } = req.body;
    if (vat_amount == null) { res.status(400).json({ error: 'vat_amount required' }); return; }
    const inv = db.prepare('SELECT id, invoice_id, supplier FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
    const newVat = Number(vat_amount);
    if (isNaN(newVat) || newVat < 0) { res.status(400).json({ error: 'Invalid vat_amount' }); return; }
    db.prepare('UPDATE demo_invoices SET vat_amount = ? WHERE id = ?').run(newVat, req.params.id);
    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'updated',
      label: `VAT updated to ${newVat} for ${inv.invoice_id} (${inv.supplier})`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update VAT' });
  }
});

router.patch('/invoices/:id/domain', (req: Request, res: Response) => {
  try {
    const { domain } = req.body;
    if (!domain || !['demo', 'sales'].includes(domain)) {
      res.status(400).json({ error: 'domain must be "demo" or "sales"' });
      return;
    }

    const inv = db.prepare('SELECT id, supplier FROM demo_invoices WHERE id = ?').get(req.params.id) as any;
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    db.prepare('UPDATE demo_invoices SET domain = ? WHERE id = ?').run(domain, req.params.id);
    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Invoice',
      action: 'updated',
      label: `${inv.supplier} — domain → ${domain}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update domain' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPLIER MANAGEMENT — add/list/delete user-defined supplier mappings
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/supplier-mappings', (req: Request, res: Response) => {
  try {
    const { domain } = req.query;
    let sql = 'SELECT id, supplier_pattern, domain, category, display_name, created_at FROM demo_supplier_mappings WHERE is_user_defined = 1';
    const params: any[] = [];
    if (domain) { sql += ' AND domain = ?'; params.push(domain); }
    sql += ' ORDER BY supplier_pattern ASC';
    res.json(db.prepare(sql).all(...params));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch supplier mappings' });
  }
});

router.post('/supplier-mappings', (req: Request, res: Response) => {
  try {
    const { supplierName, category, domain } = req.body;
    if (!supplierName || !category || !domain) {
      res.status(400).json({ error: 'supplierName, category, and domain are required' });
      return;
    }

    const existing = db.prepare('SELECT id FROM demo_supplier_mappings WHERE LOWER(supplier_pattern) = LOWER(?)').get(supplierName) as any;
    if (existing) {
      res.status(409).json({ error: `Supplier "${supplierName}" already exists` });
      return;
    }

    const result = db.prepare(
      'INSERT INTO demo_supplier_mappings (supplier_pattern, domain, category, display_name, is_user_defined) VALUES (?, ?, ?, ?, 1)'
    ).run(supplierName.toLowerCase(), domain, category, supplierName);

    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Mapping',
      action: 'created',
      label: `${supplierName} → ${category} (${domain})`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[demo-expenses] add supplier mapping error:', err);
    res.status(500).json({ error: 'Failed to add supplier' });
  }
});

router.patch('/supplier-mappings/:id', (req: Request, res: Response) => {
  try {
    const { category, domain } = req.body;
    const mapping = db.prepare('SELECT id, supplier_pattern, domain, category FROM demo_supplier_mappings WHERE id = ? AND is_user_defined = 1').get(req.params.id) as any;
    if (!mapping) { res.status(404).json({ error: 'Supplier mapping not found' }); return; }

    const updates: string[] = [];
    const params: any[] = [];
    if (category) { updates.push('category = ?'); params.push(category); }
    if (domain && ['demo', 'sales'].includes(domain)) { updates.push('domain = ?'); params.push(domain); }
    if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

    params.push(req.params.id);
    db.prepare(`UPDATE demo_supplier_mappings SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Mapping',
      action: 'updated',
      label: `${mapping.supplier_pattern} — ${category ? `category → ${category}` : ''}${domain ? ` domain → ${domain}` : ''}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update supplier mapping' });
  }
});

router.delete('/supplier-mappings/:id', (req: Request, res: Response) => {
  try {
    const mapping = db.prepare('SELECT supplier_pattern, category FROM demo_supplier_mappings WHERE id = ? AND is_user_defined = 1').get(req.params.id) as any;
    db.prepare('DELETE FROM demo_supplier_mappings WHERE id = ? AND is_user_defined = 1').run(req.params.id);
    db.saveToDisk();
    notifyAdmin({
      entity: 'Supplier Mapping',
      action: 'deleted',
      label: mapping ? `${mapping.supplier_pattern} (${mapping.category})` : `Mapping #${req.params.id}`,
      performedBy: (req as any).user?.display_name || 'Unknown',
      performedById: (req as any).user?.userId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete supplier mapping' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK DUPLICATES — scan all demo_invoices for suspected duplicates
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/check-duplicates', (_req: Request, res: Response) => {
  try {
    const allInvoices = db.prepare(
      'SELECT id, invoice_id, issue_date, supplier, category, domain, amount, vat_amount, currency, month FROM demo_invoices'
    ).all() as { id: number; invoice_id: string; issue_date: string; supplier: string; category: string; domain: string; amount: number; vat_amount: number; currency: string; month: string }[];

    // Track which id-pairs we've already grouped to avoid duplicates across strategies
    const seenPairs = new Set<string>();
    const pairKey = (a: number, b: number) => a < b ? `${a}|${b}` : `${b}|${a}`;

    const groups: { reason: string; invoices: typeof allInvoices }[] = [];

    // --- Strategy 1: Exact invoice_id match ---
    const exactIdMap = new Map<string, typeof allInvoices>();
    for (const inv of allInvoices) {
      const key = inv.invoice_id;
      if (!exactIdMap.has(key)) exactIdMap.set(key, []);
      exactIdMap.get(key)!.push(inv);
    }
    for (const [, invs] of exactIdMap) {
      if (invs.length < 2) continue;
      // Mark all pairs as seen
      for (let i = 0; i < invs.length; i++) {
        for (let j = i + 1; j < invs.length; j++) {
          seenPairs.add(pairKey(invs[i].id, invs[j].id));
        }
      }
      groups.push({ reason: 'exact_id', invoices: invs });
    }

    // --- Strategy 2: Copy-suffix match (e.g. "SI037954" vs "SI037954 (2)") ---
    const copySuffixRegex = /\s*\(\d+\)\s*$/;
    const baseIdMap = new Map<string, typeof allInvoices>();
    for (const inv of allInvoices) {
      const baseId = inv.invoice_id.replace(copySuffixRegex, '');
      // Only index if this invoice actually has a suffix OR shares a base with another
      if (!baseIdMap.has(baseId)) baseIdMap.set(baseId, []);
      baseIdMap.get(baseId)!.push(inv);
    }
    for (const [, invs] of baseIdMap) {
      if (invs.length < 2) continue;
      // Must have at least one pair with matching amount AND date
      // Also skip if all invoice_ids are identical (already caught by strategy 1)
      const allSameId = invs.every(i => i.invoice_id === invs[0].invoice_id);
      if (allSameId) continue;

      // Find sub-groups where amount+date match
      const matched: typeof allInvoices = [];
      for (let i = 0; i < invs.length; i++) {
        for (let j = i + 1; j < invs.length; j++) {
          if (seenPairs.has(pairKey(invs[i].id, invs[j].id))) continue;
          if (Math.abs(invs[i].amount - invs[j].amount) < 0.01 && invs[i].issue_date === invs[j].issue_date) {
            if (!matched.includes(invs[i])) matched.push(invs[i]);
            if (!matched.includes(invs[j])) matched.push(invs[j]);
            seenPairs.add(pairKey(invs[i].id, invs[j].id));
          }
        }
      }
      if (matched.length >= 2) {
        groups.push({ reason: 'copy_suffix', invoices: matched });
      }
    }

    // --- Strategy 3: Combo match (same supplier + amount + date, different IDs) ---
    const comboMap = new Map<string, typeof allInvoices>();
    for (const inv of allInvoices) {
      if (inv.amount === 0) continue; // skip zero-amount to avoid false positives
      const key = `${inv.supplier.toLowerCase()}|${Math.round(inv.amount * 100)}|${inv.issue_date}`;
      if (!comboMap.has(key)) comboMap.set(key, []);
      comboMap.get(key)!.push(inv);
    }
    for (const [, invs] of comboMap) {
      if (invs.length < 2) continue;
      // Filter to only unseen pairs
      const unseen: typeof allInvoices = [];
      for (let i = 0; i < invs.length; i++) {
        for (let j = i + 1; j < invs.length; j++) {
          if (seenPairs.has(pairKey(invs[i].id, invs[j].id))) continue;
          if (!unseen.includes(invs[i])) unseen.push(invs[i]);
          if (!unseen.includes(invs[j])) unseen.push(invs[j]);
          seenPairs.add(pairKey(invs[i].id, invs[j].id));
        }
      }
      if (unseen.length >= 2) {
        groups.push({ reason: 'combo_match', invoices: unseen });
      }
    }

    const totalSuspected = groups.reduce((s, g) => s + g.invoices.length, 0);
    res.json({ groups, totalGroups: groups.length, totalSuspected });
  } catch (err: any) {
    console.error('[demo-expenses] check-duplicates error:', err);
    res.status(500).json({ error: 'Failed to check for duplicates' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VAT AUDIT — check existing invoices for VAT issues
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/vat-audit', async (_req: Request, res: Response) => {
  try {
    const allInvoices = db.prepare(
      'SELECT id, invoice_id, issue_date, supplier, amount, vat_amount, currency, domain, category, embedded_pdf, xml_filename FROM demo_invoices'
    ).all() as any[];

    const issues: {
      id: number;
      invoice_id: string;
      supplier: string;
      amount: number;
      current_vat: number;
      suggested_vat: number | null;
      currency: string;
      domain: string;
      issue: string;
      country: string;
    }[] = [];

    // Known non-Belgian supplier patterns (common ones from the supplier map)
    const NON_BE_SUPPLIERS = [
      { pattern: 'chemoxy', country: 'GB' },
      { pattern: 'henan', country: 'CN' },
      { pattern: 'jindan', country: 'CN' },
      { pattern: 'seqens', country: 'FR' },
      { pattern: 'brenntag nederland', country: 'NL' },
      { pattern: 'caldic', country: 'NL' },
      { pattern: 'jungbunzlauer', country: 'DE' },
      { pattern: 'corbion', country: 'NL' },
    ];

    // Known Belgian supplier patterns
    const BE_SUPPLIERS = [
      'acerta', 'kbc', 'belfius', 'proximus', 'telenet', 'elia', 'engie',
      'bpost', 'securitas', 'athlon', 'modalizy', 'lyreco', 'vanbreda',
      'ethias', 'edenred', 'coolblue', 'bnp', 'axa', 'dhl express belgium',
    ];

    for (const inv of allInvoices) {
      const supplierLower = inv.supplier.toLowerCase();
      let country = '';

      // Determine country from known patterns
      for (const { pattern, country: c } of NON_BE_SUPPLIERS) {
        if (supplierLower.includes(pattern)) { country = c; break; }
      }
      if (!country) {
        for (const p of BE_SUPPLIERS) {
          if (supplierLower.includes(p)) { country = 'BE'; break; }
        }
      }

      // If we have XML, try to extract country from it
      if (!country && inv.xml_filename) {
        // Can't re-parse XML without the original file, but we can check the supplier name
        // for common Belgian legal suffixes (BV, NV, BVBA with Belgian-sounding names)
      }

      // If we have embedded PDF, check for country indicators
      if (!country && inv.embedded_pdf) {
        try {
          const pdfBuf = Buffer.from(inv.embedded_pdf, 'base64');
          const result = await (pdfParse as any)(pdfBuf);
          const text = result.text || '';

          const beVatAll = text.match(/\bBE\s?0[\d.\s]{8,12}\b/g) || [];
          if (beVatAll.length >= 2) {
            country = 'BE';
          } else if (beVatAll.length === 1) {
            const hasNonBE = /\b(united kingdom|UK|germany|deutschland|france|nederland|netherlands|china|india|usa|ireland)\b/i.test(text);
            if (hasNonBE) {
              // Detect which non-BE country
              if (/\b(United Kingdom|England)\b/i.test(text)) country = 'GB';
              else if (/\b(Deutschland|Germany)\b/i.test(text)) country = 'DE';
              else if (/\b(Nederland|Netherlands)\b/i.test(text)) country = 'NL';
              else if (/\b(France)\b/i.test(text)) country = 'FR';
              else if (/\b(China)\b/i.test(text)) country = 'CN';
              else if (/\b(India)\b/i.test(text)) country = 'IN';
              else if (/\b(Ireland)\b/i.test(text)) country = 'IE';
            } else {
              country = 'BE';
            }
          } else {
            if (/\b(United Kingdom|England)\b/i.test(text)) country = 'GB';
            else if (/\b(Deutschland|Germany)\b/i.test(text)) country = 'DE';
            else if (/\b(Nederland|Netherlands|Pays-Bas)\b/i.test(text)) country = 'NL';
            else if (/\b(France)\b/i.test(text)) country = 'FR';
            else if (/\b(China|中国)\b/i.test(text)) country = 'CN';
            else if (/\b(India)\b/i.test(text)) country = 'IN';
          }
        } catch { /* PDF parse failed, skip */ }
      }

      const isBelgian = country === 'BE';
      const isNonBelgian = country !== '' && country !== 'BE';

      // Issue 1: Non-Belgian supplier has VAT > 0
      if (isNonBelgian && inv.vat_amount > 0) {
        issues.push({
          id: inv.id,
          invoice_id: inv.invoice_id,
          supplier: inv.supplier,
          amount: inv.amount,
          current_vat: inv.vat_amount,
          suggested_vat: 0,
          currency: inv.currency,
          domain: inv.domain,
          issue: `Non-Belgian supplier (${country}) should not charge VAT — reverse charge applies`,
          country,
        });
      }

      // Issue 2: Belgian supplier, has amount but 0 VAT, and amount looks like it could be 21% off
      if (isBelgian && inv.vat_amount === 0 && inv.amount > 100) {
        // Check if amount / 1.21 gives a round-ish number (suggesting incl. VAT total was stored)
        const possibleExcl = inv.amount / 1.21;
        const possibleVat = inv.amount - possibleExcl;
        const isRoundExcl = Math.abs(possibleExcl - Math.round(possibleExcl)) < 0.5;
        // Only flag if the amount is suspicious — exact multiples of 1.21
        if (isRoundExcl && inv.amount > 200) {
          issues.push({
            id: inv.id,
            invoice_id: inv.invoice_id,
            supplier: inv.supplier,
            amount: inv.amount,
            current_vat: 0,
            suggested_vat: Math.round(possibleVat * 100) / 100,
            currency: inv.currency,
            domain: inv.domain,
            issue: `Belgian supplier with 0 VAT — amount ${inv.amount} could be incl. 21% BTW (excl. would be ${possibleExcl.toFixed(2)})`,
            country,
          });
        }
      }
    }

    // Sort: non-Belgian with VAT first (clear errors), then Belgian with 0 VAT (potential issues)
    issues.sort((a, b) => {
      if (a.suggested_vat === 0 && b.suggested_vat !== 0) return -1;
      if (a.suggested_vat !== 0 && b.suggested_vat === 0) return 1;
      return Math.abs(b.current_vat) - Math.abs(a.current_vat);
    });

    res.json({
      totalInvoices: allInvoices.length,
      issuesFound: issues.length,
      issues,
    });
  } catch (err: any) {
    console.error('[demo-expenses] vat-audit error:', err);
    res.status(500).json({ error: 'Failed to run VAT audit' });
  }
});

export default router;
