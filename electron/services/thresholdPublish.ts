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

type ThresholdState = 'normal' | 'out_of_range';

export class ThresholdPublishService extends EventEmitter {
  private rules = new Map<string, ThresholdPublishRule>();
  private latestValues = new Map<string, RealtimeData>();
  private thresholdStates = new Map<string, ThresholdState>();

  constructor(
    private db: DatabaseService,
    private httpClientService: HttpClientService
  ) {
    super();
    this.reloadRules();
  }

  reloadRules(): void {
    this.rules = new Map(
      this.db.getThresholdPublishRules().map((rule) => [rule.id, rule])
    );
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
    this.rules.clear();
    this.latestValues.clear();
    this.thresholdStates.clear();
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
    if (previousState === 'out_of_range') {
      return;
    }

    const now = Date.now();
    const cooldownMs = Math.max(0, rule.cooldownSeconds || 0) * 1000;
    if (cooldownMs > 0 && rule.lastTriggeredAt && now - rule.lastTriggeredAt < cooldownMs) {
      return;
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
