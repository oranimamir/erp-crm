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
    const data = this.sqlDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }

  exec(sql: string) {
    this.sqlDb.run(sql);
    this.scheduleSave();
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
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
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
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
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
      `);
    }
  } catch (_) { /* table may not exist yet */ }

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

  // Migrate operations statuses: old values → new (ordered/shipped/delivered)
  try {
    db.exec(`UPDATE operations SET status = 'ordered'   WHERE status IN ('active', 'on_hold', 'cancelled')`);
    db.exec(`UPDATE operations SET status = 'delivered' WHERE status = 'completed'`);
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

  // Packaging table
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
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

  // Seed packaging types from Packaging RG sheet (only if empty)
  const packagingCount = (db.prepare('SELECT COUNT(*) as c FROM packaging').get() as any).c;
  if (packagingCount === 0) {
    const insertPkg = db.prepare(`
      INSERT OR IGNORE INTO packaging (type, code, product_mass, units_per_pallet, pallet_label_code, weight_per_pallet, weight_packaging, weight_pallet, gross_weight, compatible)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const pkgData = [
      ['0.125l sample bottle',   'SU04', 0.125,   8,  'S004',    1,    0.1,  0.4,    2.2,   'Food'],
      ['0.25l sample bottle',    'SU03', 0.25,    4,  'S003',    1,    0.2,  0.4,    2.2,   'Food'],
      ['0.5l sample bottle',     'SU02', 0.5,     2,  'S002',    1,    0.3,  0.4,    2.0,   'Food'],
      ['1l sample bottle',       'SU01', 1,       1,  'S001',    1,    0.4,  0.4,    1.8,   'Food'],
      ['5l sample bottle',       'SU05', 5,       1,  'S005',    5,    1.0,  1.0,    7.0,   'Food'],
      ['15l short blue pails',   'PU18', 18,     32,  'PU18032', 576,  2.5,  20,   676.0,  'Food'],
      ['20kg paper bags',        'BU20', 20,     40,  'BU20040', 800,  0.1,  20,   824.0,  'Food'],
      ['25kg cardboard drums',   'CD25', 25,     18,  'CD25018', 450,  2.0,  20,   506.0,  'Food'],
      ['25kg paper bags',        'BU25', 25,     30,  'BU25030', 750,  0.1,  25,   778.0,  'Food'],
      ['25l blue pails',         'PU25', 25,     32,  'PU25032', 800,  3.0,  20,   916.0,  'Food'],
      ['30l blue pails',         'PU30', 30,     32,  'PU30032', 960,  3.0,  20,  1076.0,  'Food'],
      ['200l drums',             'DU20', 200,     4,  'DU20004', 800,  10.0, 20,   860.0,  'Food'],
      ['220l blue drums',        'DU25', 250,     4,  'DU25004',1000,  10.0, 20,  1060.0,  'Food'],
      ['275l drums',             'DU27', 275,     4,  'DU27004',1100,  10.0, 20,  1160.0,  'Food'],
      ['1000kg big bags',        'BB10',1000,     1,  'IB10001',1000,  65.0,  0,  1065.0,  'Food'],
      ['IBC',                    'IBC', 1000,     1,  'IB12001',1000,  65.0,  0,  1065.0,  'Food'],
      ['Bulk tanker',            'BULK',27000,  null,  null,   27000,  null,  null, 27000,  'Food'],
    ];
    for (const row of pkgData) insertPkg.run(...row);
  }

  // Seed admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(
      'admin', hash, 'Administrator', 'admin'
    );
    console.log('Default admin user created (admin/admin123)');
  }

  db.saveToDisk();
}

export default db;
