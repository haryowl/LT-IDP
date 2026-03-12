import axios from 'axios';
import https from 'https';
import { EventEmitter } from 'events';
import type { DatabaseService } from './database';
import type { Publisher, RealtimeData } from '../types';

interface HttpClientConnection {
  publisher: Publisher;
  client: any;
  buffer: RealtimeData[];
  flushTimer?: NodeJS.Timeout;
}

interface HttpLikeConfig {
  name?: string;
  httpUrl?: string;
  httpMethod?: string;
  httpHeaders?: string | Record<string, string>;
  useJwt?: boolean;
  jwtToken?: string;
  jwtHeader?: string;
  jsonFormat?: 'simple' | 'custom';
  customJsonTemplate?: string;
}

export class HttpClientService extends EventEmitter {
  private connections: Map<string, HttpClientConnection> = new Map();

  constructor(private db: DatabaseService) {
    super();
  }

  private buildTemplateContext(
    publisher: Publisher,
    data: RealtimeData | null,
    batch: RealtimeData[] = []
  ): Record<string, any> {
    const clientId = this.db.getClientId();
    return {
      clientId,
      mappingId: data?.mappingId ?? '',
      mappingName: data?.mappingName ?? '',
      parameterId: data?.parameterId ?? '',
      value: data?.value,
      unit: data?.unit ?? '',
      quality: data?.quality ?? '',
      timestamp: data?.timestamp ?? Date.now(),
      data,
      batch,
      publisher,
      JSON,
      Math,
      Date,
    };
  }

  private renderTemplate(template: string, context: Record<string, any>): any {
    const keys = Object.keys(context);
    const values = Object.values(context);
    let body = template.trim();
    if (!/^return\b/i.test(body)) {
      body = `return (${body});`;
    }
    const fn = new Function(...keys, body);
    return fn(...values);
  }

  private applyLegacyTemplate(template: string, context: Record<string, any>): any {
    try {
      let rendered = template;
      rendered = rendered.replace(/{clientId}/g, (context.clientId ?? '').toString());
      rendered = rendered.replace(/{parameterId}/g, (context.parameterId ?? '').toString());
      rendered = rendered.replace(/{mappingId}/g, (context.mappingId ?? '').toString());
      rendered = rendered.replace(/{mappingName}/g, (context.mappingName ?? '').toString());
      rendered = rendered.replace(/{unit}/g, (context.unit ?? '').toString());
      rendered = rendered.replace(/{quality}/g, (context.quality ?? '').toString());
      rendered = rendered.replace(/{timestamp}/g, (context.timestamp ?? '').toString());
      rendered = rendered.replace(/{value}/g, JSON.stringify(context.value));
      try {
        return JSON.parse(rendered);
      } catch {
        return rendered;
      }
    } catch {
      return template;
    }
  }

