import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'erp.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Wrapper to provide better-sqlite3-like API over sql.js
class DatabaseWrapper {
  private sqlDb!: any;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      this.sqlDb = new SQL.Database(buffer);
    } else {
      this.sqlDb = new SQL.Database();
    }
    // Enable foreign keys
    this.sqlDb.run('PRAGMA foreign_keys = ON;');
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, 100);
  }

  saveToDisk() {
    try {
      const data = this.sqlDb.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (err: any) {
      console.error(`[db] Save to disk failed (${err.code || err.message})`);
    }
  }

  /** Create a timestamped backup of the database file before risky operations */
  backupToDisk() {
    try {
      if (fs.existsSync(dbPath)) {
        // Clean up old backup files first — keep only the 2 most recent
        const dir = path.dirname(dbPath);
        const base = path.basename(dbPath, '.db');
        const backups = fs.readdirSync(dir)
          .filter((f: string) => f.startsWith(base + '_backup_') && f.endsWith('.db'))
          .sort()
          .reverse();
        for (const old of backups.slice(2)) {
          try { fs.unlinkSync(path.join(dir, old)); } catch (_) {}
        }

        const backupPath = dbPath.replace(/\.db$/, '') + '_backup_' + Date.now() + '.db';
        fs.copyFileSync(dbPath, backupPath);
        console.log(`[db] Backup created: ${backupPath}`);
      }
    } catch (err: any) {
      console.error(`[db] Backup failed (${err.code || err.message}) — continuing without backup`);
    }
  }

  /** Run raw SQL. Pass skipSave=true during migrations to avoid persisting intermediate states. */
  exec(sql: string, skipSave = false) {
    this.sqlDb.run(sql);
    if (!skipSave) this.scheduleSave();
  }

  prepare(sql: string) {
    const sqlDb = this.sqlDb;
    const self = this;

    return {
      run(...params: any[]) {
        sqlDb.run(sql, params);
        self.scheduleSave();
        // Emulate better-sqlite3 RunResult
        const lastId = sqlDb.exec('SELECT last_insert_rowid() as id');
        const changes = sqlDb.exec('SELECT changes() as c');
        return {
          lastInsertRowid: lastId[0]?.values[0]?.[0] ?? 0,
          changes: changes[0]?.values[0]?.[0] ?? 0,
        };
      },
      get(...params: any[]) {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        let result: any = undefined;
        if (stmt.step()) {
          result = stmt.getAsObject();
        }
        stmt.free();
        return result;
      },
      all(...params: any[]) {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        const results: any[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
    };
  }

  pragma(directive: string) {
    this.sqlDb.run(`PRAGMA ${directive};`);
  }

  transaction<T>(fn: () => T): () => T {
    const self = this;
    return () => {
      self.sqlDb.run('BEGIN TRANSACTION');
      try {
        const result = fn();
        self.sqlDb.run('COMMIT');
        self.scheduleSave();
        return result;
      } catch (e) {
        self.sqlDb.run('ROLLBACK');
        throw e;
      }
    };
  }
}

const db = new DatabaseWrapper();

export async function initializeDatabase() {
  await db.init();

  // Create a backup before running any migrations (protects against data loss)
  db.backupToDisk();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      company TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      category TEXT NOT NULL CHECK (category IN ('logistics', 'blenders', 'raw_materials', 'shipping')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER,
      supplier_id INTEGER,
      type TEXT NOT NULL CHECK (type IN ('customer', 'supplier')),
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
      due_date TEXT,
      notes TEXT,
      file_path TEXT,
      file_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
      CHECK (
        (type = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR
        (type = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      reference TEXT,
      notes TEXT,
      file_path TEXT,
      file_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER,
      supplier_id INTEGER,
      type TEXT NOT NULL CHECK (type IN ('customer', 'supplier')),
      status TEXT NOT NULL DEFAULT 'order_placed' CHECK (status IN ('order_placed', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled')),
      total_amount REAL NOT NULL DEFAULT 0,
      description TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
      CHECK (
        (type = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR
        (type = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      customer_id INTEGER,
      supplier_id INTEGER,
      type TEXT NOT NULL CHECK (type IN ('customer', 'supplier')),
      tracking_number TEXT,
      carrier TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'failed')),
      estimated_delivery TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
      CHECK (
        (type = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR
        (type = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('invoice', 'order', 'shipment', 'production')),
      entity_id INTEGER NOT NULL,
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_by INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('raw_material', 'packaging', 'finished_product')),
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'pcs',
      min_stock_level REAL NOT NULL DEFAULT 0,
      supplier_id INTEGER,
      unit_cost REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS production_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_number TEXT UNIQUE NOT NULL,
      order_id INTEGER,
      customer_id INTEGER,
      product_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new_order' CHECK (status IN ('new_order', 'stock_check', 'sufficient_stock', 'lot_issued', 'discussing_with_toller', 'supplying_toller', 'in_production', 'production_complete', 'sample_testing', 'to_warehousing', 'coa_received', 'delivered', 'cancelled')),
      toller_supplier_id INTEGER,
      ingredients_at_toller INTEGER NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'kg',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      FOREIGN KEY (toller_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      token TEXT UNIQUE NOT NULL,
      invited_by INTEGER,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL DEFAULT 'raw_material',
      unit TEXT NOT NULL DEFAULT 'tons',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wire_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      transfer_date TEXT NOT NULL,
      bank_reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      approved_by INTEGER,
      approved_at TEXT,
      rejection_reason TEXT,
      file_path TEXT,
      file_name TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_number TEXT UNIQUE NOT NULL,
      order_id INTEGER,
      customer_id INTEGER,
      supplier_id INTEGER,
      status TEXT NOT NULL DEFAULT 'ordered',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS document_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operation_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id INTEGER NOT NULL,
      category_id INTEGER,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES document_categories(id) ON DELETE SET NULL
    );
  `);

  // Migrate status_history table to support 'production' entity_type
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='status_history'").get() as any;
    if (tableInfo?.sql && !tableInfo.sql.includes('production')) {
      db.exec(`PRAGMA foreign_keys = OFF`, true);
      db.exec(`
        ALTER TABLE status_history RENAME TO status_history_old;
        CREATE TABLE status_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('invoice', 'order', 'shipment', 'production')),
          entity_id INTEGER NOT NULL,
          old_status TEXT,
          new_status TEXT NOT NULL,
          changed_by INTEGER,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO status_history SELECT * FROM status_history_old;
        DROP TABLE status_history_old;
      `, true);
      db.exec(`PRAGMA foreign_keys = ON`, true);
      db.saveToDisk();
    }
  } catch (_) {
    try { db.exec(`PRAGMA foreign_keys = ON`, true); } catch (_) {}
  }

  // Add email column to users
  try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT`); } catch (_) { /* column may already exist */ }

  // Add invoice_date and payment_date columns to invoices
  try { db.exec(`ALTER TABLE invoices ADD COLUMN invoice_date TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE invoices ADD COLUMN payment_date TEXT`); } catch (_) { /* column may already exist */ }

  // Add unit column to order_items
  try { db.exec(`ALTER TABLE order_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'tons'`); } catch (_) { /* column may already exist */ }
  // Add packaging and currency columns to order_items
  try { db.exec(`ALTER TABLE order_items ADD COLUMN packaging TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE order_items ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'`); } catch (_) { /* column may already exist */ }
  // Add client_product_name to order_items
  try { db.exec(`ALTER TABLE order_items ADD COLUMN client_product_name TEXT`); } catch (_) { /* column may already exist */ }

  // Add new order-level fields
  try { db.exec(`ALTER TABLE orders ADD COLUMN order_date TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN inco_terms TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN destination TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN transport TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN delivery_date TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN payment_terms TEXT`); } catch (_) { /* column may already exist */ }
  // Add file attachment columns to orders
  try { db.exec(`ALTER TABLE orders ADD COLUMN file_path TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN file_name TEXT`); } catch (_) { /* column may already exist */ }
  // Add our_ref and po_number to invoices
  try { db.exec(`ALTER TABLE invoices ADD COLUMN our_ref TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE invoices ADD COLUMN po_number TEXT`); } catch (_) { /* column may already exist */ }
  // Add operation_number to orders
  try { db.exec(`ALTER TABLE orders ADD COLUMN operation_number TEXT`); } catch (_) { /* column may already exist */ }
  // Add email to users (for admin notifications)
  try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT`); } catch (_) { /* column may already exist */ }
  // Add notify_on_changes flag to users
  try { db.exec(`ALTER TABLE users ADD COLUMN notify_on_changes INTEGER NOT NULL DEFAULT 0`); } catch (_) { /* column may already exist */ }
  // Add operation_id to invoices
  try { db.exec(`ALTER TABLE invoices ADD COLUMN operation_id INTEGER`); } catch (_) { /* column may already exist */ }
  // One-time fix: wire transfers uploaded in 2026-02 for invoices dated in 2025
  // (historical bookkeeping uploads that got today's date instead of the actual payment date)
  try {
    db.exec(`
      UPDATE wire_transfers
      SET transfer_date = (
        SELECT invoice_date FROM invoices
        WHERE id = wire_transfers.invoice_id AND invoice_date IS NOT NULL
      )
      WHERE strftime('%Y-%m', transfer_date) = '2026-02'
        AND (
          SELECT invoice_date FROM invoices WHERE id = wire_transfers.invoice_id
        ) LIKE '2025-%'
    `);
  } catch (_) { /* safe to ignore */ }

  // Add EUR FX columns to invoices and wire_transfers
  try { db.exec(`ALTER TABLE invoices ADD COLUMN fx_rate REAL`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE invoices ADD COLUMN eur_amount REAL`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE wire_transfers ADD COLUMN fx_rate REAL`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE wire_transfers ADD COLUMN eur_amount REAL`); } catch (_) { /* column may already exist */ }

  // Migrate operations statuses: old values → new (only legacy statuses, never touch 'completed')
  try {
    db.exec(`UPDATE operations SET status = 'ordered' WHERE status IN ('active', 'on_hold', 'cancelled')`);
  } catch (_) { /* safe to ignore */ }

  // Seed default document categories
  const defaultCategories = [
    'Quality Statement', 'COA', 'Insurance', 'MSDS', 'PDS',
    'Packing list', 'Halal certificate', 'Kosher certificate',
  ];
  for (const name of defaultCategories) {
    try {
      db.prepare('INSERT OR IGNORE INTO document_categories (name) VALUES (?)').run(name);
    } catch (_) { /* ignore */ }
  }

  // Add payment_due_date to orders (set automatically when status → shipped)
  try { db.exec(`ALTER TABLE orders ADD COLUMN payment_due_date TEXT`); } catch (_) { /* column may already exist */ }
  // Backfill payment_date on paid invoices that are missing it (so they appear in cash flow)
  try {
    db.exec(`
      UPDATE invoices
      SET payment_date = COALESCE(invoice_date, date(created_at))
      WHERE status = 'paid'
        AND payment_date IS NULL
        AND NOT EXISTS (SELECT 1 FROM wire_transfers wt WHERE wt.invoice_id = invoices.id)
    `);
  } catch (_) { /* ignore */ }
  // Add product column to packaging
  try { db.exec(`ALTER TABLE packaging ADD COLUMN product TEXT`); } catch (_) { /* column may already exist */ }

  // Packaging table
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      code TEXT NOT NULL,
      product TEXT,
      product_mass REAL,
      units_per_pallet INTEGER,
      pallet_label_code TEXT,
      weight_per_pallet REAL,
      weight_packaging REAL,
      weight_pallet REAL,
      gross_weight REAL,
      compatible TEXT DEFAULT 'Food',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Remove UNIQUE constraint from packaging.code if it still exists
  try {
    const schema = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='packaging'").get() as any)?.sql || '';
    if (schema.includes('UNIQUE')) {
      db.exec(`
        CREATE TABLE packaging_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          code TEXT NOT NULL,
          product TEXT,
          product_mass REAL,
          units_per_pallet INTEGER,
          pallet_label_code TEXT,
          weight_per_pallet REAL,
          weight_packaging REAL,
          weight_pallet REAL,
          gross_weight REAL,
          compatible TEXT DEFAULT 'Food',
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO packaging_new (id, type, code, product, product_mass, units_per_pallet, pallet_label_code, weight_per_pallet, weight_packaging, weight_pallet, gross_weight, compatible, notes, created_at, updated_at)
          SELECT id, type, code, product, product_mass, units_per_pallet, pallet_label_code, weight_per_pallet, weight_packaging, weight_pallet, gross_weight, compatible, notes, created_at, updated_at FROM packaging;
        DROP TABLE packaging;
        ALTER TABLE packaging_new RENAME TO packaging;
      `);
    }
  } catch (_) { /* already migrated */ }

  // Seed packaging data from official Packaging List (only if table is empty)
  const packagingCount = (db.prepare('SELECT COUNT(*) as c FROM packaging').get() as any).c;
  if (packagingCount === 0) {
    const insertPkg = db.prepare(`
      INSERT INTO packaging (type, code, product, product_mass, units_per_pallet, pallet_label_code, weight_per_pallet, weight_packaging, weight_pallet, gross_weight, compatible)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const pkgData: [string, string, string|null, number|null, number|null, string|null, number|null, number|null, number|null, number|null, string][] = [
      ['0.125l sample bottle',  'SU04', 'ALL',                                      0.125, 8,    'S004',    1,    0.1,  0.4,  2.2,    'Food'],
      ['0.25l sample bottle',   'SU03', 'ALL',                                      0.25,  4,    'S003',    1,    0.2,  0.4,  2.2,    'Food'],
      ['0.5l sample bottle',    'SU02', 'ALL',                                      0.5,   2,    'S002',    1,    0.3,  0.4,  2,      'Food'],
      ['1l sample bottle',      'SU01', 'ALL',                                      1,     1,    'S001',    1,    0.4,  0.4,  1.8,    'Food'],
      ['5l sample bottle',      'SU05', 'ALL',                                      5,     1,    'S005',    5,    1,    1,    7,      'Food'],
      ['15l short blue pails',  'PU18', 'Midas Circulac',                           18,    32,   'PU18032', 576,  2.5,  20,   676,    'Food'],
      ['15l short blue pails',  'PU18', 'Potassium Circulac',                       18,    32,   'PU18032', 576,  2.5,  20,   676,    'Food'],
      ['15l short blue pails',  'PU18', 'Sodium Circulac',                          18,    32,   'PU18032', 576,  2.5,  20,   676,    'Food'],
      ['20kg paper bags',       'BU20', 'Midas Circulac Powder',                    20,    50,   'BU20050', 1000, 0.1,  20,   1025,   'Food'],
      ['20kg paper bags',       'BU20', 'Midas Circulac Powder',                    20,    40,   'BU20040', 800,  0.1,  20,   824,    'Food'],
      ['20kg paper bags',       'BU20', 'Sodium Circulac S100',                     20,    28,   'BU20028', 560,  0.1,  20,   582.8,  'Food'],
      ['25kg cardboard drums',  'CD25', 'Naturlac LF60, Ferrous Naturlac FL2H',     25,    18,   'CD25018', 450,  2,    20,   506,    'Food'],
      ['25kg paper bags',       'BU25', 'Calcium Naturlac CL5H',                    25,    32,   'BU25032', 800,  0.1,  18,   821.2,  'Food'],
      ['25kg paper bags',       'BU25', 'Calcium Naturlac CG5H',                    25,    24,   'BU25024', 600,  0.1,  18,   620.4,  'Food'],
      ['25kg paper bags',       'BU25', 'Midas Circulac Powder',                    25,    40,   'BU25040', 1000, 0.1,  25,   1029,   'Food'],
      ['25kg paper bags',       'BU25', 'Midas Circulac Powder',                    25,    30,   'BU25030', 750,  0.1,  25,   778,    'Food'],
      ['25l blue pails',        'PU25', 'Circulac, Sodium Circulac',                25,    32,   'PU25032', 800,  3,    20,   916,    'Food'],
      ['25l blue pails',        'PU30', 'Circulac',                                 30,    32,   'PU30032', 960,  3,    20,   1076,   'Food'],
      ['25l blue pails',        'PU30', 'Midas Circulac',                           30,    32,   'PU30032', 960,  3,    20,   1076,   'Food'],
      ['25l blue pails',        'PU30', 'Potassium Circulac',                       30,    32,   'PU30032', 960,  3,    20,   1076,   'Food'],
      ['25l blue pails',        'PU30', 'Sodium Circulac',                          30,    32,   'PU30032', 960,  3,    20,   1076,   'Food'],
      ['220l blue drums',       'DU20', 'Ethyl Circulac',                           200,   4,    'DU20004', 800,  10,   20,   860,    'Food'],
      ['220l blue drums',       'DU25', 'Circulac',                                 250,   4,    'DU25004', 1000, 10,   20,   1060,   'Food'],
      ['220l blue drums',       'DU25', 'Midas Circulac',                           250,   4,    'DU25004', 1000, 10,   20,   1060,   'Food'],
      ['220l blue drums',       'DU25', 'Potassium Circulac',                       250,   4,    'DU25004', 1000, 10,   20,   1060,   'Food'],
      ['220l blue drums',       'DU25', 'Sodium Circulac',                          250,   4,    'DU25004', 1000, 10,   20,   1060,   'Food'],
      ['220l blue drums',       'DU27', 'Sodium Circulac',                          275,   4,    'DU27004', 1100, 10,   20,   1160,   'Food'],
      ['1000kg big bags',       'BB10', 'Sodium Circulac S100',                     1000,  1,    'BB10001', 1000, 10,   20,   1030,   'Food'],
      ['IBC',                   'IB10', 'Ethyl Circulac',                           1000,  1,    'IB10001', 1000, 65,   0,    1065,   'Food'],
      ['IBC',                   'IB12', 'Circulac',                                 1200,  1,    'IB12001', 1200, 65,   0,    1265,   'Food'],
      ['IBC',                   'IB13', 'Midas Circulac',                           1300,  1,    'IB13001', 1300, 65,   0,    1365,   'Food'],
      ['IBC',                   'IB13', 'Potassium Circulac',                       1300,  1,    'IB13001', 1300, 65,   0,    1365,   'Food'],
      ['IBC',                   'IB13', 'Sodium Circulac',                          1300,  1,    'IB13001', 1300, 65,   0,    1365,   'Food'],
      ['Bulk',                  'X27K', 'Naturlac',                                 27000, null, null,       27000, null, null, 27000,  'Food'],
    ];
    for (const row of pkgData) insertPkg.run(...row);
  }

  // Add ship_date to operations
  try { db.exec(`ALTER TABLE operations ADD COLUMN ship_date TEXT`); } catch (_) { /* already exists */ }

  // Add ETD / ETA to operations
  try { db.exec(`ALTER TABLE operations ADD COLUMN etd TEXT`); } catch (_) { /* already exists */ }
  try { db.exec(`ALTER TABLE operations ADD COLUMN eta TEXT`); } catch (_) { /* already exists */ }

  // Warehouse stock (from weekly CSV upload)
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouse_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whs TEXT,
      location TEXT,
      principal TEXT,
      article TEXT NOT NULL,
      searchname TEXT,
      description TEXT,
      stock INTEGER DEFAULT 0,
      pc TEXT,
      gross_weight REAL,
      nett_weight REAL,
      uploaded_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.exec(`ALTER TABLE warehouse_stock ADD COLUMN whs TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE warehouse_stock ADD COLUMN location TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE warehouse_stock ADD COLUMN batch_number TEXT`); } catch (_) {}

  // Upload history log for warehouse stock
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouse_stock_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      rows_imported INTEGER NOT NULL,
      filename TEXT,
      uploaded_by TEXT,
      source TEXT DEFAULT 'manual'
    )
  `);
  try { db.exec(`ALTER TABLE warehouse_stock_uploads ADD COLUMN source TEXT DEFAULT 'manual'`); } catch (_) {}

  // Seed admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(
      'admin', hash, 'Administrator', 'admin'
    );
    console.warn('⚠️  Default admin created (admin/admin123) — change this password immediately via Settings.');
  }

  // Login OTP table for 2FA
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // App-wide key-value settings (e.g. backup schedule)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Seed default backup schedule (weekly, Sunday, 02:00 UTC)
  try {
    db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_schedule', '{"frequency":"weekly","day":0,"hour":2,"minute":0}')`).run();
  } catch (_) {}

  // Batches and batch-article links
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_number TEXT UNIQUE NOT NULL,
      production_date TEXT,
      expiry_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_warehouse_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      article TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(batch_id, article)
    )
  `);

  // Add product field to batches (populated from CSV description)
  try { db.exec(`ALTER TABLE batches ADD COLUMN product TEXT`); } catch (_) {}
  // Add category field to batches
  try { db.exec(`ALTER TABLE batches ADD COLUMN category TEXT`); } catch (_) {}
  // Add is_finished field to batches (0 = ongoing, 1 = finished)
  try { db.exec(`ALTER TABLE batches ADD COLUMN is_finished INTEGER NOT NULL DEFAULT 0`); } catch (_) {}

  // Batch documents (COA and other tagged documents per batch)
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL CHECK (document_type IN ('coa', 'other')),
      document_name TEXT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Backfill batches from existing warehouse_stock rows (one-time, idempotent)
  try {
    const stockRows = db.prepare(`
      SELECT DISTINCT batch_number, description
      FROM warehouse_stock
      WHERE batch_number IS NOT NULL AND batch_number != ''
      ORDER BY batch_number
    `).all() as any[];
    for (const row of stockRows) {
      db.prepare(`INSERT OR IGNORE INTO batches (batch_number, product) VALUES (?, ?)`).run(row.batch_number, row.description || null);
      if (row.description) {
        db.prepare(`UPDATE batches SET product = ? WHERE batch_number = ? AND product IS NULL`).run(row.description, row.batch_number);
      }
    }
  } catch (_) {}

  // Performance indexes on frequently queried columns
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_operation_id ON invoices(operation_id)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_operation_number ON orders(operation_number)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_warehouse_stock_article ON warehouse_stock(article)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_warehouse_stock_batch ON warehouse_stock(batch_number)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_batch_documents_batch_id ON batch_documents(batch_id)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_login_otps_user_id ON login_otps(user_id)`); } catch (_) {}

  // Activity log for in-app notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      label TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at)`); } catch (_) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN notifications_last_read_at TEXT`); } catch (_) {}

  // Add invoice_payments table for partial payment installment tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      fx_rate REAL,
      eur_amount REAL,
      payment_date TEXT NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON invoice_payments(invoice_id)`); } catch (_) {}

  // Add remainder_due_date to invoices
  try { db.exec(`ALTER TABLE invoices ADD COLUMN remainder_due_date TEXT`); } catch (_) {}

  // Migrate invoices CHECK constraint to allow new statuses
  // CRITICAL: disable foreign keys to prevent CASCADE DELETE on wire_transfers/invoice_payments
  // Use skipSave=true to avoid persisting intermediate states — only save after full migration
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'").get() as any;
    if (tableInfo?.sql && !tableInfo.sql.includes('paid_with_other')) {
      db.exec(`PRAGMA foreign_keys = OFF`, true);
      db.exec(`
        ALTER TABLE invoices RENAME TO invoices_old;
        CREATE TABLE invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_number TEXT UNIQUE NOT NULL,
          customer_id INTEGER,
          supplier_id INTEGER,
          type TEXT NOT NULL CHECK (type IN ('customer', 'supplier')),
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD',
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled', 'partially_paid', 'paid_with_other')),
          due_date TEXT,
          notes TEXT,
          file_path TEXT,
          file_name TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          invoice_date TEXT,
          payment_date TEXT,
          our_ref TEXT,
          po_number TEXT,
          operation_id INTEGER,
          fx_rate REAL,
          eur_amount REAL,
          remainder_due_date TEXT,
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
          CHECK (
            (type = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR
            (type = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL)
          )
        );
        INSERT INTO invoices SELECT id, invoice_number, customer_id, supplier_id, type, amount, currency, status, due_date, notes, file_path, file_name, created_at, updated_at, invoice_date, payment_date, our_ref, po_number, operation_id, fx_rate, eur_amount, remainder_due_date FROM invoices_old;
        DROP TABLE invoices_old;
      `, true);
      db.exec(`PRAGMA foreign_keys = ON`, true);
      // Only persist AFTER the full migration succeeds atomically
      db.saveToDisk();
    }
  } catch (_) {
    try { db.exec(`PRAGMA foreign_keys = ON`, true); } catch (_) {}
  }

  // Remove ON DELETE CASCADE from wire_transfers — financial records must NEVER be silently deleted
  try {
    const wtInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wire_transfers'").get() as any;
    if (wtInfo?.sql && wtInfo.sql.includes('ON DELETE CASCADE')) {
      console.log('[db] Migrating wire_transfers: removing ON DELETE CASCADE');
      db.exec(`PRAGMA foreign_keys = OFF`, true);
      db.exec(`
        ALTER TABLE wire_transfers RENAME TO wire_transfers_old;
        CREATE TABLE wire_transfers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          transfer_date TEXT NOT NULL,
          bank_reference TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
          approved_by INTEGER,
          approved_at TEXT,
          rejection_reason TEXT,
          file_path TEXT,
          file_name TEXT,
          notes TEXT,
          fx_rate REAL,
          eur_amount REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
          FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO wire_transfers SELECT id, invoice_id, amount, transfer_date, bank_reference, status, approved_by, approved_at, rejection_reason, file_path, file_name, notes, fx_rate, eur_amount, created_at, updated_at FROM wire_transfers_old;
        DROP TABLE wire_transfers_old;
      `, true);
      db.exec(`PRAGMA foreign_keys = ON`, true);
      db.saveToDisk();
      console.log('[db] wire_transfers migration complete — CASCADE removed');
    }
  } catch (err) {
    console.error('[db] wire_transfers CASCADE migration failed:', err);
    try { db.exec(`PRAGMA foreign_keys = ON`, true); } catch (_) {}
  }

  // Remove ON DELETE CASCADE from invoice_payments
  try {
    const ipInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoice_payments'").get() as any;
    if (ipInfo?.sql && ipInfo.sql.includes('ON DELETE CASCADE')) {
      console.log('[db] Migrating invoice_payments: removing ON DELETE CASCADE');
      db.exec(`PRAGMA foreign_keys = OFF`, true);
      db.exec(`
        ALTER TABLE invoice_payments RENAME TO invoice_payments_old;
        CREATE TABLE invoice_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'EUR',
          fx_rate REAL,
          eur_amount REAL,
          payment_date TEXT NOT NULL,
          notes TEXT,
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO invoice_payments SELECT * FROM invoice_payments_old;
        DROP TABLE invoice_payments_old;
      `, true);
      db.exec(`PRAGMA foreign_keys = ON`, true);
      db.saveToDisk();
      console.log('[db] invoice_payments migration complete — CASCADE removed');
    }
  } catch (err) {
    console.error('[db] invoice_payments CASCADE migration failed:', err);
    try { db.exec(`PRAGMA foreign_keys = ON`, true); } catch (_) {}
  }

  // Remove ON DELETE CASCADE from payments table
  try {
    const pInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get() as any;
    if (pInfo?.sql && pInfo.sql.includes('ON DELETE CASCADE')) {
      console.log('[db] Migrating payments: removing ON DELETE CASCADE');
      db.exec(`PRAGMA foreign_keys = OFF`, true);
      db.exec(`
        ALTER TABLE payments RENAME TO payments_old;
        CREATE TABLE payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          payment_date TEXT NOT NULL,
          payment_method TEXT NOT NULL,
          reference TEXT,
          notes TEXT,
          file_path TEXT,
          file_name TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
        );
        INSERT INTO payments SELECT * FROM payments_old;
        DROP TABLE payments_old;
      `, true);
      db.exec(`PRAGMA foreign_keys = ON`, true);
      db.saveToDisk();
      console.log('[db] payments migration complete — CASCADE removed');
    }
  } catch (err) {
    console.error('[db] payments CASCADE migration failed:', err);
    try { db.exec(`PRAGMA foreign_keys = ON`, true); } catch (_) {}
  }

  // Self-healing: recover orphaned wire transfer files that exist on disk but not in DB
  try {
    const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads');
    const wtDir = path.join(uploadsBase, 'wire-transfers');
    if (fs.existsSync(wtDir)) {
      const filesOnDisk = fs.readdirSync(wtDir).filter(f => !f.startsWith('.'));
      const dbFiles = db.prepare('SELECT file_path FROM wire_transfers WHERE file_path IS NOT NULL').all() as any[];
      const dbFileSet = new Set(dbFiles.map((r: any) => r.file_path));

      const orphanedFiles = filesOnDisk.filter(f => !dbFileSet.has(f));
      if (orphanedFiles.length > 0) {
        console.warn(`[db] Found ${orphanedFiles.length} orphaned wire transfer file(s) on disk not in DB:`);
        orphanedFiles.forEach(f => console.warn(`  - ${f}`));
        console.warn('[db] These files may be from wire transfers lost to a previous CASCADE DELETE.');
        console.warn('[db] They are preserved in the wire-transfers folder for manual re-upload.');
      }
    }
  } catch (err) {
    console.error('[db] Wire transfer self-healing check failed:', err);
  }

  // ── Expense invoice tables (shared by Demo Expenses + Sales Activities) ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_upload_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      month TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'demo',
      invoice_count INTEGER NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      uploaded_by INTEGER,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      invoice_id TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      supplier TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      domain TEXT NOT NULL DEFAULT 'demo',
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      month TEXT NOT NULL,
      line_items TEXT,
      embedded_pdf TEXT,
      pdf_filename TEXT,
      xml_filename TEXT,
      duplicate_warning INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (batch_id) REFERENCES demo_upload_batches(id) ON DELETE CASCADE
    )
  `);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_demo_invoices_month ON demo_invoices(month)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_demo_invoices_category ON demo_invoices(category)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_demo_invoices_supplier ON demo_invoices(supplier)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_demo_invoices_batch ON demo_invoices(batch_id)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_demo_invoices_domain ON demo_invoices(domain)`); } catch (_) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_supplier_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_pattern TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL DEFAULT 'demo',
      category TEXT NOT NULL,
      is_user_defined INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migrations: add domain columns to existing tables
  try { db.exec(`ALTER TABLE demo_invoices ADD COLUMN domain TEXT NOT NULL DEFAULT 'demo'`); } catch (_) {}
  try { db.exec(`ALTER TABLE demo_upload_batches ADD COLUMN domain TEXT NOT NULL DEFAULT 'demo'`); } catch (_) {}
  try { db.exec(`ALTER TABLE demo_supplier_mappings ADD COLUMN domain TEXT NOT NULL DEFAULT 'demo'`); } catch (_) {}
  try { db.exec(`ALTER TABLE demo_invoices ADD COLUMN vat_amount REAL NOT NULL DEFAULT 0`); } catch (_) {}
  try { db.exec(`ALTER TABLE demo_supplier_mappings ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`); } catch (_) {}
  try { db.exec(`ALTER TABLE demo_upload_batches ADD COLUMN note TEXT NOT NULL DEFAULT ''`); } catch (_) {}
  try { db.exec(`ALTER TABLE demo_upload_batches ADD COLUMN uploaded_by_name TEXT NOT NULL DEFAULT ''`); } catch (_) {}

  // Custom categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_custom_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'demo',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(name, domain)
    )
  `);

  // Keep old demo_expenses table for backward compat (won't be used by new code)

  // Backfill: derive month from issue_date for invoices that have a date but no month
  try {
    db.prepare(`
      UPDATE demo_invoices SET month = SUBSTR(issue_date, 1, 7)
      WHERE (month IS NULL OR month = '') AND issue_date IS NOT NULL AND issue_date != '' AND LENGTH(issue_date) >= 7
    `).run();
  } catch { /* ignore */ }

  db.saveToDisk();
}

export default db;
