import { EventEmitter } from 'events';
import type { DatabaseService } from './database';
import type {
  HistoricalData,
  RealtimeData,
  ThresholdPublishRule,
  ThresholdSnapshotItem,
  ThresholdTriggerContext,
  ThresholdWatchItem,
} from '../types';
import { HttpClientService } from './httpClient';
import { getLogger } from './logger';

type ThresholdState = 'normal' | 'out_of_range' | 'stale';

export type ConnectionStatusItem = {
  deviceId: string;
  deviceName: string;
  type: 'modbus' | 'mqtt';
  connected: boolean;
};

export class ThresholdPublishService extends EventEmitter {
  private rules = new Map<string, ThresholdPublishRule>();
  private latestValues = new Map<string, RealtimeData>();
  private thresholdStates = new Map<string, ThresholdState>();
  /** When a watched device became disconnected (for disconnectedSeconds delay). */
  private firstDisconnectedAt = new Map<string, number>();
  private periodicCheckIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs = 10_000;

  constructor(
    private db: DatabaseService,
    private httpClientService: HttpClientService,
    private getConnectionStatus?: () => ConnectionStatusItem[]
  ) {
    super();
    this.reloadRules();
  }

  startPeriodicCheck(): void {
    if (this.periodicCheckIntervalId != null) return;
    this.periodicCheckIntervalId = setInterval(() => {
      this.checkStaleAndConnection().catch((err: any) => {
        getLogger().error('Threshold periodic check error:', err?.message ?? err);
      });
    }, this.checkIntervalMs);
    getLogger().info('Threshold publish periodic check started (stale/connection)');
  }

  stopPeriodicCheck(): void {
    if (this.periodicCheckIntervalId != null) {
      clearInterval(this.periodicCheckIntervalId);
      this.periodicCheckIntervalId = null;
    }
  }

  reloadRules(): void {
    this.rules = new Map(
      this.db.getThresholdPublishRules().map((rule) => [rule.id, rule])
    );
  }

  private async checkStaleAndConnection(): Promise<void> {
    const now = Date.now();
    const mappingLookup = new Map(
      this.db.getParameterMappings().map((m) => [m.id, m])
    );
    const connectionStatus = this.getConnectionStatus?.() ?? [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      const cooldownMs = Math.max(0, rule.cooldownSeconds || 0) * 1000;
      const inCooldown = cooldownMs > 0 && rule.lastTriggeredAt != null && now - rule.lastTriggeredAt < cooldownMs;

      for (const watch of rule.watchedMappings) {
        const staleSeconds = watch.staleSeconds;
        if (staleSeconds == null || staleSeconds <= 0) continue;

        const stateKey = `${rule.id}:${watch.mappingId}`;
        const lastData = this.latestValues.get(watch.mappingId);
        if (!lastData) continue;
        const ageMs = now - lastData.timestamp;
        const isStale = ageMs > staleSeconds * 1000;
        const prevState = this.thresholdStates.get(stateKey) || 'normal';

        if (isStale && prevState !== 'stale') {
          this.thresholdStates.set(stateKey, 'stale');
          if (!inCooldown) {
            const mapping = mappingLookup.get(watch.mappingId);
            const trigger: ThresholdTriggerContext = {
              mappingId: watch.mappingId,
              mappingName: lastData.mappingName,
              parameterId: lastData.parameterId,
              value: lastData.value,
              numericValue: Number.isFinite(Number(lastData.value)) ? Number(lastData.value) : undefined,
              breach: 'stale_data',
              unit: lastData.unit,
              quality: lastData.quality,
              timestamp: lastData.timestamp,
            };
            await this.fireRule(rule, trigger, mappingLookup).catch((e: any) =>
              getLogger().error(`Threshold rule "${rule.name}" stale trigger failed:`, e?.message ?? e)
            );
          }
        } else if (!isStale && prevState === 'stale') {
          this.thresholdStates.set(stateKey, 'normal');
        }
      }

      const watchedDevices = rule.watchedDevices ?? [];
      for (const wd of watchedDevices) {
        const status = connectionStatus.find(
          (s) => s.deviceId === wd.deviceId && s.type === wd.type
        );
        const connected = status?.connected ?? false;
        const key = `${rule.id}:device:${wd.deviceId}`;
        const delaySeconds = Math.max(0, wd.disconnectedSeconds ?? 0);
        const delayMs = delaySeconds * 1000;

        if (!connected) {
          if (!this.firstDisconnectedAt.has(key)) {
            this.firstDisconnectedAt.set(key, now);
          }
          const firstAt = this.firstDisconnectedAt.get(key)!;
          const disconnectedLongEnough = now - firstAt >= delayMs;
          if (!disconnectedLongEnough) continue;

          const prevFired = this.thresholdStates.get(key) === 'out_of_range';
          if (!prevFired && !inCooldown) {
            this.thresholdStates.set(key, 'out_of_range');
            const trigger: ThresholdTriggerContext = {
              mappingId: '',
              mappingName: status?.deviceName ?? wd.deviceId,
              value: null,
              breach: 'no_connection',
              quality: 'bad',
              timestamp: now,
              deviceId: wd.deviceId,
              deviceName: status?.deviceName,
            };
            await this.fireRule(rule, trigger, mappingLookup).catch((e: any) =>
              getLogger().error(`Threshold rule "${rule.name}" connection trigger failed:`, e?.message ?? e)
            );
          }
        } else {
          this.firstDisconnectedAt.delete(key);
          this.thresholdStates.delete(key);
        }
      }
    }
  }