  private createClient(config: HttpLikeConfig) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.httpHeaders) {
      if (typeof config.httpHeaders === 'string') {
        try {
          Object.assign(headers, JSON.parse(config.httpHeaders));
        } catch (_) {}
      } else {
        Object.assign(headers, config.httpHeaders);
      }
    }

    const client = axios.create({
      baseURL: config.httpUrl,
      timeout: 30000,
      headers,
      httpsAgent: new https.Agent({
        rejectUnauthorized: true,
      }),
    });

    if (config.useJwt && config.jwtToken) {
      const headerName = config.jwtHeader || 'Authorization';
      const headerValue = config.jwtToken.startsWith('Bearer ')
        ? config.jwtToken
        : `Bearer ${config.jwtToken}`;
      client.defaults.headers.common[headerName] = headerValue;
    }

    return client;
  }

  private async sendRequestWithClient(client: any, method: string | undefined, payload: any): Promise<void> {
    const normalized = method?.toLowerCase() || 'post';
    try {
      if (normalized === 'post') {
        await client.post('', payload);
      } else if (normalized === 'put') {
        await client.put('', payload);
      } else {
        throw new Error(`HTTP method ${method} is not supported`);
      }
    } catch (error: any) {
      console.error(`HTTP request error:`, error.message);
      throw error;
    }
  }

  async sendConfiguredRequest(config: HttpLikeConfig, templateContext: Record<string, any>, fallbackPayload: any): Promise<any> {
    const client = this.createClient(config);
    let payload = fallbackPayload;
    if (config.jsonFormat === 'custom' && config.customJsonTemplate) {
      try {
        payload = this.renderTemplate(config.customJsonTemplate, templateContext);
      } catch (error) {
        console.error('Error applying custom JSON template, falling back to legacy template handling:', error);
        payload = this.applyLegacyTemplate(config.customJsonTemplate, templateContext);
      }
    }
    await this.sendRequestWithClient(client, config.httpMethod, payload);
    return payload;
  }

  async start(publisherId: string): Promise<void> {
    const publisher = this.db.getPublisherById(publisherId);
    if (!publisher || publisher.type !== 'http') {
      throw new Error(`HTTP Publisher ${publisherId} not found`);
    }
    if (!publisher.enabled) {
      throw new Error(`Publisher ${publisher.name} is disabled`);
    }

    if (this.connections.has(publisherId)) {
      throw new Error(`Publisher ${publisher.name} is already running`);
    }

    try {
      const client = this.createClient(publisher);

      const connection: HttpClientConnection = {
        publisher,
        client,
        buffer: [],
      };

      this.connections.set(publisherId, connection);
      this.emit('started', publisherId);
      this.emit('log', {
        type: 'publisher',
        level: 'info',
        message: `HTTP Publisher "${publisher.name}" started - URL: ${publisher.httpUrl}`,
        publisherId,
        publisherName: publisher.name,
        timestamp: Date.now(),
      });

      this.processBufferQueue(publisherId);

      if (publisher.mode === 'buffer' || publisher.mode === 'both') {
        if (publisher.bufferFlushInterval) {
          connection.flushTimer = setInterval(() => {
            this.flushBuffer(publisherId);
          }, publisher.bufferFlushInterval);
        }
      }
    } catch (error: any) {
      this.emit('error', publisherId, error);
      this.emit('log', {
        type: 'publisher',
        level: 'error',
        message: `Failed to start HTTP Publisher "${publisher.name}": ${error.message}`,
        publisherId,
        publisherName: publisher.name,
        timestamp: Date.now(),
        error: error.message,
      });
      throw error;
    }
  }

  async stop(publisherId: string): Promise<void> {
    const connection = this.connections.get(publisherId);
    if (!connection) {
      return;
    }

    if (connection.flushTimer) {
      clearInterval(connection.flushTimer);
    }

    await this.flushBuffer(publisherId);
    this.connections.delete(publisherId);
    this.emit('stopped', publisherId);
    this.emit('log', {
      type: 'publisher',
      level: 'info',
      message: `HTTP Publisher "${connection.publisher.name}" stopped`,
      publisherId,
      publisherName: connection.publisher.name,
      timestamp: Date.now(),
    });
  }

  async publish(publisherId: string, data: RealtimeData): Promise<void> {
    console.log(`   📥 [HTTP PUBLISHER] Received data for publisher ID: ${publisherId}`);
    console.log(`      Data: ${data.mappingName} = ${data.value} (ID: ${data.mappingId})`);

    const connection = this.connections.get(publisherId);
    if (!connection) {
      console.log(`   ⚠️  [HTTP PUBLISHER] Publisher ${publisherId} is NOT CONNECTED - queuing to database buffer`);
      this.db.enqueueBuffer({
        publisherId,
        data,
        timestamp: Date.now(),
        attempts: 0,
        status: 'pending',
      });
      return;
    }

    const publisher = connection.publisher;
    const shouldPublish = publisher.mappingIds.length === 0 || publisher.mappingIds.includes(data.mappingId);
    
    console.log(`   🔍 [HTTP PUBLISHER] "${publisher.name}" filter check:`);
    console.log(`      Publisher mapping filter: ${publisher.mappingIds.length === 0 ? 'ALL (no filter)' : `[${publisher.mappingIds.join(', ')}]`}`);
    console.log(`      Data mapping ID: ${data.mappingId}`);
    console.log(`      Should publish: ${shouldPublish ? '✅ YES' : '❌ NO (filtered out)'}`);

    if (publisher.mappingIds.length > 0 && !publisher.mappingIds.includes(data.mappingId)) {
      console.log(`   ⏭️  [HTTP PUBLISHER] "${publisher.name}" SKIPPING - mapping ID "${data.mappingId}" not in filter list`);
      return;
    }

    const payload = this.formatPayload(publisher, data);
    console.log(`   📝 [HTTP PUBLISHER] "${publisher.name}" formatted payload (mode: ${publisher.mode})`);
    
    // Log the actual JSON payload being sent
    console.log(`   📄 [HTTP PUBLISHER] "${publisher.name}" JSON Payload:`);
    try {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      const preview = payloadStr.length > 500 ? payloadStr.substring(0, 500) + '\n... (truncated)' : payloadStr;
      console.log(`      ${preview.split('\n').join('\n      ')}`);
    } catch (e) {
      console.log(`      ${JSON.stringify(payload).substring(0, 200)}...`);
    }

    if (publisher.mode === 'realtime' || publisher.mode === 'both') {
      console.log(`   🚀 [HTTP PUBLISHER] "${publisher.name}" sending in REALTIME mode to URL: "${publisher.httpUrl}"`);
      try {
        await this.sendRequest(connection, payload);
        console.log(`   ✅ [HTTP PUBLISHER] "${publisher.name}" SUCCESSFULLY PUBLISHED: ${data.mappingName} = ${data.value}`);
        this.emit('log', {
          type: 'publisher',
          level: 'info',
          message: `Published data: ${data.mappingName} = ${data.value} to ${publisher.httpUrl}`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
          data: {
            mappingName: data.mappingName,
            value: data.value,
            url: publisher.httpUrl,
          },
        });
      } catch (error: any) {
        console.error(`   ❌ [HTTP PUBLISHER] "${publisher.name}" PUBLISH FAILED: ${error.message}`);
        this.emit('log', {
          type: 'publisher',
          level: 'error',
          message: `Failed to publish data: ${data.mappingName} = ${data.value} - ${error.message}`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
          error: error.message,
        });
        throw error;
      }
    }

    if (publisher.mode === 'buffer' || publisher.mode === 'both') {
      connection.buffer.push(data);
      const bufferSize = connection.buffer.length;
      const maxBufferSize = publisher.bufferSize || 100;
      console.log(`   📦 [HTTP PUBLISHER] "${publisher.name}" added to buffer (${bufferSize}/${maxBufferSize} items)`);

      if (bufferSize >= maxBufferSize) {
        console.log(`   🔄 [HTTP PUBLISHER] "${publisher.name}" buffer full, flushing...`);
        await this.flushBuffer(publisherId);
      }
    }
  }

  private async sendRequest(connection: HttpClientConnection, payload: any): Promise<void> {
    await this.sendRequestWithClient(connection.client, connection.publisher.httpMethod, payload);
  }

  private async flushBuffer(publisherId: string): Promise<void> {
    const connection = this.connections.get(publisherId);
    if (!connection || connection.buffer.length === 0) {
      return;
    }

    const batch = connection.buffer.splice(0, connection.buffer.length);
    let payload: any;

    if (connection.publisher.jsonFormat === 'custom' && connection.publisher.customJsonTemplate) {
      const context = this.buildTemplateContext(connection.publisher, batch[batch.length - 1] ?? null, batch);
      try {
        payload = this.renderTemplate(connection.publisher.customJsonTemplate, context);
      } catch (error) {
        console.error(
          `Error applying custom batch template for HTTP publisher ${connection.publisher.name}, falling back to default format:`,
          error
        );
        payload = {
          batch: batch.map((data) => ({
            name: data.mappingName,
            parameterId: data.parameterId,
            value: data.value,
            unit: data.unit,
            timestamp: data.timestamp,
            quality: data.quality,
          })),
          count: batch.length,
          timestamp: Date.now(),
        };
      }
    } else {
      payload = {
        batch: batch.map((data) => ({
          name: data.mappingName,
          parameterId: data.parameterId,
          value: data.value,
          unit: data.unit,
          timestamp: data.timestamp,
          quality: data.quality,
        })),
        count: batch.length,
        timestamp: Date.now(),
      };
    }

    // Log the batch JSON payload being sent
    console.log(`   📦 [HTTP PUBLISHER] "${connection.publisher.name}" flushing buffer with ${batch.length} items`);
    try {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      const preview = payloadStr.length > 1000 ? payloadStr.substring(0, 1000) + '\n... (truncated)' : payloadStr;
      console.log(`   📄 [HTTP PUBLISHER] "${connection.publisher.name}" Batch JSON Payload:`);
      console.log(`      ${preview.split('\n').join('\n      ')}`);
    } catch (e) {
      console.log(`   📄 [HTTP PUBLISHER] "${connection.publisher.name}" Batch JSON Payload: ${JSON.stringify(payload).substring(0, 200)}...`);
    }

    try {
      console.log(`   🚀 [HTTP PUBLISHER] "${connection.publisher.name}" sending BATCH to URL: "${connection.publisher.httpUrl}"`);
      await this.sendRequest(connection, payload);
      console.log(`   ✅ [HTTP PUBLISHER] "${connection.publisher.name}" SUCCESSFULLY PUBLISHED BATCH: ${batch.length} items`);
      this.emit('log', {
        type: 'publisher',
        level: 'info',
        message: `Flushed buffer: ${batch.length} items to ${connection.publisher.httpUrl}`,
        publisherId,
        publisherName: connection.publisher.name,
        timestamp: Date.now(),
        data: {
          itemCount: batch.length,
          url: connection.publisher.httpUrl,
        },
      });
    } catch (error: any) {
      console.error(`Error flushing buffer for publisher ${publisherId}:`, error);
      this.emit('log', {
        type: 'publisher',
        level: 'error',
        message: `Failed to flush buffer: ${batch.length} items - ${error.message}`,
        publisherId,
        publisherName: connection.publisher.name,
        timestamp: Date.now(),
        error: error.message,
        data: {
          itemCount: batch.length,
        },
      });

      batch.forEach((data) => {
        this.db.enqueueBuffer({
          publisherId,
          data,
          timestamp: Date.now(),
          attempts: 0,
          status: 'pending',
        });
      });
    }
  }

  private async processBufferQueue(publisherId: string): Promise<void> {
    const connection = this.connections.get(publisherId);
    if (!connection) {
      return;
    }

    const publisher = connection.publisher;
    const pendingItems = this.db.getPendingBufferItems(publisherId, 1000);

    for (const item of pendingItems) {
      try {
        const payload = this.formatPayload(publisher, item.data);
        await this.sendRequest(connection, payload);
        this.db.updateBufferItemStatus(item.id, 'sent', item.attempts + 1);
      } catch (error: any) {
        console.error(`Error sending buffered item ${item.id}:`, error);
        const newAttempts = item.attempts + 1;
        if (newAttempts >= (publisher.retryAttempts || 3)) {
          this.db.updateBufferItemStatus(item.id, 'failed', newAttempts);
        } else {
          this.db.updateBufferItemStatus(item.id, 'pending', newAttempts);
        }
        if (publisher.retryDelay) {
          await new Promise((resolve) => setTimeout(resolve, publisher.retryDelay));
        }
      }
    }

    pendingItems
      .filter((item) => item.status === 'sent')
      .forEach((item) => this.db.deleteBufferItem(item.id));
  }

  private formatPayload(publisher: Publisher, data: RealtimeData): any {
    if (publisher.jsonFormat === 'custom' && publisher.customJsonTemplate) {
      const context = this.buildTemplateContext(publisher, data, [data]);
      try {
        return this.renderTemplate(publisher.customJsonTemplate, context);
      } catch (error) {
        console.error('Error applying custom JSON template, falling back to legacy template handling:', error);
        return this.applyLegacyTemplate(publisher.customJsonTemplate, context);
      }
    }

    const simplePayload: any = {
      name: data.mappingName,
      value: data.value,
      unit: data.unit,
      timestamp: data.timestamp,
      quality: data.quality,
    };

    const clientId = this.db.getClientId();
    if (clientId) {
      simplePayload.clientId = clientId;
    }
    if (data.parameterId) {
      simplePayload.parameterId = data.parameterId;
    }

    return simplePayload;
  }

  cleanup(): void {
    for (const publisherId of this.connections.keys()) {
      this.stop(publisherId);
    }
  }

  refreshPublisher(publisherId: string): void {
    const connection = this.connections.get(publisherId);
    if (!connection) {
      return;
    }

    const updated = this.db.getPublisherById(publisherId);
    if (updated) {
      connection.publisher = updated;
      console.log(`Refreshed HTTP publisher configuration for ${updated.name}`);
    }
  }
}

