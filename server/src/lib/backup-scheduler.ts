import cron from 'node-cron';
import { runScheduledBackup } from './backup.js';

export interface BackupSchedule {
  frequency: 'daily' | 'weekly' | 'monthly';
  day: number;   // weekly: 0-6 (Sun=0); monthly: 1-28; ignored for daily
  hour: number;  // 0-23
  minute: number; // 0-59
}

export function buildCronExpr(s: BackupSchedule): string {
  if (s.frequency === 'daily')   return `${s.minute} ${s.hour} * * *`;
  if (s.frequency === 'weekly')  return `${s.minute} ${s.hour} * * ${s.day}`;
  if (s.frequency === 'monthly') return `${s.minute} ${s.hour} ${s.day} * *`;
  return `0 2 * * 0`; // fallback
}

let task: cron.ScheduledTask | null = null;

export function startBackupScheduler(expression: string) {
  if (task) { task.stop(); task = null; }
  if (!cron.validate(expression)) {
    console.error(`[Backup] Invalid cron expression: ${expression} — using default`);
    expression = '0 2 * * 0';
  }
  task = cron.schedule(expression, () => {
    runScheduledBackup().catch(err => console.error('[Backup]', err));
  });
  console.log(`[Backup] Scheduled: ${expression}`);
}
