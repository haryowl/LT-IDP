import { EventEmitter } from 'events';
import jsep from 'jsep';
import type { DatabaseService } from './database';
import type { AdvancedRule, AdvancedRuleEvent, RealtimeData } from '../types';
import { getLogger } from './logger';
import type { MqttPublisherService } from './mqttPublisher';
import type { HttpClientService } from './httpClient';

type RuleRuntimeState = {
  lastEvalAt?: number;
  /** last boolean condition result */
  lastCondition?: boolean;
  modbusToggleTimer?: NodeJS.Timeout;
  modbusToggleState?: boolean;
};

export type AdvancedRulesServiceDeps = {
  dataDir: string;
  mqttPublisher?: MqttPublisherService;
  httpClient?: HttpClientService;
  publishEvent?: (evt: AdvancedRuleEvent) => void;
  modbusWrite?: (payload: { deviceId: string; registerId: string; value: unknown }) => Promise<void>;
};

type ValueCacheItem = {
  mappingId: string;
  mappingName: string;
  parameterId?: string;
  unit?: string;
  value: any;
  quality: 'good' | 'bad' | 'uncertain';
  timestamp: number;
};

function isTruthy(v: any): boolean {
  return !!v;
}

function safeNumber(v: any): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function nowMs(): number {
  return Date.now();
}

function clampInt(n: any, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function uniqueStrings(a: string[]): string[] {
  return Array.from(new Set((a || []).map((s) => String(s)).filter(Boolean)));
}

class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

function evalAst(node: any, ctx: Record<string, any>): any {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier': {
      const name = node.name as string;
      if (Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name];
      throw new ExpressionError(`Unknown identifier "${name}"`);
    }
    case 'UnaryExpression': {
      const op = node.operator as string;
      const arg = evalAst(node.argument, ctx);
      if (op === '!') return !isTruthy(arg);
      if (op === '+') return +(arg as any);
      if (op === '-') return -(arg as any);
      throw new ExpressionError(`Unsupported unary operator "${op}"`);
    }
    case 'BinaryExpression':
    case 'LogicalExpression': {
      const op = node.operator as string;
      if (node.type === 'LogicalExpression') {
        // short-circuit
        const left = evalAst(node.left, ctx);
        if (op === '&&') return isTruthy(left) ? evalAst(node.right, ctx) : left;
        if (op === '||') return isTruthy(left) ? left : evalAst(node.right, ctx);
      }
      const left = evalAst(node.left, ctx);
      const right = evalAst(node.right, ctx);
      switch (op) {
        case '==':
          return left == right;
        case '!=':
          return left != right;
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
        case '+':
          return (left as any) + (right as any);
        case '-':
          return (left as any) - (right as any);
        case '*':
          return (left as any) * (right as any);
        case '/':
          return (left as any) / (right as any);
        case '%':
          return (left as any) % (right as any);
        default:
          throw new ExpressionError(`Unsupported operator "${op}"`);
      }
    }
    case 'ConditionalExpression': {
      const test = evalAst(node.test, ctx);
      if (isTruthy(test)) {
        return evalAst(node.consequent, ctx);
      }
      return evalAst(node.alternate, ctx);
    }
    case 'CallExpression': {
      const callee = node.callee;
      if (callee.type !== 'Identifier') throw new ExpressionError('Only simple function calls are allowed');
      const name = callee.name as string;
      const args = (node.arguments as any[]).map((a) => evalAst(a, ctx));
      const fn = ctx[name];
      if (typeof fn !== 'function') throw new ExpressionError(`Unknown function "${name}"`);
      return fn(...args);
    }
    default:
      throw new ExpressionError(`Unsupported expression node type "${(node as any).type}"`);
  }
}

function compileExpression(expression: string): (ctx: Record<string, any>) => any {
  let ast: any;
  try {
    ast = jsep(expression);
  } catch (e: any) {
    throw new ExpressionError(e?.message || 'Expression parse error');
  }
  return (ctx: Record<string, any>) => evalAst(ast, ctx);
}

export class AdvancedRulesService extends EventEmitter {
  private rules = new Map<string, AdvancedRule>();
  private compiled = new Map<string, (ctx: Record<string, any>) => any>();
  private runtime = new Map<string, RuleRuntimeState>();
  private cache = new Map<string, ValueCacheItem>();
  private timers = new Map<string, NodeJS.Timeout>();
  private modbusWriteChainByDevice = new Map<string, Promise<void>>();

