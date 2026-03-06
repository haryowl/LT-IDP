import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import https from 'https';
import { URL } from 'url';
import type { DatabaseService } from './database';
import { getLogger } from './logger';
import type {
  SparingConfig,
  SparingMapping,
  SparingQueue,
  SparingLog,
  SparingHourlyData,
} from '../types';

export class SparingService {
  // SPARING API URLs
  private readonly DEFAULT_API_BASE = 'https://sparing.kemenlh.go.id/api';

  private getApiUrls() {
    const cfg = this.getSparingConfig();
    const base = (cfg?.apiBase && cfg.apiBase.trim().length > 0 ? cfg.apiBase.trim() : this.DEFAULT_API_BASE).replace(/\/+$/, '');
    const SECRET_URL = (cfg?.apiSecretUrl && cfg.apiSecretUrl.trim()) ? cfg.apiSecretUrl.trim() : `${base}/secret-sensor`;
    const TESTING_URL = (cfg?.apiTestingUrl && cfg.apiTestingUrl.trim()) ? cfg.apiTestingUrl.trim() : `${base}/testing`;
    const SEND_2MIN_URL = (cfg?.apiSend2MinUrl && cfg.apiSend2MinUrl.trim()) ? cfg.apiSend2MinUrl.trim() : `${base}/send`;
    const SEND_HOURLY_URL = (cfg?.apiSendHourlyUrl && cfg.apiSendHourlyUrl.trim()) ? cfg.apiSendHourlyUrl.trim() : `${base}/send-hourly-vendor`;
    return { SECRET_URL, TESTING_URL, SEND_2MIN_URL, SEND_HOURLY_URL, BASE: base };
  }

  private hourlyScheduler?: NodeJS.Timeout;
  private twoMinScheduler?: NodeJS.Timeout;
  private retryScheduler?: NodeJS.Timeout;

  constructor(private db: DatabaseService) {}

