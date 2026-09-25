import db from '../database.js';

/**
 * A customer invoice still marked 'sent' once its due date has passed is
 * overdue. The dashboard already treats it that way (it reads due_date), so
 * the stored status is brought in line — otherwise the invoice list shows it
 * as "Sent" and its Overdue filter misses it.
 */
export function markOverdueInvoices(): number {
  const rows = db.prepare(`
    SELECT id FROM invoices
    WHERE type = 'customer' AND status = 'sent'
      AND due_date IS NOT NULL AND due_date < date('now')
  `).all() as Array<{ id: number }>;
  // And the other way: a due date moved into the future means it isn't overdue
  const back = db.prepare(`
    SELECT id FROM invoices
    WHERE type = 'customer' AND status = 'overdue'
      AND due_date IS NOT NULL AND due_date >= date('now')
  `).all() as Array<{ id: number }>;
  for (const { id } of back) {
    db.prepare(`UPDATE invoices SET status = 'sent', updated_at = datetime('now') WHERE id = ?`).run(id);
  }
  if (!rows.length) {
    if (back.length) db.saveToDisk();
    return 0;
  }

  const update = db.prepare(`UPDATE invoices SET status = 'overdue', updated_at = datetime('now') WHERE id = ?`);
  const history = db.prepare(
    `INSERT INTO status_history (entity_type, entity_id, old_status, new_status, notes) VALUES ('invoice', ?, 'sent', 'overdue', 'Past its due date')`
  );
  for (const { id } of rows) {
    update.run(id);
    try { history.run(id); } catch { /* history is best effort */ }
  }
  db.saveToDisk();
  return rows.length;
}
