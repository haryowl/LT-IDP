/**
 * In-memory counters for SPARING and third-party (MQTT/HTTP) publish outcomes.
 * Used by parameter mappings with sourceType "system" and system_device_id keys below.
 * Counts reset when the application process restarts.
 */
export const SYSTEM_TELEMETRY_SOURCE_IDS = {
  SPARING_SUCCESS: 'system-sparing-success-count',
  SPARING_FAIL: 'system-sparing-fail-count',
  SPARING_QUEUE: 'system-sparing-queue-depth',
  MQTT_SUCCESS: 'system-mqtt-success-count',
  MQTT_FAIL: 'system-mqtt-fail-count',
  HTTP_SUCCESS: 'system-http-success-count',
  HTTP_FAIL: 'system-http-fail-count',
} as const;

export type SystemTelemetrySourceId = (typeof SYSTEM_TELEMETRY_SOURCE_IDS)[keyof typeof SYSTEM_TELEMETRY_SOURCE_IDS];

export function isSystemTelemetrySourceId(id: string): id is SystemTelemetrySourceId {
  return (Object.values(SYSTEM_TELEMETRY_SOURCE_IDS) as string[]).includes(id);
}

export class TransmissionTelemetry {
  private sparingSuccess = 0;
  private sparingFail = 0;
  private mqttSuccess = 0;
  private mqttFail = 0;
  private httpSuccess = 0;
  private httpFail = 0;

  recordSparing(status: 'success' | 'failed'): void {
    if (status === 'success') this.sparingSuccess += 1;
    else this.sparingFail += 1;
  }

  recordMqtt(success: boolean): void {
    if (success) this.mqttSuccess += 1;
    else this.mqttFail += 1;
  }

  recordHttp(success: boolean): void {
    if (success) this.httpSuccess += 1;
    else this.httpFail += 1;
  }

  getSparingSuccess(): number {
    return this.sparingSuccess;
  }
  getSparingFail(): number {
    return this.sparingFail;
  }
  getMqttSuccess(): number {
    return this.mqttSuccess;
  }
  getMqttFail(): number {
    return this.mqttFail;
  }
  getHttpSuccess(): number {
    return this.httpSuccess;
  }
  getHttpFail(): number {
    return this.httpFail;
  }
}

let instance: TransmissionTelemetry | null = null;

export function getTransmissionTelemetry(): TransmissionTelemetry {
  if (!instance) instance = new TransmissionTelemetry();
  return instance;
}