  // ============================================================================
  // CONFIGURATION MANAGEMENT
  // ============================================================================
  getSparingConfig(): SparingConfig | null {
    const row = this.db.getDb().prepare('SELECT * FROM sparing_config LIMIT 1').get() as any;
    if (!row) return null;

    return {
      id: row.id,
      loggerId: row.logger_id,
      apiBase: row.api_base || undefined,
      apiSecretUrl: row.api_secret_url || undefined,
      apiSendHourlyUrl: row.api_send_hourly_url || undefined,
      apiSend2MinUrl: row.api_send_2min_url || undefined,
      apiTestingUrl: row.api_testing_url || undefined,
      apiSecret: row.api_secret,
      apiSecretFetchedAt: row.api_secret_fetched_at,
      enabled: Boolean(row.enabled),
      sendMode: row.send_mode,
      lastHourlySend: row.last_hourly_send,
      last2MinSend: row.last_2min_send,
      retryMaxAttempts: row.retry_max_attempts || undefined,
      retryIntervalMinutes: row.retry_interval_minutes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  upsertSparingConfig(config: Partial<SparingConfig>): SparingConfig {
    const existing = this.getSparingConfig();
    const now = Date.now();

    if (existing) {
      const updated = {
        ...existing,
        ...config,
        updatedAt: now,
      };

      this.db
        .getDb()
        .prepare(
          `UPDATE sparing_config 
           SET logger_id = ?, api_secret = ?, api_secret_fetched_at = ?, 
               enabled = ?, send_mode = ?, last_hourly_send = ?, last_2min_send = ?, api_base = ?, 
               api_secret_url = ?, api_send_hourly_url = ?, api_send_2min_url = ?, api_testing_url = ?, 
               retry_max_attempts = ?, retry_interval_minutes = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          updated.loggerId,
          updated.apiSecret || null,
          updated.apiSecretFetchedAt || null,
          updated.enabled ? 1 : 0,
          updated.sendMode,
          updated.lastHourlySend || null,
          (updated as any).last2MinSend || null,
          updated.apiBase || null,
          updated.apiSecretUrl || null,
          updated.apiSendHourlyUrl || null,
          updated.apiSend2MinUrl || null,
          updated.apiTestingUrl || null,
          updated.retryMaxAttempts || null,
          updated.retryIntervalMinutes || null,
          updated.updatedAt,
          updated.id
        );

      return updated;
    } else {
      const newConfig: SparingConfig = {
        id: uuidv4(),
        loggerId: config.loggerId || '',
        apiSecret: config.apiSecret,
        apiSecretFetchedAt: config.apiSecretFetchedAt,
        enabled: config.enabled || false,
        sendMode: config.sendMode || 'hourly',
        lastHourlySend: config.lastHourlySend,
        createdAt: now,
        updatedAt: now,
      };

      this.db
        .getDb()
        .prepare(
          `INSERT INTO sparing_config 
           (id, logger_id, api_secret, api_secret_fetched_at, enabled, send_mode, last_hourly_send, last_2min_send, api_base, api_secret_url, api_send_hourly_url, api_send_2min_url, api_testing_url, retry_max_attempts, retry_interval_minutes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newConfig.id,
          newConfig.loggerId,
          newConfig.apiSecret || null,
          newConfig.apiSecretFetchedAt || null,
          newConfig.enabled ? 1 : 0,
          newConfig.sendMode,
          newConfig.lastHourlySend || null,
          null,
          newConfig.apiBase || null,
          newConfig.apiSecretUrl || null,
          newConfig.apiSendHourlyUrl || null,
          newConfig.apiSend2MinUrl || null,
          newConfig.apiTestingUrl || null,
          newConfig.retryMaxAttempts || null,
          newConfig.retryIntervalMinutes || null,
          newConfig.createdAt,
          newConfig.updatedAt
        );

      return newConfig;
    }
  }

  async fetchApiSecret(): Promise<string> {
    try {
      getLogger().info('Fetching SPARING API Secret from KLHK...');
      const { SECRET_URL } = this.getApiUrls();
      const response = await this.httpRequest(SECRET_URL, 'GET', undefined, { acceptText: true });
      let apiSecret: string;
      try {
        const obj = JSON.parse(response);
        apiSecret = obj.secret || obj.api_secret || String(response).trim();
      } catch {
        apiSecret = String(response).trim();
      }

      this.upsertSparingConfig({
        apiSecret: apiSecret,
        apiSecretFetchedAt: Date.now(),
      });

      getLogger().info('✅ API Secret fetched successfully');
      return apiSecret;
    } catch (error: any) {
      getLogger().error('❌ Failed to fetch API Secret:', error.message);
      throw new Error(`Failed to fetch API Secret: ${error.message}`);
    }
  }

  // ============================================================================
  // PARAMETER MAPPING MANAGEMENT
  // ============================================================================
  getSparingMappings(): SparingMapping[] {
    const rows = this.db
      .getDb()
      .prepare('SELECT * FROM sparing_mappings ORDER BY created_at ASC')
      .all() as any[];

    return rows.map((row) => ({
      id: row.id,
      sparingParam: row.sparing_param,
      mappingId: row.mapping_id,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
    }));
  }

  upsertSparingMapping(sparingParam: string, mappingId: string): SparingMapping {
    const existing = this.db
      .getDb()
      .prepare('SELECT * FROM sparing_mappings WHERE sparing_param = ?')
      .get(sparingParam) as any;

    if (existing) {
      this.db
        .getDb()
        .prepare('UPDATE sparing_mappings SET mapping_id = ?, enabled = 1 WHERE id = ?')
        .run(mappingId, existing.id);

      return {
        id: existing.id,
        sparingParam,
        mappingId,
        enabled: true,
        createdAt: existing.created_at,
      };
    } else {
      const id = uuidv4();
      const now = Date.now();

      this.db
        .getDb()
        .prepare('INSERT INTO sparing_mappings (id, sparing_param, mapping_id, enabled, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, sparingParam, mappingId, 1, now);

      return {
        id,
        sparingParam,
        mappingId,
        enabled: true,
        createdAt: now,
      };
    }
  }

  deleteSparingMapping(id: string): void {
    this.db.getDb().prepare('DELETE FROM sparing_mappings WHERE id = ?').run(id);
    getLogger().info(`Deleted SPARING mapping: ${id}`);
  }

  // ============================================================================
  // JWT ENCRYPTION
  // ============================================================================
  private base64UrlEncode(data: string): string {
    const base64 = Buffer.from(data).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  encryptJWT(payload: any, apiSecret: string): string {
    try {
      const header = {
        typ: 'JWT',
        alg: 'HS256',
      };

      const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
      const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));

      const dataToSign = `${encodedHeader}.${encodedPayload}`;

      const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(dataToSign)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const jwt = `${dataToSign}.${signature}`;
      return jwt;
    } catch (error: any) {
      getLogger().error('❌ JWT encryption failed:', error.message);
      throw new Error(`JWT encryption failed: ${error.message}`);
    }
  }

  // ============================================================================
  // DATA COLLECTION & PREPARATION
  // ============================================================================
  async collectHourlyData(hourTimestamp: number): Promise<SparingHourlyData | null> {
    const config = this.getSparingConfig();
    if (!config || !config.loggerId) {
      getLogger().error('❌ SPARING config not found or logger ID missing');
      return null;
    }

    const mappings = this.getSparingMappings().filter((m) => m.enabled);
    if (mappings.length === 0) {
      getLogger().error('❌ No SPARING mappings configured');
      return null;
    }

    const startTime = hourTimestamp;
    const endTime = hourTimestamp + 60 * 60 * 1000;

    const mappingIds = mappings.map((m) => m.mappingId);

    const query = `
      SELECT * FROM historical_data 
      WHERE timestamp >= ? AND timestamp < ? 
        AND mapping_id IN (${mappingIds.map(() => '?').join(',')})
      ORDER BY timestamp ASC
    `;

    const rows = this.db.getDb().prepare(query).all(startTime, endTime, ...mappingIds) as any[];

    getLogger().info(`📊 Found ${rows.length} historical records for hour ${new Date(hourTimestamp).toISOString()}`);

    if (rows.length === 0) {
      return null;
    }

    const dataByTimestamp = new Map<number, any>();

    // Align all records to 2-minute bins within the target hour (alignment tolerance)
    const startSeconds = Math.floor(startTime / 1000);
    const BIN_SECONDS = 120;

    rows.forEach((row) => {
      const timestamp = row.timestamp;
      const mappingId = row.mapping_id;
      const value = JSON.parse(row.value);

      const mapping = mappings.find((m) => m.mappingId === mappingId);
      if (!mapping) return;

      // Compute the bin start (aligned to 2-minute)
      const seconds = Math.floor(timestamp / 1000);
      const offset = seconds - startSeconds;
      const binIndex = Math.floor(offset / BIN_SECONDS);
      const binSeconds = startSeconds + binIndex * BIN_SECONDS;

      if (!dataByTimestamp.has(binSeconds)) {
        dataByTimestamp.set(binSeconds, {
          datetime: binSeconds,
        });
      }

      dataByTimestamp.get(binSeconds)![mapping.sparingParam] = value;
    });

    let dataArray = Array.from(dataByTimestamp.values());
    dataArray.sort((a, b) => a.datetime - b.datetime);

    if (dataArray.length < 30) {
      getLogger().info(`⚠️ Only ${dataArray.length} records found, interpolating to 30...`);
      dataArray = this.interpolateMissingData(dataArray, hourTimestamp, mappings);
    }

    dataArray = dataArray.slice(0, 30);

    return {
      uid: config.loggerId,
      data: dataArray,
    };
  }

  // Collect a single 2-minute slot using latest values within the slot window
  async collect2MinData(slotTimestamp: number): Promise<SparingHourlyData | null> {
    const config = this.getSparingConfig();
    if (!config || !config.loggerId) {
      getLogger().error('❌ SPARING config not found or logger ID missing');
      return null;
    }

    const mappings = this.getSparingMappings().filter((m) => m.enabled);
    if (mappings.length === 0) {
      getLogger().error('❌ No SPARING mappings configured');
      return null;
    }

    const SLOT_MS = 2 * 60 * 1000;
    const start = slotTimestamp;
    const end = slotTimestamp + SLOT_MS;

    const mappingIds = mappings.map((m) => m.mappingId);
    const query = `
      SELECT * FROM historical_data 
      WHERE timestamp >= ? AND timestamp < ? 
        AND mapping_id IN (${mappingIds.map(() => '?').join(',')})
      ORDER BY timestamp ASC
    `;
    const rows = this.db.getDb().prepare(query).all(start, end, ...mappingIds) as any[];

    if (rows.length === 0) {
      getLogger().info(`⚠️ No records found for slot ${new Date(slotTimestamp).toISOString()}`);
      return null;
    }

    // Pick the latest value per mapping within the slot
    const latestByMapping = new Map<string, any>();
    rows.forEach((row) => {
      const mappingId = row.mapping_id;
      latestByMapping.set(mappingId, row);
    });

    const record: any = { datetime: Math.floor(slotTimestamp / 1000) };
    mappings.forEach((m) => {
      const r = latestByMapping.get(m.mappingId);
      if (r) {
        record[m.sparingParam] = JSON.parse(r.value);
      }
    });

    return {
      uid: config.loggerId,
      data: [record],
    };
  }

  private interpolateMissingData(
    records: any[],
    hourTimestamp: number,
    mappings: SparingMapping[]
  ): any[] {
    const TARGET_COUNT = 30;
    const INTERVAL_SECONDS = 2 * 60;
    const startTimeSeconds = Math.floor(hourTimestamp / 1000);
    const result: any[] = [];

    for (let i = 0; i < TARGET_COUNT; i++) {
      const expectedTime = startTimeSeconds + i * INTERVAL_SECONDS;
      const existing = records.find((r) => r.datetime === expectedTime);

      if (existing) {
        result.push(existing);
      } else {
        const interpolated: any = { datetime: expectedTime };

        mappings.forEach((mapping) => {
          const param = mapping.sparingParam;
          const values = records.filter((r) => r[param] !== undefined).map((r) => r[param]);

          if (values.length > 0) {
            const avg = values.reduce((sum, val) => sum + Number(val), 0) / values.length;
            interpolated[param] = Number(avg.toFixed(2));
          } else {
            interpolated[param] = 0;
          }
        });

        result.push(interpolated);
      }
    }

    return result;
  }

  // ============================================================================
  // HTTP REQUEST HELPER
  // ============================================================================
  private async httpRequest(url: string, method: string, body?: any, opts?: { acceptText?: boolean }): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const headers: any = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'LT-IDP/1.0',
      };

      let bodyString = '';
      if (body) {
        bodyString = JSON.stringify(body);
        headers['Content-Length'] = Buffer.byteLength(bodyString);
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: headers,
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          const is2xx = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          if (!is2xx) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }

          if (opts?.acceptText) {
            resolve(data);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (bodyString) {
        req.write(bodyString);
      }

      req.end();
    });
  }

