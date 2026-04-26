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
import { AdvancedRulesService } from '../electron/services/advancedRulesService';
import { getLogger } from '../electron/services/logger';
import { getSystemInfo } from '../electron/services/systemInfo';
import { GnssService, type GnssConfig } from '../electron/services/gnssService';
import { runScheduledDataRetention } from '../electron/services/dataRetentionScheduler';
import { SerialPort } from 'serialport';
import { execFile } from 'child_process';
import { promisify } from 'util';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DAY_MS = 86_400_000;

const execFileAsync = promisify(execFile);

function isLinux(): boolean {
  return process.platform === 'linux';
}

function assertLinuxWifiSupported(): void {
  if (!isLinux()) {
    throw new Error('Wi‑Fi configuration is supported only on Linux hosts.');
  }
}

async function nmcli(args: string[], timeoutMs = 12_000): Promise<string> {
  const { stdout } = await execFileAsync('nmcli', args, {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    encoding: 'utf8',
  } as any);
  return String(stdout || '');
}

type WifiScanRow = {
  ssid: string;
  security: string;
  signal: number | null;
  inUse: boolean;
  device?: string | null;
};

function parseNmcliWifiList(stdout: string): WifiScanRow[] {
  // format: IN-USE:SSID:SECURITY:SIGNAL:DEVICE
  const lines = String(stdout || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: WifiScanRow[] = [];
  for (const line of lines) {
    const parts = line.split(':');
    const inUse = (parts[0] || '').trim() === '*';
    const ssid = (parts[1] || '').trim();
    const security = (parts[2] || '').trim();
    const signalRaw = (parts[3] || '').trim();
    const device = (parts[4] || '').trim() || null;
    const signal = signalRaw ? Number(signalRaw) : null;
    if (!ssid) continue; // hide hidden SSIDs for now
    out.push({ ssid, security, signal: Number.isFinite(signal as number) ? (signal as number) : null, inUse, device });
  }
  // strongest first; keep in-use on top
  return out.sort(
    (a, b) =>
      (b.inUse ? 1 : 0) - (a.inUse ? 1 : 0) ||
      (b.signal ?? -1) - (a.signal ?? -1) ||
      a.ssid.localeCompare(b.ssid)
  );
}

async function linuxWifiStatus(): Promise<{ devices: Array<{ device: string; type: string; state: string; connection: string | null }> }> {
  assertLinuxWifiSupported();
  const raw = await nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']);
  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const devices = lines
    .map((l) => {
      const [device, type, state, connection] = l.split(':');
      return { device, type, state, connection: connection && connection !== '--' ? connection : null };
    })
    .filter((d) => d.type === 'wifi');
  return { devices };
}

type NetIpDeviceRow = {
  device: string;
  type: string;
  state: string;
  connection: string | null;
  ipv4Address: string | null;
  ipv4Gateway: string | null;
  ipv4Dns: string[];
};

async function nmcliDeviceField(device: string, field: string): Promise<string> {
  // e.g. nmcli -g GENERAL.CONNECTION device show wlan0
  const out = await nmcli(['-g', field, 'device', 'show', device]);
  return out.trim();
}

function splitDns(v: string): string[] {
  const t = (v || '').trim();
  if (!t) return [];
  // nmcli -g IP4.DNS can return multi-line or comma-separated depending on version
  return t
    .replace(/\r\n/g, '\n')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function linuxNetIpStatus(): Promise<{ devices: NetIpDeviceRow[] }> {
  assertLinuxWifiSupported();
  const raw = await nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']);
  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const base = lines.map((l) => {
    const [device, type, state, connection] = l.split(':');
    return { device, type, state, connection: connection && connection !== '--' ? connection : null };
  });
  const wanted = base.filter((d) => d.type === 'wifi' || d.type === 'ethernet');

  const devices: NetIpDeviceRow[] = [];
  for (const d of wanted) {
    // IP4.ADDRESS is often like "192.168.1.50/24" (may be multiple lines)
    const addrRaw = await nmcliDeviceField(d.device, 'IP4.ADDRESS').catch(() => '');
    const gwRaw = await nmcliDeviceField(d.device, 'IP4.GATEWAY').catch(() => '');
    const dnsRaw = await nmcliDeviceField(d.device, 'IP4.DNS').catch(() => '');
    const ipv4Address = addrRaw ? addrRaw.split(/\r?\n/)[0]?.trim() || null : null;
    const ipv4Gateway = gwRaw || null;
    const ipv4Dns = splitDns(dnsRaw);
    devices.push({ ...d, ipv4Address, ipv4Gateway, ipv4Dns });
  }
  return { devices };
}

async function pingHost(host: string, timeoutMs = 3000): Promise<boolean> {
  const h = String(host || '').trim();
  if (!h) return false;
  try {
    // Linux: ping -c 1 -W <seconds> host
    const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    await execFileAsync('ping', ['-c', '1', '-W', String(waitSeconds), h], {
      timeout: timeoutMs + 1500,
      maxBuffer: 128 * 1024,
      windowsHide: true,
      encoding: 'utf8',
    } as any);
    return true;
  } catch {
    return false;
  }
}

function clampInt(n: any, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function validateCidrv4(s: string): void {
  const t = String(s || '').trim();
  const m = t.match(/^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/);
  if (!m) throw new Error('address must be IPv4 CIDR, e.g. 192.168.1.50/24');
  const [ip, prefixStr] = t.split('/');
  const parts = ip.split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error('address must be IPv4 CIDR, e.g. 192.168.1.50/24');
  }
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) throw new Error('CIDR prefix must be 1..32');
}

function validateIpv4(s: string, label: string): void {
  const t = String(s || '').trim();
  if (!t) return;
  const parts = t.split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`${label} must be an IPv4 address`);
  }
}

