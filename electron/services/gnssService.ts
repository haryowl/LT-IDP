import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import { getLogger } from './logger';

export type GnssConfig = {
  enabled: boolean;
  portPath: string | null;
  baudRate: number;
};

export type GnssFix = {
  valid: boolean;
  latitude: number | null;
  longitude: number | null;
  altitudeM: number | null;
  speedKmh: number | null;
  satellites: number | null;
  fixQuality: number | null;
  lastSentenceAt: number | null;
  lastSentenceType: string | null;
};

export type GnssStatus = {
  config: GnssConfig;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastConnectAt: number | null;
  lastDisconnectAt: number | null;
  fix: GnssFix;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function safePortPath(p: string | null): string | null {
  if (!p) return null;
  const t = p.trim();
  if (!t) return null;
  // Conservative: allow typical Linux serial paths and Windows COM ports.
  if (/^\/dev\/[a-zA-Z0-9._-]+$/.test(t)) return t;
  if (/^COM\d+$/i.test(t)) return t.toUpperCase();
  return t;
}

function nmeaToDecimal(dm: string, hemi: string): number | null {
  const raw = dm?.trim();
  if (!raw) return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  const degrees = Math.floor(v / 100);
  const minutes = v - degrees * 100;
  const dec = degrees + minutes / 60;
  if (!Number.isFinite(dec)) return null;
  const h = (hemi || '').trim().toUpperCase();
  if (h === 'S' || h === 'W') return -dec;
  if (h === 'N' || h === 'E') return dec;
  return dec;
}

function knotsToKmh(knots: string): number | null {
  const v = Number((knots || '').trim());
  if (!Number.isFinite(v)) return null;
  return v * 1.852;
}

function parseGga(parts: string[]): Partial<GnssFix> | null {
  // $GxGGA,time,lat,N,lon,E,fixQuality,numSV,HDOP,alt,M,...
  const lat = nmeaToDecimal(parts[2] ?? '', parts[3] ?? '');
  const lon = nmeaToDecimal(parts[4] ?? '', parts[5] ?? '');
  const fixQuality = Number(parts[6] ?? '');
  const satellites = Number(parts[7] ?? '');
  const altitudeM = Number(parts[9] ?? '');
  return {
    latitude: Number.isFinite(lat as number) ? (lat as number) : null,
    longitude: Number.isFinite(lon as number) ? (lon as number) : null,
    fixQuality: Number.isFinite(fixQuality) ? fixQuality : null,
    satellites: Number.isFinite(satellites) ? satellites : null,
    altitudeM: Number.isFinite(altitudeM) ? altitudeM : null,
    valid: Number.isFinite(fixQuality) ? fixQuality > 0 : false,
    lastSentenceType: 'GGA',
  };
}

function parseRmc(parts: string[]): Partial<GnssFix> | null {
  // $GxRMC,time,status,lat,N,lon,E,speedKnots,trackAngle,date,...
  const status = (parts[2] ?? '').trim().toUpperCase();
  const lat = nmeaToDecimal(parts[3] ?? '', parts[4] ?? '');
  const lon = nmeaToDecimal(parts[5] ?? '', parts[6] ?? '');
  const speedKmh = knotsToKmh(parts[7] ?? '');
  return {
    latitude: Number.isFinite(lat as number) ? (lat as number) : null,
    longitude: Number.isFinite(lon as number) ? (lon as number) : null,
    speedKmh: Number.isFinite(speedKmh as number) ? (speedKmh as number) : null,
    valid: status === 'A',
    lastSentenceType: 'RMC',
  };
}

function parseNmeaSentence(line: string): Partial<GnssFix> | null {
  const t = (line || '').trim();
  if (!t.startsWith('$')) return null;
  const noChecksum = t.split('*')[0] ?? t;
  const parts = noChecksum.split(',');
  const head = parts[0] ?? '';
  const type = head.slice(-3).toUpperCase();
  if (type === 'GGA') return parseGga(parts);
  if (type === 'RMC') return parseRmc(parts);
  return null;
}

export class GnssService extends EventEmitter {
  private port: SerialPort | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private buffer = '';

  private status: GnssStatus = {
    config: { enabled: false, portPath: null, baudRate: 9600 },
    connected: false,
    connecting: false,
    error: null,
    lastConnectAt: null,
    lastDisconnectAt: null,
    fix: {
      valid: false,
      latitude: null,
      longitude: null,
      altitudeM: null,
      speedKmh: null,
      satellites: null,
      fixQuality: null,
      lastSentenceAt: null,
      lastSentenceType: null,
    },
  };

  constructor(private dataDir: string) {
    super();
  }

  getStatus(): GnssStatus {
    return this.status;
  }

  getLatestFix(): GnssFix {
    return this.status.fix;
  }

  async applyConfig(next: Partial<GnssConfig>): Promise<GnssStatus> {
    const cfg: GnssConfig = {
      enabled: typeof next.enabled === 'boolean' ? next.enabled : this.status.config.enabled,
      portPath: safePortPath(next.portPath ?? this.status.config.portPath),
      baudRate:
        typeof next.baudRate === 'number' && Number.isFinite(next.baudRate)
          ? Math.floor(next.baudRate)
          : this.status.config.baudRate,
    };
    cfg.baudRate = clamp(cfg.baudRate || 9600, 4800, 921600);

    const changed =
      cfg.enabled !== this.status.config.enabled ||
      cfg.portPath !== this.status.config.portPath ||
      cfg.baudRate !== this.status.config.baudRate;

    this.status = { ...this.status, config: cfg };
    this.emit('status', this.status);

    if (!changed) return this.status;

    if (!cfg.enabled) {
      await this.disconnect('disabled');
      return this.status;
    }

    if (!cfg.portPath) {
      await this.disconnect('missing-port');
      this.status = { ...this.status, error: 'GNSS enabled but no serial port selected' };
      this.emit('status', this.status);
      return this.status;
    }

    await this.disconnect('reconfigure');
    void this.connect();
    return this.status;
  }

  async shutdown(): Promise<void> {
    await this.disconnect('shutdown');
  }

  private log() {
    return getLogger(this.dataDir);
  }

  private scheduleReconnect(reason: string) {
    if (!this.status.config.enabled) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delayMs = clamp(500 * Math.pow(2, this.reconnectAttempt - 1), 500, 30_000);
    this.log().warn(`GNSS reconnect scheduled in ${delayMs}ms (${reason})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
  }

  private async connect(): Promise<void> {
    const { enabled, portPath, baudRate } = this.status.config;
    if (!enabled || !portPath) return;
    if (this.status.connected || this.status.connecting) return;

    this.status = { ...this.status, connecting: true, error: null };
    this.emit('status', this.status);

    try {
      const port = new SerialPort({
        path: portPath,
        baudRate,
        autoOpen: false,
      });

      await new Promise<void>((resolve, reject) => {
        port.open((err) => (err ? reject(err) : resolve()));
      });

      this.port = port;
      this.buffer = '';
      this.clearReconnect();

      port.on('data', (buf: Buffer) => this.onData(buf));
      port.on('error', (e: any) => {
        this.log().error('GNSS serial error:', e?.message || String(e));
        this.status = { ...this.status, error: e?.message || String(e) };
        this.emit('status', this.status);
      });
      port.on('close', () => {
        this.log().warn('GNSS serial closed');
        this.status = {
          ...this.status,
          connected: false,
          connecting: false,
          lastDisconnectAt: Date.now(),
        };
        this.emit('status', this.status);
        this.port = null;
        this.scheduleReconnect('close');
      });

      this.status = {
        ...this.status,
        connected: true,
        connecting: false,
        lastConnectAt: Date.now(),
      };
      this.emit('status', this.status);
      this.log().info(`GNSS connected: ${portPath} @ ${baudRate}`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.status = { ...this.status, connected: false, connecting: false, error: msg };
      this.emit('status', this.status);
      this.log().error('GNSS connect failed:', msg);
      this.port = null;
      this.scheduleReconnect('connect-failed');
    }
  }

  private async disconnect(reason: string): Promise<void> {
    this.clearReconnect();

    const port = this.port;
    this.port = null;
    this.buffer = '';

    if (port && port.isOpen) {
      try {
        await new Promise<void>((resolve) => port.close(() => resolve()));
      } catch {
        // ignore
      }
    }

    if (this.status.connected || this.status.connecting) {
      this.status = {
        ...this.status,
        connected: false,
        connecting: false,
        lastDisconnectAt: Date.now(),
      };
      this.emit('status', this.status);
      this.log().info(`GNSS disconnected (${reason})`);
    }
  }

  private onData(buf: Buffer) {
    this.buffer += buf.toString('utf8');
    // NMEA is line-based with CRLF. Handle partial lines.
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const parsed = parseNmeaSentence(line);
      if (!parsed) continue;

      const now = Date.now();
      const prev = this.status.fix;
      const nextFix: GnssFix = {
        ...prev,
        ...parsed,
        lastSentenceAt: now,
        latitude: parsed.latitude ?? prev.latitude,
        longitude: parsed.longitude ?? prev.longitude,
        altitudeM: parsed.altitudeM ?? prev.altitudeM,
        speedKmh: parsed.speedKmh ?? prev.speedKmh,
        satellites: parsed.satellites ?? prev.satellites,
        fixQuality: parsed.fixQuality ?? prev.fixQuality,
        valid: typeof parsed.valid === 'boolean' ? parsed.valid : prev.valid,
        lastSentenceType: parsed.lastSentenceType ?? prev.lastSentenceType,
      };

      this.status = { ...this.status, fix: nextFix };
      this.emit('fix', nextFix);
      this.emit('status', this.status);
    }
  }
}