  // ============================================================================
  // DATA SENDING
  // ============================================================================
  private async sendToSparing(endpoint: string, jwtToken: string): Promise<any> {
    try {
      const payload = { token: jwtToken };
      getLogger().info(`📤 Sending data to ${endpoint}...`);
      getLogger().info(`   🔐 JWT Token (sending): ${jwtToken}`);
      const fileLogger = getLogger();
      try {
        fileLogger.writeToFile(`[SPARING] Endpoint: ${endpoint}\n[SPARING] JWT: ${jwtToken}\n`);
      } catch {}

      // Send and capture raw response for logging, then parse JSON if possible
      const raw = await this.httpRequest(endpoint, 'POST', payload, { acceptText: true });
      let responseData: any;
      try {
        responseData = JSON.parse(raw);
      } catch {
        responseData = { status: false, desc: raw };
      }

      // Log original response body
      const rawPreview = typeof raw === 'string' ? raw.substring(0, 2000) : String(raw);
      getLogger().info(`📥 RAW Response Body: ${rawPreview}${(typeof raw === 'string' && raw.length > 2000) ? '... (truncated)' : ''}`);
      getLogger().info(`📥 Parsed Response:`, responseData);
      try {
        fileLogger.writeToFile(`[SPARING] RAW Response: ${rawPreview}${(typeof raw === 'string' && raw.length > 2000) ? '... (truncated)' : ''}\n`);
      } catch {}

      return {
        status: responseData.status || false,
        desc: responseData.desc || null,
      };
    } catch (error: any) {
      getLogger().error(`❌ Send failed:`, error.message);
      throw new Error(`Send failed: ${error.message}`);
    }
  }