  private async fireRule(
    rule: ThresholdPublishRule,
    trigger: ThresholdTriggerContext,
    mappingLookup: Map<string, any>
  ): Promise<void> {
    const seed = this.getMergedValues(
      [
        ...new Set([
          ...rule.snapshotMappingIds,
          ...rule.watchedMappings.map((w) => w.mappingId),
        ]),
      ],
      mappingLookup
    );
    await this.sendRule(rule, trigger, seed, false);
  }

  onMappedData(data: RealtimeData): void {
    this.latestValues.set(data.mappingId, data);

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      const watch = rule.watchedMappings.find((item) => item.mappingId === data.mappingId);
      if (!watch) continue;
      this.evaluateWatch(rule, watch, data).catch((error: any) => {
        const message = error?.message || String(error);
        getLogger().error(`Threshold publish rule "${rule.name}" failed:`, message);
        this.emit('log', {
          type: 'threshold-rule',
          level: 'error',
          message: `Rule "${rule.name}" failed: ${message}`,
          ruleId: rule.id,
          ruleName: rule.name,
          timestamp: Date.now(),
          error: message,
        });
      });
    }
  }

  async triggerRuleNow(ruleId: string): Promise<void> {
    const rule = this.rules.get(ruleId) || this.db.getThresholdPublishRuleById(ruleId);
    if (!rule) {
      throw new Error('Threshold publish rule not found');
    }

    const mappingLookup = new Map(
      this.db.getParameterMappings().map((mapping) => [mapping.id, mapping])
    );

    const seed = this.getMergedValues([
      ...new Set([
        ...rule.snapshotMappingIds,
        ...rule.watchedMappings.map((item) => item.mappingId),
      ]),
    ], mappingLookup);

    const firstWatch = rule.watchedMappings[0];
    const triggerSnapshot = firstWatch
      ? seed.find((item) => item.mappingId === firstWatch.mappingId)
      : undefined;
    const trigger: ThresholdTriggerContext = {
      mappingId: firstWatch?.mappingId || '',
      mappingName:
        triggerSnapshot?.mappingName ||
        (firstWatch ? mappingLookup.get(firstWatch.mappingId)?.mappedName || firstWatch.mappingId : 'manual-test'),
      parameterId: triggerSnapshot?.parameterId,
      value: triggerSnapshot?.value,
      numericValue:
        triggerSnapshot && Number.isFinite(Number(triggerSnapshot.value))
          ? Number(triggerSnapshot.value)
          : undefined,
      min: firstWatch?.min,
      max: firstWatch?.max,
      breach: 'out_of_range',
      unit: triggerSnapshot?.unit,
      quality: triggerSnapshot?.quality || 'good',
      timestamp: Date.now(),
    };

    await this.sendRule(rule, trigger, seed, true);
  }

  cleanup(): void {
    this.stopPeriodicCheck();
    this.rules.clear();
    this.latestValues.clear();
    this.thresholdStates.clear();
    this.firstDisconnectedAt.clear();
  }

  private async evaluateWatch(
    rule: ThresholdPublishRule,
    watch: ThresholdWatchItem,
    data: RealtimeData
  ): Promise<void> {
    const numericValue = Number(data.value);
    const isNumeric = Number.isFinite(numericValue);
    const stateKey = `${rule.id}:${watch.mappingId}`;
    const previousState = this.thresholdStates.get(stateKey) || 'normal';

    if (!isNumeric) {
      this.thresholdStates.set(stateKey, 'normal');
      return;
    }

    const breach =
      watch.min != null && numericValue < watch.min
        ? 'below_min'
        : watch.max != null && numericValue > watch.max
          ? 'above_max'
          : null;

    if (!breach) {
      this.thresholdStates.set(stateKey, 'normal');
      return;
    }

    this.thresholdStates.set(stateKey, 'out_of_range');

    const now = Date.now();
    const cooldownMs = Math.max(0, rule.cooldownSeconds || 0) * 1000;

    if (previousState === 'out_of_range') {
      const periodic = rule.reTriggerMode === 'periodic_while_breach' && (rule.reTriggerIntervalSeconds ?? 0) > 0;
      if (!periodic) return;
      const intervalMs = Math.max(cooldownMs, (rule.reTriggerIntervalSeconds ?? 0) * 1000);
      if (intervalMs <= 0 || !rule.lastTriggeredAt || now - rule.lastTriggeredAt < intervalMs) {
        return;
      }
    } else {
      if (cooldownMs > 0 && rule.lastTriggeredAt && now - rule.lastTriggeredAt < cooldownMs) {
        return;
      }
    }

    const snapshot = this.buildSnapshot(rule);
    const trigger: ThresholdTriggerContext = {
      mappingId: data.mappingId,
      mappingName: data.mappingName,
      parameterId: data.parameterId,
      value: data.value,
      numericValue,
      min: watch.min,
      max: watch.max,
      breach,
      unit: data.unit,
      quality: data.quality,
      timestamp: data.timestamp,
    };

    await this.sendRule(rule, trigger, snapshot, false);
  }

  private buildSnapshot(rule: ThresholdPublishRule): ThresholdSnapshotItem[] {
    const mappingLookup = new Map(
      this.db.getParameterMappings().map((mapping) => [mapping.id, mapping])
    );
    return this.getMergedValues(rule.snapshotMappingIds, mappingLookup);
  }

  private getMergedValues(
    mappingIds: string[],
    mappingLookup: Map<string, any>
  ): ThresholdSnapshotItem[] {
    const uniqueIds = [...new Set(mappingIds)];
    const historical = this.db.getLatestHistoricalDataForMappings(uniqueIds);

    return uniqueIds
      .map((mappingId) => {
        const live = this.latestValues.get(mappingId);
        if (live) return this.toSnapshotItem(live);

        const hist = historical.get(mappingId);
        if (hist) return this.historicalToSnapshotItem(mappingId, hist, mappingLookup);

        const mapping = mappingLookup.get(mappingId);
        if (!mapping) return null;

        return {
          mappingId,
          mappingName: mapping.mappedName || mapping.name || mappingId,
          parameterId: mapping.parameterId,
          value: null,
          unit: mapping.unit,
          quality: 'uncertain' as const,
          timestamp: Date.now(),
        };
      })
      .filter((item): item is ThresholdSnapshotItem => item != null);
  }

  private toSnapshotItem(data: RealtimeData): ThresholdSnapshotItem {
    return {
      mappingId: data.mappingId,
      mappingName: data.mappingName,
      parameterId: data.parameterId,
      value: data.value,
      unit: data.unit,
      quality: data.quality,
      timestamp: data.timestamp,
    };
  }

  private historicalToSnapshotItem(
    mappingId: string,
    hist: HistoricalData,
    mappingLookup: Map<string, any>
  ): ThresholdSnapshotItem {
    const mapping = mappingLookup.get(mappingId);
    return {
      mappingId,
      mappingName: mapping?.mappedName || mapping?.name || mappingId,
      parameterId: mapping?.parameterId,
      value: hist.value,
      unit: mapping?.unit,
      quality: hist.quality,
      timestamp: hist.timestamp,
    };
  }

  private async sendRule(
    rule: ThresholdPublishRule,
    trigger: ThresholdTriggerContext,
    snapshot: ThresholdSnapshotItem[],
    isTest: boolean
  ): Promise<void> {
    const clientId = this.db.getClientId();
    const snapshotMap = Object.fromEntries(
      snapshot.map((item) => [item.mappingName, item.value])
    );
    const payload = {
      clientId,
      triggeredAt: Date.now(),
      isTest,
      rule: {
        id: rule.id,
        name: rule.name,
      },
      trigger,
      snapshot,
      snapshotMap,
    };

    const templateContext = {
      clientId,
      rule,
      trigger,
      snapshot,
      snapshotMap,
      isTest,
      JSON,
      Math,
      Date,
    };

    await this.httpClientService.sendConfiguredRequest(rule, templateContext, payload);

    const now = Date.now();
    this.db.updateThresholdPublishRule(rule.id, { lastTriggeredAt: now });
    rule.lastTriggeredAt = now;
    this.rules.set(rule.id, rule);

    this.emit('log', {
      type: 'threshold-rule',
      level: 'info',
      message: `${isTest ? 'Test sent' : 'Threshold triggered'} for rule "${rule.name}"`,
      ruleId: rule.id,
      ruleName: rule.name,
      timestamp: now,
      data: {
        httpUrl: rule.httpUrl,
        trigger,
        snapshotCount: snapshot.length,
        isTest,
      },
    });
  }
}
