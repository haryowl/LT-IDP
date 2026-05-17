import type { DatabaseService } from './database';
import type { Publisher, RealtimeData } from '../types';

export function getScheduledIntervalMs(
  interval?: number,
  unit?: 'seconds' | 'minutes' | 'hours'
): number | null {
  if (!interval || interval <= 0 || !unit) return null;
  switch (unit) {
    case 'seconds':
      return interval * 1000;
    case 'minutes':
      return interval * 60 * 1000;
    case 'hours':
      return interval * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Next aligned window [from, to) where `to` is an epoch-aligned boundary strictly after `from`.
 * Payload bucket timestamp = `to` (exclusive end of the window).
 */
export function computeScheduledPublishWindow(
  db: DatabaseService,
  publisherId: string,
  intervalMs: number
): { from: number; to: number; bucketTs: number } | null {
  if (intervalMs <= 0) return null;
  const now = Date.now();
  let to = Math.ceil(now / intervalMs) * intervalMs;
  const cursor = db.getScheduledPublishCursor(publisherId);
  const from = cursor !== undefined ? cursor : to - intervalMs;
  while (to <= from) {
    to += intervalMs;
  }
  return { from, to, bucketTs: to };
}

/** Delay until the next epoch-aligned boundary (e.g. next 5-minute mark). */
export function msUntilNextScheduledBoundary(intervalMs: number): number {
  const now = Date.now();
  const next = Math.ceil(now / intervalMs) * intervalMs;
  const delay = next - now;
  return delay <= 0 ? intervalMs : delay;
}

function rowToRealtimeData(
  row: { mappingId: string; value: unknown; quality: string; timestamp?: number },
  mapping: { mappedName: string; parameterId?: string; unit?: string },
  timestamp: number
): RealtimeData {
  return {
    mappingId: row.mappingId,
    mappingName: mapping.mappedName,
    parameterId: mapping.parameterId,
    value: row.value,
    unit: mapping.unit,
    timestamp,
    quality: row.quality as RealtimeData['quality'],
  };
}

function buildSnapshotBatch(
  db: DatabaseService,
  effectiveMappingIds: string[],
  bucketTs: number
): RealtimeData[] {
  const latestByMapping = db.getLatestHistoricalDataForMappings(effectiveMappingIds);
  if (latestByMapping.size === 0) return [];

  const mappings = db.getParameterMappings();
  const mappingById = new Map(mappings.map((m) => [m.id, m]));
  const batch: RealtimeData[] = [];

  for (const [mappingId, row] of latestByMapping.entries()) {
    const m = mappingById.get(mappingId);
    if (!m) continue;
    batch.push(rowToRealtimeData(row, m, bucketTs));
  }
  batch.sort((a, b) => a.mappingName.localeCompare(b.mappingName));
  return batch;
}

function buildWindowBatch(
  db: DatabaseService,
  publisher: Publisher,
  publisherId: string,
  from: number,
  to: number,
  bucketTs: number,
  effectiveMappingIds: string[]
): RealtimeData[] {
  const historicalRows = db.queryHistoricalData(from, Math.max(from, to - 1), effectiveMappingIds);
  const bufferItems = db.getPendingBufferItemsInWindow(publisherId, from, to, 5000);
  const mappings = db.getParameterMappings();
  const mappingById = new Map(mappings.map((m) => [m.id, m]));
  const batch: RealtimeData[] = [];

  for (const row of historicalRows) {
    const mapping = mappingById.get(row.mappingId);
    if (!mapping) continue;
    batch.push(rowToRealtimeData(row, mapping, row.timestamp));
  }
  for (const item of bufferItems) {
    const d = item.data as RealtimeData;
    if (publisher.mappingIds.length > 0 && !publisher.mappingIds.includes(d.mappingId)) continue;
    batch.push(d);
  }

  const seen = new Set<string>();
  const deduped: RealtimeData[] = [];
  for (const d of batch) {
    const key = `${d.mappingId}|${d.timestamp}|${JSON.stringify(d.value)}|${d.quality}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(d);
  }

  deduped.forEach((d) => {
    d.timestamp = bucketTs;
  });
  deduped.sort((a, b) => a.timestamp - b.timestamp);
  return deduped;
}

/**
 * One batch per scheduled tick, according to publisher mode:
 * - realtime: latest historical value per mapping
 * - buffer: all rows in the schedule window (historical + pending buffer queue)
 * - both: window rows if any, otherwise latest snapshot
 */
export function collectScheduledPublishBatch(
  db: DatabaseService,
  publisher: Publisher,
  publisherId: string,
  window: { from: number; to: number; bucketTs: number },
  effectiveMappingIds: string[]
): RealtimeData[] {
  const mode = publisher.mode || 'realtime';
  const { from, to, bucketTs } = window;

  if (mode === 'realtime') {
    return buildSnapshotBatch(db, effectiveMappingIds, bucketTs);
  }
  if (mode === 'buffer') {
    return buildWindowBatch(db, publisher, publisherId, from, to, bucketTs, effectiveMappingIds);
  }
  const windowBatch = buildWindowBatch(db, publisher, publisherId, from, to, bucketTs, effectiveMappingIds);
  if (windowBatch.length > 0) return windowBatch;
  return buildSnapshotBatch(db, effectiveMappingIds, bucketTs);
}
