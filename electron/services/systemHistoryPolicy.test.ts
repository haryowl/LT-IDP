import { describe, expect, it } from 'vitest';
import {
  BULKY_SYSTEM_HISTORY_SOURCE_IDS,
  defaultStoreHistoryForMapping,
  getSystemTelemetryHistoryIntervalMs,
  isBulkySystemHistorySource,
  SYSTEM_TELEMETRY_HISTORY_INTERVAL_MS,
} from './systemHistoryPolicy';
import { SYSTEM_TELEMETRY_SOURCE_IDS } from './transmissionTelemetry';

describe('systemHistoryPolicy', () => {
  it('flags SPARING response desc/raw as bulky', () => {
    expect(isBulkySystemHistorySource(SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_RAW)).toBe(true);
    expect(isBulkySystemHistorySource(SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_DESC)).toBe(true);
    expect(isBulkySystemHistorySource(SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_SUCCESS)).toBe(false);
    expect(BULKY_SYSTEM_HISTORY_SOURCE_IDS).toHaveLength(2);
  });

  it('defaults storeHistory off for bulky system sources unless explicitly enabled', () => {
    expect(
      defaultStoreHistoryForMapping('system', SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_RAW, undefined)
    ).toBe(false);
    expect(
      defaultStoreHistoryForMapping('system', SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_RAW, false)
    ).toBe(false);
    expect(
      defaultStoreHistoryForMapping('system', SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_RAW, true)
    ).toBe(true);
    expect(defaultStoreHistoryForMapping('system', 'system-timestamp', undefined)).toBe(true);
    expect(defaultStoreHistoryForMapping('modbus', 'dev-1', undefined)).toBe(true);
    expect(defaultStoreHistoryForMapping('modbus', 'dev-1', false)).toBe(false);
  });

  it('rate-limits system telemetry history to 60s (not timestamp/gnss)', () => {
    expect(getSystemTelemetryHistoryIntervalMs(SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_RESPONSE_RAW)).toBe(
      SYSTEM_TELEMETRY_HISTORY_INTERVAL_MS
    );
    expect(getSystemTelemetryHistoryIntervalMs(SYSTEM_TELEMETRY_SOURCE_IDS.MQTT_SUCCESS)).toBe(
      SYSTEM_TELEMETRY_HISTORY_INTERVAL_MS
    );
    expect(getSystemTelemetryHistoryIntervalMs('system-timestamp')).toBeNull();
    expect(getSystemTelemetryHistoryIntervalMs('system-gnss-latitude')).toBeNull();
  });
});
