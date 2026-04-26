// Shared type definitions for Electron main process

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'viewer' | 'guest';
  createdAt: number;
}

export interface ModbusDevice {
  id: string;
  name: string;
  type: 'tcp' | 'rtu';
  enabled: boolean;
  autoStart: boolean;
  host?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  slaveId: number;
  pollInterval: number;
  recordInterval?: number;
  timeout: number;
  retryAttempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface ModbusRegister {
  id: string;
  deviceId: string;
  name: string;
  functionCode: number;
  address: number;
  quantity: number;
  dataType: string;
  byteOrder?: string;
  wordOrder?: string;
  scaleFactor?: number;
  offset?: number;
  unit?: string;
}

export interface MqttDevice {
  id: string;
  name: string;
  enabled: boolean;
  autoStart: boolean;
  broker: string;
  port: number;
  protocol: string;
  clientId: string;
  username?: string;
  password?: string;
  qos: number;
  topics: string[];
  useTls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  tlsCa?: string;
  rejectUnauthorized: boolean;
  keepAlive: number;
  reconnectPeriod: number;
  createdAt: number;
  updatedAt: number;
}

export interface ParameterMapping {
  id: string;
  name: string;
  parameterId?: string;
  description?: string;
  sourceType: 'modbus' | 'mqtt' | 'system';
  /** Modbus device id, MQTT device id, or system key (e.g. system-timestamp, system-sparing-success-count). */
  sourceDeviceId: string;
  registerId?: string;
  topic?: string;
  jsonPath?: string;
  mappedName: string;
  unit?: string;
  dataType: string;
  inputFormat?: string;
  inputTimezone?: string;
  outputFormat?: string;
  outputTimezone?: string;
  transformExpression?: string;
  storeHistory: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Publisher {
  id: string;
  name: string;
  type: 'mqtt' | 'http';
  enabled: boolean;
  autoStart: boolean;
  mode: 'realtime' | 'buffer' | 'both';
  // MQTT specific
  mqttBroker?: string;
  mqttPort?: number;
  mqttProtocol?: string;
  mqttTopic?: string;
  mqttQos?: number;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttUseTls?: boolean;
  // HTTP specific
  httpUrl?: string;
  httpMethod?: string;
  httpHeaders?: string;
  useJwt?: boolean;
  jwtToken?: string;
  jwtHeader?: string;
  // Buffer settings
  bufferSize?: number;
  bufferFlushInterval?: number;
  retryAttempts?: number;
  retryDelay?: number;
  // JSON format settings
  jsonFormat?: 'simple' | 'custom';
  customJsonTemplate?: string;
  mappingIds: string[];
  // Scheduled publishing (from historical database)
  scheduledEnabled?: boolean;
  scheduledInterval?: number; // Interval value
  scheduledIntervalUnit?: 'seconds' | 'minutes' | 'hours'; // Interval unit
  createdAt: number;
  updatedAt: number;
}

export interface ThresholdWatchItem {
  mappingId: string;
  min?: number;
  max?: number;
  /** If set, trigger when this mapping has not received data for this many seconds. */
  staleSeconds?: number;
}

export interface ThresholdWatchedDevice {
  deviceId: string;
  type: 'modbus' | 'mqtt';
  /** If set, trigger only after device has been disconnected for this many seconds. */
  disconnectedSeconds?: number;
}

export interface ThresholdSnapshotItem {
  mappingId: string;
  mappingName: string;
  parameterId?: string;
  value: any;
  unit?: string;
  quality: 'good' | 'bad' | 'uncertain';
  timestamp: number;
}

export interface ThresholdTriggerContext {
  mappingId: string;
  mappingName: string;
  parameterId?: string;
  value: any;
  numericValue?: number;
  min?: number;
  max?: number;
  breach: 'below_min' | 'above_max' | 'out_of_range' | 'stale_data' | 'no_connection';
  unit?: string;
  quality: 'good' | 'bad' | 'uncertain';
  timestamp: number;
  /** Set when breach is 'no_connection'. */
  deviceId?: string;
  deviceName?: string;
}

export interface ThresholdPublishRule {
  id: string;
  name: string;
  enabled: boolean;
  httpUrl: string;
  httpMethod: 'POST' | 'PUT';
  httpHeaders?: string | Record<string, string>;
  useJwt?: boolean;
  jwtToken?: string;
  jwtHeader?: string;
  jsonFormat?: 'simple' | 'custom';
  customJsonTemplate?: string;
  watchedMappings: ThresholdWatchItem[];
  /** When set, rule can trigger when these devices are disconnected (or disconnected for N seconds). */
  watchedDevices?: ThresholdWatchedDevice[];
  snapshotMappingIds: string[];
  cooldownSeconds?: number;
  /**
   * When to consider a new excursion (re-trigger):
   * - 'edge_only': Re-trigger only when value returns to normal, then goes out of range again (default).
   * - 'periodic_while_breach': Re-trigger every reTriggerIntervalSeconds while value stays out of range.
   */
  reTriggerMode?: 'edge_only' | 'periodic_while_breach';
  /** Seconds between re-triggers when value stays out of range. Used when reTriggerMode is 'periodic_while_breach'. */
  reTriggerIntervalSeconds?: number;
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AdvancedRuleActionPublish {
  /** Publisher IDs (mqtt/http) to emit this event to */
  publisherIds: string[];
}

export interface AdvancedRuleActionAlert {
  /** Severity to display/store */
  severity: 'info' | 'warning' | 'error';
}

export interface AdvancedRuleActionModbusWrite {
  enabled: boolean;
  deviceId: string;
  registerId: string;
  /** Write behavior while rule is true */
  mode: 'once' | 'toggle_interval';
  /** Value to write when toggle state is TRUE (default true) */
  valueTrue?: unknown;
  /** Value to write when toggle state is FALSE (default false) */
  valueFalse?: unknown;
  /** Toggle interval seconds while rule is true (default 1) */
  intervalSeconds?: number;
  /** When rule becomes false, write valueFalse once (default true) */
  writeFalseOnStop?: boolean;
}

export interface AdvancedRuleActions {
  alert?: AdvancedRuleActionAlert;
  publish?: AdvancedRuleActionPublish;
  modbusWrite?: AdvancedRuleActionModbusWrite;
}

export interface AdvancedRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Expression evaluated against latest values; should return boolean/truthy to trigger. */
  expression: string;
  /** Mapping IDs used by the expression (for event-driven evaluation). */
  inputs: string[];
  /** Additional mapping values to include in event payload. */
  snapshotMappingIds: string[];
  /** Cooldown between triggers. */
  cooldownSeconds?: number;
  reTriggerMode?: 'edge_only' | 'periodic_while_true';
  reTriggerIntervalSeconds?: number;
  /** Optional timer-based evaluation interval. */
  timerIntervalSeconds?: number;
  actions: AdvancedRuleActions;
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AdvancedRuleEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  triggeredAt: number;
  payload: any;
}

export interface RealtimeData {
  mappingId: string;
  mappingName: string;
  parameterId?: string;
  value: any;
  unit?: string;
  timestamp: number;
  quality: 'good' | 'bad' | 'uncertain';
}

export interface HistoricalData {
  id: string;
  mappingId: string;
  timestamp: number;
  value: string;
  quality: 'good' | 'bad' | 'uncertain';
}

export interface BufferItem {
  id: string;
  publisherId: string;
  data: RealtimeData;
  timestamp: number;
  attempts: number;
  lastAttempt?: number;
  status: 'pending' | 'failed' | 'sent';
}

export interface MqttBrokerConfig {
  id: string;
  name: string;
  enabled: boolean;
  autoStart: boolean;
  port: number;
  wsPort?: number;
  allowAnonymous: boolean;
  username?: string;
  password?: string;
  useTls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  tlsCa?: string;
  maxConnections: number;
  retainedMessages: boolean;
  persistenceEnabled: boolean;
  logLevel: string;
  createdAt: number;
  updatedAt: number;
}

export interface SystemConfig {
  id: string;
  key: string;
  value?: string;
  createdAt: number;
  updatedAt: number;
}

// SPARING Types
export type SparingSendMode = 'hourly' | '2min' | 'both';
export type SparingQueueStatus = 'pending' | 'sending' | 'sent' | 'failed';
export type SparingSendType = 'hourly' | '2min' | 'testing';

export interface SparingConfig {
  id: string;
  loggerId: string;
  apiBase?: string;
  apiSecretUrl?: string;
  apiSendHourlyUrl?: string;
  apiSend2MinUrl?: string;
  apiTestingUrl?: string;
  apiSecret?: string;
  apiSecretFetchedAt?: number;
  enabled: boolean;
  sendMode: SparingSendMode;
  lastHourlySend?: number;
  last2MinSend?: number;
  retryMaxAttempts?: number;
  retryIntervalMinutes?: number;
  /** When SPARING host is reachable again, re-queue every failed row (not only network-like errors). */
  retryAllFailedOnReconnect?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SparingMapping {
  id: string;
  mappingId: string;
  sparingParam: string;
  enabled: boolean;
  createdAt: number;
}

export interface SparingQueue {
  id: string;
  sendType: SparingSendType;
  hourTimestamp: number;
  payload: string;
  recordsCount: number;
  status: SparingQueueStatus;
  retryCount: number;
  lastAttemptAt?: number;
  errorMessage?: string;
  createdAt: number;
  sentAt?: number;
}

export interface SparingLog {
  id: string;
  sendType: SparingSendType;
  hourTimestamp?: number;
  recordsCount: number;
  status: 'success' | 'failed';
  response?: string;
  durationMs?: number;
  timestamp: number;
}

export interface Sparing2MinData {
  waktu: string;
  [key: string]: string | number;
}

export interface SparingHourlyData {
  uid: string;
  data: any[];
}

export interface SparingJwtPayload {
  waktu: string;
  uid: string;
  [key: string]: string | number;
}

export interface SparingApiResponse {
  status: string;
  message?: string;
  data?: any;
}

