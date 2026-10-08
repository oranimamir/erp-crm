import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import db from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// backup.ts lives in server/src/lib, so the DB (server/data/erp.db) is two levels up,
// matching database.ts which is in server/src and uses one '..'.
const dbPath      = process.env.DB_PATH      || path.join(__dirname, '..', '..', 'data', 'erp.db');
const uploadsBase = process.env.UPLOADS_PATH  || path.join(__dirname, '..', '..', 'uploads');
const backupsDir  = process.env.BACKUPS_PATH  || path.join(__dirname, '..', '..', 'backups');

const MAX_BACKUPS = 4; // keep ~1 month of weekly backups

export function getBackupsDir() { return backupsDir; }

// ── Categorized invoice files ───────────────────────────────────────────────────
// Add every invoice file to the archive foldered by category, using its ORIGINAL
// uploaded filename. Categories:
//   Customer Invoices / Supplier Invoices  → disk files in uploads/invoices
//   Demo Suppliers / Sales Activities Suppliers → base64 embedded_pdf in demo_invoices
// `prefix` nests the whole tree (e.g. 'Invoices by Category/') for the full backup.

function sanitizeName(name: string): string {
  return (name || 'file').replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || 'file';
}

// Ensure a unique name within a folder — original names can collide across invoices.
function uniqueName(used: Set<string>, folder: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let i = 1;
  while (used.has(`${folder}/${candidate.toLowerCase()}`)) {
    candidate = `${base} (${i})${ext}`;
    i++;
  }
  used.add(`${folder}/${candidate.toLowerCase()}`);
  return candidate;
}

function addCategorizedInvoices(archive: archiver.Archiver, prefix = ''): void {
  const used = new Set<string>();

  // Disk-backed customer + supplier invoices (uploads/invoices/<file_path>).
  const diskInvoices = db.prepare(
    `SELECT type, invoice_number, file_path, file_name FROM invoices WHERE file_path IS NOT NULL`
  ).all() as any[];
  for (const inv of diskInvoices) {
    const full = path.join(uploadsBase, 'invoices', inv.file_path);
    if (!fs.existsSync(full)) continue;
    const folder = `${prefix}${inv.type === 'supplier' ? 'Supplier Invoices' : 'Customer Invoices'}`;
    const orig = sanitizeName(inv.file_name || inv.file_path);
    const name = uniqueName(used, folder, orig);
    archive.file(full, { name: `${folder}/${name}` });
  }

  // Embedded demo / sales-activities invoices (base64 PDF stored in the DB).
  let demoRows: any[] = [];
  try {
    demoRows = db.prepare(
      `SELECT domain, invoice_id, supplier, pdf_filename, embedded_pdf FROM demo_invoices WHERE embedded_pdf IS NOT NULL`
    ).all() as any[];
  } catch { /* table may not exist */ }
  for (const r of demoRows) {
    const folder = `${prefix}${r.domain === 'sales' ? 'Sales Activities Suppliers' : 'Demo Suppliers'}`;
    let b64 = String(r.embedded_pdf);
    const at = b64.indexOf('base64,');
    if (at >= 0) b64 = b64.slice(at + 7); // strip data-URI prefix if present
    let buf: Buffer;
    try { buf = Buffer.from(b64, 'base64'); } catch { continue; }
    if (!buf.length) continue;
    let orig = sanitizeName(r.pdf_filename || `${r.supplier || 'invoice'}-${r.invoice_id || ''}`);
    if (!/\.[a-z0-9]+$/i.test(orig)) orig += '.pdf';
    const name = uniqueName(used, folder, orig);
    archive.append(buf, { name: `${folder}/${name}` });
  }
}

/**
 * Pipe a ZIP of invoice files organized into category folders (original filenames)
 * into any writable stream. Used by the on-demand "download invoices by category".
 */
export function createCategorizedInvoiceArchive(output: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', resolve);
    output.on('finish', resolve);
    archive.pipe(output);
    addCategorizedInvoices(archive);
    archive.finalize();
  });
}

/**
 * Pipe a full ZIP backup (DB + all uploaded files) into any writable stream.
 * Used by both the on-demand HTTP download and the scheduled file writer.
 */
