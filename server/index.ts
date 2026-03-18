/**
 * LT-IDP Web Server
 * Serves the React app and exposes REST API + WebSocket for the same logic as the Electron app.
 */
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { DatabaseService } from '../electron/services/database';
import { AuthService } from '../electron/services/auth';
import { ModbusService } from '../electron/services/modbus';
import { MqttSubscriberService } from '../electron/services/mqttSubscriber';
import { MqttPublisherService } from '../electron/services/mqttPublisher';
import { MqttBrokerService } from '../electron/services/mqttBroker';
import { HttpClientService } from '../electron/services/httpClient';
import { DataMapperService } from '../electron/services/dataMapper';
import { SparingService } from '../electron/services/sparingService';
import { EmailNotificationService } from '../electron/services/emailNotificationService';
import { ThresholdPublishService } from '../electron/services/thresholdPublish';
import { getLogger } from '../electron/services/logger';
import { SerialPort } from 'serialport';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const logger = getLogger(DATA_DIR);
logger.info('Server starting. DATA_DIR:', DATA_DIR);

function errMsg(e: any): string {
  if (e == null) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof e?.message === 'string') return e.message;
  return String(e);
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection:', errMsg(reason));
});

const dbPath = path.join(DATA_DIR, 'scada.db');
const exportDir = path.join(DATA_DIR, 'exports');
const dbService = new DatabaseService(dbPath, exportDir);

// Services created after DB init (see async block below) so that tables exist
let authService: AuthService;
let modbusService: ModbusService;
let mqttSubscriberService: MqttSubscriberService;
let mqttPublisherService: MqttPublisherService;
let mqttBrokerService: MqttBrokerService;
let httpClientService: HttpClientService;
let dataMapperService: DataMapperService;
let sparingService: SparingService;
let emailNotificationService!: EmailNotificationService;
let thresholdPublishService: ThresholdPublishService;

// WebSocket broadcast (assigned after services created)
let broadcast: (msg: { type: string; data?: any }) => void = () => {};
const realtimeSubscribers: Set<string[]> = new Set();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function getToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return (req as any).cookies?.token ?? req.body?.token ?? null;
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const result = authService.verifyToken(token);
  if (!result.valid) return res.status(401).json({ error: 'Invalid or expired token' });
  (req as any).user = result.user;
  next();
}