  async sendHourlyBatch(hourTimestamp: number): Promise<void> {
    // Validate timestamp
    if (!hourTimestamp || isNaN(hourTimestamp) || hourTimestamp <= 0) {
      throw new Error(`Invalid hour timestamp: ${hourTimestamp}`);
    }

    getLogger().info(`\n🕐 Starting hourly batch send for ${new Date(hourTimestamp).toISOString()}`);

    const config = this.getSparingConfig();
    if (!config || !config.enabled) {
      getLogger().info('⚠️ SPARING is not enabled');
      return;
    }

    if (!config.apiSecret) {
      getLogger().error('❌ API Secret not configured');
      throw new Error('API Secret not configured');
    }

    try {
      // Duplicate guard: do not send for the same hour twice
      if (config.lastHourlySend) {
        const lastBucket = Math.floor(config.lastHourlySend / (60 * 60 * 1000)) * (60 * 60 * 1000);
        if (lastBucket === hourTimestamp) {
          getLogger().info('⏭️  Skipping hourly send: already sent for this hour');
          return;
        }
      }

      const hourlyData = await this.collectHourlyData(hourTimestamp);
      if (!hourlyData) {
        getLogger().info('⚠️ No data to send');
        return;
      }

      getLogger().info(`📦 Prepared ${hourlyData.data.length} records`);

      // Log the JSON used to create the token
      try {
        const pretty = JSON.stringify(hourlyData, null, 2);
        const preview = pretty.length > 4000 ? pretty.substring(0, 4000) + '\n... (truncated)' : pretty;
        getLogger().info(`📝 JSON used to build JWT (hourly):\n${preview}`);
        try {
          const fileLogger = getLogger();
          fileLogger.writeToFile(`[SPARING] Hourly JSON used to build JWT:\n${preview}\n`);
        } catch {}
      } catch {
        // ignore
      }

      const jwtToken = this.encryptJWT(hourlyData, config.apiSecret);
      getLogger().info(`🔐 Generated JWT (hourly): ${jwtToken}`);
      try {
        const fileLogger = getLogger();
        fileLogger.writeToFile(`[SPARING] Generated JWT (hourly): ${jwtToken}\n`);
      } catch {}

      const startTime = Date.now();
      const { SEND_HOURLY_URL } = this.getApiUrls();
      const response = await this.sendToSparing(SEND_HOURLY_URL, jwtToken);
      const duration = Date.now() - startTime;

      if (response.status) {
        getLogger().info(`✅ Hourly batch sent successfully in ${duration}ms`);

        // Store the hourTimestamp that was sent, not the current time
        // This ensures the duplicate guard works correctly for the next hour
        this.upsertSparingConfig({ lastHourlySend: hourTimestamp });

        this.logSend('hourly', hourTimestamp, hourlyData.data.length, 'success', JSON.stringify(response), duration);
      } else {
        getLogger().error(`❌ SPARING API returned error: ${response.desc}`);
        throw new Error(response.desc || 'Unknown error');
      }
    } catch (error: any) {
      getLogger().error(`❌ Hourly batch send failed:`, error.message);

      await this.addToQueue('hourly', hourTimestamp, error.message);

      this.logSend('hourly', hourTimestamp, 0, 'failed', error.message, 0);
      throw error;
    }
  }