export function createBackupArchive(output: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', resolve);
    // for response streams 'finish' fires instead of 'close'
    output.on('finish', resolve);

    archive.pipe(output);

    if (fs.existsSync(dbPath)) {
      archive.file(dbPath, { name: 'erp.db' });
    }

    if (fs.existsSync(uploadsBase)) {
      archive.directory(uploadsBase, 'uploads');
    }

    // Also include invoice files organized by category with original filenames,
    // alongside the raw uploads/ tree (raw kept for full fidelity).
    addCategorizedInvoices(archive, 'Invoices by Category/');

    archive.finalize();
  });
}

/**
 * Write a timestamped backup ZIP to the backups folder and prune old ones.
 * Called by the weekly cron job.
 */
export async function runScheduledBackup(): Promise<string> {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename  = `erp-backup-${timestamp}.zip`;
  const outputPath = path.join(backupsDir, filename);

  const output = fs.createWriteStream(outputPath);
  await createBackupArchive(output);

  // Prune: keep only the most recent MAX_BACKUPS files
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('erp-backup-') && f.endsWith('.zip'))
    .sort(); // ISO timestamps sort lexicographically = chronologically

  for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    fs.unlinkSync(path.join(backupsDir, f));
  }

  console.log(`[Backup] Saved ${filename} — kept last ${MAX_BACKUPS} weekly backups`);
  return filename;
}

/** List saved weekly backup files, newest first. */
export function listBackups(): { filename: string; size: number; created_at: string }[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('erp-backup-') && f.endsWith('.zip'))
    .sort().reverse()
    .map(f => {
      const stats = fs.statSync(path.join(backupsDir, f));
      return { filename: f, size: stats.size, created_at: stats.mtime.toISOString() };
    });
}

/** What an emailed backup can hold — each goes out as its own ZIP. */
/**
 * What a backup email can hold: the full backup (database + every upload),
 * or one part per app tab — each an Excel of the tab's records plus its files.
 * `invoices` (invoice PDFs by category) is kept for settings saved before the
 * tab parts existed.
 */
export type BackupPart =
  | 'database' | 'documents' | 'invoices'
  | 'customers' | 'suppliers' | 'customer_invoices' | 'supplier_invoices' | 'orders'
  | 'operations' | 'ncos' | 'inventory' | 'working_capital';

export const BACKUP_PART_LABELS: Record<BackupPart, string> = {
  database: 'Database (all records)',
  documents: 'All uploaded documents',
  invoices: 'Invoices by category',
  customers: 'Customers',
  suppliers: 'Suppliers',
  customer_invoices: 'Customer Invoices',
  supplier_invoices: 'Supplier Invoices',
  orders: 'Orders',
  operations: 'Operations',
  ncos: 'Non-Commercial Ops',
  inventory: 'Inventory',
  working_capital: 'Working Capital',
};

/** The tabs, in sidebar order — what a recipient picks from. */
export const BACKUP_TABS: BackupPart[] = [
  'customers', 'suppliers', 'customer_invoices', 'supplier_invoices', 'orders',
  'operations', 'ncos', 'inventory', 'working_capital',
];
/** "Everything": the full backup. */
export const BACKUP_EVERYTHING: BackupPart[] = ['database', 'documents'];

export const BACKUP_PART_HINTS: Record<BackupPart, string> = {
  database: 'Every record — enough to restore the app.',
  documents: 'Every uploaded file. Usually too large to email.',
  invoices: 'Customer and supplier invoice PDFs in folders.',
  customers: 'Excel of the customers and their document profiles.',
  suppliers: 'Excel of the suppliers, and each supplier\'s documents.',
  customer_invoices: 'Excel of the customer invoices, payments and wire transfers, with the invoice and wire PDFs.',
  supplier_invoices: 'Excel of the supplier invoices (demo and sales activities), with their PDFs.',
  orders: 'Excel of the orders and their lines, with the order documents.',
  operations: 'A folder per operation (order, documents by category, invoices) and an overview Excel; split when large.',
  ncos: 'Excel of the non-commercial operations, with a folder of documents per NCO.',
  inventory: 'Excel of products, packaging, batches and stock, with the batch and library documents.',
  working_capital: 'Excel of the working capital forecasts.',
};

// ── Operations: a folder per operation, and an overview spreadsheet ─────────

