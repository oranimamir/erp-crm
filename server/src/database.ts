import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'erp.db');
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

  // Add invoice_date and payment_date columns to invoices
  try { db.exec(`ALTER TABLE invoices ADD COLUMN invoice_date TEXT`); } catch (_) { /* column may already exist */ }
  try { db.exec(`ALTER TABLE invoices ADD COLUMN payment_date TEXT`); } catch (_) { /* column may already exist */ }

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