  // ============================================================================
  // QUEUE MANAGEMENT
  // ============================================================================
  private async addToQueue(sendType: 'hourly' | '2min' | 'testing', hourTimestamp: number, errorMessage: string): Promise<void> {
    try {
      const config = this.getSparingConfig();
      if (!config || !config.apiSecret) return;

      const hourlyData = await this.collectHourlyData(hourTimestamp);
      if (!hourlyData) return;

      const jwtToken = this.encryptJWT(hourlyData, config.apiSecret);

      const id = uuidv4();
      const now = Date.now();

      this.db
        .getDb()
        .prepare(
          `INSERT INTO sparing_queue 
           (id, send_type, hour_timestamp, payload, records_count, status, retry_count, last_attempt_at, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, sendType, hourTimestamp, jwtToken, hourlyData.data.length, 'pending', 0, now, errorMessage, now);

      getLogger().info(`📥 Added to retry queue: ${id}`);
    } catch (error: any) {
      getLogger().error('Failed to add to queue:', error.message);
    }
  }

  async processQueue(): Promise<void> {
    const config = this.getSparingConfig();
    const maxAttempts = config?.retryMaxAttempts || 5; // Default to 5 if not configured

    const pending = this.db
      .getDb()
      .prepare(
        `SELECT * FROM sparing_queue 
         WHERE status = 'pending' AND retry_count < ? 
         ORDER BY created_at ASC 
         LIMIT 10`
      )
      .all(maxAttempts) as any[];

    getLogger().info(`🔄 Processing ${pending.length} pending queue items... (max attempts: ${maxAttempts})`);

    for (const item of pending) {
      try {
        this.db.getDb().prepare('UPDATE sparing_queue SET status = ? WHERE id = ?').run('sending', item.id);

        const { SEND_HOURLY_URL, SEND_2MIN_URL, TESTING_URL } = this.getApiUrls();
        let endpoint = SEND_HOURLY_URL;
        if (item.send_type === '2min') endpoint = SEND_2MIN_URL;
        if (item.send_type === 'testing') endpoint = TESTING_URL;

        const response = await this.sendToSparing(endpoint, item.payload);

        if (response.status) {
          this.db.getDb().prepare('UPDATE sparing_queue SET status = ?, sent_at = ? WHERE id = ?').run('sent', Date.now(), item.id);
          getLogger().info(`✅ Queue item ${item.id} sent successfully`);
        } else {
          throw new Error(response.desc || 'Unknown error');
        }
      } catch (error: any) {
        const newRetryCount = item.retry_count + 1;
        const newStatus = newRetryCount >= maxAttempts ? 'failed' : 'pending';
        
        this.db
          .getDb()
          .prepare('UPDATE sparing_queue SET status = ?, retry_count = ?, error_message = ?, last_attempt_at = ? WHERE id = ?')
          .run(newStatus, newRetryCount, error.message, Date.now(), item.id);

        if (newStatus === 'failed') {
          getLogger().error(`❌ Queue item ${item.id} failed permanently after ${maxAttempts} attempts:`, error.message);
        } else {
          getLogger().error(`❌ Queue item ${item.id} failed (attempt ${newRetryCount}/${maxAttempts}):`, error.message);
        }
      }
    }
  }

  // Status helpers
  getQueueDepth(): number {
    const row = this.db.getDb().prepare(`SELECT COUNT(*) as cnt FROM sparing_queue WHERE status = 'pending'`).get() as any;
    return row?.cnt || 0;
  }

  getQueueItems(limit: number = 100): SparingQueue[] {
    const rows = this.db
      .getDb()
      .prepare(
        `SELECT * FROM sparing_queue 
         ORDER BY created_at DESC 
         LIMIT ?`
      )
      .all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      sendType: row.send_type,
      hourTimestamp: row.hour_timestamp,
      payload: row.payload,
      recordsCount: row.records_count,
      status: row.status,
      retryCount: row.retry_count,
      lastAttemptAt: row.last_attempt_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    }));
  }

  getNextRunTimes(): { hourly?: number; twoMin?: number } {
    // Best-effort estimation based on current time and timers
    const now = Date.now();
    const next: any = {};
    if (this.hourlyScheduler) {
      const d = new Date();
      const msUntilNextHour =
        (60 - d.getMinutes()) * 60 * 1000 - d.getSeconds() * 1000 - d.getMilliseconds();
      next.hourly = now + Math.max(msUntilNextHour, 0);
    }
    if (this.twoMinScheduler) {
      const remainder = now % (2 * 60 * 1000);
      next.twoMin = now + ((2 * 60 * 1000) - remainder);
    }
    return next;
  }

  // ============================================================================
  // LOGGING
  // ============================================================================
  private logSend(
    sendType: 'hourly' | '2min' | 'testing',
    hourTimestamp: number | null,
    recordsCount: number,
    status: 'success' | 'failed',
    response: string,
    durationMs: number
  ): void {
    const id = uuidv4();
    const now = Date.now();

    this.db
      .getDb()
      .prepare(
        `INSERT INTO sparing_logs 
         (id, send_type, hour_timestamp, records_count, status, response, duration_ms, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, sendType, hourTimestamp || null, recordsCount, status, response, durationMs, now);
  }

  getSparingLogs(limit: number = 50): SparingLog[] {
    const rows = this.db.getDb().prepare('SELECT * FROM sparing_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      sendType: row.send_type,
      hourTimestamp: row.hour_timestamp,
      recordsCount: row.records_count,
      status: row.status,
      response: row.response,
      durationMs: row.duration_ms,
      timestamp: row.timestamp,
    }));
  }