// ---------- Auth ----------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = await authService.login(username, password);
    res.json(result);
  } catch (e: any) {
    res.status(401).json({ error: e?.message || 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = getToken(req);
  if (token) authService.logout(token);
  res.json({ ok: true });
});

app.get('/api/auth/verify', (req, res) => {
  const token = getToken(req);
  if (!token) return res.json({ valid: false });
  const result = authService.verifyToken(token);
  res.json(result);
});

app.get('/api/auth/session', (req, res) => {
  const token = getToken(req);
  if (!token) return res.json(null);
  const result = authService.verifyToken(token);
  if (!result.valid || !result.user) return res.json(null);
  res.json({ token, username: result.user.username, role: result.user.role });
});

// ---------- Users ----------
app.get('/api/users/list', authMiddleware, (req, res) => {
  res.json(dbService.getUsers());
});
app.post('/api/users/create', authMiddleware, (req, res) => {
  dbService.createUser(req.body).then((u) => res.json(u)).catch((e) => res.status(400).json({ error: e?.message }));
});

// ---------- Modbus ----------
app.get('/api/modbus/devices', authMiddleware, (req, res) => res.json(dbService.getModbusDevices()));
app.post('/api/modbus/devices', authMiddleware, (req, res) => res.json(dbService.createModbusDevice(req.body)));
app.put('/api/modbus/devices/:id', authMiddleware, (req, res) => {
  dbService.updateModbusDevice(req.params.id, req.body);
  res.json({ ok: true });
});
app.delete('/api/modbus/devices/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  await modbusService.disconnect(id).catch(() => {});
  dbService.deleteModbusDevice(id);
  res.json({ ok: true });
});
app.get('/api/modbus/registers', authMiddleware, (req, res) => res.json(dbService.getModbusRegisters(req.query.deviceId as string)));
app.post('/api/modbus/registers', authMiddleware, (req, res) => {
  const created = dbService.createModbusRegister(req.body);
  const regs = dbService.getModbusRegisters(req.body.deviceId);
  modbusService.updateDeviceRegisters(req.body.deviceId, regs);
  res.json(created);
});
app.put('/api/modbus/registers/:id', authMiddleware, (req, res) => {
  const existing = dbService.getModbusRegisterById(req.params.id);
  dbService.updateModbusRegister(req.params.id, req.body);
  const deviceId = req.body.deviceId || existing?.deviceId;
  if (deviceId) modbusService.updateDeviceRegisters(deviceId, dbService.getModbusRegisters(deviceId));
  res.json({ ok: true });
});
app.delete('/api/modbus/registers/:id', authMiddleware, (req, res) => {
  const existing = dbService.getModbusRegisterById(req.params.id);
  dbService.deleteModbusRegister(req.params.id);
  if (existing?.deviceId) modbusService.updateDeviceRegisters(existing.deviceId, dbService.getModbusRegisters(existing.deviceId));
  res.json({ ok: true });
});
app.post('/api/modbus/connect', authMiddleware, (req, res) => {
  const deviceId = req.body?.deviceId;
  if (!deviceId) {
    return res.status(400).json({ error: 'Missing device ID' });
  }
  modbusService
    .connect(deviceId)
    .then(() => res.json({ ok: true }))
    .catch((e: any) => res.status(400).json({ error: (e?.message ?? (typeof e === 'string' ? e : String(e))) || 'Connection failed' }));
});
app.post('/api/modbus/disconnect', authMiddleware, (req, res) => {
  modbusService.disconnect(req.body?.deviceId);
  res.json({ ok: true });
});
app.get('/api/modbus/status', authMiddleware, (req, res) => res.json(modbusService.getConnectionStatus()));
app.get('/api/serial-ports', authMiddleware, (req, res) => {
  SerialPort.list()
    .then((ports) => res.json(ports.map((p: any) => ({ path: p.path, manufacturer: p.manufacturer, serialNumber: p.serialNumber }))))
    .catch((err: any) => {
      logger.error('List serial ports', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to list serial ports' });
    });
});

// ---------- MQTT ----------
app.get('/api/mqtt/devices', authMiddleware, (req, res) => res.json(dbService.getMqttDevices()));
app.post('/api/mqtt/devices', authMiddleware, (req, res) => res.json(dbService.createMqttDevice(req.body)));
app.put('/api/mqtt/devices/:id', authMiddleware, (req, res) => {
  dbService.updateMqttDevice(req.params.id, req.body);
  res.json({ ok: true });
});
app.delete('/api/mqtt/devices/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  await mqttSubscriberService.disconnect(id).catch(() => {});
  dbService.deleteMqttDevice(id);
  res.json({ ok: true });
});
app.post('/api/mqtt/connect', authMiddleware, (req, res) => {
  mqttSubscriberService.connect(req.body?.deviceId).then(() => res.json({ ok: true })).catch((e) => res.status(400).json({ error: e?.message }));
});
app.post('/api/mqtt/disconnect', authMiddleware, (req, res) => {
  mqttSubscriberService.disconnect(req.body?.deviceId);
  res.json({ ok: true });
});
app.get('/api/mqtt/status', authMiddleware, (req, res) => res.json(mqttSubscriberService.getConnectionStatus()));

app.get('/api/mqtt/broker', authMiddleware, (req, res) => res.json(dbService.getMqttBrokerConfig()));
app.post('/api/mqtt/broker', authMiddleware, (req, res) => {
  const existing = dbService.getMqttBrokerConfig();
  if (existing) dbService.updateMqttBrokerConfig(existing.id, req.body);
  else dbService.createMqttBrokerConfig(req.body);
  res.json(dbService.getMqttBrokerConfig());
});
app.post('/api/mqtt/broker/start', authMiddleware, async (req, res) => {
  try {
    let config = dbService.getMqttBrokerConfig();
    if (!config) config = dbService.createMqttBrokerConfig({ name: 'Local', enabled: true, port: 11883, wsPort: 19001, allowAnonymous: true, useTls: false, maxConnections: 100, retainedMessages: true, persistenceEnabled: true, logLevel: 'warning' });
    dbService.getOrCreateLocalBrokerDevice();
    await mqttBrokerService.start(config);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message });
  }
});
app.post('/api/mqtt/broker/stop', authMiddleware, async (req, res) => {
  await mqttBrokerService.stop();
  res.json({ success: true });
});
app.get('/api/mqtt/broker/status', authMiddleware, (req, res) => res.json(mqttBrokerService.getStatus()));
app.get('/api/mqtt/broker/check-installed', authMiddleware, (req, res) => res.json(mqttBrokerService.isMosquittoInstalled()));
app.get('/api/mqtt/discovered', authMiddleware, (req, res) => res.json(mqttBrokerService.getDiscoveredTopics()));

