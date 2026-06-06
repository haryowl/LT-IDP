/**
 * In-memory counters for SPARING and third-party (MQTT/HTTP) publish outcomes.
 * Used by parameter mappings with sourceType "system" and system_device_id keys below.
 * Counts reset when the application process restarts.
 */
export const SYSTEM_TELEMETRY_SOURCE_IDS = {
  SPARING_SUCCESS: 'system-sparing-success-count',
  SPARING_FAIL: 'system-sparing-fail-count',
  SPARING_QUEUE: 'system-sparing-queue-depth',
  SPARING_RESPONSE_STATUS: 'system-sparing-response-status',
  SPARING_RESPONSE_DESC: 'system-sparing-response-desc',
  SPARING_RESPONSE_RAW: 'system-sparing-response-raw',
  SPARING_LAST_SEND_DURATION_MS: 'system-sparing-last-send-duration-ms',
  SPARING_LAST_RESPONSE_AT: 'system-sparing-last-response-at',
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
  private sparingResponseStatus: boolean | null = null;
  private sparingResponseDesc: string | null = null;
  private sparingResponseRaw: string | null = null;
  private sparingLastSendDurationMs: number | null = null;
  private sparingLastResponseAt: number | null = null;

  recordSparing(status: 'success' | 'failed'): void {
    if (status === 'success') this.sparingSuccess += 1;
    else this.sparingFail += 1;
  }

  /** Latest KLHK API response from the most recent SPARING send attempt. */
  recordSparingResponse(
    apiStatus: boolean,
    desc: string | null,
    durationMs: number,
    rawResponse?: string | null
  ): void {
    this.sparingResponseStatus = apiStatus;
    this.sparingResponseDesc = desc;
    this.sparingResponseRaw = rawResponse ?? null;
    this.sparingLastSendDurationMs = durationMs;
    this.sparingLastResponseAt = Date.now();
  }

  hasSparingResponse(): boolean {
    return this.sparingLastResponseAt != null;
  }

  getSparingResponseStatus(): boolean | null {
    return this.sparingResponseStatus;
  }

  getSparingResponseDesc(): string | null {
    return this.sparingResponseDesc;
  }

  getSparingResponseRaw(): string | null {
    return this.sparingResponseRaw;
  }

  getSparingLastSendDurationMs(): number | null {
    return this.sparingLastSendDurationMs;
  }

  getSparingLastResponseAt(): number | null {
    return this.sparingLastResponseAt;
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
