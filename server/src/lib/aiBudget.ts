/**
 * Monthly spending limit for AI invoice reading (uploads and the full check),
 * set on the Settings page. Spend = this calendar month's ai_usage plus the
 * estimate of batches still out with Anthropic.
 */
import db from '../database.js';

export const DEFAULT_MONTHLY_LIMIT_USD = 10;

export class AiBudgetError extends Error {
  constructor() { super('The monthly AI spending limit is reached — raise it in Settings'); }
}

export function getAiMonthlyLimit(): number {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ai_monthly_limit_usd'").get() as any;
    const n = row ? Number(JSON.parse(row.value)) : NaN;
    return isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_LIMIT_USD;
  } catch {
    return DEFAULT_MONTHLY_LIMIT_USD;
  }
}

export function setAiMonthlyLimit(usd: number): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('ai_monthly_limit_usd', ?, datetime('now'))")
    .run(JSON.stringify(Math.round(usd * 100) / 100));
}

/** Spent this month (UTC), including batches still being processed (at their estimate). */
export function aiSpentThisMonth(): number {
  const used = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as usd FROM ai_usage WHERE at >= datetime('now', 'start of month')").get() as any;
  const pending = db.prepare("SELECT COALESCE(SUM(estimated_usd), 0) as usd FROM invoice_read_batches WHERE status = 'in_progress'").get() as any;
  return (used?.usd || 0) + (pending?.usd || 0);
}

export function aiBudgetLeft(): number {
  return Math.max(0, getAiMonthlyLimit() - aiSpentThisMonth());
}

/** Throw before a call that would go over the limit. */
export function assertAiBudget(estimatedUsd: number): void {
  if (aiBudgetLeft() < estimatedUsd) throw new AiBudgetError();
}
