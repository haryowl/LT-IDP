import { EventEmitter } from 'events';
import type { DatabaseService } from './database';
import type { ParameterMapping, RealtimeData } from '../types';
import { getLogger } from './logger';
import { getTransmissionTelemetry, SYSTEM_TELEMETRY_SOURCE_IDS } from './transmissionTelemetry';
import type { GnssService } from './gnssService';
import { getCpuTemperatureC } from './systemInfo';

export class DataMapperService extends EventEmitter {
  private mappings: Map<string, ParameterMapping> = new Map();
  private callbacks: Set<(data: RealtimeData) => void> = new Set();
  private systemTimestampIntervalMs: number;
  private systemGnssHistoryIntervalMs: number;
  private lastStoredTimestamps: Map<string, number> = new Map();

  constructor(private db: DatabaseService, private gnss?: GnssService) {
    super();
    this.loadMappings();
    this.systemTimestampIntervalMs = Math.max(1, this.db.getSystemTimestampInterval()) * 1000;
    this.systemGnssHistoryIntervalMs = Math.max(1, this.getGnssHistoryIntervalSeconds()) * 1000;
    this.startSystemDataEmitter();
  }

  private getGnssHistoryIntervalSeconds(): number {
    const raw = this.db.getSystemConfig?.('gnss:historyIntervalSeconds');
    const n = Number((raw ?? '').trim());
    if (!Number.isFinite(n) || n <= 0) return 5;
    return Math.max(1, Math.floor(n));
  }

  private shouldStoreHistorical(mapping: ParameterMapping, timestamp: number, sourceId?: string): boolean {
    let intervalMs: number | undefined;

    if (mapping.sourceType === 'system' && (sourceId || mapping.sourceDeviceId || 'system-timestamp') === 'system-timestamp') {
      intervalMs = this.systemTimestampIntervalMs;
    } else if (mapping.sourceType === 'system' && String(sourceId || mapping.sourceDeviceId || '').startsWith('system-gnss-')) {
      intervalMs = this.systemGnssHistoryIntervalMs;
    } else if (mapping.sourceType === 'modbus') {
      const device = this.db.getModbusDeviceById(mapping.sourceDeviceId);
      intervalMs = device?.recordInterval ?? undefined;
    }

    if (!intervalMs || intervalMs <= 0) {
      return true;
    }

    const last = this.lastStoredTimestamps.get(mapping.id) || 0;
    if (timestamp - last >= intervalMs) {
      this.lastStoredTimestamps.set(mapping.id, timestamp);
      return true;
    }
    return false;
  }

  loadMappings(): void {
    const mappings = this.db.getParameterMappings();
    this.mappings.clear();
    mappings.forEach((mapping) => {
      this.mappings.set(mapping.id, mapping);
    });
  }

  reloadMappings(): void {
    this.loadMappings();
    this.lastStoredTimestamps.clear();
  }

  async mapModbusData(data: any): Promise<void> {
    const relevantMappings = Array.from(this.mappings.values()).filter(
      (mapping) =>
        mapping.sourceType === 'modbus' &&
        mapping.sourceDeviceId === data.deviceId &&
        mapping.registerId === data.registerId
    );

    const allDeviceMappings = Array.from(this.mappings.values()).filter(
      (mapping) => mapping.sourceType === 'modbus' && mapping.sourceDeviceId === data.deviceId
    );

    getLogger().info(
      `Available mappings for device ${data.deviceId}:`,
      allDeviceMappings.map((m) => ({
        id: m.id,
        name: m.name,
        registerId: m.registerId,
      }))
    );

    getLogger().info(`Looking for register ${data.registerName} with ID: ${data.registerId}`);

    if (relevantMappings.length === 0) {
      getLogger().info(`No parameter mappings found for register ${data.registerName} (${data.registerId})`);
      return;
    }

    for (const mapping of relevantMappings) {
      const mappedData = await this.transformData(mapping, data.value, data.timestamp, data.quality);
      if (mappedData) {
        let stored = false;
        if (mapping.storeHistory) {
          try {
            const shouldStore = this.shouldStoreHistorical(mapping, mappedData.timestamp, mapping.sourceDeviceId);
            if (shouldStore) {
              this.db.insertHistoricalData({
                mappingId: mapping.id,
                timestamp: mappedData.timestamp,
                value: mappedData.value,
                quality: mappedData.quality,
              });
              stored = true;
            }
          } catch (error: any) {
            getLogger().error('❌ Error saving historical data:', error);
          }
        }

        this.emit('dataMapped', mappedData);
        this.callbacks.forEach((callback) => callback(mappedData));
        if (stored) {
          this.emit('dataStored', mappedData);
        }
      }
    }

    await this.emitSystemData();
  }

