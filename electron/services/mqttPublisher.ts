import mqtt, { MqttClient } from 'mqtt';
import type { Publisher, RealtimeData } from '../types';
import type { DatabaseService } from './database';
import { EventEmitter } from 'events';
import fs from 'fs';
import { getLogger } from './logger';

const log = getLogger();

interface PublisherConnection {
  publisher: Publisher;
  client: MqttClient;
  buffer: RealtimeData[];
  flushTimer?: NodeJS.Timeout;
  scheduledTimer?: NodeJS.Timeout;
  reconnectTimer?: NodeJS.Timeout;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  isReconnecting: boolean;
}

export class MqttPublisherService extends EventEmitter {
  private connections: Map<string, PublisherConnection> = new Map();
  // Cache latest values for each mapping ID per publisher
  private mappingCache: Map<string, Map<string, RealtimeData>> = new Map();
  
  private buildTemplateContext(
    publisher: Publisher,
    data: RealtimeData | null,
    batch: RealtimeData[] = [],
    publisherId?: string
  ): Record<string, any> {
    const clientId = this.db.getClientId();
    
    // Get all cached mappings for this publisher
    let allMappings: RealtimeData[] = [];
    if (publisherId) {
      const cache = this.mappingCache.get(publisherId);
      if (cache) {
        allMappings = Array.from(cache.values());
      }
    }
    
    // Combine batch with cached mappings (deduplicate by mappingId, prefer batch)
    const mappingMap = new Map<string, RealtimeData>();
    // First add cached mappings
    allMappings.forEach(m => mappingMap.set(m.mappingId, m));
    // Then add batch mappings (overwrite cached with newer batch values)
    batch.forEach(m => mappingMap.set(m.mappingId, m));
    // Finally add current data if provided
    if (data) {
      mappingMap.set(data.mappingId, data);
    }
    
    const combinedBatch = Array.from(mappingMap.values());
    
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
      batch: combinedBatch, // Use combined batch with all cached mappings
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

  private applyLegacyTemplate(template: string, context: Record<string, any>): string {
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
        return JSON.stringify(JSON.parse(rendered));
      } catch {
        return rendered;
      }
    } catch {
      return template;
    }
  }


  constructor(private db: DatabaseService) {
    super();
  }

  async start(publisherId: string): Promise<void> {
    const publisher = this.db.getPublisherById(publisherId);

    if (!publisher || publisher.type !== 'mqtt') {
      throw new Error(`MQTT Publisher ${publisherId} not found`);
    }

    if (!publisher.enabled) {
      throw new Error(`Publisher ${publisher.name} is disabled`);
    }

    // Check if already started
    if (this.connections.has(publisherId)) {
      throw new Error(`Publisher ${publisher.name} is already running`);
    }

    try {
      const options: mqtt.IClientOptions = {
        clientId: `publisher_${publisherId}_${Date.now()}`,
        keepalive: 30, // Reduced from 60 to 30 seconds for better reliability
        reconnectPeriod: 0, // Disable automatic reconnection, we'll handle it manually
        clean: true,
        connectTimeout: 30000, // 30 second connection timeout
      };

      // Add authentication
      if (publisher.mqttUsername) {
        options.username = publisher.mqttUsername;
      }
      if (publisher.mqttPassword) {
        options.password = publisher.mqttPassword;
      }

      // Add TLS/SSL
      if (publisher.mqttUseTls) {
        options.protocol = (publisher.mqttProtocol?.includes('s') ? publisher.mqttProtocol : 'mqtts') as any;
      }

      const brokerUrl = `${publisher.mqttProtocol}://${publisher.mqttBroker}:${publisher.mqttPort}`;
      const client = mqtt.connect(brokerUrl, options);

      const connection: PublisherConnection = {
        publisher,
        client,
        buffer: [],
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        isReconnecting: false,
      };

      this.connections.set(publisherId, connection);

      // Setup event handlers
      client.on('connect', () => {
        log.info(`MQTT Publisher connected: ${publisher.name}`);
        // Reset reconnect attempts on successful connection
        connection.reconnectAttempts = 0;
        connection.isReconnecting = false;
        
        this.emit('connected', publisherId);
        this.emit('log', {
          type: 'publisher',
          level: 'info',
          message: `MQTT Publisher "${publisher.name}" connected to ${publisher.mqttBroker}:${publisher.mqttPort}`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
        });

        // Process any pending buffer items from database
        // Skip immediate buffer processing when scheduled publishing is enabled
        if (!publisher.scheduledEnabled) {
          this.processBufferQueue(publisherId);
        } else {
          log.info(`   ⏸️  [MQTT PUBLISHER] Skipping buffer processing on connect because scheduled publishing is enabled`);
        }

        // Start flush timer if using buffer mode
        if (publisher.mode === 'buffer' || publisher.mode === 'both') {
          if (publisher.bufferFlushInterval) {
            connection.flushTimer = setInterval(() => {
              this.flushBuffer(publisherId);
            }, publisher.bufferFlushInterval);
          }
        }

        // Start scheduled publishing if enabled
        if (publisher.scheduledEnabled && publisher.scheduledInterval && publisher.scheduledIntervalUnit) {
          this.startScheduledPublishing(publisherId);
        }
      });

      // Explicitly handle keepalive timeout event
      // Note: keepaliveTimeout is not in the official MQTT types, but it exists in the runtime
      (client as any).on('keepaliveTimeout', () => {
        log.warn(`MQTT Publisher keepalive timeout for ${publisher.name}`);
        this.emit('log', {
          type: 'publisher',
          level: 'warning',
          message: `MQTT Publisher "${publisher.name}" keepalive timeout detected`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
        });
        
        // Handle the timeout gracefully
        this.handleConnectionError(publisherId);
      });

      client.on('error', (error) => {
        log.error(`MQTT Publisher error for ${publisher.name}:`, error);
        
        // Safely emit error - catch if no listeners
        try {
          if (this.listenerCount('error') > 0) {
            this.emit('error', publisherId, error);
          }
        } catch (err) {
          // Ignore if no error listeners
        }
        
        this.emit('log', {
          type: 'publisher',
          level: 'error',
          message: `MQTT Publisher "${publisher.name}" error: ${error.message || 'Unknown error'}`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
          error: error.message || 'Unknown error',
        });
        
        // Handle keepalive timeout and other connection errors
        if (error.message?.includes('keepalive') || 
            error.message?.includes('timeout') || 
            error.message?.includes('ECONNRESET') ||
            error.message?.includes('ENOTFOUND') ||
            error.message?.includes('ECONNREFUSED')) {
          this.handleConnectionError(publisherId);
        }
      });

      client.on('close', () => {
        log.info(`MQTT Publisher connection closed: ${publisher.name}`);
        this.emit('disconnected', publisherId);
        this.emit('log', {
          type: 'publisher',
          level: 'warning',
          message: `MQTT Publisher "${publisher.name}" connection closed`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
        });
        
        // Attempt to reconnect if not already reconnecting
        if (!connection.isReconnecting) {
          this.handleConnectionError(publisherId);
        }
      });

      // Handle offline event
      client.on('offline', () => {
        log.info(`MQTT Publisher went offline: ${publisher.name}`);
        this.emit('log', {
          type: 'publisher',
          level: 'warning',
          message: `MQTT Publisher "${publisher.name}" went offline`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
        });
      });
    } catch (error: any) {
      // Safely emit error - catch if no listeners
      try {
        if (this.listenerCount('error') > 0) {
          this.emit('error', publisherId, error);
        }
      } catch (err) {
        // Ignore if no error listeners
      }
      
      this.emit('log', {
        type: 'publisher',
        level: 'error',
        message: `Failed to start MQTT Publisher "${publisher.name}": ${error.message || 'Unknown error'}`,
        publisherId,
        publisherName: publisher.name,
        timestamp: Date.now(),
        error: error.message || 'Unknown error',
      });
      throw error;
    }
  }

  async stop(publisherId: string): Promise<void> {
    const connection = this.connections.get(publisherId);

    if (!connection) {
      return;
    }

    // Stop flush timer
    if (connection.flushTimer) {
      clearInterval(connection.flushTimer);
    }

    // Stop scheduled timer
    if (connection.scheduledTimer) {
      clearInterval(connection.scheduledTimer);
    }

    // Stop reconnect timer
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
    }

    // Flush any remaining buffer
    await this.flushBuffer(publisherId);

    return new Promise((resolve) => {
      if (connection.client.connected) {
        connection.client.end(false, {}, () => {
          this.connections.delete(publisherId);
          this.emit('stopped', publisherId);
          this.emit('log', {
            type: 'publisher',
            level: 'info',
            message: `MQTT Publisher "${connection.publisher.name}" stopped`,
            publisherId,
            publisherName: connection.publisher.name,
            timestamp: Date.now(),
          });
          resolve();
        });
      } else {
        this.connections.delete(publisherId);
        this.emit('log', {
          type: 'publisher',
          level: 'info',
          message: `MQTT Publisher "${connection.publisher.name}" stopped`,
          publisherId,
          publisherName: connection.publisher.name,
          timestamp: Date.now(),
        });
        resolve();
      }
    });
  }

  async publish(publisherId: string, data: RealtimeData): Promise<void> {
    const connection = this.connections.get(publisherId);
    
    // If scheduled publishing is enabled, skip realtime/buffer publishing
    // Scheduled publishing will handle publishing from historical database
    if (connection?.publisher.scheduledEnabled) {
      log.info(`   ⏸️  [MQTT PUBLISHER] Skipping realtime publish - scheduled publishing is enabled for "${connection.publisher.name}"`);
      return;
    }

    log.info(`   📥 [MQTT PUBLISHER] Received data for publisher ID: ${publisherId}`);
    log.info(`      Data: ${data.mappingName} = ${data.value} (ID: ${data.mappingId})`);

    if (!connection) {
      log.info(`   ⚠️  [MQTT PUBLISHER] Publisher ${publisherId} is NOT CONNECTED - queuing to database buffer`);
      // Publisher not running, queue to database
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
    
    log.info(`   🔍 [MQTT PUBLISHER] "${publisher.name}" filter check:`);
    log.info(`      Publisher mapping filter: ${publisher.mappingIds.length === 0 ? 'ALL (no filter)' : `[${publisher.mappingIds.join(', ')}]`}`);
    log.info(`      Data mapping ID: ${data.mappingId}`);
    log.info(`      Should publish: ${shouldPublish ? '✅ YES' : '❌ NO (filtered out)'}`);

    // Check if this mapping should be published
    if (publisher.mappingIds.length > 0 && !publisher.mappingIds.includes(data.mappingId)) {
      log.info(`   ⏭️  [MQTT PUBLISHER] "${publisher.name}" SKIPPING - mapping ID "${data.mappingId}" not in filter list`);
      return;
    }

    // Update cache with latest value for this mapping
    if (!this.mappingCache.has(publisherId)) {
      this.mappingCache.set(publisherId, new Map());
    }
    const cache = this.mappingCache.get(publisherId)!;
    cache.set(data.mappingId, data);
    log.info(`   💾 [MQTT PUBLISHER] "${publisher.name}" cached mapping: ${data.mappingName} (cache now has ${cache.size} mappings)`);

    // For custom templates, include buffer data so all mappings are available
    // Create a combined batch: existing buffer + new data
    const combinedBatch = [...connection.buffer, data];
    const payload = this.formatPayload(publisher, data, combinedBatch, publisherId);
    log.info(`   📝 [MQTT PUBLISHER] "${publisher.name}" formatted payload (mode: ${publisher.mode})`);
    
    // Log the actual JSON payload being sent
    log.info(`   📄 [MQTT PUBLISHER] "${publisher.name}" JSON Payload:`);
    try {
      // Try to pretty-print if it's valid JSON
      try {
        const parsed = JSON.parse(payload);
        const pretty = JSON.stringify(parsed, null, 2);
        const preview = pretty.length > 500 ? pretty.substring(0, 500) + '\n... (truncated)' : pretty;
        log.info(`      ${preview.split('\n').join('\n      ')}`);
      } catch {
        // Not valid JSON, just show as-is
        const payloadPreview = payload.length > 500 ? payload.substring(0, 500) + '... (truncated)' : payload;
        log.info(`      ${payloadPreview.split('\n').join('\n      ')}`);
      }
    } catch (e) {
      log.info(`      ${payload.substring(0, 200)}...`);
    }

    if (publisher.mode === 'realtime' || publisher.mode === 'both') {
      // For custom templates, check if payload has many empty values (missing mappings)
      // If so, skip immediate send and only buffer to wait for more mappings
      let shouldSendImmediately = true;
      if (publisher.jsonFormat === 'custom' && publisher.customJsonTemplate) {
        try {
          const parsed = JSON.parse(payload);
          const values = Object.values(parsed);
          const emptyCount = values.filter(v => v === '' || v === null || v === undefined).length;
          const totalCount = values.length;
          // If more than 50% of values are empty, skip immediate send
          if (totalCount > 1 && emptyCount > totalCount * 0.5) {
            shouldSendImmediately = false;
            log.info(`   ⏸️  [MQTT PUBLISHER] "${publisher.name}" skipping immediate send - waiting for more mappings (${emptyCount}/${totalCount} empty)`);
          }
        } catch (e) {
          // Not JSON or can't parse, send anyway
        }
      }

      if (shouldSendImmediately) {
        // Send immediately
        log.info(`   🚀 [MQTT PUBLISHER] "${publisher.name}" sending in REALTIME mode to topic: "${publisher.mqttTopic}"`);
        try {
          await this.sendMessage(connection, payload);
          log.info(`   ✅ [MQTT PUBLISHER] "${publisher.name}" SUCCESSFULLY PUBLISHED: ${data.mappingName} = ${data.value}`);
        this.emit('log', {
          type: 'publisher',
          level: 'info',
          message: `Published data: ${data.mappingName} = ${data.value} to topic "${publisher.mqttTopic}"`,
          publisherId,
          publisherName: publisher.name,
          timestamp: Date.now(),
          data: {
            mappingName: data.mappingName,
            value: data.value,
            topic: publisher.mqttTopic,
          },
        });
      } catch (error: any) {
        log.error(`   ❌ [MQTT PUBLISHER] "${publisher.name}" PUBLISH FAILED: ${error.message}`);
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
    }

    if (publisher.mode === 'buffer' || publisher.mode === 'both') {
      // Add to buffer
      connection.buffer.push(data);
      const bufferSize = connection.buffer.length;
      const maxBufferSize = publisher.bufferSize || 100;
      log.info(`   📦 [MQTT PUBLISHER] "${publisher.name}" added to buffer (${bufferSize}/${maxBufferSize} items)`);

      // Check buffer size
      if (bufferSize >= maxBufferSize) {
        log.info(`   🔄 [MQTT PUBLISHER] "${publisher.name}" buffer full, flushing...`);
        await this.flushBuffer(publisherId);
      }
    }
  }

  private async sendMessage(connection: PublisherConnection, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!connection.client.connected) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      connection.client.publish(
        connection.publisher.mqttTopic!,
        payload,
        {
          qos: (connection.publisher.mqttQos || 0) as any,
          retain: false,
        },
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });
  }

  private async flushBuffer(publisherId: string): Promise<void> {
    const connection = this.connections.get(publisherId);

    if (!connection || connection.buffer.length === 0) {
      return;
    }

    // When scheduled publishing is enabled, do not flush the in-memory buffer immediately.
    if (connection.publisher.scheduledEnabled) {
      log.info(`   ⏸️  [MQTT PUBLISHER] "${connection.publisher.name}" skipping flushBuffer because scheduled publishing is enabled`);
      return;
    }

    const batch = connection.buffer.splice(0, connection.buffer.length);
    
    // Format batch according to JSON format setting
    let payload: string;
    if (connection.publisher.jsonFormat === 'custom' && connection.publisher.customJsonTemplate) {
      // Use cache so all mappings are available, not just what's in the current batch
      const context = this.buildTemplateContext(connection.publisher, batch[batch.length - 1] ?? null, batch, publisherId);
      try {
        const rendered = this.renderTemplate(connection.publisher.customJsonTemplate, context);
        payload = typeof rendered === 'string' ? rendered : JSON.stringify(rendered);
      } catch (error) {
        log.error(
          `Error applying custom batch template for publisher ${connection.publisher.name}, falling back to default format:`,
          error
        );
        payload = JSON.stringify({
          batch: batch.map((item) => ({
            name: item.mappingName,
            parameterId: item.parameterId,
            value: item.value,
            unit: item.unit,
            timestamp: item.timestamp,
            quality: item.quality,
          })),
          count: batch.length,
          timestamp: Date.now(),
        });
      }
    } else {
      // Simple format batch
      payload = JSON.stringify({
        batch: batch.map(item => ({
          name: item.mappingName,
          parameterId: item.parameterId,
          value: item.value,
          unit: item.unit,
          timestamp: item.timestamp,
          quality: item.quality,
        })),
        count: batch.length,
        timestamp: Date.now(),
      });
    }

    // Log the batch JSON payload being sent
    log.info(`   📦 [MQTT PUBLISHER] "${connection.publisher.name}" flushing buffer with ${batch.length} items`);
    try {
      const payloadPreview = payload.length > 1000 ? payload.substring(0, 1000) + '... (truncated)' : payload;
      log.info(`   📄 [MQTT PUBLISHER] "${connection.publisher.name}" Batch JSON Payload:`);
      // Pretty print if it's valid JSON
      try {
        const parsed = JSON.parse(payload);
        const pretty = JSON.stringify(parsed, null, 2);
        const preview = pretty.length > 1000 ? pretty.substring(0, 1000) + '\n... (truncated)' : pretty;
        log.info(`      ${preview.split('\n').join('\n      ')}`);
      } catch {
        // Not valid JSON, just show as-is
        log.info(`      ${payloadPreview.split('\n').join('\n      ')}`);
      }
    } catch (e) {
      log.info(`   📄 [MQTT PUBLISHER] "${connection.publisher.name}" Batch JSON Payload: ${payload.substring(0, 200)}...`);
    }

    try {
      log.info(`   🚀 [MQTT PUBLISHER] "${connection.publisher.name}" sending BATCH to topic: "${connection.publisher.mqttTopic}"`);
      await this.sendMessage(connection, payload);
      log.info(`   ✅ [MQTT PUBLISHER] "${connection.publisher.name}" SUCCESSFULLY PUBLISHED BATCH: ${batch.length} items`);
      this.emit('log', {
        type: 'publisher',
        level: 'info',
        message: `Flushed buffer: ${batch.length} items to topic "${connection.publisher.mqttTopic}"`,
        publisherId,
        publisherName: connection.publisher.name,
        timestamp: Date.now(),
        data: {
          itemCount: batch.length,
          topic: connection.publisher.mqttTopic,
        },
      });
    } catch (error: any) {
      log.error(`Error flushing buffer for publisher ${publisherId}:`, error);
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

      // Save failed batch to database
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
    // When scheduled publishing is enabled, do not send buffer items immediately.
    // They will be reconciled by scheduled publishing using historical database values.
    if (publisher.scheduledEnabled) {
      log.info(`   ⏸️  [MQTT PUBLISHER] Skipping processBufferQueue because scheduled publishing is enabled`);
      return;
    }
    const pendingItems = this.db.getPendingBufferItems(publisherId, 1000);

    for (const item of pendingItems) {
      try {
        const payload = this.formatPayload(publisher, item.data);
        await this.sendMessage(connection, payload);

        // Mark as sent
        this.db.updateBufferItemStatus(item.id, 'sent', item.attempts + 1);
      } catch (error) {
        log.error(`Error sending buffered item ${item.id}:`, error);

        // Update attempts
        const newAttempts = item.attempts + 1;
        if (newAttempts >= (publisher.retryAttempts || 3)) {
          this.db.updateBufferItemStatus(item.id, 'failed', newAttempts);
        } else {
          this.db.updateBufferItemStatus(item.id, 'pending', newAttempts);
        }
      }
    }

      // Clean up sent items
      pendingItems
        .filter((item: any) => item.status === 'sent')
        .forEach((item: any) => this.db.deleteBufferItem(item.id));
  }

  private startScheduledPublishing(publisherId: string): void {
    const connection = this.connections.get(publisherId);
    if (!connection) {
      return;
    }

    const publisher = connection.publisher;
    if (!publisher.scheduledEnabled || !publisher.scheduledInterval || !publisher.scheduledIntervalUnit) {
      return;
    }

    // Calculate interval in milliseconds
    let intervalMs: number;
    switch (publisher.scheduledIntervalUnit) {
      case 'seconds':
        intervalMs = publisher.scheduledInterval * 1000;
        break;
      case 'minutes':
        intervalMs = publisher.scheduledInterval * 60 * 1000;
        break;
      case 'hours':
        intervalMs = publisher.scheduledInterval * 60 * 60 * 1000;
        break;
      default:
        log.error(`Invalid scheduled interval unit: ${publisher.scheduledIntervalUnit}`);
        return;
    }

    log.info(`⏰ [MQTT PUBLISHER] "${publisher.name}" scheduled publishing started: every ${publisher.scheduledInterval} ${publisher.scheduledIntervalUnit}`);

    // Perform initial publish immediately
    this.performScheduledPublish(publisherId);

    // Then set up interval
    connection.scheduledTimer = setInterval(() => {
      this.performScheduledPublish(publisherId);
    }, intervalMs);
  }

  private async performScheduledPublish(publisherId: string): Promise<void> {
    const connection = this.connections.get(publisherId);
    if (!connection || !connection.client.connected) {
      log.info(`   ⚠️  [MQTT PUBLISHER] Scheduled publish skipped - publisher not connected`);
      return;
    }

    const publisher = connection.publisher;
    if (!publisher.scheduledEnabled || publisher.mappingIds.length === 0) {
      return;
    }

    log.info(`   ⏰ [MQTT PUBLISHER] "${publisher.name}" performing scheduled publish from historical database`);

    try {
      // Get latest values from historical database for all configured mappings
      const latestData = this.db.getLatestHistoricalDataForMappings(publisher.mappingIds);
      
      if (latestData.size === 0) {
        log.info(`   ⚠️  [MQTT PUBLISHER] "${publisher.name}" no historical data found for scheduled publish`);
        return;
      }

      // Convert historical data to RealtimeData format
      const mappings = this.db.getParameterMappings();
      const realtimeDataArray: RealtimeData[] = [];

      for (const [mappingId, historicalData] of latestData.entries()) {
        const mapping = mappings.find(m => m.id === mappingId);
        if (mapping) {
          realtimeDataArray.push({
            mappingId: historicalData.mappingId,
            mappingName: mapping.mappedName,
            parameterId: mapping.parameterId,
            value: historicalData.value,
            unit: mapping.unit,
            timestamp: historicalData.timestamp,
            quality: historicalData.quality,
          });
        }
      }

      if (realtimeDataArray.length === 0) {
        log.info(`   ⚠️  [MQTT PUBLISHER] "${publisher.name}" no valid mappings found for scheduled publish`);
        return;
      }

      log.info(`   📊 [MQTT PUBLISHER] "${publisher.name}" found ${realtimeDataArray.length} mappings from database`);

      // Use the latest timestamp as the "current" data for template context
      const latestTimestamp = Math.max(...realtimeDataArray.map(d => d.timestamp));
      const latestDataItem = realtimeDataArray.find(d => d.timestamp === latestTimestamp) || realtimeDataArray[0];

      // Format payload using all the data
      const payload = this.formatPayload(publisher, latestDataItem, realtimeDataArray, publisherId);

      log.info(`   📄 [MQTT PUBLISHER] "${publisher.name}" Scheduled JSON Payload:`);
      try {
        const parsed = JSON.parse(payload);
        const pretty = JSON.stringify(parsed, null, 2);
        const preview = pretty.length > 500 ? pretty.substring(0, 500) + '\n... (truncated)' : pretty;
        log.info(`      ${preview.split('\n').join('\n      ')}`);
      } catch {
        const payloadPreview = payload.length > 500 ? payload.substring(0, 500) + '... (truncated)' : payload;
        log.info(`      ${payloadPreview.split('\n').join('\n      ')}`);
      }

      // Send the payload
      await this.sendMessage(connection, payload);
      log.info(`   ✅ [MQTT PUBLISHER] "${publisher.name}" SUCCESSFULLY PUBLISHED scheduled data (${realtimeDataArray.length} mappings)`);

      // Reconcile buffer queue: mark pending items up to the latest timestamp as sent
      try {
        const cleared = this.db.markBufferItemsSentUpTo(publisherId, latestTimestamp);
        if (cleared > 0) {
          log.info(`   🧹 [MQTT PUBLISHER] "${publisher.name}" reconciled buffer queue: marked ${cleared} items as sent (<= ${new Date(latestTimestamp).toISOString()})`);
        }
      } catch (err: any) {
        log.warn(`   ⚠️  [MQTT PUBLISHER] Buffer reconciliation warning: ${err.message}`);
      }

      this.emit('log', {
        type: 'publisher',
        level: 'info',
        message: `Scheduled publish: ${realtimeDataArray.length} mappings to topic "${publisher.mqttTopic}"`,
        publisherId,
        publisherName: publisher.name,
        timestamp: Date.now(),
        data: {
          mappingCount: realtimeDataArray.length,
          topic: publisher.mqttTopic,
        },
      });
    } catch (error: any) {
      log.error(`   ❌ [MQTT PUBLISHER] "${publisher.name}" scheduled publish FAILED: ${error.message}`);
      this.emit('log', {
        type: 'publisher',
        level: 'error',
        message: `Scheduled publish failed: ${error.message}`,
        publisherId,
        publisherName: publisher.name,
        timestamp: Date.now(),
        error: error.message,
      });
    }
  }

  refreshPublisher(publisherId: string): void {
    const connection = this.connections.get(publisherId);
    if (!connection) {
      return;
    }

    const updated = this.db.getPublisherById(publisherId);
    if (updated) {
      const oldScheduledEnabled = connection.publisher.scheduledEnabled;
      const oldScheduledInterval = connection.publisher.scheduledInterval;
      const oldScheduledIntervalUnit = connection.publisher.scheduledIntervalUnit;

      connection.publisher = updated;
      log.info(`Refreshed MQTT publisher configuration for ${updated.name}`);

      // Restart scheduled publishing if configuration changed
      if (connection.client.connected) {
        // Stop existing scheduled timer if it exists
        if (connection.scheduledTimer) {
          clearInterval(connection.scheduledTimer);
          connection.scheduledTimer = undefined;
        }

        // Start scheduled publishing if enabled and configuration changed
        if (
          updated.scheduledEnabled &&
          updated.scheduledInterval &&
          updated.scheduledIntervalUnit &&
          (oldScheduledEnabled !== updated.scheduledEnabled ||
            oldScheduledInterval !== updated.scheduledInterval ||
            oldScheduledIntervalUnit !== updated.scheduledIntervalUnit)
        ) {
          this.startScheduledPublishing(publisherId);
        }
      }
    }
  }

  /**
   * Format payload according to publisher's JSON format configuration
   * @param batch Optional batch array - if provided, template can access all mappings
   * @param publisherId Optional publisher ID - if provided, template can access cached mappings
   */
  private formatPayload(publisher: Publisher, data: RealtimeData, batch?: RealtimeData[], publisherId?: string): string {
    if (publisher.jsonFormat === 'custom' && publisher.customJsonTemplate) {
      // Use provided batch if available, otherwise just the current data
      const batchData = batch && batch.length > 0 ? batch : [data];
      const context = this.buildTemplateContext(publisher, data, batchData, publisherId);
      try {
        const rendered = this.renderTemplate(publisher.customJsonTemplate, context);
        return typeof rendered === 'string' ? rendered : JSON.stringify(rendered);
      } catch (error) {
        log.error('Error applying custom JSON template, falling back to legacy template handling:', error);
        return this.applyLegacyTemplate(publisher.customJsonTemplate, context);
      }
    }

    // Simple format (default)
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
    
    // Include parameterId if available
    if (data.parameterId) {
      simplePayload.parameterId = data.parameterId;
    }
    
    return JSON.stringify(simplePayload);
  }

  private handleConnectionError(publisherId: string): void {
    const connection = this.connections.get(publisherId);
    if (!connection) {
      return;
    }

    // If already reconnecting, skip
    if (connection.isReconnecting) {
      return;
    }

    // Clear any existing reconnect timer
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = undefined;
    }

    connection.isReconnecting = true;
    connection.reconnectAttempts++;

    this.emit('log', {
      type: 'publisher',
      level: 'warning',
      message: `MQTT Publisher "${connection.publisher.name}" attempting reconnection (attempt ${connection.reconnectAttempts}/${connection.maxReconnectAttempts})`,
      publisherId,
      publisherName: connection.publisher.name,
      timestamp: Date.now(),
    });

    if (connection.reconnectAttempts > connection.maxReconnectAttempts) {
      this.emit('log', {
        type: 'publisher',
        level: 'error',
        message: `MQTT Publisher "${connection.publisher.name}" failed to reconnect after ${connection.maxReconnectAttempts} attempts. Will retry with health check.`,
        publisherId,
        publisherName: connection.publisher.name,
        timestamp: Date.now(),
      });
      // Reset after max attempts - let health check handle it
      connection.isReconnecting = false;
      connection.reconnectAttempts = 0; // Reset for health check retries
      return;
    }

    // Calculate exponential backoff delay (5s, 10s, 20s, 40s, 80s)
    const delay = Math.min(5000 * Math.pow(2, connection.reconnectAttempts - 1), 80000);
    
    connection.reconnectTimer = setTimeout(async () => {
      try {
        // Clean up existing connection
        try {
          if (connection.client) {
            if (connection.client.connected) {
              connection.client.removeAllListeners();
              connection.client.end(true);
            } else {
              connection.client.removeAllListeners();
            }
          }
        } catch (err) {
          // Ignore cleanup errors
        }

        // Wait a bit before reconnecting
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Remove from connections map before restarting
        this.connections.delete(publisherId);

        // Restart the publisher
        await this.start(publisherId);
        
        this.emit('log', {
          type: 'publisher',
          level: 'info',
          message: `MQTT Publisher "${connection.publisher.name}" reconnected successfully`,
          publisherId,
          publisherName: connection.publisher.name,
          timestamp: Date.now(),
        });
      } catch (error: any) {
        log.error(`Reconnection failed for ${publisherId}:`, error);
        this.emit('log', {
          type: 'publisher',
          level: 'error',
          message: `MQTT Publisher "${connection.publisher.name}" reconnection failed: ${error.message || 'Unknown error'}`,
          publisherId,
          publisherName: connection.publisher.name,
          timestamp: Date.now(),
          error: error.message || 'Unknown error',
        });
        
        // Reset reconnecting flag for next attempt
        connection.isReconnecting = false;
        
        // Try again after a longer delay (30s)
        connection.reconnectTimer = setTimeout(() => {
          this.handleConnectionError(publisherId);
        }, 30000);
      }
    }, delay);
  }

  private async checkConnectionHealth(publisherId: string): Promise<boolean> {
    const connection = this.connections.get(publisherId);
    if (!connection) {
      return false;
    }

    // Check if client is connected and not in reconnecting state
    if (connection.client.connected && !connection.isReconnecting) {
      return true;
    }

    // If disconnected and not reconnecting, try to reconnect
    if (!connection.client.connected && !connection.isReconnecting) {
      this.handleConnectionError(publisherId);
    }

    return false;
  }

  // Public method to manually check and fix connection health
  async ensureConnectionHealth(publisherId: string): Promise<void> {
    const isHealthy = await this.checkConnectionHealth(publisherId);
    if (!isHealthy) {
      this.emit('log', {
        type: 'publisher',
        level: 'warning',
        message: `MQTT Publisher connection health check failed, attempting recovery`,
        publisherId,
        publisherName: this.connections.get(publisherId)?.publisher.name || 'Unknown',
        timestamp: Date.now(),
      });
    }
  }

  cleanup(): void {
    for (const publisherId of this.connections.keys()) {
      this.stop(publisherId);
    }
  }
}

