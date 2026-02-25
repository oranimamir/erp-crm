import { Router } from 'express';
import db from '../database.js';

const router = Router();

// GET / — list with pagination, search, filter
router.get('/', (req, res) => {
  const { page = '1', limit = '50', search = '', compatible = '' } = req.query as Record<string, string>;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params: any[] = [];

  if (search) {
    where += ' AND (type LIKE ? OR code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (compatible) {
    where += ' AND compatible = ?';
    params.push(compatible);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM packaging WHERE ${where}`).get(...params) as any).count;
  const data = db.prepare(`SELECT * FROM packaging WHERE ${where} ORDER BY type ASC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

  res.json({ data, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
});

// POST / — create
router.post('/', (req, res) => {
  const { type, code, product_mass, units_per_pallet, pallet_label_code, weight_per_pallet, weight_packaging, weight_pallet, gross_weight, compatible = 'Food', notes = '' } = req.body;
  if (!type?.trim() || !code?.trim()) {
    res.status(400).json({ error: 'Type and Code are required' });
    return;
  }
  try {
    const result = db.prepare(`
      INSERT INTO packaging (type, code, product_mass, units_per_pallet, pallet_label_code, weight_per_pallet, weight_packaging, weight_pallet, gross_weight, compatible, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(type.trim(), code.trim(), product_mass ?? null, units_per_pallet ?? null, pallet_label_code ?? null, weight_per_pallet ?? null, weight_packaging ?? null, weight_pallet ?? null, gross_weight ?? null, compatible, notes);
    const row = db.prepare('SELECT * FROM packaging WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(400).json({ error: 'Packaging code already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// PUT /:id — update
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM packaging WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Packaging not found' }); return; }
  const { type, code, product_mass, units_per_pallet, pallet_label_code, weight_per_pallet, weight_packaging, weight_pallet, gross_weight, compatible, notes } = req.body;
  if (!type?.trim() || !code?.trim()) {
    res.status(400).json({ error: 'Type and Code are required' });
    return;
  }
  try {
    db.prepare(`
      UPDATE packaging SET type=?, code=?, product_mass=?, units_per_pallet=?, pallet_label_code=?, weight_per_pallet=?, weight_packaging=?, weight_pallet=?, gross_weight=?, compatible=?, notes=?, updated_at=datetime('now') WHERE id=?
    `).run(type.trim(), code.trim(), product_mass ?? null, units_per_pallet ?? null, pallet_label_code ?? null, weight_per_pallet ?? null, weight_packaging ?? null, weight_pallet ?? null, gross_weight ?? null, compatible ?? 'Food', notes ?? null, req.params.id);
    res.json(db.prepare('SELECT * FROM packaging WHERE id = ?').get(req.params.id));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(400).json({ error: 'Packaging code already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM packaging WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Packaging not found' }); return; }
  db.prepare('DELETE FROM packaging WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
