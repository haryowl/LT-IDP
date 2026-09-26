import type { DatabaseService } from './database';
import type { AdvancedRuleEvent, ThresholdPublishRule, ThresholdTriggerContext } from '../types';
import { getLogger } from './logger';

const DEFAULT_BASE = 'https://jogja.wablas.com';
const MAX_MESSAGE_LEN = 1024;

export function normalizePhone(raw: string): string {
  let p = String(raw || '').trim().replace(/[\s\-]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = `62${p.slice(1)}`;
  return p;
}

export function truncateMessage(text: string, max = MAX_MESSAGE_LEN): string {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

function parsePhones(csv: string): string[] {
  return Array.from(
    new Set(
      (csv || '')
        .split(/[,;]/)
        .map((x) => normalizePhone(x))
        .filter(Boolean)
    )
  );
}

export class WhatsAppNotificationService {
  private diskTickRunning = false;

  constructor(private db: DatabaseService) {}

  getSettingsForApi(): Record<string, unknown> {
    const s = this.db.getWhatsAppNotificationSettings();
    return {
      id: s.id,
      enabled: s.enabled,
      apiBaseUrl: s.apiBaseUrl,
      token: s.token,
      secretKeyConfigured: !!(s.secretKey && s.secretKey.length > 0),
      phoneNumbers: s.phoneNumbers,
      notifyThresholdAlerts: s.notifyThresholdAlerts,
      notifyAdvancedAlerts: s.notifyAdvancedAlerts,
      notifyDiskLow: s.notifyDiskLow,
      diskFreePercentThreshold: s.diskFreePercentThreshold,
      cooldownMinutes: s.cooldownMinutes,
      lastThresholdSentAt: s.lastThresholdSentAt,
      lastAdvancedSentAt: s.lastAdvancedSentAt,
      lastDiskAlertAt: s.lastDiskAlertAt,
      updatedAt: s.updatedAt,
    };
  }

  saveSettings(updates: {
    enabled?: boolean;
    apiBaseUrl?: string;
    token?: string;
    secretKey?: string;
    phoneNumbers?: string;
    notifyThresholdAlerts?: boolean;
    notifyAdvancedAlerts?: boolean;
    notifyDiskLow?: boolean;
    diskFreePercentThreshold?: number;
    cooldownMinutes?: number;
  }): void {
    this.db.upsertWhatsAppNotificationSettings(updates);
  }

  private inCooldown(lastSentAt: number | null, cooldownMinutes: number): boolean {
    if (lastSentAt == null) return false;
    const ms = Math.max(1, cooldownMinutes) * 60 * 1000;
    return Date.now() - lastSentAt < ms;
  }

  async sendMessage(text: string): Promise<void> {
    const s = this.db.getWhatsAppNotificationSettings();
    const phones = parsePhones(s.phoneNumbers);
    if (phones.length === 0) throw new Error('At least one phone number is required');
    if (!s.token?.trim()) throw new Error('Wablas token is required');
    if (!s.secretKey?.trim()) throw new Error('Wablas secret key is required');

    const base = (s.apiBaseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    const url = `${base}/api/v2/send-message`;
    const message = truncateMessage(text);
    const body = {
      data: phones.map((phone) => ({ phone, message })),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `${s.token.trim()}.${s.secretKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const detail = parsed?.message || parsed?.status || raw.slice(0, 300) || res.statusText;
      throw new Error(`Wablas HTTP ${res.status}: ${detail}`);
    }

    // Wablas often returns 200 with status:false on auth/device errors
    if (parsed && parsed.status === false) {
      throw new Error(parsed.message || parsed.error || 'Wablas rejected the message');
    }
  }

  async testWhatsApp(): Promise<{ ok: boolean; error?: string }> {
    try {
      const s = this.db.getWhatsAppNotificationSettings();
      if (!s.enabled && !(s.token && s.secretKey && s.phoneNumbers)) {
        // allow test even if master toggle off, as long as credentials exist
      }
      await this.sendMessage(
        `LT-IDP WhatsApp test\nTime: ${new Date().toLocaleString()}\nIf you received this, Wablas is configured correctly.`
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async notifyThresholdAlert(
    rule: ThresholdPublishRule,
    trigger: ThresholdTriggerContext,
    opts?: { isTest?: boolean }
  ): Promise<void> {
    try {
      if (opts?.isTest) return;
      const s = this.db.getWhatsAppNotificationSettings();
      if (!s.enabled || !s.notifyThresholdAlerts) return;
      if (this.inCooldown(s.lastThresholdSentAt, s.cooldownMinutes)) return;

      const lines = [
        'LT-IDP Threshold Alert',
        `Rule: ${rule.name}`,
        `Breach: ${trigger.breach}`,
      ];
      if (trigger.mappingName) lines.push(`Mapping: ${trigger.mappingName}`);
      if (trigger.deviceName) lines.push(`Device: ${trigger.deviceName}`);
      if (trigger.value !== undefined) {
        const unit = trigger.unit ? ` ${trigger.unit}` : '';
        lines.push(`Value: ${trigger.value}${unit}`);
      }
      if (trigger.min != null || trigger.max != null) {
        lines.push(`Limits: min=${trigger.min ?? '-'} max=${trigger.max ?? '-'}`);
      }
      lines.push(`Time: ${new Date(trigger.timestamp || Date.now()).toLocaleString()}`);

      await this.sendMessage(lines.join('\n'));
      this.db.setWhatsAppLastSent('threshold', Date.now());
    } catch (e: any) {
      getLogger().error('WhatsApp threshold notify failed:', e?.message || e);
    }
  }

  async notifyAdvancedAlert(event: AdvancedRuleEvent, hasAlertAction: boolean): Promise<void> {
    try {
      if (!hasAlertAction) return;
      const s = this.db.getWhatsAppNotificationSettings();
      if (!s.enabled || !s.notifyAdvancedAlerts) return;
      if (this.inCooldown(s.lastAdvancedSentAt, s.cooldownMinutes)) return;

      const lines = [
        'LT-IDP Advanced Alert',
        `Rule: ${event.ruleName}`,
        `Severity: ${event.severity}`,
        `Message: ${event.message}`,
        `Time: ${new Date(event.triggeredAt).toLocaleString()}`,
      ];
      await this.sendMessage(lines.join('\n'));
      this.db.setWhatsAppLastSent('advanced', Date.now());
    } catch (e: any) {
      getLogger().error('WhatsApp advanced alert notify failed:', e?.message || e);
    }
  }

  tickDiskHealth(): void {
    if (this.diskTickRunning) return;
    this.diskTickRunning = true;
    void this.runDiskHealthCheck()
      .catch((e: any) => getLogger().error('WhatsApp disk health check failed:', e?.message || e))
      .finally(() => {
        this.diskTickRunning = false;
      });
  }

  private async runDiskHealthCheck(): Promise<void> {
    const s = this.db.getWhatsAppNotificationSettings();
    if (!s.enabled || !s.notifyDiskLow) return;
    if (this.inCooldown(s.lastDiskAlertAt, s.cooldownMinutes)) return;

    const summary = this.db.getDataStorageSummary();
    const disk = summary.disk;
    if (!disk || disk.freePercent == null) return;

    const threshold = s.diskFreePercentThreshold ?? 10;
    if (disk.freePercent > threshold) return;

    const usedPct = 100 - disk.freePercent;
    const fmt = (n: number) => {
      if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
      return `${Math.round(n)} B`;
    };

    const lines = [
      'LT-IDP System Health: Low Disk Space',
      `Path: ${disk.path}`,
      `Free: ${disk.freePercent.toFixed(1)}% (${fmt(disk.freeBytes)})`,
      `Used: ${usedPct.toFixed(1)}% (${fmt(disk.totalBytes - disk.freeBytes)})`,
      `Total: ${fmt(disk.totalBytes)}`,
      `Threshold: alert when free ≤ ${threshold}%`,
      `DB size: ${fmt(summary.dbMainBytes + summary.dbWalBytes + summary.dbShmBytes)}`,
      `Time: ${new Date().toLocaleString()}`,
    ];

    await this.sendMessage(lines.join('\n'));
    this.db.setWhatsAppLastSent('disk', Date.now());
    getLogger().warn(
      `[whatsapp] Disk low alert sent (${disk.freePercent.toFixed(1)}% free under ${disk.path})`
    );
  }
}
