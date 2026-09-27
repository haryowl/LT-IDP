import { SYSTEM_TELEMETRY_SOURCE_IDS } from './transmissionTelemetry';

/** Large / frequently-emitted system sources that must not flood historical_data. */
export const BULKY_SYSTEM_HISTORY_SOURCE_IDS: readonly string[] = [
  SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_DESC,
  SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_RAW,
];

/** Default history interval for system telemetry (SPARING/MQTT/HTTP counters, etc.). */
export const SYSTEM_TELEMETRY_HISTORY_INTERVAL_MS = 60_000;

export function isBulkySystemHistorySource(sourceId: string | undefined | null): boolean {
  if (!sourceId) return false;
  return BULKY_SYSTEM_HISTORY_SOURCE_IDS.includes(sourceId);
}

/**
 * New mappings: bulky SPARING response text defaults to storeHistory off.
 * Other system sources keep the previous default (on) unless the caller sets false.
 */
export function defaultStoreHistoryForMapping(
  sourceType: string | undefined,
  sourceDeviceId: string | undefined,
  requestedStoreHistory: boolean | undefined
): boolean {
  if (sourceType === 'system' && isBulkySystemHistorySource(sourceDeviceId)) {
    return requestedStoreHistory === true;
  }
  return requestedStoreHistory !== false;
}

/**
 * Interval gate for system historical writes (excluding timestamp / GNSS which have their own).
 * Returns ms, or null when the caller should use another policy.
 */
export function getSystemTelemetryHistoryIntervalMs(
  sourceId: string | undefined
): number | null {
  if (!sourceId) return SYSTEM_TELEMETRY_HISTORY_INTERVAL_MS;
  if (sourceId === 'system-timestamp') return null;
  if (sourceId.startsWith('system-gnss-')) return null;
  return SYSTEM_TELEMETRY_HISTORY_INTERVAL_MS;
}