// ---------- Mappings ----------
app.get('/api/mappings', authMiddleware, (req, res) => res.json(dbService.getParameterMappings()));
app.post('/api/mappings', authMiddleware, (req, res) => {
  const result = dbService.createParameterMapping(req.body);
  dataMapperService.reloadMappings();
  res.json(result);
});
app.put('/api/mappings/:id', authMiddleware, (req, res) => {
  dbService.updateParameterMapping(req.params.id, req.body);
  dataMapperService.reloadMappings();
  res.json({ ok: true });
});
app.delete('/api/mappings/:id', authMiddleware, (req, res) => {
  dbService.deleteParameterMapping(req.params.id);
  dataMapperService.reloadMappings();
  res.json({ ok: true });
});

// ---------- Data ----------
app.post('/api/data/query', authMiddleware, (req, res) => {
  const { startTime, endTime, mappingIds } = req.body || {};
  res.json(dbService.queryHistoricalData(startTime, endTime, mappingIds || []));
});
app.post('/api/data/export', authMiddleware, (req, res) => {
  const { startTime, endTime, mappingIds, format } = req.body || {};
  const result = dbService.exportData(startTime, endTime, mappingIds || [], format || 'csv');
  res.json(result);
});
app.post('/api/data/realtime/subscribe', authMiddleware, (req, res) => {
  const mappingIds = req.body?.mappingIds || [];
  realtimeSubscribers.add(mappingIds);
  res.json({ ok: true });
});

// ---------- Publishers ----------
app.get('/api/publishers', authMiddleware, (req, res) => res.json(dbService.getPublishers()));
app.post('/api/publishers', authMiddleware, (req, res) => res.json(dbService.createPublisher(req.body)));
app.put('/api/publishers/:id', authMiddleware, (req, res) => {
  dbService.updatePublisher(req.params.id, req.body);
  const updated = dbService.getPublisherById(req.params.id);
  if (updated?.type === 'mqtt') mqttPublisherService.refreshPublisher(updated.id);
  else if (updated?.type === 'http') httpClientService.refreshPublisher(updated.id);
  res.json(updated);
});
app.delete('/api/publishers/:id', authMiddleware, (req, res) => {
  dbService.deletePublisher(req.params.id);
  res.json({ ok: true });
});
app.post('/api/publishers/toggle', authMiddleware, async (req, res) => {
  const { id, enabled } = req.body || {};
  const pub = dbService.getPublisherById(id);
  if (!pub) return res.status(404).json({ error: 'Not found' });
  dbService.togglePublisher(id, enabled);
  if (enabled) {
    if (pub.type === 'mqtt') await mqttPublisherService.start(id);
    else await httpClientService.start(id);
  } else {
    if (pub.type === 'mqtt') mqttPublisherService.stop(id);
    else httpClientService.stop(id);
  }
  res.json(dbService.getPublisherById(id));
});

// ---------- Threshold-triggered HTTP publish rules ----------
app.get('/api/threshold-rules', authMiddleware, (req, res) => res.json(dbService.getThresholdPublishRules()));
app.post('/api/threshold-rules', authMiddleware, (req, res) => {
  const created = dbService.createThresholdPublishRule(req.body);
  thresholdPublishService.reloadRules();
  res.json(created);
});
app.put('/api/threshold-rules/:id', authMiddleware, (req, res) => {
  dbService.updateThresholdPublishRule(req.params.id, req.body);
  thresholdPublishService.reloadRules();
  res.json(dbService.getThresholdPublishRuleById(req.params.id));
});
app.delete('/api/threshold-rules/:id', authMiddleware, (req, res) => {
  dbService.deleteThresholdPublishRule(req.params.id);
  thresholdPublishService.reloadRules();
  res.json({ ok: true });
});
app.post('/api/threshold-rules/:id/test', authMiddleware, async (req, res) => {
  try {
    await thresholdPublishService.triggerRuleNow(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to test rule' });
  }
});

// ---------- System ----------
app.get('/api/system/client-id', authMiddleware, (req, res) => res.json(dbService.getClientId()));
app.post('/api/system/client-id', authMiddleware, (req, res) => {
  dbService.setClientId(req.body?.clientId || '');
  res.json({ success: true });
});
app.get('/api/system/timestamp-interval', authMiddleware, (req, res) => res.json(dbService.getSystemTimestampInterval()));
app.post('/api/system/timestamp-interval', authMiddleware, (req, res) => {
  const seconds = req.body?.seconds ?? 60;
  dbService.setSystemTimestampInterval(seconds);
  dataMapperService.setSystemTimestampInterval(seconds);
  res.json({ success: true });
});
app.get('/api/system/local-ip', authMiddleware, (req, res) => {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces || {})) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return res.json(iface.address);
    }
  }
  res.json('localhost');
});
app.get('/api/system/log-directory', authMiddleware, (req, res) => res.json(logger.getLogDirectory()));
app.get('/api/system/current-log-file', authMiddleware, (req, res) => res.json(logger.getCurrentLogFile()));