/** Every operation with its order, parties and money, one row each. */
function operationRows(): any[] {
  return db.prepare(`
    SELECT o.id, o.operation_number, o.category, o.status, o.country, o.ship_date, o.etd, o.eta, o.bl_date,
           o.estimated_payment_date, o.notes, o.created_at,
           c.name AS customer_name, s.name AS supplier_name,
           ord.order_number, ord.file_path AS order_file_path, ord.file_name AS order_file_name,
           (SELECT COUNT(*) FROM operation_documents d WHERE d.operation_id = o.id) AS document_count,
           (SELECT COUNT(*) FROM invoices i WHERE i.operation_id = o.id AND i.type = 'customer') AS invoice_count,
           (SELECT COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) FROM invoices i
             WHERE i.operation_id = o.id AND i.type = 'customer') AS invoiced_eur,
           (SELECT COALESCE(SUM(COALESCE(i.eur_amount, i.amount)), 0) FROM invoices i
             WHERE i.operation_id = o.id AND i.type = 'customer' AND i.status = 'paid') AS paid_eur
    FROM operations o
    LEFT JOIN orders ord ON ord.id = o.order_id
    LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, ord.customer_id)
    LEFT JOIN suppliers s ON s.id = COALESCE(o.supplier_id, ord.supplier_id)
    ORDER BY o.operation_number
  `).all() as any[];
}