  // ============================================================================
  // SCHEDULER
  // ============================================================================
  startHourlyScheduler(): void {
    if (this.hourlyScheduler) {
      getLogger().info('⚠️ Hourly scheduler already running');
      return;
    }

    getLogger().info('🕐 Starting SPARING hourly scheduler...');

    const now = new Date();
    const msUntilNextHour =
      (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

    setTimeout(() => {
      this.runHourlyScheduler();
      this.hourlyScheduler = setInterval(() => {
        this.runHourlyScheduler();
      }, 60 * 60 * 1000);
    }, msUntilNextHour);

    // Start retry scheduler with configurable interval
    const config = this.getSparingConfig();
    const retryIntervalMinutes = config?.retryIntervalMinutes || 5; // Default to 5 minutes
    const retryIntervalMs = retryIntervalMinutes * 60 * 1000;
    
    this.retryScheduler = setInterval(() => {
      this.processQueue();
    }, retryIntervalMs);

    getLogger().info(`✅ Scheduler will run in ${Math.round(msUntilNextHour / 1000 / 60)} minutes`);
    getLogger().info(`✅ Retry scheduler will run every ${retryIntervalMinutes} minutes`);
  }

  startTwoMinScheduler(): void {
    if (this.twoMinScheduler) {
      getLogger().info('⚠️ 2-minute scheduler already running');
      return;
    }

    getLogger().info('⏱️ Starting SPARING 2-minute scheduler...');

    const now = Date.now();
    const remainder = now % (2 * 60 * 1000);
    const msUntilNextSlot = (2 * 60 * 1000) - remainder;

    setTimeout(() => {
      this.runTwoMinScheduler();
      this.twoMinScheduler = setInterval(() => {
        this.runTwoMinScheduler();
      }, 2 * 60 * 1000);
    }, msUntilNextSlot);

    getLogger().info(`✅ 2-minute scheduler will run in ${Math.round(msUntilNextSlot / 1000)} seconds`);
  }

  private async runTwoMinScheduler(): Promise<void> {
    getLogger().info('\n' + '-'.repeat(60));
    getLogger().info('⏱️ SPARING 2-minute Scheduler Triggered');
    getLogger().info('-'.repeat(60));

    const config = this.getSparingConfig();
    if (!config || !config.enabled) {
      getLogger().info('⚠️ SPARING is not enabled, skipping...');
      return;
    }

    if (config.sendMode !== '2min' && config.sendMode !== 'both') {
      getLogger().info('⚠️ 2-minute mode not enabled, skipping...');
      return;
    }

    try {
      // First, retry any failed sends from previous slots
      getLogger().info('🔄 Processing failed queue items before sending new 2-minute data...');
      await this.processQueue();

      // Then, send new 2-minute data for the current slot
      const now = Date.now();
      const slotTimestamp = now - (now % (2 * 60 * 1000));

      await this.send2MinBatch(slotTimestamp);
    } catch (error: any) {
      getLogger().error('❌ 2-minute scheduler failed:', error.message);
    }
  }

  private async runHourlyScheduler(): Promise<void> {
    getLogger().info('\n' + '='.repeat(60));
    getLogger().info('🕐 SPARING Hourly Scheduler Triggered');
    getLogger().info('='.repeat(60));

    const config = this.getSparingConfig();
    if (!config || !config.enabled) {
      getLogger().info('⚠️ SPARING is not enabled, skipping...');
      return;
    }

    if (config.sendMode !== 'hourly' && config.sendMode !== 'both') {
      getLogger().info('⚠️ Hourly mode not enabled, skipping...');
      return;
    }

    try {
      // First, retry any failed sends from previous hours
      getLogger().info('🔄 Processing failed queue items before sending new hourly data...');
      await this.processQueue();

      // Then, send new hourly data for the previous hour
      const now = Date.now();
      const previousHour = now - 60 * 60 * 1000;
      const hourTimestamp = Math.floor(previousHour / (60 * 60 * 1000)) * (60 * 60 * 1000);

      await this.sendHourlyBatch(hourTimestamp);
    } catch (error: any) {
      getLogger().error('❌ Hourly scheduler failed:', error.message);
    }
  }

  stopHourlyScheduler(): void {
    if (this.hourlyScheduler) {
      clearInterval(this.hourlyScheduler);
      this.hourlyScheduler = undefined;
      getLogger().info('🛑 Hourly scheduler stopped');
    }

    if (this.twoMinScheduler) {
      clearInterval(this.twoMinScheduler);
      this.twoMinScheduler = undefined;
      getLogger().info('🛑 2-minute scheduler stopped');
    }

    if (this.retryScheduler) {
      clearInterval(this.retryScheduler);
      this.retryScheduler = undefined;
      getLogger().info('🛑 Retry scheduler stopped');
    }
  }

  async sendNow(hourTimestamp?: number): Promise<void> {
    let timestamp: number;
    if (hourTimestamp) {
      timestamp = hourTimestamp;
    } else {
      // Align to previous hour boundary (like scheduler does)
      const now = Date.now();
      const previousHour = now - 60 * 60 * 1000;
      timestamp = Math.floor(previousHour / (60 * 60 * 1000)) * (60 * 60 * 1000);
    }
    await this.sendHourlyBatch(timestamp);
  }

  async send2MinBatch(slotTimestamp: number): Promise<void> {
    getLogger().info(`\n⏱️ Starting 2-minute send for slot ${new Date(slotTimestamp).toISOString()}`);

    const config = this.getSparingConfig();
    if (!config || !config.enabled) {
      getLogger().info('⚠️ SPARING is not enabled');
      return;
    }

    if (!config.apiSecret) {
      getLogger().error('❌ API Secret not configured');
      throw new Error('API Secret not configured');
    }

    try {
      // Duplicate guard: do not send for the same 2-minute slot twice
      const last2 = (config as any).last2MinSend as number | undefined;
      if (last2) {
        const lastSlot = last2 - (last2 % (2 * 60 * 1000));
        const thisSlot = slotTimestamp - (slotTimestamp % (2 * 60 * 1000));
        if (lastSlot === thisSlot) {
          getLogger().info('⏭️  Skipping 2-minute send: already sent for this slot');
          return;
        }
      }

      const twoMinData = await this.collect2MinData(slotTimestamp);
      if (!twoMinData) {
        getLogger().info('⚠️ No data to send for this 2-minute slot');
        return;
      }

      // Log the JSON used to create the token for 2-min send
      try {
        const pretty = JSON.stringify(twoMinData, null, 2);
        const preview = pretty.length > 4000 ? pretty.substring(0, 4000) + '\n... (truncated)' : pretty;
        getLogger().info(`📝 JSON used to build JWT (2-min):\n${preview}`);
        try {
          const fileLogger = getLogger();
          fileLogger.writeToFile(`[SPARING] 2-min JSON used to build JWT:\n${preview}\n`);
        } catch {}
      } catch {
        // ignore
      }

      const jwtToken = this.encryptJWT(twoMinData, config.apiSecret);
      getLogger().info(`🔐 Generated JWT (2-min): ${jwtToken}`);
      try {
        const fileLogger = getLogger();
        fileLogger.writeToFile(`[SPARING] Generated JWT (2-min): ${jwtToken}\n`);
      } catch {}

      const startTime = Date.now();
      const { SEND_2MIN_URL } = this.getApiUrls();
      const response = await this.sendToSparing(SEND_2MIN_URL, jwtToken);
      const duration = Date.now() - startTime;

      if (response.status) {
        getLogger().info(`✅ 2-minute data sent successfully in ${duration}ms`);

        // Store the slotTimestamp that was sent, not the current time
        // This ensures the duplicate guard works correctly for the next slot
        this.upsertSparingConfig({ last2MinSend: slotTimestamp } as any);

        this.logSend('2min', slotTimestamp, twoMinData.data.length, 'success', JSON.stringify(response), duration);
      } else {
        getLogger().error(`❌ SPARING API returned error: ${response.desc}`);
        throw new Error(response.desc || 'Unknown error');
      }
    } catch (error: any) {
      getLogger().error(`❌ 2-minute send failed:`, error.message);

      await this.addToQueue('2min', slotTimestamp, error.message);

      this.logSend('2min', slotTimestamp, 0, 'failed', error.message, 0);
      throw error;
    }
  }

  async sendTestData(): Promise<void> {
    // Similar to sendHourlyBatch but for testing
    // Implementation can be added if needed
    throw new Error('Test data sending not yet implemented');
  }
}