async function linuxSetIpv4ForDevice(payload: {
  device: string;
  method: 'auto' | 'manual';
  address?: string;
  gateway?: string;
  dns?: string[];
  testConnectivity?: boolean;
  safetyRollbackSeconds?: number;
}): Promise<void> {
  assertLinuxWifiSupported();
  const device = String(payload.device || '').trim();
  if (!device) throw new Error('device is required');
  const conn = await nmcliDeviceField(device, 'GENERAL.CONNECTION').catch(() => '');
  if (!conn || conn === '--') {
    throw new Error(`No active NetworkManager connection for ${device}. Connect it first.`);
  }

  const method = payload.method;
  if (method !== 'auto' && method !== 'manual') throw new Error('method must be auto or manual');

  const testConnectivity = payload.testConnectivity !== false;
  const safetyRollbackSeconds = clampInt(payload.safetyRollbackSeconds ?? 30, 0, 300);

  const prev = {
    method: (await nmcli(['-g', 'ipv4.method', 'connection', 'show', conn]).catch(() => '')).trim(),
    addresses: (await nmcli(['-g', 'ipv4.addresses', 'connection', 'show', conn]).catch(() => '')).trim(),
    gateway: (await nmcli(['-g', 'ipv4.gateway', 'connection', 'show', conn]).catch(() => '')).trim(),
    dns: (await nmcli(['-g', 'ipv4.dns', 'connection', 'show', conn]).catch(() => '')).trim(),
    ignoreAutoDns: (await nmcli(['-g', 'ipv4.ignore-auto-dns', 'connection', 'show', conn]).catch(() => '')).trim(),
  };

  if (method === 'auto') {
    await nmcli(['connection', 'modify', conn, 'ipv4.method', 'auto']);
    await nmcli(['connection', 'modify', conn, 'ipv4.addresses', '']);
    await nmcli(['connection', 'modify', conn, 'ipv4.gateway', '']);
    await nmcli(['connection', 'modify', conn, 'ipv4.dns', '']);
    await nmcli(['connection', 'modify', conn, 'ipv4.ignore-auto-dns', 'no']);
  } else {
    const address = String(payload.address || '').trim();
    if (!address) throw new Error('address is required for manual mode (example: 192.168.1.50/24)');
    const gateway = String(payload.gateway || '').trim();
    const dns = Array.isArray(payload.dns) ? payload.dns.map((d) => String(d).trim()).filter(Boolean) : [];
    validateCidrv4(address);
    validateIpv4(gateway, 'gateway');
    dns.forEach((d) => validateIpv4(d, 'dns'));

    await nmcli(['connection', 'modify', conn, 'ipv4.method', 'manual']);
    await nmcli(['connection', 'modify', conn, 'ipv4.addresses', address]);
    await nmcli(['connection', 'modify', conn, 'ipv4.gateway', gateway || '']);
    await nmcli(['connection', 'modify', conn, 'ipv4.dns', dns.join(',')]);
    // Prefer explicit DNS when user provided any
    await nmcli(['connection', 'modify', conn, 'ipv4.ignore-auto-dns', dns.length > 0 ? 'yes' : 'no']);
  }

  // Apply by cycling connection. (nmcli device reapply would be nicer but not always available.)
  await nmcli(['connection', 'down', conn], 25_000).catch(() => {});
  await nmcli(['connection', 'up', conn], 35_000);

  const doVerify = async (): Promise<boolean> => {
    if (!testConnectivity) return true;
    // Prefer gateway ping if provided; otherwise just try public IP.
    const gw = String(payload.gateway || '').trim();
    if (gw) {
      const okGw = await pingHost(gw, 3000);
      if (!okGw) return false;
    }
    const okNet = await pingHost('1.1.1.1', 3500);
    return okNet;
  };

  const restorePrev = async (): Promise<void> => {
    await nmcli(['connection', 'modify', conn, 'ipv4.method', prev.method || 'auto']).catch(() => {});
    await nmcli(['connection', 'modify', conn, 'ipv4.addresses', prev.addresses || '']).catch(() => {});
    await nmcli(['connection', 'modify', conn, 'ipv4.gateway', prev.gateway || '']).catch(() => {});
    await nmcli(['connection', 'modify', conn, 'ipv4.dns', prev.dns || '']).catch(() => {});
    await nmcli(['connection', 'modify', conn, 'ipv4.ignore-auto-dns', prev.ignoreAutoDns || 'no']).catch(() => {});
    await nmcli(['connection', 'down', conn], 25_000).catch(() => {});
    await nmcli(['connection', 'up', conn], 35_000).catch(() => {});
  };

  if (safetyRollbackSeconds > 0) {
    let rolledBack = false;
    const timer = setTimeout(async () => {
      if (rolledBack) return;
      // If still not good after the grace period, rollback.
      const ok = await doVerify().catch(() => false);
      if (!ok) {
        rolledBack = true;
        await restorePrev().catch(() => {});
      }
    }, safetyRollbackSeconds * 1000);

    // Early verify: if good now, cancel timer.
    const okNow = await doVerify().catch(() => false);
    if (okNow) {
      clearTimeout(timer);
    }
  } else {
    const okNow = await doVerify().catch(() => false);
    if (!okNow) {
      await restorePrev();
      throw new Error('Connectivity test failed; changes were rolled back.');
    }
  }
}

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
let gnssService: GnssService;
let advancedRulesService: AdvancedRulesService;

