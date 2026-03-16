import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

const CATEGORIES = [
  'Overhead', 'Demo Consumables', 'Demo Equipment', 'Demo Maintenance',
  'Demo Materials', 'Cars', 'Regulation', 'Salaries', 'Couriers', 'Other',
];

// GET /api/demo-expenses — list all expenses with optional filters
router.get('/', (req: Request, res: Response) => {
  try {
    const { category, supplier, month_from, month_to } = req.query;
    let sql = 'SELECT * FROM demo_expenses WHERE 1=1';
    const params: any[] = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (supplier) {
      sql += ' AND supplier = ?';
      params.push(supplier);
    }
    if (month_from) {
      sql += ' AND month >= ?';
      params.push(month_from);
    }
    if (month_to) {
      sql += ' AND month <= ?';
      params.push(month_to);
    }

    sql += ' ORDER BY month DESC, supplier ASC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[demo-expenses] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch demo expenses' });
  }
});

// GET /api/demo-expenses/summary — aggregated data for charts
router.get('/summary', (req: Request, res: Response) => {
  try {
    const { category, supplier, month_from, month_to } = req.query;
    let where = '1=1';
    const params: any[] = [];

    if (category) { where += ' AND category = ?'; params.push(category); }
    if (supplier) { where += ' AND supplier = ?'; params.push(supplier); }
    if (month_from) { where += ' AND month >= ?'; params.push(month_from); }
    if (month_to) { where += ' AND month <= ?'; params.push(month_to); }

    // Total per category
    const byCategory = db.prepare(
      `SELECT category, SUM(amount) as total FROM demo_expenses WHERE ${where} GROUP BY category ORDER BY total DESC`
    ).all(...params);

    // Total per supplier
    const bySupplier = db.prepare(
      `SELECT supplier, SUM(amount) as total FROM demo_expenses WHERE ${where} GROUP BY supplier ORDER BY total DESC`
    ).all(...params);

    // Monthly breakdown by category (for stacked chart)
    const monthlyByCategory = db.prepare(
      `SELECT month, category, SUM(amount) as total FROM demo_expenses WHERE ${where} GROUP BY month, category ORDER BY month ASC`
    ).all(...params);

    // Available months
    const months = db.prepare(
      'SELECT DISTINCT month FROM demo_expenses ORDER BY month ASC'
    ).all();

    // Available suppliers
    const suppliers = db.prepare(
      'SELECT DISTINCT supplier FROM demo_expenses ORDER BY supplier ASC'
    ).all();

    res.json({
      by_category: byCategory,
      by_supplier: bySupplier,
      monthly_by_category: monthlyByCategory,
      months: months.map((m: any) => m.month),
      suppliers: suppliers.map((s: any) => s.supplier),
      categories: CATEGORIES,
    });
  } catch (err: any) {
    console.error('[demo-expenses] summary error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// POST /api/demo-expenses/upload — bulk upsert from parsed Excel data
router.post('/upload', (req: Request, res: Response) => {
  try {
    const { month, expenses } = req.body;
    if (!month || !expenses || !Array.isArray(expenses)) {
      res.status(400).json({ error: 'month and expenses[] required' });
      return;
    }

    // Validate month format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: 'Month must be in YYYY-MM format' });
      return;
    }

    const userId = (req as any).user?.userId;

    // Delete existing data for this month, then insert new
    const doUpload = db.transaction(() => {
      db.prepare('DELETE FROM demo_expenses WHERE month = ?').run(month);

      const insert = db.prepare(
        'INSERT INTO demo_expenses (supplier, category, amount, month, created_by) VALUES (?, ?, ?, ?, ?)'
      );

      let count = 0;
      for (const row of expenses) {
        const supplier = (row.supplier || '').toString().trim();
        if (!supplier) continue;

        for (const cat of CATEGORIES) {
          const amount = parseFloat(row[cat]) || 0;
          if (amount !== 0) {
            insert.run(supplier, cat, amount, month, userId);
            count++;
          }
        }
      }
      return count;
    });

    const count = doUpload();
    db.saveToDisk();
    res.json({ success: true, records: count, month });
  } catch (err: any) {
    console.error('[demo-expenses] upload error:', err);
    res.status(500).json({ error: 'Failed to upload expenses' });
  }
});

// DELETE /api/demo-expenses/month/:month — delete all expenses for a month
router.delete('/month/:month', (req: Request, res: Response) => {
  try {
    const { month } = req.params;
    const result = db.prepare('DELETE FROM demo_expenses WHERE month = ?').run(month);
    db.saveToDisk();
    res.json({ success: true, deleted: result.changes });
  } catch (err: any) {
    console.error('[demo-expenses] delete error:', err);
    res.status(500).json({ error: 'Failed to delete expenses' });
  }
});

export default router;
