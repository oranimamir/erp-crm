// Wire-transfer → operation matching.
//
// A bank payment proof rarely carries a single clean key, so we score every
// candidate invoice on three independent signals and add them up:
//   1. payer name   vs the operation's customer name
//   2. references   vs invoice / order / operation / PO numbers
//   3. amount       vs the invoice value (original currency and EUR)
// Any two of the three landing is normally enough to identify the operation.

export interface WireSignals {
  amount: number | null;      // amount as printed on the wire
  amountEur: number | null;   // same amount converted to EUR (null when unknown)
  payerName: string | null;
  references: string[];       // bank ref, payment reference, extracted doc numbers
  text: string;               // any free text from the document (notes, raw PDF text)
}

export interface MatchTarget {
  customerName: string | null;
  invoiceNumber: string | null;
  orderNumber: string | null;
  operationNumber: string | null;
  ourRef: string | null;
  poNumber: string | null;
  invoiceAmount: number;
  invoiceEur: number;
  invoiceStatus: string;
}

export interface MatchResult {
  score: number;
  nameScore: number;
  refScore: number;
  amountScore: number;
  reasons: string[];
  refMatch: boolean;
  nameMatch: boolean;
  amountMatch: boolean;
}

// Words that carry no identifying weight in a company name. Both sides of the
// comparison are stripped the same way, so "LA MESTA S.A." and "LA MESTA SA"
// both collapse to ["mesta"].
const NOISE_WORDS = new Set([
  'sa', 'sas', 'sarl', 'srl', 'sl', 'spa', 'bv', 'nv', 'gmbh', 'ag', 'kg', 'oy', 'ab', 'as',
  'ltd', 'limited', 'llc', 'lp', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'plc', 'pte', 'pty', 'sac', 'cia', 'kft', 'doo', 'sro', 'aps', 'sae', 'fze', 'llp',
  'group', 'holding', 'holdings', 'international', 'intl', 'trading', 'trade', 'commerce',
  'import', 'export', 'imports', 'exports', 'the', 'and', 'of', 'de', 'del', 'la', 'le', 'les',
  'el', 'los', 'las', 'du', 'des', 'da', 'do', 'van', 'von', 'y',
]);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Company name → significant lowercase tokens. */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = stripAccents(String(raw))
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  const all = cleaned.split(' ').filter(t => t.length > 1);
  const significant = all.filter(t => !NOISE_WORDS.has(t));
  return significant.length ? significant : all;
}

function tokensOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let hits = 0;
  for (const t of a) {
    const found = b.some(u => u === t || (t.length >= 4 && u.length >= 4 && (u.startsWith(t) || t.startsWith(u))));
    if (found) hits++;
  }
  return hits / Math.min(a.length, b.length);
}

/** Identifier → uppercase alphanumerics only ("INV-2024/0123" → "INV20240123"). */
export function normRef(raw: string | null | undefined): string {
  if (!raw) return '';
  return stripAccents(String(raw)).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function digitsOf(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '');
}

/**
 * Does `id` appear inside the wire document text? Short identifiers are only
 * accepted on their digit core, so a 2-digit order number can't match a random
 * pair of digits in an IBAN.
 */
function idAppearsIn(id: string | null | undefined, haystackAlnum: string, haystackDigits: string): boolean {
  const alnum = normRef(id);
  if (alnum.length >= 5 && haystackAlnum.includes(alnum)) return true;
  const digits = digitsOf(id);
  // Drop leading zeros — invoices are often printed as "0123" but wired as "123".
  const trimmed = digits.replace(/^0+/, '');
  if (trimmed.length >= 4 && haystackDigits.includes(trimmed)) return true;
  return false;
}

function relDiff(a: number, b: number): number {
  if (!isFinite(a) || !isFinite(b) || b === 0) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / Math.abs(b);
}