  async mapMqttData(data: any): Promise<void> {
    const relevantMappings = Array.from(this.mappings.values()).filter(
      (mapping) =>
        mapping.sourceType === 'mqtt' &&
        mapping.sourceDeviceId === data.deviceId &&
        this.topicMatches(mapping.topic!, data.topic)
    );

    for (const mapping of relevantMappings) {
      let value = data.data;
      if (mapping.jsonPath) {
        value = this.extractJsonPath(data.data, mapping.jsonPath);
      }

      const mappedData = await this.transformData(mapping, value, data.timestamp, data.quality);
      if (mappedData) {
        let stored = false;
        if (mapping.storeHistory) {
          try {
            const shouldStore = this.shouldStoreHistorical(mapping, mappedData.timestamp, mapping.sourceDeviceId);
            if (shouldStore) {
              this.db.insertHistoricalData({
                mappingId: mapping.id,
                timestamp: mappedData.timestamp,
                value: mappedData.value,
                quality: mappedData.quality,
              });
              stored = true;
            }
          } catch (error: any) {
            getLogger().error('Error saving historical data:', error);
          }
        }

        this.emit('dataMapped', mappedData);
        this.callbacks.forEach((callback) => callback(mappedData));
        if (stored) {
          this.emit('dataStored', mappedData);
        }
      }
    }

    await this.emitSystemData();
  }

  private async transformData(
    mapping: ParameterMapping,
    value: any,
    timestamp: number,
    quality: 'good' | 'bad' | 'uncertain'
  ): Promise<RealtimeData | null> {
    try {
      let transformedValue = value;

      if (mapping.transformExpression) {
        try {
          const context = {
            value,
            Math,
            Date,
            Number,
            String,
            Boolean,
          };
          const fn = new Function(...Object.keys(context), `return ${mapping.transformExpression}`);
          transformedValue = fn(...Object.values(context));
        } catch (error: any) {
          getLogger().error(`Error applying transformation for ${mapping.name}:`, error);
          return null;
        }
      }

      if (mapping.dataType === 'timestamp') {
        const sourceId = mapping.sourceDeviceId || 'system-timestamp';
        if (mapping.sourceType === 'system' && sourceId === 'system-timestamp') {
          const outputFormat = mapping.outputFormat || 'ISO8601';
          const outputTimezone = mapping.outputTimezone || 'UTC+0';
          const outputOffset = this.getTimezoneOffset(outputTimezone);
          const rawValue = typeof value === 'number' ? value : Date.now();
          transformedValue = this.formatTimestamp(rawValue + outputOffset * 60 * 1000, outputFormat, outputOffset);
        } else {
          let inputFormat = mapping.inputFormat;
          let inputTimezone = mapping.inputTimezone;
          if (mapping.sourceType === 'system' && mapping.sourceDeviceId === 'system-timestamp') {
            inputFormat = 'UNIX_MS';
            inputTimezone = 'UTC+0';
          }
          transformedValue = this.convertTimestamp(
            transformedValue,
            inputFormat,
            inputTimezone,
            mapping.outputFormat,
            mapping.outputTimezone
          );
        }
      } else {
        transformedValue = this.castToType(transformedValue, mapping.dataType);
      }

      return {
        mappingId: mapping.id,
        mappingName: mapping.mappedName,
        parameterId: mapping.parameterId,
        timestamp,
        value: transformedValue,
        unit: mapping.unit,
        quality,
      };
    } catch (error: any) {
      getLogger().error(`Error transforming data for mapping ${mapping.name}:`, error);
      return null;
    }
  }

  private castToType(value: any, dataType: string): any {
    switch (dataType) {
      case 'number':
        return Number(value);
      case 'string':
        return String(value);
      case 'boolean':
        return Boolean(value);
      case 'object':
        return typeof value === 'object' ? value : JSON.parse(String(value));
      default:
        return value;
    }
  }