// WebSocket broadcast (assigned after services created)
let broadcast: (msg: { type: string; data?: any }) => void = () => {};
const realtimeSubscribers: Set<string[]> = new Set();
const publicRealtimeSubscribers: Set<string[]> = new Set();

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
  // Guest role: allow only SPARING APIs (and /api/auth/* which are not protected by this middleware).
  // This protects the backend even if someone tries to call other endpoints directly.
  if ((result.user as any)?.role === 'guest') {
    const url = req.originalUrl || req.url || '';
    if (!String(url).startsWith('/api/sparing')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  next();
}

function getReadOnlyTokenFromReq(req: express.Request): string | null {
  const q = (req.query as any)?.ro;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const h = req.headers['x-read-only-token'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return null;
}

function readOnlyMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = getReadOnlyTokenFromReq(req);
  if (!token) return res.status(401).json({ error: 'Missing read-only token' });
  const expected = dbService.getReadOnlyToken();
  if (token !== expected) return res.status(403).json({ error: 'Invalid read-only token' });
  (req as any).readOnly = true;
  next();
}

function sparingRoleMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const role = (req as any).user?.role;
  if (role !== 'admin' && role !== 'guest') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req as any).user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
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

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const { currentPassword, newPassword } = req.body || {};
    const r = await authService.changePassword(user.username, currentPassword, newPassword);
    res.json(r);
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to change password' });
  }
});