async function operationsOverview(rows: any[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Operations');
  ws.columns = [
    { header: 'Operation', key: 'operation_number', width: 18 },
    { header: 'Category', key: 'category', width: 11 },
    { header: 'Status', key: 'status', width: 13 },
    { header: 'Customer', key: 'customer_name', width: 30 },
    { header: 'Supplier', key: 'supplier_name', width: 26 },
    { header: 'Order', key: 'order_number', width: 18 },
    { header: 'Country', key: 'country', width: 14 },
    { header: 'Ship date', key: 'ship_date', width: 12 },
    { header: 'ETD', key: 'etd', width: 12 },
    { header: 'ETA', key: 'eta', width: 12 },
    { header: 'BL date', key: 'bl_date', width: 12 },
    { header: 'Est. payment', key: 'estimated_payment_date', width: 13 },
    { header: 'Invoices', key: 'invoice_count', width: 9 },
    { header: 'Invoiced (EUR)', key: 'invoiced_eur', width: 15 },
    { header: 'Paid (EUR)', key: 'paid_eur', width: 13 },
    { header: 'Documents', key: 'document_count', width: 11 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  for (const key of ['invoiced_eur', 'paid_eur']) ws.getColumn(key).numFmt = '#,##0.00';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One file to put in the operations backup: where it is, where it goes in the ZIP. */
interface OpFile { full: string; name: string; size: number }

/**
 * The operations backup as files: `Operations/<op#> - <customer>/` holding the
 * order document, every operation document foldered by its category, and the
 * uploaded invoices — grouped by operation so a ZIP never splits one.
 */
function operationFiles(rows: any[]): OpFile[][] {
  const used = new Set<string>();
  const docs = db.prepare(`
    SELECT d.operation_id, d.file_path, d.file_name, c.name AS category
    FROM operation_documents d LEFT JOIN document_categories c ON c.id = d.category_id
  `).all() as any[];
  // Generated invoices already sit among the operation documents — only uploaded ones are added
  const invoices = db.prepare(`
    SELECT i.operation_id, i.file_path, i.file_name, i.invoice_number FROM invoices i
    WHERE i.operation_id IS NOT NULL AND i.file_path IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM invoice_documents g WHERE g.invoice_id = i.id)
  `).all() as any[];

  return rows.map(op => {
    const folder = `Operations/${sanitizeName(`${op.operation_number}${op.customer_name || op.supplier_name ? ` - ${op.customer_name || op.supplier_name}` : ''}`)}`;
    const files: OpFile[] = [];
    const add = (full: string, sub: string, name: string) => {
      if (!fs.existsSync(full)) return;
      const dir = `${folder}/${sanitizeName(sub)}`;
      files.push({ full, name: `${dir}/${uniqueName(used, dir, sanitizeName(name))}`, size: fs.statSync(full).size });
    };
    if (op.order_file_path) add(path.join(uploadsBase, 'orders', op.order_file_path), 'Order', op.order_file_name || op.order_file_path);
    for (const d of docs.filter(d => d.operation_id === op.id)) {
      add(path.join(uploadsBase, 'operation-docs', d.file_path), d.category || 'Other documents', d.file_name || d.file_path);
    }
    for (const inv of invoices.filter(i => i.operation_id === op.id)) {
      add(path.join(uploadsBase, 'invoices', inv.file_path), 'Invoices', inv.file_name || `${inv.invoice_number}.pdf`);
    }
    return files;
  });
}

/** Keeps each operations ZIP small enough to email (documents are mostly PDFs, which barely compress). */
const OPERATIONS_ZIP_BYTES = 22 * 1024 * 1024;

function writeZip(filePath: string, fill: (archive: archiver.Archiver) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', () => resolve(filePath));
    archive.pipe(output);
    fill(archive);
    archive.finalize();
  });
}

/** The operations backup, split into as many ZIPs as it takes; the overview is in the first. */
async function writeOperationsParts(stamp: string): Promise<string[]> {
  const rows = operationRows();
  const overview = await operationsOverview(rows);
  const groups: OpFile[][] = [];
  let current: OpFile[] = [];
  let size = overview.length;
  for (const files of operationFiles(rows)) {
    const opSize = files.reduce((acc, f) => acc + f.size, 0);
    if (current.length && size + opSize > OPERATIONS_ZIP_BYTES) { groups.push(current); current = []; size = 0; }
    current.push(...files);
    size += opSize;
  }
  groups.push(current);

  const paths: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const suffix = groups.length > 1 ? `-${i + 1}of${groups.length}` : '';
    paths.push(await writeZip(path.join(backupsDir, `email-operations-${stamp}${suffix}.zip`), archive => {
      if (i === 0) archive.append(overview, { name: 'Operations/Operations overview.xlsx' });
      for (const f of groups[i]) archive.file(f.full, { name: f.name });
    }));
  }
  return paths;
}

// ── One tab: an Excel of its records plus its files ─────────────────────────

/** Rows of a query, or none when a table is missing on this install. */
function rowsOf(sql: string): any[] {
  try { return db.prepare(sql).all() as any[]; } catch { return []; }
}

/** Big / binary columns never go into the Excel. */
const SKIP_COLUMNS = new Set(['embedded_pdf', 'password_hash', 'sha256', 'file_hash']);

async function tabWorkbook(sheets: Array<{ name: string; rows: any[] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    const keys = [...new Set(sheet.rows.flatMap(r => Object.keys(r)))].filter(k => !SKIP_COLUMNS.has(k));
    ws.columns = keys.map(k => ({ header: k, key: k, width: Math.min(40, Math.max(10, k.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of sheet.rows) {
      const row: Record<string, unknown> = {};
      for (const k of keys) {
        const v = r[k];
        // Excel cells hold at most 32,767 characters
        row[k] = typeof v === 'string' && v.length > 32000 ? `${v.slice(0, 32000)}…` : v;
      }
      ws.addRow(row);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

type TabFile = { full?: string; buffer?: Buffer; name: string };

/** The records (sheets) and files of one tab. */
function tabContent(part: BackupPart): { folder: string; sheets: Array<{ name: string; rows: any[] }>; files: TabFile[] } {
  const used = new Set<string>();
  const files: TabFile[] = [];
  const addFile = (sub: string, dir: string, stored: string | null | undefined, name: string | null | undefined, folder: string) => {
    if (!stored || !/^[a-zA-Z0-9._-]+$/.test(stored)) return;
    const full = path.join(uploadsBase, sub, stored);
    if (!fs.existsSync(full)) return;
    const target = `${folder}/${sanitizeName(dir)}`;
    files.push({ full, name: `${target}/${uniqueName(used, target, sanitizeName(name || stored))}` });
  };

  switch (part) {
    case 'customers':
      return { folder: 'Customers', files, sheets: [
        { name: 'Customers', rows: rowsOf('SELECT * FROM customers ORDER BY name') },
        { name: 'Document profiles', rows: rowsOf(`SELECT p.*, c.name AS customer_name FROM customer_document_profiles p LEFT JOIN customers c ON c.id = p.customer_id ORDER BY c.name`) },
      ] };
    case 'suppliers': {
      for (const d of rowsOf(`SELECT sd.*, s.name AS supplier_name FROM supplier_documents sd JOIN suppliers s ON s.id = sd.supplier_id`)) {
        addFile('supplier-docs', d.supplier_name, d.file_path, d.file_name, 'Suppliers');
      }
      return { folder: 'Suppliers', files, sheets: [
        { name: 'Suppliers', rows: rowsOf('SELECT * FROM suppliers ORDER BY name') },
        { name: 'Supplier documents', rows: rowsOf(`SELECT sd.id, s.name AS supplier, sd.title, sd.doc_type, sd.file_name, sd.notes, sd.created_at FROM supplier_documents sd JOIN suppliers s ON s.id = sd.supplier_id ORDER BY s.name`) },
      ] };
    }
    case 'customer_invoices': {
      for (const i of rowsOf(`SELECT invoice_number, file_path, file_name FROM invoices WHERE type = 'customer' AND file_path IS NOT NULL`)) {
        addFile('invoices', 'Invoices', i.file_path, i.file_name || `${i.invoice_number}.pdf`, 'Customer Invoices');
      }
      for (const w of rowsOf(`SELECT w.file_path, w.file_name, i.invoice_number FROM wire_transfers w JOIN invoices i ON i.id = w.invoice_id WHERE i.type = 'customer' AND w.file_path IS NOT NULL`)) {
        addFile('wire-transfers', 'Wire transfers', w.file_path, w.file_name || `${w.invoice_number} wire.pdf`, 'Customer Invoices');
      }
      return { folder: 'Customer Invoices', files, sheets: [
        { name: 'Invoices', rows: rowsOf(`SELECT i.*, c.name AS customer_name, o.operation_number FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN operations o ON o.id = i.operation_id WHERE i.type = 'customer' ORDER BY i.invoice_date DESC`) },
        { name: 'Wire transfers', rows: rowsOf(`SELECT w.*, i.invoice_number FROM wire_transfers w JOIN invoices i ON i.id = w.invoice_id WHERE i.type = 'customer' ORDER BY w.transfer_date DESC`) },
        { name: 'Payments', rows: rowsOf(`SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.type = 'customer' ORDER BY p.payment_date DESC`) },
      ] };
    }
    case 'supplier_invoices': {
      for (const r of rowsOf(`SELECT domain, invoice_id, supplier, pdf_filename, embedded_pdf FROM demo_invoices WHERE embedded_pdf IS NOT NULL`)) {
        let b64 = String(r.embedded_pdf);
        const at = b64.indexOf('base64,');
        if (at >= 0) b64 = b64.slice(at + 7);
        const buf = Buffer.from(b64, 'base64');
        if (!buf.length) continue;
        const folder = `Supplier Invoices/${r.domain === 'sales' ? 'Sales activities' : 'Demo expenses'}`;
        let name = sanitizeName(r.pdf_filename || `${r.supplier || 'invoice'}-${r.invoice_id || ''}`);
        if (!/\.[a-z0-9]+$/i.test(name)) name += '.pdf';
        files.push({ buffer: buf, name: `${folder}/${uniqueName(used, folder, name)}` });
      }
      for (const i of rowsOf(`SELECT invoice_number, file_path, file_name FROM invoices WHERE type = 'supplier' AND file_path IS NOT NULL`)) {
        addFile('invoices', 'Recorded supplier invoices', i.file_path, i.file_name || `${i.invoice_number}.pdf`, 'Supplier Invoices');
      }
      return { folder: 'Supplier Invoices', files, sheets: [
        { name: 'Supplier invoices', rows: rowsOf(`SELECT * FROM demo_invoices ORDER BY issue_date DESC`) },
        { name: 'Recorded (orders)', rows: rowsOf(`SELECT i.*, s.name AS supplier_name FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.type = 'supplier' ORDER BY i.invoice_date DESC`) },
      ] };
    }
    case 'orders': {
      for (const o of rowsOf(`SELECT order_number, file_path, file_name FROM orders WHERE file_path IS NOT NULL`)) {
        addFile('orders', 'Order documents', o.file_path, o.file_name || `${o.order_number}.pdf`, 'Orders');
      }
      return { folder: 'Orders', files, sheets: [
        { name: 'Orders', rows: rowsOf(`SELECT o.*, c.name AS customer_name, s.name AS supplier_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN suppliers s ON s.id = o.supplier_id ORDER BY o.created_at DESC`) },
        { name: 'Order lines', rows: rowsOf(`SELECT oi.*, o.order_number FROM order_items oi JOIN orders o ON o.id = oi.order_id ORDER BY o.order_number, oi.id`) },
      ] };
    }
    case 'ncos': {
      for (const d of rowsOf(`SELECT d.file_path, d.file_name, n.nco_number, c.name AS category FROM nco_documents d JOIN non_commercial_operations n ON n.id = d.nco_id LEFT JOIN document_categories c ON c.id = d.category_id`)) {
        addFile('operation-docs', `${d.nco_number}/${d.category || 'Other documents'}`, d.file_path, d.file_name, 'Non-Commercial Ops');
      }
      return { folder: 'Non-Commercial Ops', files, sheets: [
        { name: 'NCOs', rows: rowsOf(`SELECT n.*, c.name AS customer_name, s.name AS supplier_name FROM non_commercial_operations n LEFT JOIN customers c ON c.id = n.customer_id LEFT JOIN suppliers s ON s.id = n.supplier_id ORDER BY n.nco_number`) },
      ] };
    }
    case 'inventory': {
      for (const d of rowsOf(`SELECT bd.file_path, bd.file_name, b.batch_number FROM batch_documents bd JOIN batches b ON b.id = bd.batch_id`)) {
        addFile('batch-documents', `Batches/${d.batch_number}`, d.file_path, d.file_name, 'Inventory');
      }
      for (const d of rowsOf(`SELECT kind, file_path, file_name FROM product_documents`)) {
        addFile('product-docs', `Documents/${String(d.kind).toUpperCase()}`, d.file_path, d.file_name, 'Inventory');
      }
      return { folder: 'Inventory', files, sheets: [
        { name: 'Products', rows: rowsOf('SELECT * FROM products ORDER BY name') },
        { name: 'Packaging', rows: rowsOf('SELECT * FROM packaging ORDER BY code') },
        { name: 'Batches', rows: rowsOf('SELECT * FROM batches ORDER BY batch_number') },
        { name: 'Warehouse stock', rows: rowsOf('SELECT * FROM warehouse_stock ORDER BY article') },
        { name: 'Documents library', rows: rowsOf(`SELECT d.id, d.kind, d.title, d.doc_code, d.file_name, d.notes, d.created_at FROM product_documents d ORDER BY d.kind, d.title`) },
      ] };
    }
    case 'working_capital':
      return { folder: 'Working Capital', files, sheets: [
        { name: 'Forecasts', rows: rowsOf(`SELECT w.*, s.name AS supplier_name FROM working_capital_forecasts w LEFT JOIN suppliers s ON s.id = w.supplier_id ORDER BY w.expected_date`) },
      ] };
    default:
      return { folder: part, files, sheets: [] };
  }
}

/** Writes one part's ZIP(s) into the backups folder and returns their paths. */
export async function writeBackupPart(part: BackupPart, stamp: string): Promise<string[]> {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  if (part === 'operations') return writeOperationsParts(stamp);
  if (BACKUP_TABS.includes(part)) {
    const content = tabContent(part);
    const workbook = await tabWorkbook(content.sheets);
    return [await writeZip(path.join(backupsDir, `email-${part}-${stamp}.zip`), archive => {
      archive.append(workbook, { name: `${content.folder}/${content.folder}.xlsx` });
      for (const f of content.files) {
        if (f.buffer) archive.append(f.buffer, { name: f.name });
        else if (f.full) archive.file(f.full, { name: f.name });
      }
    })];
  }
  const filePath = path.join(backupsDir, `email-${part}-${stamp}.zip`);
  return [await writeZip(filePath, archive => {
    if (part === 'database') {
      try { (db as any).saveToDisk?.(); } catch { /* the file on disk is still the last save */ }
      if (fs.existsSync(dbPath)) archive.file(dbPath, { name: 'erp.db' });
    } else if (part === 'documents') {
      if (fs.existsSync(uploadsBase)) archive.directory(uploadsBase, 'uploads');
    } else {
      addCategorizedInvoices(archive);
    }
  })];
}