// ---------- SPARING ----------
app.get('/api/sparing/config', authMiddleware, (req, res) => res.json(sparingService.getSparingConfig()));
app.post('/api/sparing/config', authMiddleware, (req, res) => {
  const updated = sparingService.upsertSparingConfig(req.body);
  const needsRestart = req.body?.enabled !== undefined || req.body?.sendMode !== undefined || req.body?.retryIntervalMinutes !== undefined;
  if (needsRestart) {
    sparingService.stopHourlyScheduler();
    if (updated?.enabled && (updated.sendMode === 'hourly' || updated.sendMode === 'both')) sparingService.startHourlyScheduler();
    if (updated?.enabled && (updated.sendMode === '2min' || updated.sendMode === 'both')) sparingService.startTwoMinScheduler();
  }
  res.json(updated);
});
app.post('/api/sparing/fetch-api-secret', authMiddleware, (req, res) => {
  sparingService.fetchApiSecret().then((r) => res.json(r)).catch((e) => res.status(400).json({ error: e?.message }));
});
app.get('/api/sparing/mappings', authMiddleware, (req, res) => res.json(sparingService.getSparingMappings()));
app.post('/api/sparing/mappings', authMiddleware, (req, res) => {
  const { sparingParam, mappingId } = req.body || {};
  sparingService.upsertSparingMapping(sparingParam, mappingId);
  res.json({ ok: true });
});
app.delete('/api/sparing/mappings/:id', authMiddleware, (req, res) => {
  sparingService.deleteSparingMapping(req.params.id);
  res.json({ ok: true });
});
app.get('/api/sparing/logs', authMiddleware, (req, res) => res.json(sparingService.getSparingLogs(Number(req.query.limit) || 50)));
app.get('/api/sparing/export-log', authMiddleware, (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const result = logger.readSparingLogForExport(date);
    if (date) {
      const single = result as { path: string; content: string; filename: string };
      return res.json({ content: single.content, filename: single.filename || `sparing-${date}.jsonl` });
    }
    const files = result as { path: string; content: string; filename: string }[];
    const content = files.filter((f) => f.content).map((f) => f.content).join('');
    return res.json({ content, filename: 'sparing-logs-export.jsonl' });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to export SPARING log' });
  }
});
app.post('/api/sparing/process-queue', authMiddleware, (req, res) => {
  sparingService.processQueue().then(() => res.json({ ok: true }));
});
app.get('/api/sparing/queue', authMiddleware, (req, res) => res.json(sparingService.getQueueItems(Number(req.query.limit) || 100)));
app.post('/api/sparing/send-now', authMiddleware, (req, res) => {
  sparingService.sendNow(req.body?.hourTimestamp).then(() => res.json({ ok: true })).catch((e) => res.status(400).json({ error: e?.message }));
});
app.get('/api/sparing/status', authMiddleware, (req, res) => {
  const cfg = sparingService.getSparingConfig();
  return res.json({
    enabled: cfg?.enabled ?? false,
    sendMode: cfg?.sendMode ?? 'hourly',
    lastHourlySend: cfg?.lastHourlySend ?? null,
    last2MinSend: (cfg as any)?.last2MinSend ?? null,
    queueDepth: (sparingService as any).getQueueDepth?.() ?? 0,
    nextRuns: (sparingService as any).getNextRunTimes?.() ?? {},
  });
});

app.get('/api/email-notifications', authMiddleware, (req, res) => {
  res.json(emailNotificationService.getSettingsForApi());
});
app.post('/api/email-notifications', authMiddleware, (req, res) => {
  emailNotificationService.saveSettings(req.body || {});
  res.json(emailNotificationService.getSettingsForApi());
});
app.post('/api/email-notifications/test', authMiddleware, async (req, res) => {
  const r = await emailNotificationService.testEmail();
  if (r.ok) res.json(r);
  else res.status(400).json(r);
});

// ---------- Static (production) ----------
const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = http.createServer(app);