  private convertTimestamp(
    value: any,
    inputFormat?: string,
    inputTimezone?: string,
    outputFormat?: string,
    outputTimezone?: string
  ): string {
    try {
      let utcTimestamp: number;

      if (inputFormat === 'UNIX_MS' || (!inputFormat && typeof value === 'number')) {
        utcTimestamp = value;
      } else if (inputFormat === 'ISO8601' || (!inputFormat && typeof value === 'string' && value.includes('T'))) {
        if (typeof value === 'number') {
          utcTimestamp = value;
        } else {
          let parsed = new Date(value).getTime();
          if (Number.isNaN(parsed) && typeof value === 'string' && /^\d+$/.test(value)) {
            parsed = Number(value);
          }
          utcTimestamp = parsed;
        }
      } else {
        utcTimestamp = this.parseCustomFormat(value, inputFormat || 'YYYY-MM-DD HH:mm:ss');
      }

      const inputOffset = this.getTimezoneOffset(inputTimezone || 'UTC+0');
      const trueUtcTimestamp = utcTimestamp - inputOffset * 60 * 1000;

      const outputOffset = this.getTimezoneOffset(outputTimezone || 'UTC+0');
      const outputTimestamp = trueUtcTimestamp + outputOffset * 60 * 1000;

      return this.formatTimestamp(outputTimestamp, outputFormat || 'ISO8601', outputOffset);
    } catch (error: any) {
      getLogger().error('Error converting timestamp:', error);
      return String(value);
    }
  }

  private getTimezoneOffset(timezone: string): number {
    const match = timezone.match(/UTC([+-])(\d+)/);
    if (!match) return 0;
    const sign = match[1] === '+' ? 1 : -1;
    const hours = parseInt(match[2]);
    return sign * hours * 60;
  }

  private parseCustomFormat(value: string, format: string): number {
    try {
      const formats: { [key: string]: RegExp } = {
        'YYYY-MM-DD HH:mm:ss': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
        'DD/MM/YYYY HH:mm:ss': /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
        'MM/DD/YYYY HH:mm:ss': /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
        'YYYY-MM-DD': /^(\d{4})-(\d{2})-(\d{2})$/,
      };

      const regex = formats[format];
      if (!regex) {
        return new Date(value).getTime();
      }

      const match = value.match(regex);
      if (!match) {
        return new Date(value).getTime();
      }

      let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;

      if (format === 'YYYY-MM-DD HH:mm:ss') {
        [, year, month, day, hour, minute, second] = match.map(Number);
      } else if (format === 'DD/MM/YYYY HH:mm:ss') {
        [, day, month, year, hour, minute, second] = match.map(Number);
      } else if (format === 'MM/DD/YYYY HH:mm:ss') {
        [, month, day, year, hour, minute, second] = match.map(Number);
      } else if (format === 'YYYY-MM-DD') {
        [, year, month, day] = match.map(Number);
      }

      return new Date(year, month - 1, day, hour, minute, second).getTime();
    } catch (error: any) {
      getLogger().error('Error parsing custom format:', error);
      return Date.now();
    }
  }