export function scoreCandidate(wire: WireSignals, target: MatchTarget): MatchResult {
  const reasons: string[] = [];

  // ── 1. Payer name ───────────────────────────────────────────────────────────
  const custTokens = nameTokens(target.customerName);
  const payerTokens = nameTokens(wire.payerName);
  let nameScore = 0;
  const overlap = tokensOverlap(custTokens, payerTokens);
  if (overlap >= 0.99) {
    nameScore = 42;
    reasons.push(`payer "${target.customerName}"`);
  } else if (overlap >= 0.6) {
    nameScore = 28;
    reasons.push(`payer ~ "${target.customerName}"`);
  } else if (overlap >= 0.34) {
    nameScore = 14;
    reasons.push(`payer ~ "${target.customerName}"`);
  } else if (custTokens.length) {
    // The remitter may not have been extracted as a discrete field — look for the
    // customer name anywhere in the document text instead.
    const hay = stripAccents(wire.text.toLowerCase()).replace(/[^a-z0-9]+/g, ' ');
    const allPresent = custTokens.every(t => hay.includes(` ${t}`) || hay.startsWith(t));
    if (allPresent) {
      nameScore = 30;
      reasons.push(`"${target.customerName}" in document`);
    }
  }

  // ── 2. References ───────────────────────────────────────────────────────────
  const haystack = [wire.text, ...wire.references].filter(Boolean).join(' ');
  const hayAlnum = normRef(haystack);
  const hayDigits = digitsOf(haystack);
  const refFields: Array<[string, string | null, number]> = [
    ['invoice', target.invoiceNumber, 45],
    ['order', target.orderNumber, 40],
    ['operation', target.operationNumber, 40],
    ['our ref', target.ourRef, 30],
    ['PO', target.poNumber, 30],
  ];
  let refScore = 0;
  let matchedRefs = 0;
  for (const [label, value, weight] of refFields) {
    if (!value) continue;
    if (idAppearsIn(value, hayAlnum, hayDigits)) {
      matchedRefs++;
      refScore = Math.max(refScore, weight);
      reasons.push(`${label} ${value}`);
    }
  }
  if (matchedRefs > 1) refScore += 10; // several identifiers agreeing is near-proof

  // ── 3. Amount ───────────────────────────────────────────────────────────────
  let amountScore = 0;
  const diffs: number[] = [];
  if (wire.amount != null) {
    diffs.push(relDiff(wire.amount, target.invoiceAmount));
    diffs.push(relDiff(wire.amount, target.invoiceEur));
  }
  if (wire.amountEur != null) diffs.push(relDiff(wire.amountEur, target.invoiceEur));
  const bestDiff = diffs.length ? Math.min(...diffs) : Number.POSITIVE_INFINITY;
  if (bestDiff <= 0.005) { amountScore = 32; reasons.push('amount matches'); }
  else if (bestDiff <= 0.02) { amountScore = 24; reasons.push('amount ≈ matches'); }
  else if (bestDiff <= 0.05) { amountScore = 12; reasons.push('amount close'); }
  else if (bestDiff <= 0.15) { amountScore = 4; }
  else if (wire.amount != null) {
    // A wire smaller than the invoice is a plausible partial / instalment payment.
    const ratio = Math.min(wire.amount, wire.amountEur ?? wire.amount) / (target.invoiceEur || target.invoiceAmount || 1);
    if (ratio > 0.15 && ratio < 0.95) { amountScore = 5; reasons.push('possible partial payment'); }
  }

  // ── 4. Invoice state ────────────────────────────────────────────────────────
  let statusScore = 0;
  if (target.invoiceStatus === 'sent' || target.invoiceStatus === 'overdue') statusScore = 8;
  else if (target.invoiceStatus === 'draft') statusScore = 2;
  else if (target.invoiceStatus === 'paid') statusScore = -6; // still offered, just ranked lower

  return {
    score: nameScore + refScore + amountScore + statusScore,
    nameScore,
    refScore,
    amountScore,
    reasons,
    refMatch: refScore > 0,
    nameMatch: nameScore > 0,
    amountMatch: amountScore >= 12,
  };
}
