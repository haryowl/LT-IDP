import { describe, expect, it, vi } from 'vitest';
import { collectScheduledPublishBatch } from './scheduledPublisherHelpers';
import type { Publisher } from '../types';

function makePublisher(mode: Publisher['mode']): Publisher {
  return {
    id: 'pub-1',
    name: 'Test',
    type: 'mqtt',
    enabled: true,
    autoStart: false,
    mode,
    jsonFormat: 'simple',
    mqttBroker: 'localhost',
    mqttPort: 1883,
    mqttTopic: 'test',
    mqttQos: 0,
    bufferSize: 100,
    bufferFlushInterval: 5000,
    retryAttempts: 3,
    retryDelay: 1000,
    mappingIds: ['m1'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('collectScheduledPublishBatch', () => {
  const window = { from: 1_000, to: 2_000, bucketTs: 2_000 };

  it('realtime uses global latest snapshot', () => {
    const db = {
      getLatestHistoricalDataForMappings: vi.fn(() =>
        new Map([
          [
            'm1',
            { id: 'h1', mappingId: 'm1', timestamp: 1500, value: 42, quality: 'good' },
          ],
        ])
      ),
      getParameterMappings: vi.fn(() => [
        { id: 'm1', mappedName: 'Temp', parameterId: 'p1', unit: 'C' },
      ]),
      getLatestHistoricalDataInRange: vi.fn(),
      getPendingBufferItemsInWindow: vi.fn(),
    } as any;

    const batch = collectScheduledPublishBatch(db, makePublisher('realtime'), 'pub-1', window, ['m1']);
    expect(batch).toHaveLength(1);
    expect(batch[0].value).toBe(42);
    expect(batch[0].timestamp).toBe(2000);
    expect(db.getLatestHistoricalDataInRange).not.toHaveBeenCalled();
  });

  it('both falls back to snapshot when window is empty', () => {
    const db = {
      getLatestHistoricalDataForMappings: vi.fn(() =>
        new Map([
          [
            'm1',
            { id: 'h1', mappingId: 'm1', timestamp: 9000, value: 99, quality: 'good' },
          ],
        ])
      ),
      getParameterMappings: vi.fn(() => [
        { id: 'm1', mappedName: 'Temp', parameterId: 'p1', unit: 'C' },
      ]),
      getLatestHistoricalDataInRange: vi.fn(() => new Map()),
      getPendingBufferItemsInWindow: vi.fn(() => []),
    } as any;

    const batch = collectScheduledPublishBatch(db, makePublisher('both'), 'pub-1', window, ['m1']);
    expect(batch).toHaveLength(1);
    expect(batch[0].value).toBe(99);
  });

  it('both uses compact latest-per-mapping from the window when present', () => {
    const db = {
      getLatestHistoricalDataForMappings: vi.fn(),
      getParameterMappings: vi.fn(() => [
        { id: 'm1', mappedName: 'Temp', parameterId: 'p1', unit: 'C' },
      ]),
      getLatestHistoricalDataInRange: vi.fn(() =>
        new Map([
          [
            'm1',
            { id: 'h2', mappingId: 'm1', timestamp: 1800, value: 7, quality: 'good' },
          ],
        ])
      ),
      getPendingBufferItemsInWindow: vi.fn(() => []),
    } as any;

    const batch = collectScheduledPublishBatch(db, makePublisher('both'), 'pub-1', window, ['m1']);
    expect(batch).toHaveLength(1);
    expect(batch[0].value).toBe(7);
    expect(batch[0].timestamp).toBe(2000);
    expect(db.getLatestHistoricalDataForMappings).not.toHaveBeenCalled();
  });

  it('both falls back to snapshot if window query throws', () => {
    const db = {
      getLatestHistoricalDataForMappings: vi.fn(() =>
        new Map([
          [
            'm1',
            { id: 'h1', mappingId: 'm1', timestamp: 9000, value: 11, quality: 'good' },
          ],
        ])
      ),
      getParameterMappings: vi.fn(() => [
        { id: 'm1', mappedName: 'Temp', parameterId: 'p1', unit: 'C' },
      ]),
      getLatestHistoricalDataInRange: vi.fn(() => {
        throw new Error('db busy');
      }),
      getPendingBufferItemsInWindow: vi.fn(() => []),
    } as any;

    const batch = collectScheduledPublishBatch(db, makePublisher('both'), 'pub-1', window, ['m1']);
    expect(batch).toHaveLength(1);
    expect(batch[0].value).toBe(11);
  });

  it('buffer returns empty when window has no data (no snapshot fallback)', () => {
    const db = {
      getLatestHistoricalDataForMappings: vi.fn(),
      getParameterMappings: vi.fn(() => [
        { id: 'm1', mappedName: 'Temp', parameterId: 'p1', unit: 'C' },
      ]),
      getLatestHistoricalDataInRange: vi.fn(() => new Map()),
      getPendingBufferItemsInWindow: vi.fn(() => []),
    } as any;

    const batch = collectScheduledPublishBatch(db, makePublisher('buffer'), 'pub-1', window, ['m1']);
    expect(batch).toHaveLength(0);
    expect(db.getLatestHistoricalDataForMappings).not.toHaveBeenCalled();
  });
});
