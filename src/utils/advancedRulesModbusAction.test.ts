import { describe, expect, it, vi } from 'vitest';
import { AdvancedRulesService } from '../../electron/services/advancedRulesService';

describe('advanced rules modbus write action', () => {
  it('toggles while true and stops on false', async () => {
    vi.useFakeTimers();

    const calls: any[] = [];
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };
    const db: any = {
      getAdvancedRules: () => [
        {
          id: 'r1',
          name: 'ToggleRule',
          enabled: true,
          expression: 'value(\"x\")',
          inputs: ['x'],
          snapshotMappingIds: [],
          cooldownSeconds: 0,
          reTriggerMode: 'edge_only',
          reTriggerIntervalSeconds: 60,
          timerIntervalSeconds: undefined,
          actions: {
            modbusWrite: {
              enabled: true,
              deviceId: 'dev1',
              registerId: 'reg1',
              mode: 'toggle_interval',
              valueTrue: true,
              valueFalse: false,
              intervalSeconds: 1,
              writeFalseOnStop: true,
            },
          },
          lastTriggeredAt: undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      insertAdvancedRuleEvent: (evt: any) => ({ id: `e${Math.random()}`, ...evt }),
      updateAdvancedRule: () => {},
      getAdvancedRuleById: () => undefined,
    };

    const svc = new AdvancedRulesService(db, {
      dataDir: '.',
      modbusWrite: async (p) => {
        calls.push(p);
      },
    });

    svc.onRealtimeData({ mappingId: 'x', mappingName: 'x', timestamp: Date.now(), quality: 'good', value: 1 });
    await flush();
    expect(calls[0]).toMatchObject({ deviceId: 'dev1', registerId: 'reg1', value: true });

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(calls[1]).toMatchObject({ value: false });

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(calls[2]).toMatchObject({ value: true });

    svc.onRealtimeData({ mappingId: 'x', mappingName: 'x', timestamp: Date.now(), quality: 'good', value: 0 });
    await flush();

    const before = calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls.length).toBe(before);

    vi.useRealTimers();
  });
});

