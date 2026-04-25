import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { SerialPort } from 'serialport';
import { getLogger } from './logger';

export type GnssConfig = {
  enabled: boolean;
  portPath: string | null;
  baudRate: number;
  /** Used only to throttle history storage for system-gnss-* mappings */
  historyIntervalSeconds?: number;
  filterEnabled?: boolean;
  minSatellites?: number;
  minFixQuality?: number;
  maxJumpMeters?: number;
  maxSpeedKmh?: number;
  /** Minimum reported speed (km/h) to count toward trip distance; 0 = disabled */
  minTripSpeedKmh?: number;
  holdLastGoodSeconds?: number;
  smoothingWindow?: number;
  minUpdateIntervalMs?: number;
};

export type GnssFix = {
  valid: boolean;
  latitude: number | null;
  longitude: number | null;
  altitudeM: number | null;
  speedKmh: number | null;
  /** Course over ground from RMC track angle (degrees, 0–360), when available */
  courseDegrees: number | null;
  /** Bearing from previous accepted position to current (degrees, 0–360) */
  bearingDegrees: number | null;
  /** Accumulated distance along accepted filtered fixes (meters); resettable */
  tripDistanceMeters: number;
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
  rawFix: GnssFix;
  filteredFix: GnssFix;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function isFiniteNum(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
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
  const trackStr = (parts[8] ?? '').trim();
  let courseDegrees: number | null = null;
  if (trackStr !== '') {
    const tr = Number(trackStr);
    if (Number.isFinite(tr)) courseDegrees = ((tr % 360) + 360) % 360;
  }
  return {
    latitude: Number.isFinite(lat as number) ? (lat as number) : null,
    longitude: Number.isFinite(lon as number) ? (lon as number) : null,
    speedKmh: Number.isFinite(speedKmh as number) ? (speedKmh as number) : null,
    courseDegrees,
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
  private lastAcceptedAt: number | null = null;
  private lastGoodAt: number | null = null;
  private smoothWindow: Array<{ lat: number; lon: number }> = [];
  private tripMeters = 0;
  private lastTripLat: number | null = null;
  private lastTripLon: number | null = null;
  private lastBearingDegrees: number | null = null;
  private tripSaveTimer: NodeJS.Timeout | null = null;

  private status: GnssStatus = {
    config: {
      enabled: false,
      portPath: null,
      baudRate: 9600,
      filterEnabled: true,
      minSatellites: 4,
      minFixQuality: 1,
      maxJumpMeters: 25,
      maxSpeedKmh: 200,
      minTripSpeedKmh: 0,
      holdLastGoodSeconds: 10,
      smoothingWindow: 1,
      minUpdateIntervalMs: 200,
    },
    connected: false,
    connecting: false,
    error: null,
    lastConnectAt: null,
    lastDisconnectAt: null,
    rawFix: {
      valid: false,
      latitude: null,
      longitude: null,
      altitudeM: null,
      speedKmh: null,
      courseDegrees: null,
      bearingDegrees: null,
      tripDistanceMeters: 0,
      satellites: null,
      fixQuality: null,
      lastSentenceAt: null,
      lastSentenceType: null,
    },
    filteredFix: {
      valid: false,
      latitude: null,
      longitude: null,
      altitudeM: null,
      speedKmh: null,
      courseDegrees: null,
      bearingDegrees: null,
      tripDistanceMeters: 0,
      satellites: null,
      fixQuality: null,
      lastSentenceAt: null,
      lastSentenceType: null,
    },
  };

  constructor(private dataDir: string) {
    super();
    this.loadTripStateSync();
    this.status = {
      ...this.status,
      rawFix: this.stampNav(this.status.rawFix),
      filteredFix: this.stampNav(this.status.filteredFix),
    };
  }

  getStatus(): GnssStatus {
    return this.status;
  }

  getLatestFix(): GnssFix {
    return this.status.filteredFix;
  }

  getRawFix(): GnssFix {
    return this.status.rawFix;
  }

  /** Clear trip odometer and anchor; persisted to disk */
  async resetTripDistance(): Promise<GnssStatus> {
    this.tripMeters = 0;
    this.lastTripLat = null;
    this.lastTripLon = null;
    this.lastBearingDegrees = null;
    if (this.tripSaveTimer) {
      clearTimeout(this.tripSaveTimer);
      this.tripSaveTimer = null;
    }
    this.flushTripStateSync();
    this.status = {
      ...this.status,
      rawFix: this.stampNav(this.status.rawFix),
      filteredFix: this.stampNav(this.status.filteredFix),
    };
    this.emit('status', this.status);
    return this.status;
  }

  private tripStatePath(): string {
    return path.join(this.dataDir, 'gnss-trip-state.json');
  }

  private loadTripStateSync(): void {
    try {
      const raw = fs.readFileSync(this.tripStatePath(), 'utf8');
      const o = JSON.parse(raw) as {
        tripDistanceMeters?: unknown;
        lastTripLat?: unknown;
        lastTripLon?: unknown;
      };
      if (typeof o.tripDistanceMeters === 'number' && Number.isFinite(o.tripDistanceMeters) && o.tripDistanceMeters >= 0) {
        this.tripMeters = o.tripDistanceMeters;
      }
      if (typeof o.lastTripLat === 'number' && Number.isFinite(o.lastTripLat)) this.lastTripLat = o.lastTripLat;
      else this.lastTripLat = null;
      if (typeof o.lastTripLon === 'number' && Number.isFinite(o.lastTripLon)) this.lastTripLon = o.lastTripLon;
      else this.lastTripLon = null;
    } catch {
      // missing or invalid file
    }
  }

  private flushTripStateSync(): void {
    try {
      const dir = this.dataDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.tripStatePath(),
        JSON.stringify({
          tripDistanceMeters: this.tripMeters,
          lastTripLat: this.lastTripLat,
          lastTripLon: this.lastTripLon,
        }),
        'utf8'
      );
    } catch (e: any) {
      this.log().warn('GNSS trip state save failed:', e?.message || String(e));
    }
  }

  private scheduleTripStateSave(): void {
    if (this.tripSaveTimer) return;
    this.tripSaveTimer = setTimeout(() => {
      this.tripSaveTimer = null;
      this.flushTripStateSync();
    }, 400);
  }

  private stampNav(f: GnssFix): GnssFix {
    return { ...f, tripDistanceMeters: this.tripMeters, bearingDegrees: this.lastBearingDegrees };
  }

  private tryAccumulateTrip(lat: number, lon: number, cfg: GnssConfig, speedKmh: number | null): void {
    const maxJump = cfg.maxJumpMeters ?? 0;
    const minTripSpd = cfg.minTripSpeedKmh ?? 0;
    if (this.lastTripLat == null || this.lastTripLon == null || !isFiniteNum(this.lastTripLat) || !isFiniteNum(this.lastTripLon)) {
      this.lastTripLat = lat;
      this.lastTripLon = lon;
      this.lastBearingDegrees = null;
      this.scheduleTripStateSave();
      return;
    }
    const d = haversineMeters(this.lastTripLat, this.lastTripLon, lat, lon);
    if (maxJump > 0 && d > maxJump) return;
    if (d < 0.05) return;
    if (minTripSpd > 0 && (!isFiniteNum(speedKmh) || speedKmh < minTripSpd)) {
      // Stationary / slow: move anchor only so drift does not accumulate into trip distance
      this.lastTripLat = lat;
      this.lastTripLon = lon;
      this.scheduleTripStateSave();
      return;
    }
    this.lastBearingDegrees = bearingDegrees(this.lastTripLat, this.lastTripLon, lat, lon);
    this.tripMeters += d;
    this.lastTripLat = lat;
    this.lastTripLon = lon;
    this.scheduleTripStateSave();
  }

  async applyConfig(next: Partial<GnssConfig>): Promise<GnssStatus> {
    const cfg: GnssConfig = {
      enabled: typeof next.enabled === 'boolean' ? next.enabled : this.status.config.enabled,
      portPath: safePortPath(next.portPath ?? this.status.config.portPath),
      baudRate:
        typeof next.baudRate === 'number' && Number.isFinite(next.baudRate)
          ? Math.floor(next.baudRate)
          : this.status.config.baudRate,
      historyIntervalSeconds:
        typeof next.historyIntervalSeconds === 'number' && Number.isFinite(next.historyIntervalSeconds)
          ? Math.max(1, Math.floor(next.historyIntervalSeconds))
          : this.status.config.historyIntervalSeconds,
      filterEnabled: typeof next.filterEnabled === 'boolean' ? next.filterEnabled : this.status.config.filterEnabled,
      minSatellites: isFiniteNum(next.minSatellites) ? Math.max(0, Math.floor(next.minSatellites)) : this.status.config.minSatellites,
      minFixQuality: isFiniteNum(next.minFixQuality) ? Math.max(0, Math.floor(next.minFixQuality)) : this.status.config.minFixQuality,
      maxJumpMeters: isFiniteNum(next.maxJumpMeters) ? Math.max(0, next.maxJumpMeters) : this.status.config.maxJumpMeters,
      maxSpeedKmh: isFiniteNum(next.maxSpeedKmh) ? Math.max(0, next.maxSpeedKmh) : this.status.config.maxSpeedKmh,
      minTripSpeedKmh: isFiniteNum(next.minTripSpeedKmh)
        ? clamp(next.minTripSpeedKmh, 0, 500)
        : (this.status.config.minTripSpeedKmh ?? 0),
      holdLastGoodSeconds: isFiniteNum(next.holdLastGoodSeconds) ? Math.max(0, Math.floor(next.holdLastGoodSeconds)) : this.status.config.holdLastGoodSeconds,
      smoothingWindow: isFiniteNum(next.smoothingWindow) ? Math.max(1, Math.floor(next.smoothingWindow)) : this.status.config.smoothingWindow,
      minUpdateIntervalMs: isFiniteNum(next.minUpdateIntervalMs) ? Math.max(0, Math.floor(next.minUpdateIntervalMs)) : this.status.config.minUpdateIntervalMs,
    };
    cfg.baudRate = clamp(cfg.baudRate || 9600, 4800, 921600);
    cfg.smoothingWindow = clamp(cfg.smoothingWindow || 1, 1, 25);
    cfg.minUpdateIntervalMs = clamp(cfg.minUpdateIntervalMs || 0, 0, 30_000);

    const changed =
      cfg.enabled !== this.status.config.enabled ||
      cfg.portPath !== this.status.config.portPath ||
      cfg.baudRate !== this.status.config.baudRate ||
      cfg.filterEnabled !== this.status.config.filterEnabled ||
      cfg.minSatellites !== this.status.config.minSatellites ||
      cfg.minFixQuality !== this.status.config.minFixQuality ||
      cfg.maxJumpMeters !== this.status.config.maxJumpMeters ||
      cfg.maxSpeedKmh !== this.status.config.maxSpeedKmh ||
      cfg.holdLastGoodSeconds !== this.status.config.holdLastGoodSeconds ||
      cfg.smoothingWindow !== this.status.config.smoothingWindow ||
      cfg.minUpdateIntervalMs !== this.status.config.minUpdateIntervalMs;

    this.status = { ...this.status, config: cfg };
    this.emit('status', this.status);
    if (cfg.smoothingWindow === 1) this.smoothWindow = [];

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
    if (this.tripSaveTimer) {
      clearTimeout(this.tripSaveTimer);
      this.tripSaveTimer = null;
    }
    this.flushTripStateSync();
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
      const prevRaw = this.status.rawFix;
      const nextRaw: GnssFix = {
        ...prevRaw,
        ...parsed,
        lastSentenceAt: now,
        latitude: parsed.latitude ?? prevRaw.latitude,
        longitude: parsed.longitude ?? prevRaw.longitude,
        altitudeM: parsed.altitudeM ?? prevRaw.altitudeM,
        speedKmh: parsed.speedKmh ?? prevRaw.speedKmh,
        courseDegrees: parsed.courseDegrees !== undefined && parsed.courseDegrees !== null ? parsed.courseDegrees : prevRaw.courseDegrees,
        satellites: parsed.satellites ?? prevRaw.satellites,
        fixQuality: parsed.fixQuality ?? prevRaw.fixQuality,
        valid: typeof parsed.valid === 'boolean' ? parsed.valid : prevRaw.valid,
        lastSentenceType: parsed.lastSentenceType ?? prevRaw.lastSentenceType,
      };

      const filtered = this.applyFilter(nextRaw, now);
      this.status = { ...this.status, rawFix: this.stampNav(nextRaw), filteredFix: filtered };
      this.emit('rawFix', nextRaw);
      this.emit('filteredFix', filtered);
      this.emit('status', this.status);
    }
  }

  private applyFilter(raw: GnssFix, now: number): GnssFix {
    const cfg = this.status.config;
    const prev = this.status.filteredFix;

    const minInterval = cfg.minUpdateIntervalMs ?? 0;
    if (this.lastAcceptedAt != null && minInterval > 0 && now - this.lastAcceptedAt < minInterval) {
      return this.stampNav(prev);
    }

    if (!cfg.filterEnabled) {
      this.lastAcceptedAt = now;
      if (isFiniteNum(raw.latitude) && isFiniteNum(raw.longitude) && raw.valid) {
        this.tryAccumulateTrip(raw.latitude, raw.longitude, cfg, raw.speedKmh);
      }
      return this.stampNav(raw);
    }

    const satsOk = (raw.satellites ?? 0) >= (cfg.minSatellites ?? 0);
    const qualOk = (raw.fixQuality ?? 0) >= (cfg.minFixQuality ?? 0);
    const validOk = !!raw.valid;
    const coordsOk = isFiniteNum(raw.latitude) && isFiniteNum(raw.longitude);
    if (!coordsOk || !satsOk || !qualOk || !validOk) {
      const holdSec = cfg.holdLastGoodSeconds ?? 0;
      if (this.lastGoodAt != null && holdSec > 0 && now - this.lastGoodAt <= holdSec * 1000) {
        return this.stampNav(prev);
      }
      return this.stampNav({
        ...prev,
        valid: false,
        lastSentenceAt: raw.lastSentenceAt,
        lastSentenceType: raw.lastSentenceType,
      });
    }

    const hasPrevCoords =
      isFiniteNum(prev.latitude) && isFiniteNum(prev.longitude) && isFiniteNum(prev.lastSentenceAt);
    if (hasPrevCoords) {
      const dtSec = Math.max(0.001, (now - (prev.lastSentenceAt as number)) / 1000);
      const distM = haversineMeters(
        prev.latitude as number,
        prev.longitude as number,
        raw.latitude as number,
        raw.longitude as number
      );
      const impliedSpeedKmh = (distM / dtSec) * 3.6;
      const maxSpeed = cfg.maxSpeedKmh ?? 0;
      const maxJump = cfg.maxJumpMeters ?? 0;
      if ((maxSpeed > 0 && impliedSpeedKmh > maxSpeed) || (maxJump > 0 && distM > maxJump)) {
        const holdSec = cfg.holdLastGoodSeconds ?? 0;
        if (this.lastGoodAt != null && holdSec > 0 && now - this.lastGoodAt <= holdSec * 1000) {
          return this.stampNav(prev);
        }
        return this.stampNav(prev);
      }
    }

    // Accept and smooth
    let outLat = raw.latitude as number;
    let outLon = raw.longitude as number;
    const w = cfg.smoothingWindow ?? 1;
    if (w > 1) {
      this.smoothWindow.push({ lat: outLat, lon: outLon });
      if (this.smoothWindow.length > w) this.smoothWindow.shift();
      const lats = this.smoothWindow.map((p) => p.lat);
      const lons = this.smoothWindow.map((p) => p.lon);
      outLat = median(lats);
      outLon = median(lons);
    }

    this.lastAcceptedAt = now;
    this.lastGoodAt = now;
    if (isFiniteNum(outLat) && isFiniteNum(outLon)) {
      this.tryAccumulateTrip(outLat, outLon, cfg, raw.speedKmh);
    }

    return this.stampNav({
      ...raw,
      latitude: outLat,
      longitude: outLon,
    });
  }
}

