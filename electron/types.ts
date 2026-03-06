// Shared type definitions for Electron main process

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'viewer';
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