// WebSocket: handle upgrade for /api/ws
const wss = new WebSocketServer({ noServer: true });
const wsClients: Set<any> = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/api/ws' || req.url?.startsWith('/api/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

(async () => {
  await dbService.initialize();

  authService = new AuthService(dbService);
  modbusService = new ModbusService(dbService);
  mqttSubscriberService = new MqttSubscriberService(dbService);
  mqttPublisherService = new MqttPublisherService(dbService);
  mqttBrokerService = new MqttBrokerService(DATA_DIR);
  httpClientService = new HttpClientService(dbService);
  dataMapperService = new DataMapperService(dbService);
  sparingService = new SparingService(dbService);
  emailNotificationService = new EmailNotificationService(dbService, () => logger.getCurrentLogFile());
  sparingService.setSendLoggedCallback((info) => {
    void emailNotificationService.onSparingSendLogged(info);
  });
  setInterval(() => {
    try {
      emailNotificationService.tickScheduled();
    } catch (e: any) {
      logger.error('Email schedule tick:', errMsg(e));
    }
  }, 60 * 1000);
  thresholdPublishService = new ThresholdPublishService(dbService, httpClientService, () => [
    ...modbusService.getConnectionStatus(),
    ...mqttSubscriberService.getConnectionStatus(),
  ]);
  thresholdPublishService.startPeriodicCheck();

  broadcast = (msg: { type: string; data?: any }) => {
    const payload = JSON.stringify(msg);
    wsClients.forEach((ws) => { try { if (ws.readyState === 1) ws.send(payload); } catch (_) {} });
  };

  modbusService.on('data', (data: any) => {
    dataMapperService.mapModbusData(data);
    broadcast({ type: 'modbus:data', data });
  });
  mqttSubscriberService.on('data', (data: any) => {
    dataMapperService.mapMqttData(data);
    broadcast({ type: 'mqtt:data', data });
  });
  mqttBrokerService.on('data', (data: any) => {
    dataMapperService.mapMqttData(data);
    broadcast({ type: 'mqtt:data', data });
  });
  mqttPublisherService.on('log', (logData: any) => broadcast({ type: 'publisher:log', data: logData }));
  httpClientService.on('log', (logData: any) => broadcast({ type: 'publisher:log', data: logData }));
  dataMapperService.on('dataStored', (data: any) => {
    const mqttPubs = dbService.getPublishers().filter((p: any) => p.enabled && p.type === 'mqtt');
    mqttPubs.forEach((pub: any) => mqttPublisherService.publish(pub.id, data).catch((e: any) => logger.error(e?.message)));
    const httpPubs = dbService.getPublishers().filter((p: any) => p.enabled && p.type === 'http');
    httpPubs.forEach((pub: any) => httpClientService.publish(pub.id, data).catch((e: any) => logger.error(e?.message)));
  });
  dataMapperService.on('dataMapped', (data: any) => {
    thresholdPublishService.onMappedData(data);
    broadcast({ type: 'data:realtime', data });
  });
  thresholdPublishService.on('log', (logData: any) => broadcast({ type: 'publisher:log', data: logData }));

  const sparingConfig = sparingService.getSparingConfig();
  if (sparingConfig?.enabled) {
    sparingService.startHourlyScheduler();
    logger.info('SPARING scheduler started');
  }

  const publishers = dbService.getPublishers().filter((p: any) => p.enabled && p.autoStart);
  for (const pub of publishers) {
    try {
      if (pub.type === 'mqtt') await mqttPublisherService.start(pub.id);
      else await httpClientService.start(pub.id);
    } catch (e: any) { logger.error('Auto-start publisher', pub.name, e?.message); }
  }
  const autoModbus = dbService.getModbusDevices().filter((d: any) => d.enabled && d.autoStart);
  for (const device of autoModbus) {
    try {
      await modbusService.connect(device.id);
    } catch (e: any) {
      logger.error('Auto-start Modbus', device.name, 'failed:', errMsg(e));
    }
  }
  const autoMqtt = dbService.getMqttDevices().filter((d: any) => d.enabled && d.autoStart);
  for (const device of autoMqtt) {
    try { await mqttSubscriberService.connect(device.id); } catch (e: any) { logger.error('Auto-start MQTT', device.name, e?.message); }
  }
  const brokerConfig = dbService.getMqttBrokerConfig();
  if (brokerConfig?.autoStart) {
    try { await mqttBrokerService.start(brokerConfig); } catch (e: any) { logger.error('Auto-start broker', e?.message); }
  }

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`LT-IDP web server listening on http://0.0.0.0:${PORT}`);
  });
})();