// ---------- Users ----------
app.get('/api/users/list', authMiddleware, (req, res) => {
  const role = (req as any).user?.role;
  if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json(dbService.getUsers());
});
app.post('/api/users/create', authMiddleware, (req, res) => {
  const role = (req as any).user?.role;
  if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
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
app.post('/api/modbus/write', authMiddleware, async (req, res) => {
  try {
    const { deviceId, registerId, value } = req.body || {};
    if (!deviceId || !registerId || value === undefined) {
      return res.status(400).json({ error: 'deviceId, registerId, and value are required' });
    }
    await modbusService.writeMappedRegister(deviceId, registerId, value);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});
app.get('/api/serial-ports', authMiddleware, (req, res) => {
  SerialPort.list()
    .then((ports) => res.json(ports.map((p: any) => ({ path: p.path, manufacturer: p.manufacturer, serialNumber: p.serialNumber }))))
    .catch((err: any) => {
      logger.error('List serial ports', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to list serial ports' });
    });
});

function getGnssConfig(): GnssConfig {
  const enabled = (dbService.getSystemConfig('gnss:enabled') || '').trim() === '1';
  const portPathRaw = (dbService.getSystemConfig('gnss:portPath') || '').trim();
  const baudRaw = (dbService.getSystemConfig('gnss:baudRate') || '').trim();
  const baud = Number(baudRaw);
  const histRaw = (dbService.getSystemConfig('gnss:historyIntervalSeconds') || '').trim();
  const hist = Number(histRaw);
  const filterEnabled = (dbService.getSystemConfig('gnss:filterEnabled') || '').trim();
  const satCountSourceRaw = (dbService.getSystemConfig('gnss:satelliteCountSource') || '').trim();
  const allowedConstRaw = (dbService.getSystemConfig('gnss:allowedConstellations') || '').trim();
  const minSatRaw = (dbService.getSystemConfig('gnss:minSatellites') || '').trim();
  const minFixRaw = (dbService.getSystemConfig('gnss:minFixQuality') || '').trim();
  const maxJumpRaw = (dbService.getSystemConfig('gnss:maxJumpMeters') || '').trim();
  const maxSpeedRaw = (dbService.getSystemConfig('gnss:maxSpeedKmh') || '').trim();
  const minTripSpdRaw = (dbService.getSystemConfig('gnss:minTripSpeedKmh') || '').trim();
  const holdRaw = (dbService.getSystemConfig('gnss:holdLastGoodSeconds') || '').trim();
  const smoothRaw = (dbService.getSystemConfig('gnss:smoothingWindow') || '').trim();
  const minUpdRaw = (dbService.getSystemConfig('gnss:minUpdateIntervalMs') || '').trim();
  const defaultAllowed = ['gps', 'glonass', 'galileo', 'beidou', 'sbas', 'qzss', 'navic', 'unknown'] as const;
  return {
    enabled,
    portPath: portPathRaw || null,
    baudRate: Number.isFinite(baud) ? Math.floor(baud) : 9600,
    historyIntervalSeconds: Number.isFinite(hist) ? Math.max(1, Math.floor(hist)) : 5,
    filterEnabled: filterEnabled ? filterEnabled === '1' : true,
    satelliteCountSource: satCountSourceRaw === 'gsa' ? 'gsa' : 'gga',
    allowedConstellations: (() => {
      try {
        const arr = JSON.parse(allowedConstRaw || '[]');
        if (!Array.isArray(arr) || !arr.length) return [...defaultAllowed];
        const allowed = arr
          .map((x: any) => String(x))
          .filter((x: string) => (defaultAllowed as readonly string[]).includes(x)) as any;
        return allowed.length ? allowed : [...defaultAllowed];
      } catch {
        return [...defaultAllowed];
      }
    })(),
    minSatellites: Number.isFinite(Number(minSatRaw)) ? Math.max(0, Math.floor(Number(minSatRaw))) : 4,
    minFixQuality: Number.isFinite(Number(minFixRaw)) ? Math.max(0, Math.floor(Number(minFixRaw))) : 1,
    maxJumpMeters: Number.isFinite(Number(maxJumpRaw)) ? Math.max(0, Number(maxJumpRaw)) : 25,
    maxSpeedKmh: Number.isFinite(Number(maxSpeedRaw)) ? Math.max(0, Number(maxSpeedRaw)) : 200,
    minTripSpeedKmh: Number.isFinite(Number(minTripSpdRaw)) ? Math.max(0, Math.min(500, Number(minTripSpdRaw))) : 0,
    holdLastGoodSeconds: Number.isFinite(Number(holdRaw)) ? Math.max(0, Math.floor(Number(holdRaw))) : 10,
    smoothingWindow: Number.isFinite(Number(smoothRaw)) ? Math.max(1, Math.floor(Number(smoothRaw))) : 1,
    minUpdateIntervalMs: Number.isFinite(Number(minUpdRaw)) ? Math.max(0, Math.floor(Number(minUpdRaw))) : 200,
  };
}

function setGnssConfig(next: Partial<GnssConfig>) {
  const curr = getGnssConfig();
  const merged: any = {
    enabled: typeof next.enabled === 'boolean' ? next.enabled : curr.enabled,
    portPath: typeof next.portPath === 'string' ? next.portPath : curr.portPath,
    baudRate: typeof next.baudRate === 'number' ? Math.floor(next.baudRate) : curr.baudRate,
    historyIntervalSeconds:
      typeof (next as any).historyIntervalSeconds === 'number'
        ? Math.max(1, Math.floor((next as any).historyIntervalSeconds))
        : (curr as any).historyIntervalSeconds ?? 5,
    filterEnabled: typeof (next as any).filterEnabled === 'boolean' ? (next as any).filterEnabled : curr.filterEnabled,
    satelliteCountSource:
      (next as any).satelliteCountSource === 'gsa' || (next as any).satelliteCountSource === 'gga'
        ? (next as any).satelliteCountSource
        : (curr as any).satelliteCountSource ?? 'gga',
    allowedConstellations:
      Array.isArray((next as any).allowedConstellations) && (next as any).allowedConstellations.length
        ? (next as any).allowedConstellations
            .map((x: any) => String(x))
            .filter((x: string) => ['gps', 'glonass', 'galileo', 'beidou', 'sbas', 'qzss', 'navic', 'unknown'].includes(x))
        : (curr as any).allowedConstellations ?? ['gps', 'glonass', 'galileo', 'beidou', 'sbas', 'qzss', 'navic', 'unknown'],
    minSatellites:
      typeof (next as any).minSatellites === 'number' ? Math.max(0, Math.floor((next as any).minSatellites)) : curr.minSatellites,
    minFixQuality:
      typeof (next as any).minFixQuality === 'number' ? Math.max(0, Math.floor((next as any).minFixQuality)) : curr.minFixQuality,
    maxJumpMeters:
      typeof (next as any).maxJumpMeters === 'number' ? Math.max(0, (next as any).maxJumpMeters) : curr.maxJumpMeters,
    maxSpeedKmh:
      typeof (next as any).maxSpeedKmh === 'number' ? Math.max(0, (next as any).maxSpeedKmh) : curr.maxSpeedKmh,
    minTripSpeedKmh:
      typeof (next as any).minTripSpeedKmh === 'number'
        ? Math.max(0, Math.min(500, (next as any).minTripSpeedKmh))
        : (curr as any).minTripSpeedKmh ?? 0,
    holdLastGoodSeconds:
      typeof (next as any).holdLastGoodSeconds === 'number'
        ? Math.max(0, Math.floor((next as any).holdLastGoodSeconds))
        : curr.holdLastGoodSeconds,
    smoothingWindow:
      typeof (next as any).smoothingWindow === 'number'
        ? Math.max(1, Math.floor((next as any).smoothingWindow))
        : curr.smoothingWindow,
    minUpdateIntervalMs:
      typeof (next as any).minUpdateIntervalMs === 'number'
        ? Math.max(0, Math.floor((next as any).minUpdateIntervalMs))
        : curr.minUpdateIntervalMs,
  };
  dbService.setSystemConfig('gnss:enabled', merged.enabled ? '1' : '0');
  dbService.setSystemConfig('gnss:portPath', merged.portPath || '');
  dbService.setSystemConfig('gnss:baudRate', String(merged.baudRate || 9600));
  dbService.setSystemConfig('gnss:historyIntervalSeconds', String(merged.historyIntervalSeconds || 5));
  dbService.setSystemConfig('gnss:filterEnabled', merged.filterEnabled ? '1' : '0');
  dbService.setSystemConfig('gnss:satelliteCountSource', String((merged as any).satelliteCountSource || 'gga'));
  dbService.setSystemConfig('gnss:allowedConstellations', JSON.stringify((merged as any).allowedConstellations || []));
  dbService.setSystemConfig('gnss:minSatellites', String(merged.minSatellites ?? 4));
  dbService.setSystemConfig('gnss:minFixQuality', String(merged.minFixQuality ?? 1));
  dbService.setSystemConfig('gnss:maxJumpMeters', String(merged.maxJumpMeters ?? 25));
  dbService.setSystemConfig('gnss:maxSpeedKmh', String(merged.maxSpeedKmh ?? 200));
  dbService.setSystemConfig('gnss:minTripSpeedKmh', String((merged as any).minTripSpeedKmh ?? 0));
  dbService.setSystemConfig('gnss:holdLastGoodSeconds', String(merged.holdLastGoodSeconds ?? 10));
  dbService.setSystemConfig('gnss:smoothingWindow', String(merged.smoothingWindow ?? 1));
  dbService.setSystemConfig('gnss:minUpdateIntervalMs', String(merged.minUpdateIntervalMs ?? 200));
}

app.get('/api/gnss/config', authMiddleware, (req, res) => {
  res.json(getGnssConfig());
});

app.post('/api/gnss/config', authMiddleware, async (req, res) => {
  try {
    const body = (req.body || {}) as Partial<GnssConfig>;
    setGnssConfig(body);
    const cfg = getGnssConfig();
    await gnssService.applyConfig(cfg);
    res.json({ ok: true, config: cfg, status: gnssService.getStatus() });
  } catch (e: any) {
    res.status(400).json({ error: errMsg(e) });
  }
});

app.get('/api/gnss/status', authMiddleware, (req, res) => {
  res.json(gnssService.getStatus());
});

app.post('/api/gnss/reset-trip-distance', authMiddleware, async (req, res) => {
  try {
    const status = await gnssService.resetTripDistance();
    res.json({ ok: true, status });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
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

app.get('/api/data/storage-summary', authMiddleware, (_req, res) => {
  try {
    const dbPart = dbService.getDataStorageSummary();
    const logs = logger.getLogsStorageSummary();
    res.json({ ...dbPart, logs });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

app.get('/api/data/cleanup-settings', authMiddleware, (req, res) => {
  const lastRaw = dbService.getSystemConfig('data:lastRetentionRunAt');
  const lastN = lastRaw ? parseInt(lastRaw, 10) : 0;
  res.json({
    retentionDays: parseInt(dbService.getSystemConfig('data:retentionDays') || '0', 10),
    exportRetentionDays: parseInt(dbService.getSystemConfig('data:exportRetentionDays') || '30', 10),
    lowDiskAutoPurge: (dbService.getSystemConfig('data:lowDiskAutoPurge') || '1') === '1',
    lowDiskFreePctThreshold: parseFloat(dbService.getSystemConfig('data:lowDiskFreePctThreshold') || '5'),
    lowDiskEmergencyKeepDays: parseInt(dbService.getSystemConfig('data:lowDiskEmergencyKeepDays') || '14', 10),
    lastRetentionRunAt: Number.isFinite(lastN) && lastN > 0 ? lastN : null,
  });
});

app.put('/api/data/cleanup-settings', authMiddleware, requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.retentionDays !== undefined) {
    const n = Number(b.retentionDays);
    if (!Number.isFinite(n) || n < 0 || n > 36500) return res.status(400).json({ error: 'Invalid retentionDays' });
    dbService.setSystemConfig('data:retentionDays', String(Math.floor(n)));
  }
  if (b.exportRetentionDays !== undefined) {
    const n = Number(b.exportRetentionDays);
    if (!Number.isFinite(n) || n < 0 || n > 3650) return res.status(400).json({ error: 'Invalid exportRetentionDays' });
    dbService.setSystemConfig('data:exportRetentionDays', String(Math.floor(n)));
  }
  if (b.lowDiskAutoPurge !== undefined) {
    dbService.setSystemConfig('data:lowDiskAutoPurge', b.lowDiskAutoPurge ? '1' : '0');
  }
  if (b.lowDiskFreePctThreshold !== undefined) {
    const n = Number(b.lowDiskFreePctThreshold);
    if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: 'Invalid lowDiskFreePctThreshold' });
    dbService.setSystemConfig('data:lowDiskFreePctThreshold', String(n));
  }
  if (b.lowDiskEmergencyKeepDays !== undefined) {
    const n = Number(b.lowDiskEmergencyKeepDays);
    if (!Number.isFinite(n) || n < 1 || n > 3650) return res.status(400).json({ error: 'Invalid lowDiskEmergencyKeepDays' });
    dbService.setSystemConfig('data:lowDiskEmergencyKeepDays', String(Math.floor(n)));
  }
  res.json({ ok: true });
});

app.post('/api/data/prune-historical', authMiddleware, requireAdmin, (req, res) => {
  const { beforeTimestamp, mappingIds } = req.body || {};
  const ts = Number(beforeTimestamp);
  if (!Number.isFinite(ts)) return res.status(400).json({ error: 'beforeTimestamp required' });
  const ids = Array.isArray(mappingIds) ? (mappingIds as unknown[]).filter((x) => typeof x === 'string') as string[] : undefined;
  const r = dbService.pruneHistoricalDataBeforeTimestamp(ts, ids?.length ? ids : undefined);
  res.json(r);
});

app.post('/api/data/vacuum', authMiddleware, requireAdmin, (_req, res) => {
  try {
    dbService.vacuumDatabase();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

app.post('/api/data/prune-exports', authMiddleware, requireAdmin, (req, res) => {
  const days = Number((req.body || {}).olderThanDays);
  if (!Number.isFinite(days) || days < 1) return res.status(400).json({ error: 'olderThanDays (>=1) required' });
  const cutoff = Date.now() - Math.floor(days) * DAY_MS;
  const r = dbService.pruneExportFilesOlderThan(cutoff);
  res.json(r);
});

app.post('/api/data/prune-logs', authMiddleware, requireAdmin, (req, res) => {
  const days = Number((req.body || {}).olderThanDays);
  if (!Number.isFinite(days) || days < 1) return res.status(400).json({ error: 'olderThanDays (>=1) required' });
  const cutoff = Date.now() - Math.floor(days) * DAY_MS;
  const r = logger.deleteRotatedLogFilesOlderThan(cutoff);
  res.json(r);
});

app.post('/api/data/retention-run', authMiddleware, requireAdmin, (_req, res) => {
  try {
    runScheduledDataRetention(dbService);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
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

// ---------- Advanced Rules ----------
app.get('/api/advanced-rules', authMiddleware, (req, res) => res.json(dbService.getAdvancedRules()));
app.post('/api/advanced-rules', authMiddleware, (req, res) => {
  const created = dbService.createAdvancedRule(req.body);
  advancedRulesService.reloadRules();
  res.json(created);
});
app.put('/api/advanced-rules/:id', authMiddleware, (req, res) => {
  dbService.updateAdvancedRule(req.params.id, req.body);
  advancedRulesService.reloadRules();
  res.json(dbService.getAdvancedRuleById(req.params.id));
});
app.delete('/api/advanced-rules/:id', authMiddleware, (req, res) => {
  dbService.deleteAdvancedRule(req.params.id);
  advancedRulesService.reloadRules();
  res.json({ ok: true });
});
app.post('/api/advanced-rules/:id/test', authMiddleware, async (req, res) => {
  try {
    await advancedRulesService.triggerNow(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to test rule' });
  }
});
app.get('/api/advanced-rules/events', authMiddleware, (req, res) => {
  const limit = Number((req.query as any)?.limit);
  res.json(dbService.getAdvancedRuleEvents(Number.isFinite(limit) ? limit : 200));
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
app.get('/api/system/info', authMiddleware, async (req, res) => {
  try {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const info = await getSystemInfo(dataDir);
    res.json(info);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to read system info' });
  }
});

app.get('/api/system/read-only-token', authMiddleware, (req, res) => {
  const user = (req as any).user;
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json({ token: dbService.getReadOnlyToken() });
});
app.post('/api/system/read-only-token/regenerate', authMiddleware, (req, res) => {
  const user = (req as any).user;
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json({ token: dbService.regenerateReadOnlyToken() });
});

// ---------- Wi‑Fi (Linux / NetworkManager) ----------
app.get('/api/wifi/status', authMiddleware, async (req, res) => {
  try {
    const role = (req as any).user?.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const st = await linuxWifiStatus();
    res.json(st);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

app.get('/api/wifi/scan', authMiddleware, async (req, res) => {
  try {
    const role = (req as any).user?.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    assertLinuxWifiSupported();
    const ifname = typeof (req.query as any)?.ifname === 'string' ? String((req.query as any).ifname).trim() : '';
    const args = ['-t', '-f', 'IN-USE,SSID,SECURITY,SIGNAL,DEVICE', 'dev', 'wifi', 'list'];
    if (ifname) args.push('ifname', ifname);
    const stdout = await nmcli(args, 15_000);
    res.json({ networks: parseNmcliWifiList(stdout) });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

app.post('/api/wifi/connect', authMiddleware, async (req, res) => {
  try {
    const role = (req as any).user?.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    assertLinuxWifiSupported();
    const { ssid, password, ifname } = req.body || {};
    const s = String(ssid || '').trim();
    const p = password == null ? '' : String(password);
    const i = ifname == null ? '' : String(ifname).trim();
    if (!s) return res.status(400).json({ error: 'ssid is required' });

    const args = ['dev', 'wifi', 'connect', s];
    if (p) args.push('password', p);
    if (i) args.push('ifname', i);
    await nmcli(args, 25_000);
    res.json({ ok: true, status: await linuxWifiStatus() });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

app.post('/api/wifi/disconnect', authMiddleware, async (req, res) => {
  try {
    const role = (req as any).user?.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    assertLinuxWifiSupported();
    const { ifname } = req.body || {};
    const i = String(ifname || '').trim();
    if (!i) return res.status(400).json({ error: 'ifname is required' });
    await nmcli(['dev', 'disconnect', i], 15_000);
    res.json({ ok: true, status: await linuxWifiStatus() });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

// ---------- IP settings (Linux / NetworkManager) ----------
app.get('/api/net/ip/status', authMiddleware, async (req, res) => {
  try {
    const role = (req as any).user?.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const st = await linuxNetIpStatus();
    res.json(st);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

app.post('/api/net/ip/set', authMiddleware, async (req, res) => {
  try {
    const role = (req as any).user?.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { device, method, address, gateway, dns, testConnectivity, safetyRollbackSeconds } = req.body || {};
    await linuxSetIpv4ForDevice({
      device,
      method,
      address,
      gateway,
      dns: Array.isArray(dns) ? dns : typeof dns === 'string' ? dns.split(',') : [],
      testConnectivity: testConnectivity !== false,
      safetyRollbackSeconds,
    });
    res.json({ ok: true, status: await linuxNetIpStatus() });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

// ---------- SPARING ----------
app.get('/api/sparing/config', authMiddleware, sparingRoleMiddleware, (req, res) => res.json(sparingService.getSparingConfig()));
app.post('/api/sparing/config', authMiddleware, sparingRoleMiddleware, (req, res) => {
  const updated = sparingService.upsertSparingConfig(req.body);
  const needsRestart = req.body?.enabled !== undefined || req.body?.sendMode !== undefined || req.body?.retryIntervalMinutes !== undefined;
  if (needsRestart) {
    sparingService.stopHourlyScheduler();
    if (updated?.enabled && (updated.sendMode === 'hourly' || updated.sendMode === 'both')) sparingService.startHourlyScheduler();
    if (updated?.enabled && (updated.sendMode === '2min' || updated.sendMode === 'both')) sparingService.startTwoMinScheduler();
  }
  res.json(updated);
});
app.post('/api/sparing/fetch-api-secret', authMiddleware, sparingRoleMiddleware, (req, res) => {
  sparingService.fetchApiSecret().then((r) => res.json(r)).catch((e) => res.status(400).json({ error: e?.message }));
});
app.get('/api/sparing/mappings', authMiddleware, sparingRoleMiddleware, (req, res) => res.json(sparingService.getSparingMappings()));
app.post('/api/sparing/mappings', authMiddleware, sparingRoleMiddleware, (req, res) => {
  const { sparingParam, mappingId } = req.body || {};
  sparingService.upsertSparingMapping(sparingParam, mappingId);
  res.json({ ok: true });
});
app.delete('/api/sparing/mappings/:id', authMiddleware, sparingRoleMiddleware, (req, res) => {
  sparingService.deleteSparingMapping(req.params.id);
  res.json({ ok: true });
});
app.get('/api/sparing/logs', authMiddleware, sparingRoleMiddleware, (req, res) => res.json(sparingService.getSparingLogs(Number(req.query.limit) || 50)));
app.get('/api/sparing/export-log', authMiddleware, sparingRoleMiddleware, (req, res) => {
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
app.post('/api/sparing/process-queue', authMiddleware, sparingRoleMiddleware, (req, res) => {
  sparingService.processQueue().then(() => res.json({ ok: true }));
});
app.get('/api/sparing/queue', authMiddleware, sparingRoleMiddleware, (req, res) => res.json(sparingService.getQueueItems(Number(req.query.limit) || 100)));
app.post('/api/sparing/send-now', authMiddleware, sparingRoleMiddleware, (req, res) => {
  sparingService.sendNow(req.body?.hourTimestamp).then(() => res.json({ ok: true })).catch((e) => res.status(400).json({ error: e?.message }));
});
app.get('/api/sparing/status', authMiddleware, sparingRoleMiddleware, (req, res) => {
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

// ---------- Public Dashboard (read-only token) ----------
app.get('/api/public/mappings', readOnlyMiddleware, (req, res) => {
  const mappings = dbService.getParameterMappings().map((m: any) => ({
    id: m.id,
    name: m.name,
    mappedName: m.mappedName,
    unit: m.unit || '',
    sourceType: m.sourceType,
    sourceDeviceId: m.sourceDeviceId,
  }));
  res.json(mappings);
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

// WebSocket: handle upgrade for /api/ws and /api/public-ws
const wss = new WebSocketServer({ noServer: true });
const wsClients: Set<any> = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

const publicWss = new WebSocketServer({ noServer: true });
const publicWsClients: Set<any> = new Set();
publicWss.on('connection', (ws) => {
  publicWsClients.add(ws);
  ws.on('close', () => publicWsClients.delete(ws));
});

function wsSendSafe(ws: any, payload: string) {
  try {
    if (ws.readyState === 1) ws.send(payload);
  } catch (_) {}
}

function parseReqUrl(req: any): { pathname: string; searchParams: URLSearchParams } {
  const u = new URL(req.url || '/', 'http://localhost');
  return { pathname: u.pathname, searchParams: u.searchParams };
}

function canRealtimeFromJwt(token: string | null): boolean {
  if (!token) return false;
  const r = authService.verifyToken(token);
  if (!r.valid) return false;
  return (r.user as any)?.role !== 'guest';
}

function canRealtimeFromReadOnly(ro: string | null): boolean {
  if (!ro) return false;
  return ro === dbService.getReadOnlyToken();
}

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = parseReqUrl(req);

  if (pathname === '/api/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const token = searchParams.get('token');
      (ws as any).canRealtime = canRealtimeFromJwt(token);
      wss.emit('connection', ws, req);
    });
    return;
  }

  if (pathname === '/api/public-ws') {
    const ro = searchParams.get('ro');
    if (!canRealtimeFromReadOnly(ro)) {
      socket.destroy();
      return;
    }
    publicWss.handleUpgrade(req, socket, head, (ws) => {
      (ws as any).canRealtime = true;
      publicWss.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

(async () => {
  await dbService.initialize();

  authService = new AuthService(dbService);
  modbusService = new ModbusService(dbService);
  mqttSubscriberService = new MqttSubscriberService(dbService);
  mqttPublisherService = new MqttPublisherService(dbService);
  mqttBrokerService = new MqttBrokerService(DATA_DIR);
  httpClientService = new HttpClientService(dbService);
  gnssService = new GnssService(DATA_DIR);
  await gnssService.applyConfig(getGnssConfig());
  dataMapperService = new DataMapperService(dbService, gnssService);
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
  advancedRulesService = new AdvancedRulesService(dbService, {
    dataDir: DATA_DIR,
    mqttPublisher: mqttPublisherService,
    httpClient: httpClientService,
    publishEvent: (evt) => broadcast({ type: 'advanced-rule:event', data: evt }),
    modbusWrite: ({ deviceId, registerId, value }) => modbusService.writeMappedRegister(deviceId, registerId, value),
  });

  broadcast = (msg: { type: string; data?: any }) => {
    const payload = JSON.stringify(msg);
    if (msg.type === 'data:realtime') {
      // Only authenticated WS connections should receive realtime payloads.
      wsClients.forEach((ws) => {
        if ((ws as any).canRealtime) wsSendSafe(ws, payload);
      });
      // Read-only token public dashboard WS
      publicWsClients.forEach((ws) => wsSendSafe(ws, payload));
      return;
    }
    // For non-public dashboard clients, only deliver when the WS is authenticated for this channel.
    wsClients.forEach((ws) => {
      if ((ws as any).canRealtime) wsSendSafe(ws, payload);
    });
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
    advancedRulesService.onRealtimeData(data);
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

  runScheduledDataRetention(dbService);
  setInterval(() => runScheduledDataRetention(dbService), 6 * 60 * 60 * 1000);

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`LT-IDP web server listening on http://0.0.0.0:${PORT}`);
  });
})();