  private formatTimestamp(timestamp: number, format: string, timezoneOffset: number): string {
    const date = new Date(timestamp);

    if (format === 'UNIX_MS') {
      return timestamp.toString();
    }

    if (format === 'ISO8601') {
      const sign = timezoneOffset >= 0 ? '+' : '-';
      const hours = Math.floor(Math.abs(timezoneOffset) / 60);
      const minutes = Math.abs(timezoneOffset) % 60;
      const tzString = `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hour = date.getHours().toString().padStart(2, '0');
      const minute = date.getMinutes().toString().padStart(2, '0');
      const second = date.getSeconds().toString().padStart(2, '0');

      return `${year}-${month}-${day}T${hour}:${minute}:${second}${tzString}`;
    }

    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    const second = date.getSeconds().toString().padStart(2, '0');

    if (format === 'YYYY-MM-DD HH:mm:ss') {
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    } else if (format === 'DD/MM/YYYY HH:mm:ss') {
      return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
    } else if (format === 'MM/DD/YYYY HH:mm:ss') {
      return `${month}/${day}/${year} ${hour}:${minute}:${second}`;
    } else if (format === 'YYYY-MM-DD') {
      return `${year}-${month}-${day}`;
    }

    return date.toISOString();
  }

  private extractJsonPath(data: any, path: string): any {
    const parts = path.split('.');
    let current = data;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  private topicMatches(pattern: string, topic: string): boolean {
    const regexPattern = pattern.replace(/\+/g, '[^/]+').replace(/#/g, '.*').replace(/\//g, '\\/');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(topic);
  }

  private startSystemDataEmitter(): void {
    setInterval(() => {
      this.emitSystemData();
    }, 1000);
  }

  setSystemTimestampInterval(seconds: number): void {
    this.systemTimestampIntervalMs = Math.max(1, Math.floor(seconds)) * 1000;
    this.systemGnssHistoryIntervalMs = Math.max(1, this.getGnssHistoryIntervalSeconds()) * 1000;
    this.lastStoredTimestamps.clear();
  }

  private async emitSystemData(): Promise<void> {
    const clientId = this.db.getClientId();

    const systemMappings = Array.from(this.mappings.values()).filter((mapping) => mapping.sourceType === 'system');

    if (systemMappings.length === 0) {
      return;
    }

    const tel = getTransmissionTelemetry();

    for (const mapping of systemMappings) {
      const now = Date.now();
      const sourceId = mapping.sourceDeviceId || 'system-timestamp';

      let value: any;
      if (sourceId === 'system-timestamp') {
        value = now;
      } else if (sourceId === 'system-clientId') {
        value = clientId;
      } else if (sourceId === SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_SUCCESS) {
        value = tel.getSparingSuccess();
      } else if (sourceId === SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_FAIL) {
        value = tel.getSparingFail();
      } else if (sourceId === SYSTEM_TELEMETRY_SOURCE_IDS.SPARING_QUEUE) {
        value = this.db.getSparingPendingQueueCount();
      } else if (sourceId === SYSTEM_TELEMETRY_SOURCE_IDS.MQTT_SUCCESS) {
        value = tel.getMqttSuccess();
      } else if (sourceId === SYSTEM_TELEMETRY_SOURCE_IDS.MQTT_FAIL) {
        value = tel.getMqttFail();
      } else if (sourceId === SYSTEM_TELEMETRY_SOURCE_IDS.HTTP_SUCCESS) {
        value = tel.getHttpSuccess();
      } else if (sourceId === SYSTEM_TELEMETRY_SOURCE_IDS.HTTP_FAIL) {
        value = tel.getHttpFail();
      } else if (sourceId === 'system-cpu-temp-c') {
        const t = await getCpuTemperatureC();
        value = t.valueC;
      } else if (sourceId.startsWith('system-gnss-')) {
        const fix = this.gnss?.getLatestFix?.();
        if (!fix) {
          continue;
        }
        if (sourceId === 'system-gnss-latitude') {
          value = fix.latitude;
        } else if (sourceId === 'system-gnss-longitude') {
          value = fix.longitude;
        } else if (sourceId === 'system-gnss-altitude-m') {
          value = fix.altitudeM;
        } else if (sourceId === 'system-gnss-speed-kmh') {
          value = fix.speedKmh;
        } else if (sourceId === 'system-gnss-satellites') {
          value = fix.satellites;
        } else if (sourceId === 'system-gnss-fix-quality') {
          value = fix.fixQuality;
        } else if (sourceId === 'system-gnss-fix-valid') {
          value = fix.valid ? 1 : 0;
        } else if (sourceId === 'system-gnss-last-fix-age-ms') {
          value = fix.lastSentenceAt ? Math.max(0, now - fix.lastSentenceAt) : null;
        } else if (sourceId === 'system-gnss-course-deg') {
          value = fix.courseDegrees;
        } else if (sourceId === 'system-gnss-bearing-deg') {
          value = fix.bearingDegrees;
        } else if (sourceId === 'system-gnss-trip-distance-m') {
          value = fix.tripDistanceMeters;
        } else {
          getLogger().warn(`Unknown GNSS system source_device_id: ${sourceId}, skipping mapping ${mapping.name}`);
          continue;
        }
        if (value == null) {
          continue;
        }
      } else {
        getLogger().warn(`Unknown system source_device_id: ${sourceId}, skipping mapping ${mapping.name}`);
        continue;
      }

      const mappedData = await this.transformData(mapping, value, now, 'good');
      if (mappedData) {
        let stored = false;
        if (mapping.storeHistory) {
          const shouldStore = this.shouldStoreHistorical(mapping, mappedData.timestamp, sourceId);
          if (shouldStore) {
            try {
              this.db.insertHistoricalData({
                mappingId: mapping.id,
                timestamp: mappedData.timestamp,
                value: mappedData.value,
                quality: mappedData.quality,
              });
              stored = true;
            } catch (error: any) {
              getLogger().error('Error saving historical data:', error);
            }
          }
        }

        this.emit('dataMapped', mappedData);
        this.callbacks.forEach((callback) => callback(mappedData));
        if (stored) {
          this.emit('dataStored', mappedData);
        }
      }
    }
  }

  onDataMapped(callback: (data: RealtimeData) => void): void {
    this.callbacks.add(callback);
  }

  offDataMapped(callback: (data: RealtimeData) => void): void {
    this.callbacks.delete(callback);
  }

  cleanup(): void {
    // No cleanup needed
  }
}

