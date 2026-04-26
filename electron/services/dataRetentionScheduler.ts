import type { DatabaseService } from './database';
import { getLogger } from './logger';

const DAY_MS = 86_400_000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Scheduled retention: optional max age for historical rows and exports, plus
 * emergency pruning when the host volume reports low free space.
 * Safe to call on a timer; no-op when nothing matches.
 */
export function runScheduledDataRetention(db: DatabaseService): void {
  const log = getLogger();
  try {
    const retentionDays = parseInt(db.getSystemConfig('data:retentionDays') || '0', 10);
    if (retentionDays > 0) {
      const cutoff = Date.now() - retentionDays * DAY_MS;
      const r = db.pruneHistoricalDataBeforeTimestamp(cutoff);
      if (r.deleted > 0) {
        log.info(`[data retention] Pruned ${r.deleted} historical row(s) older than ${retentionDays} day(s)`);
      }
    }

    const exportDays = parseInt(db.getSystemConfig('data:exportRetentionDays') || '30', 10);
    if (exportDays > 0) {
      const ec = Date.now() - exportDays * DAY_MS;
      const er = db.pruneExportFilesOlderThan(ec);
      if (er.deletedFiles > 0) {
        log.info(
          `[data retention] Removed ${er.deletedFiles} export file(s) older than ${exportDays} day(s), freed ${formatBytes(er.freedBytes)}`
        );
      }
    }

    const summary = db.getDataStorageSummary();
    const auto = (db.getSystemConfig('data:lowDiskAutoPurge') || '1') === '1';
    const threshold = parseFloat(db.getSystemConfig('data:lowDiskFreePctThreshold') || '5');
    if (auto && summary.disk && summary.disk.freePercent <= threshold) {
      const keepDays = Math.max(1, parseInt(db.getSystemConfig('data:lowDiskEmergencyKeepDays') || '14', 10));
      const emerg = Date.now() - keepDays * DAY_MS;
      const r2 = db.pruneHistoricalDataBeforeTimestamp(emerg);
      if (r2.deleted > 0) {
        log.warn(
          `[data retention] Low disk (${summary.disk.freePercent.toFixed(1)}% free under ${summary.disk.path}): removed ${r2.deleted} historical row(s); keeping about the last ${keepDays} day(s)`
        );
      }
      const lr = log.deleteRotatedLogFilesOlderThan(emerg);
      if (lr.deletedFiles > 0) {
        log.warn(`[data retention] Low disk: removed ${lr.deletedFiles} log file(s), freed ${formatBytes(lr.freedBytes)}`);
      }
      const er2 = db.pruneExportFilesOlderThan(emerg);
      if (er2.deletedFiles > 0) {
        log.warn(`[data retention] Low disk: removed ${er2.deletedFiles} export file(s)`);
      }
    }

    db.setSystemConfig('data:lastRetentionRunAt', String(Date.now()));
  } catch (e: unknown) {
    log.error('[data retention] Scheduled run failed:', e instanceof Error ? e.message : String(e));
  }
}
