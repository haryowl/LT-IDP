import type { DatabaseService } from './database';
import type { Publisher, RealtimeData } from '../types';

export function isScheduledPublishingEnabled(publisher: Publisher | undefined | null): boolean {
  return !!(
    publisher?.scheduledEnabled &&
    publisher.scheduledInterval &&
    publisher.scheduledInterval > 0 &&
    publisher.scheduledIntervalUnit
  );
}

/** Clear setTimeout (initial delay) and setInterval (recurring tick) from the same handle slot. */
export function clearScheduledPublisherTimer(timer?: NodeJS.Timeout): void {
  if (timer === undefined) return;
  clearTimeout(timer);
  clearInterval(timer);
}

export function clearPublisherFlushTimer(flushTimer?: NodeJS.Timeout): void {
  if (flushTimer === undefined) return;
  clearInterval(flushTimer);
}

export interface PublisherTimerHandles {
  flushTimer?: NodeJS.Timeout;
  scheduledTimer?: NodeJS.Timeout;
}

/**
 * Exactly one delivery cadence: scheduled interval OR buffer flush interval, never both.
 * Call after connect, start, or refresh when publisher settings change.
 */
export function syncPublisherDeliveryTimers(
  handles: PublisherTimerHandles,
  publisher: Publisher,
  callbacks: { onFlush: () => void; onScheduledTick: () => void }
): 'scheduled' | 'buffer_flush' | 'none' {
  clearPublisherFlushTimer(handles.flushTimer);
  handles.flushTimer = undefined;
  clearScheduledPublisherTimer(handles.scheduledTimer);
  handles.scheduledTimer = undefined;

  if (isScheduledPublishingEnabled(publisher)) {
    const intervalMs = getScheduledIntervalMs(publisher.scheduledInterval, publisher.scheduledIntervalUnit);
    if (!intervalMs) {
      return 'none';
    }
    const delayMs = msUntilNextScheduledBoundary(intervalMs);
    const run = () => callbacks.onScheduledTick();
    handles.scheduledTimer = setTimeout(() => {
      run();
      handles.scheduledTimer = setInterval(run, intervalMs) as unknown as NodeJS.Timeout;
    }, delayMs) as unknown as NodeJS.Timeout;
    return 'scheduled';
  }

  if ((publisher.mode === 'buffer' || publisher.mode === 'both') && publisher.bufferFlushInterval) {
    handles.flushTimer = setInterval(() => callbacks.onFlush(), publisher.bufferFlushInterval);
    return 'buffer_flush';
  }

  return 'none';
}

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
  // At most one schedule interval per tick (steady cadence when catching up after outages).
  const maxTo = from + intervalMs;
  if (to > maxTo) {
    to = maxTo;
  }
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

/**
 * Compact window batch: latest value per mapping inside [from, to).
 * Full raw sample dumps break MQTT/custom templates when devices poll frequently;
 * scheduled sends must stay snapshot-shaped like realtime mode.
 */
function buildWindowBatch(
  db: DatabaseService,
  publisher: Publisher,
  publisherId: string,
  from: number,
  to: number,
  bucketTs: number,
  effectiveMappingIds: string[]
): RealtimeData[] {
  const latestInWindow = db.getLatestHistoricalDataInRange(from, to, effectiveMappingIds);
  const bufferItems = db.getPendingBufferItemsInWindow(publisherId, from, to, 5000);
  const mappings = db.getParameterMappings();
  const mappingById = new Map(mappings.map((m) => [m.id, m]));
  const latestByMapping = new Map<string, RealtimeData>();

  for (const [mappingId, row] of latestInWindow.entries()) {
    const mapping = mappingById.get(mappingId);
    if (!mapping) continue;
    latestByMapping.set(mappingId, rowToRealtimeData(row, mapping, bucketTs));
  }
  for (const item of bufferItems) {
    const d = item.data as RealtimeData;
    if (!d?.mappingId) continue;
    if (publisher.mappingIds.length > 0 && !publisher.mappingIds.includes(d.mappingId)) continue;
    latestByMapping.set(d.mappingId, {
      ...d,
      timestamp: bucketTs,
    });
  }

  return Array.from(latestByMapping.values()).sort((a, b) =>
    a.mappingName.localeCompare(b.mappingName)
  );
}

/**
 * One batch per scheduled tick, according to publisher mode:
 * - realtime: latest historical value per mapping (global)
 * - buffer: latest value per mapping inside the schedule window
 * - both: window latest-per-mapping if any, otherwise global snapshot
 *
 * Window collection is isolated so a bad/slow history query cannot block the
 * realtime fallback used by mode "both".
 */
export function collectScheduledPublishBatch(
  db: DatabaseService,
  publisher: Publisher,
  publisherId: string,
  window: { from: number; to: number; bucketTs: number },
  effectiveMappingIds: string[]
): RealtimeData[] {
  const mode = (publisher.mode || 'realtime').toLowerCase();
  const { from, to, bucketTs } = window;

  if (mode === 'realtime') {
    return buildSnapshotBatch(db, effectiveMappingIds, bucketTs);
  }

  let windowBatch: RealtimeData[] = [];
  try {
    windowBatch = buildWindowBatch(db, publisher, publisherId, from, to, bucketTs, effectiveMappingIds);
  } catch {
    windowBatch = [];
  }

  if (mode === 'buffer') {
    return windowBatch;
  }

  // both (default for unknown modes): prefer window values, else live snapshot
  if (windowBatch.length > 0) return windowBatch;
  return buildSnapshotBatch(db, effectiveMappingIds, bucketTs);
}