  constructor(
    private db: DatabaseService,
    private deps: AdvancedRulesServiceDeps
  ) {
    super();
    this.reloadRules();
  }

  private log() {
    return getLogger(this.deps.dataDir);
  }

  reloadRules(): void {
    // Stop any running modbus toggle intervals before we drop runtime state
    for (const [ruleId, rt] of this.runtime.entries()) {
      if (rt.modbusToggleTimer) clearInterval(rt.modbusToggleTimer as any);
      rt.modbusToggleTimer = undefined;
      rt.modbusToggleState = undefined;
    }
    this.rules = new Map(this.db.getAdvancedRules().map((r) => [r.id, r]));
    this.compiled.clear();
    this.runtime.clear();
    this.resetTimers();
    for (const rule of this.rules.values()) {
      this.ensureCompiled(rule);
      this.ensureTimer(rule);
    }
  }

  getRules(): AdvancedRule[] {
    return Array.from(this.rules.values());
  }

  getRuleById(id: string): AdvancedRule | undefined {
    return this.rules.get(id) || this.db.getAdvancedRuleById(id);
  }

  onRealtimeData(data: RealtimeData): void {
    this.cache.set(data.mappingId, {
      mappingId: data.mappingId,
      mappingName: data.mappingName,
      parameterId: data.parameterId,
      unit: data.unit,
      value: data.value,
      quality: data.quality,
      timestamp: data.timestamp,
    });

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (!rule.inputs?.includes(data.mappingId)) continue;
      void this.evaluate(rule, 'event');
    }
  }

  async triggerNow(ruleId: string): Promise<void> {
    const rule = this.getRuleById(ruleId);
    if (!rule) throw new Error('Advanced rule not found');
    await this.evaluate(rule, 'manual');
  }

  private ensureCompiled(rule: AdvancedRule) {
    if (this.compiled.has(rule.id)) return;
    const fn = compileExpression(rule.expression || 'false');
    this.compiled.set(rule.id, fn);
  }

  private resetTimers() {
    for (const t of this.timers.values()) clearInterval(t as any);
    this.timers.clear();
  }

  private ensureTimer(rule: AdvancedRule) {
    const sec = rule.timerIntervalSeconds;
    if (!rule.enabled || !sec || sec <= 0) return;
    if (this.timers.has(rule.id)) return;
    const ms = clampInt(sec, 1, 3600, 5) * 1000;
    const t = setInterval(() => {
      void this.evaluate(rule, 'timer');
    }, ms);
    this.timers.set(rule.id, t);
  }

  private buildContext(rule: AdvancedRule): Record<string, any> {
    const value = (mappingId: string) => this.cache.get(String(mappingId))?.value;
    const ts = (mappingId: string) => this.cache.get(String(mappingId))?.timestamp;
    const num = (v: any) => safeNumber(v);
    const has = (mappingId: string) => this.cache.has(String(mappingId));
    const ifFn = (cond: any, a: any, b: any) => (isTruthy(cond) ? a : b);
    const ageMs = (mappingId: string) => {
      const t = ts(mappingId);
      return typeof t === 'number' ? Math.max(0, nowMs() - t) : null;
    };
    return {
      value,
      ts,
      ageMs,
      has,
      num,
      if: ifFn,
      now: () => nowMs(),
      Math,
      Number,
      String,
      Boolean,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  }

  private canTrigger(rule: AdvancedRule, condition: boolean, now: number): { ok: boolean; why?: string } {
    const rt = this.runtime.get(rule.id) || {};

    const cooldownMs = Math.max(0, rule.cooldownSeconds || 0) * 1000;
    if (cooldownMs > 0 && rule.lastTriggeredAt != null && now - rule.lastTriggeredAt < cooldownMs) {
      return { ok: false, why: 'cooldown' };
    }

    const mode = rule.reTriggerMode || 'edge_only';
    if (mode === 'edge_only') {
      // Edge-only is based on the previous condition, so callers must not have overwritten rt.lastCondition yet.
      if (rt.lastCondition === true && condition === true) return { ok: false, why: 'edge_only' };
    } else if (mode === 'periodic_while_true') {
      const intervalMs = Math.max(1, rule.reTriggerIntervalSeconds || 60) * 1000;
      if (rule.lastTriggeredAt != null && now - rule.lastTriggeredAt < intervalMs) return { ok: false, why: 'periodic_wait' };
    }

    return { ok: true };
  }

  private enqueueModbusWrite(deviceId: string, op: () => Promise<void>): Promise<void> {
    const prev = this.modbusWriteChainByDevice.get(deviceId) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(op)
      .finally(() => {
        if (this.modbusWriteChainByDevice.get(deviceId) === next) {
          // keep map from growing unbounded if no further writes
          this.modbusWriteChainByDevice.delete(deviceId);
        }
      });
    this.modbusWriteChainByDevice.set(deviceId, next);
    return next;
  }

  private startModbusToggle(rule: AdvancedRule): void {
    const cfg = rule.actions?.modbusWrite;
    if (!cfg?.enabled) return;
    if (cfg.mode !== 'toggle_interval') return;
    if (!this.deps.modbusWrite) return;

    const rt = this.runtime.get(rule.id) || {};
    if (rt.modbusToggleTimer) return; // already running

    const deviceId = String(cfg.deviceId || '');
    const registerId = String(cfg.registerId || '');
    if (!deviceId || !registerId) return;

    const intervalMs = clampInt(cfg.intervalSeconds, 1, 3600, 1) * 1000;
    const valueTrue = cfg.valueTrue !== undefined ? cfg.valueTrue : true;
    const valueFalse = cfg.valueFalse !== undefined ? cfg.valueFalse : false;

    rt.modbusToggleState = true;
    // Write immediately then continue toggling
    void this.enqueueModbusWrite(deviceId, async () => this.deps.modbusWrite!({ deviceId, registerId, value: valueTrue })).catch((e: any) => {
      this.log().error(`Advanced rule "${rule.name}" modbus toggle write failed:`, e?.message || String(e));
    });

    const t = setInterval(() => {
      const cur = this.runtime.get(rule.id);
      if (!cur?.modbusToggleTimer) return;
      cur.modbusToggleState = !cur.modbusToggleState;
      const value = cur.modbusToggleState ? valueTrue : valueFalse;
      void this.enqueueModbusWrite(deviceId, async () => this.deps.modbusWrite!({ deviceId, registerId, value })).catch((e: any) => {
        this.log().error(`Advanced rule "${rule.name}" modbus toggle write failed:`, e?.message || String(e));
      });
    }, intervalMs);

    rt.modbusToggleTimer = t;
    this.runtime.set(rule.id, rt);
  }

  private stopModbusToggle(rule: AdvancedRule): void {
    const cfg = rule.actions?.modbusWrite;
    const rt = this.runtime.get(rule.id);
    if (!rt?.modbusToggleTimer) return;
    clearInterval(rt.modbusToggleTimer as any);
    rt.modbusToggleTimer = undefined;
    rt.modbusToggleState = undefined;
    this.runtime.set(rule.id, rt);

    if (!cfg?.enabled) return;
    if (cfg.mode !== 'toggle_interval') return;
    if (cfg.writeFalseOnStop === false) return;
    if (!this.deps.modbusWrite) return;

    const deviceId = String(cfg.deviceId || '');
    const registerId = String(cfg.registerId || '');
    if (!deviceId || !registerId) return;
    const valueFalse = cfg.valueFalse !== undefined ? cfg.valueFalse : false;
    void this.enqueueModbusWrite(deviceId, async () => this.deps.modbusWrite!({ deviceId, registerId, value: valueFalse })).catch((e: any) => {
      this.log().error(`Advanced rule "${rule.name}" modbus stop write failed:`, e?.message || String(e));
    });
  }

  private buildSnapshot(rule: AdvancedRule): any[] {
    const ids = uniqueStrings([...(rule.snapshotMappingIds || []), ...(rule.inputs || [])]);
    return ids
      .map((id) => this.cache.get(id))
      .filter(Boolean)
      .map((x) => ({
        mappingId: x!.mappingId,
        mappingName: x!.mappingName,
        parameterId: x!.parameterId,
        unit: x!.unit,
        value: x!.value,
        quality: x!.quality,
        timestamp: x!.timestamp,
      }));
  }

  private async evaluate(rule: AdvancedRule, source: 'event' | 'timer' | 'manual'): Promise<void> {
    if (!rule.enabled) return;
    const now = nowMs();

    try {
      this.ensureCompiled(rule);
      const fn = this.compiled.get(rule.id)!;
      const ctx = this.buildContext(rule);
      const result = fn(ctx);
      const condition = isTruthy(result);

      const rt = this.runtime.get(rule.id) || {};
      const prevCondition = rt.lastCondition;
      // Update lastCondition AFTER we compute transitions/gating (edge-only depends on previous)
      if (prevCondition === true && condition === false) {
        this.stopModbusToggle(rule);
      } else if ((prevCondition !== true || prevCondition === undefined) && condition === true) {
        this.startModbusToggle(rule);
      }

      // Transition handlers may have updated runtime state; re-read before persisting lastCondition.
      const rt2 = this.runtime.get(rule.id) || rt;
      rt2.lastEvalAt = now;
      rt2.lastCondition = condition;
      this.runtime.set(rule.id, rt2);

      if (!condition) return;
      const gate = this.canTrigger(rule, condition, now);
      if (!gate.ok) return;

      const severity = rule.actions?.alert?.severity || (rule.actions?.publish ? 'warning' : 'info');
      const snapshot = this.buildSnapshot(rule);
      const payload = {
        type: 'advanced-rule',
        ruleId: rule.id,
        ruleName: rule.name,
        source,
        evaluatedAt: now,
        expression: rule.expression,
        result,
        snapshot,
      };

      const evt: Omit<AdvancedRuleEvent, 'id'> = {
        ruleId: rule.id,
        ruleName: rule.name,
        severity,
        message: `Advanced rule triggered: ${rule.name}`,
        triggeredAt: now,
        payload,
      };

      const inserted = this.db.insertAdvancedRuleEvent(evt);
      this.emit('event', inserted);
      this.deps.publishEvent?.(inserted);

      // Update lastTriggeredAt in DB + in-memory
      this.db.updateAdvancedRule(rule.id, { lastTriggeredAt: now });
      const updated: AdvancedRule = { ...rule, lastTriggeredAt: now, updatedAt: now };
      this.rules.set(rule.id, updated);

      await this.fireActions(updated, inserted);
    } catch (e: any) {
      const message = e?.message || String(e);
      this.log().error(`Advanced rule "${rule.name}" evaluation failed:`, message);
      const evt: Omit<AdvancedRuleEvent, 'id'> = {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: 'error',
        message: `Advanced rule "${rule.name}" failed: ${message}`,
        triggeredAt: now,
        payload: { type: 'advanced-rule-error', ruleId: rule.id, ruleName: rule.name, message },
      };
      const inserted = this.db.insertAdvancedRuleEvent(evt);
      this.emit('event', inserted);
      this.deps.publishEvent?.(inserted);
    }
  }

  private async fireActions(rule: AdvancedRule, event: AdvancedRuleEvent): Promise<void> {
    // Alert action is already represented by inserting the event and broadcasting it.
    const modbus = rule.actions?.modbusWrite;
    if (modbus?.enabled && modbus.mode === 'once' && this.deps.modbusWrite) {
      const deviceId = String(modbus.deviceId || '');
      const registerId = String(modbus.registerId || '');
      if (deviceId && registerId) {
        const value = modbus.valueTrue !== undefined ? modbus.valueTrue : true;
        try {
          await this.enqueueModbusWrite(deviceId, async () => this.deps.modbusWrite!({ deviceId, registerId, value }));
        } catch (e: any) {
          const message = e?.message || String(e);
          this.log().error(`Advanced rule "${rule.name}" modbus write failed:`, message);
          const evt: Omit<AdvancedRuleEvent, 'id'> = {
            ruleId: rule.id,
            ruleName: rule.name,
            severity: 'error',
            message: `Advanced rule "${rule.name}" Modbus write failed: ${message}`,
            triggeredAt: nowMs(),
            payload: { type: 'advanced-rule-modbus-error', ruleId: rule.id, ruleName: rule.name, message, action: modbus },
          };
          const inserted = this.db.insertAdvancedRuleEvent(evt);
          this.emit('event', inserted);
          this.deps.publishEvent?.(inserted);
        }
      }
    }

    const publishIds = rule.actions?.publish?.publisherIds || [];
    if (!publishIds.length) return;

    const data: RealtimeData = {
      mappingId: `advanced-rule:${rule.id}`,
      mappingName: `AdvancedRule:${rule.name}`,
      parameterId: undefined,
      unit: undefined,
      timestamp: event.triggeredAt,
      quality: 'good',
      value: event.payload,
    };

    for (const pubId of publishIds) {
      try {
        // We don't know type here cheaply; attempt mqtt first if service exists, then http.
        if (this.deps.mqttPublisher) {
          await this.deps.mqttPublisher.publish(pubId, data);
          continue;
        }
        if (this.deps.httpClient) {
          await this.deps.httpClient.publish(pubId, data);
        }
      } catch (e: any) {
        this.log().error(`Advanced rule publish to ${pubId} failed:`, e?.message || String(e));
      }
    }
  }
}

