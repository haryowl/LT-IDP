import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import { URL } from 'url';
import type { DatabaseService } from './database';
import { getLogger } from './logger';
import { getTransmissionTelemetry } from './transmissionTelemetry';
import type { TmatApiResponse, TmatBodyParam, TmatConfig, TmatLog, TmatMapping, TmatQueue } from '../types';
import { TMAT_BODY_PARAMS } from '../types';

export class TmatService {
  /** KLH Monitoring TMAT API v1.2 default endpoint */
  readonly DEFAULT_API_URL =
    'https://gambutindonesia.kemenlh.go.id/backoffice-SPAgambut/api/v1/realtime_push';

  private pushScheduler?: NodeJS.Timeout;
  private retryScheduler?: NodeJS.Timeout;

  constructor(private db: DatabaseService) {}

  getTmatConfig(): TmatConfig | null {
    const row = this.db.getDb().prepare('SELECT * FROM tmat_config LIMIT 1').get() as any;
    if (!row) return null;
    return {
      id: row.id,
      deviceIdUnik: row.device_id_unik,
      apiKey: row.api_key || undefined,
      apiUrl: row.api_url || undefined,
      enabled: Boolean(row.enabled),
      pushIntervalSeconds: row.push_interval_seconds ?? 60,
      lastSend: row.last_send || undefined,
      retryMaxAttempts: row.retry_max_attempts || undefined,
      retryIntervalMinutes: row.retry_interval_minutes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  upsertTmatConfig(config: Partial<TmatConfig>): TmatConfig {
    const existing = this.getTmatConfig();
    const now = Date.now();

    if (existing) {
      const updated: TmatConfig = {
        ...existing,
        ...config,
        pushIntervalSeconds: config.pushIntervalSeconds ?? existing.pushIntervalSeconds ?? 60,
        updatedAt: now,
      };
      this.db
        .getDb()
        .prepare(
          `UPDATE tmat_config SET device_id_unik = ?, api_key = ?, api_url = ?, enabled = ?,
           push_interval_seconds = ?, last_send = ?, retry_max_attempts = ?, retry_interval_minutes = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          updated.deviceIdUnik,
          updated.apiKey || null,
          updated.apiUrl || null,
          updated.enabled ? 1 : 0,
          updated.pushIntervalSeconds,
          updated.lastSend || null,
          updated.retryMaxAttempts || null,
          updated.retryIntervalMinutes || null,
          updated.updatedAt,
          updated.id
        );
      return updated;
    }

    const newConfig: TmatConfig = {
      id: uuidv4(),
      deviceIdUnik: config.deviceIdUnik || '',
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      enabled: config.enabled ?? false,
      pushIntervalSeconds: config.pushIntervalSeconds ?? 60,
      lastSend: config.lastSend,
      retryMaxAttempts: config.retryMaxAttempts,
      retryIntervalMinutes: config.retryIntervalMinutes,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .getDb()
      .prepare(
        `INSERT INTO tmat_config
         (id, device_id_unik, api_key, api_url, enabled, push_interval_seconds, last_send,
          retry_max_attempts, retry_interval_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newConfig.id,
        newConfig.deviceIdUnik,
        newConfig.apiKey || null,
        newConfig.apiUrl || null,
        newConfig.enabled ? 1 : 0,
        newConfig.pushIntervalSeconds,
        newConfig.lastSend || null,
        newConfig.retryMaxAttempts || null,
        newConfig.retryIntervalMinutes || null,
        newConfig.createdAt,
        newConfig.updatedAt
      );
    return newConfig;
  }

  getTmatMappings(): TmatMapping[] {
    const rows = this.db.getDb().prepare('SELECT * FROM tmat_mappings ORDER BY created_at ASC').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      mappingId: row.mapping_id,
      tmatParam: row.tmat_param as TmatBodyParam,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
    }));
  }

  upsertTmatMapping(tmatParam: TmatBodyParam, mappingId: string): TmatMapping {
    if (!TMAT_BODY_PARAMS.includes(tmatParam)) {
      throw new Error(`Invalid TMAT parameter: ${tmatParam}`);
    }
    const existing = this.db
      .getDb()
      .prepare('SELECT * FROM tmat_mappings WHERE tmat_param = ?')
      .get(tmatParam) as any;
    const now = Date.now();
    if (existing) {
      this.db.getDb().prepare('UPDATE tmat_mappings SET mapping_id = ?, enabled = 1 WHERE id = ?').run(mappingId, existing.id);
      return {
        id: existing.id,
        mappingId,
        tmatParam,
        enabled: true,
        createdAt: existing.created_at,
      };
    }
    const id = uuidv4();
    this.db
      .getDb()
      .prepare('INSERT INTO tmat_mappings (id, tmat_param, mapping_id, enabled, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, tmatParam, mappingId, 1, now);
    return { id, mappingId, tmatParam, enabled: true, createdAt: now };
  }

  deleteTmatMapping(id: string): void {
    this.db.getDb().prepare('DELETE FROM tmat_mappings WHERE id = ?').run(id);
  }

  /** Build form body from latest historical values per mapped parameter. */
  collectRealtimePayload(): Record<string, string> | null {
    const config = this.getTmatConfig();
    if (!config?.deviceIdUnik) {
      getLogger().error('❌ TMAT device_id_unik not configured');
      return null;
    }

    const mappings = this.getTmatMappings().filter((m) => m.enabled);
    if (mappings.length === 0) {
      getLogger().error('❌ No TMAT parameter mappings configured');
      return null;
    }

    const mappingIds = mappings.map((m) => m.mappingId);
    const latestByMapping = this.db.getLatestHistoricalDataForMappings(mappingIds);
    if (latestByMapping.size === 0) {
      getLogger().info('⚠️ TMAT: no historical data for mapped parameters');
      return null;
    }

    const body: Record<string, string> = {
      device_id_unik: config.deviceIdUnik,
    };

    for (const m of mappings) {
      const row = latestByMapping.get(m.mappingId);
      if (!row) continue;
      let raw = row.value;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          /* keep string */
        }
      }
      const num = Number(raw);
      body[m.tmatParam] = Number.isFinite(num) ? String(num) : String(raw ?? '');
    }

    return body;
  }

  private getEndpoint(): string {
    const cfg = this.getTmatConfig();
    const url = (cfg?.apiUrl?.trim() || this.DEFAULT_API_URL).replace(/\/+$/, '');
    return url;
  }

  private async httpFormPost(url: string, apiKey: string, formBody: Record<string, string>): Promise<TmatApiResponse> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const bodyString = new URLSearchParams(formBody).toString();
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-API-KEY': apiKey,
          'Content-Length': Buffer.byteLength(bodyString),
        },
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const code = res.statusCode ?? 0;
          if (code < 200 || code >= 300) {
            reject(new Error(`HTTP ${code}: ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as TmatApiResponse);
          } catch {
            resolve({ status: true, message: data });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.write(bodyString);
      req.end();
    });
  }

  private async sendPayload(formBody: Record<string, string>): Promise<TmatApiResponse> {
    const config = this.getTmatConfig();
    if (!config?.apiKey?.trim()) {
      throw new Error('X-API-KEY not configured');
    }
    const endpoint = this.getEndpoint();
    getLogger().info(`📤 TMAT push → ${endpoint}`);
    getLogger().info(`   device_id_unik=${formBody.device_id_unik}`);
    return this.httpFormPost(endpoint, config.apiKey.trim(), formBody);
  }

  private writeLog(status: 'success' | 'failed', response: string, durationMs: number): void {
    const id = uuidv4();
    const ts = Date.now();
    this.db
      .getDb()
      .prepare(
        `INSERT INTO tmat_logs (id, status, response, duration_ms, timestamp) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, status, response.substring(0, 4000), durationMs, ts);
    getTransmissionTelemetry().recordHttp(status === 'success');
  }

  private enqueueFailed(formBody: Record<string, string>, errorMessage: string): void {
    const id = uuidv4();
    const now = Date.now();
    this.db
      .getDb()
      .prepare(
        `INSERT INTO tmat_queue (id, payload, status, retry_count, error_message, created_at)
         VALUES (?, ?, 'pending', 0, ?, ?)`
      )
      .run(id, JSON.stringify(formBody), errorMessage.substring(0, 500), now);
  }

  async sendRealtimePush(): Promise<void> {
    const config = this.getTmatConfig();
    if (!config?.enabled) {
      getLogger().info('⚠️ TMAT is not enabled');
      return;
    }

    const formBody = this.collectRealtimePayload();
    if (!formBody) return;

    const start = Date.now();
    try {
      const response = await this.sendPayload(formBody);
      const durationMs = Date.now() - start;
      const responseStr = JSON.stringify(response);
      this.writeLog('success', responseStr, durationMs);
      this.upsertTmatConfig({ lastSend: Date.now() });
      getLogger().info(`✅ TMAT push OK (${durationMs}ms): ${response.message ?? responseStr}`);
    } catch (error: any) {
      const durationMs = Date.now() - start;
      const msg = error?.message ?? String(error);
      this.writeLog('failed', msg, durationMs);
      this.enqueueFailed(formBody, msg);
      getLogger().error(`❌ TMAT push failed: ${msg}`);
      throw error;
    }
  }

  getQueueDepth(): number {
    const row = this.db.getDb().prepare(`SELECT COUNT(*) as cnt FROM tmat_queue WHERE status = 'pending'`).get() as any;
    return row?.cnt ?? 0;
  }

  getQueueItems(limit = 100): TmatQueue[] {
    const rows = this.db
      .getDb()
      .prepare(`SELECT * FROM tmat_queue ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      payload: row.payload,
      status: row.status,
      retryCount: row.retry_count,
      lastAttemptAt: row.last_attempt_at || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      sentAt: row.sent_at || undefined,
    }));
  }

  async processQueue(): Promise<void> {
    const config = this.getTmatConfig();
    if (!config?.enabled || !config.apiKey?.trim()) return;

    const maxAttempts = config.retryMaxAttempts ?? 5;
    const items = this.db
      .getDb()
      .prepare(
        `SELECT * FROM tmat_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20`
      )
      .all() as any[];

    for (const item of items) {
      if (item.retry_count >= maxAttempts) {
        this.db.getDb().prepare(`UPDATE tmat_queue SET status = 'failed' WHERE id = ?`).run(item.id);
        continue;
      }

      let formBody: Record<string, string>;
      try {
        formBody = JSON.parse(item.payload);
      } catch {
        this.db.getDb().prepare(`UPDATE tmat_queue SET status = 'failed', error_message = ? WHERE id = ?`).run('Invalid payload JSON', item.id);
        continue;
      }

      this.db.getDb().prepare(`UPDATE tmat_queue SET status = 'sending' WHERE id = ?`).run(item.id);
      const start = Date.now();
      try {
        const response = await this.sendPayload(formBody);
        this.db.getDb().prepare(`UPDATE tmat_queue SET status = 'sent', sent_at = ? WHERE id = ?`).run(Date.now(), item.id);
        this.writeLog('success', JSON.stringify(response), Date.now() - start);
      } catch (error: any) {
        const msg = error?.message ?? String(error);
        this.db
          .getDb()
          .prepare(
            `UPDATE tmat_queue SET status = 'pending', retry_count = ?, error_message = ?, last_attempt_at = ? WHERE id = ?`
          )
          .run(item.retry_count + 1, msg.substring(0, 500), Date.now(), item.id);
        this.writeLog('failed', msg, Date.now() - start);
      }
    }
  }

  getTmatLogs(limit = 50): TmatLog[] {
    const rows = this.db
      .getDb()
      .prepare('SELECT * FROM tmat_logs ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      response: row.response || undefined,
      durationMs: row.duration_ms || undefined,
      timestamp: row.timestamp,
    }));
  }

  startScheduler(): void {
    this.stopScheduler();
    const config = this.getTmatConfig();
    if (!config?.enabled) return;

    const intervalMs = Math.max(10, (config.pushIntervalSeconds || 60)) * 1000;
    getLogger().info(`⏱️ TMAT scheduler started (every ${intervalMs / 1000}s)`);

    this.pushScheduler = setInterval(() => {
      void this.runSchedulerTick();
    }, intervalMs);

    const retryMinutes = config.retryIntervalMinutes ?? 5;
    this.retryScheduler = setInterval(() => {
      void this.processQueue();
    }, retryMinutes * 60 * 1000);

    void this.runSchedulerTick();
  }

  stopScheduler(): void {
    if (this.pushScheduler) {
      clearInterval(this.pushScheduler);
      this.pushScheduler = undefined;
    }
    if (this.retryScheduler) {
      clearInterval(this.retryScheduler);
      this.retryScheduler = undefined;
    }
    getLogger().info('🛑 TMAT scheduler stopped');
  }

  private async runSchedulerTick(): Promise<void> {
    getLogger().info('⏱️ TMAT scheduler tick');
    try {
      await this.processQueue();
      await this.sendRealtimePush();
    } catch {
      /* logged in sendRealtimePush */
    }
  }

  async sendNow(): Promise<void> {
    await this.sendRealtimePush();
  }

  getStatus(): {
    enabled: boolean;
    pushIntervalSeconds: number;
    lastSend: number | null;
    queueDepth: number;
    endpoint: string;
  } {
    const cfg = this.getTmatConfig();
    return {
      enabled: cfg?.enabled ?? false,
      pushIntervalSeconds: cfg?.pushIntervalSeconds ?? 60,
      lastSend: cfg?.lastSend ?? null,
      queueDepth: this.getQueueDepth(),
      endpoint: this.getEndpoint(),
    };
  }
}
