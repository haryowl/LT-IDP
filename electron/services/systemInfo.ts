import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';

const execFileAsync = promisify(execFile);

export interface SystemInfo {
  hostname: string;
  platform: string;
  osType: string;
  osRelease: string;
  arch: string;
  nodeVersion: string;
  processUptimeSeconds: number;
  systemUptimeSeconds: number;
  /** 1 / 5 / 15 minute load (Unix); null on Windows */
  loadAverage: [number, number, number] | null;
  cpuCount: number;
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  /** Filesystem containing `dataPath` (database / data root) */
  disk: {
    path: string;
    totalBytes: number | null;
    freeBytes: number | null;
    usedBytes: number | null;
    usedPercent: number | null;
    error?: string;
  };
  collectedAt: number;
  /** Network interfaces (MAC, IPs, Ethernet vs Wi‑Fi heuristic) */
  network: {
    summary: {
      /** Distinct non-zero MACs on non-loopback interfaces */
      distinctMacCount: number;
      /** Non-loopback interfaces that have at least one usable IPv4 or global IPv6 */
      interfacesWithIpCount: number;
      /** Interface names classified as Ethernet (wired) */
      ethernetPortNames: string[];
      /** Interface names classified as wireless (Wi‑Fi / WLAN) */
      wirelessPortNames: string[];
    };
    interfaces: NetworkInterfaceInfo[];
    /** Per wireless interface: hardware + association when detectable */
    wifi: WifiAdapterInfo[];
  };
}

export interface WifiAdapterInfo {
  interfaceName: string;
  /** Friendly name from OS (udev / netsh Description) */
  hardwareDescription: string | null;
  /** Extra id text (e.g. PCI ids) */
  hardwareDetail: string | null;
  connected: boolean;
  ssid: string | null;
  bssid: string | null;
  signalDbm: number | null;
  /** 0–100 heuristic from dBm when known */
  signalPercent: number | null;
  txRateMbps: number | null;
  dataSource: 'iw' | 'nmcli' | 'netsh' | 'none';
  message: string | null;
}

export interface NetworkInterfaceInfo {
  name: string;
  mac: string | null;
  /** Heuristic from OS interface name */
  portKind: 'ethernet' | 'wireless' | 'loopback' | 'other';
  ipv4: string[];
  ipv6: string[];
  /** Has a non-loopback / non–link-local address suitable for traffic */
  inUse: boolean;
}

const NIL_MAC = '00:00:00:00:00:00';

function classifyPortKind(name: string): NetworkInterfaceInfo['portKind'] {
  const n = name.toLowerCase();
  if (n === 'lo' || n.includes('loopback')) return 'loopback';
  if (/(wi-?fi|wlan|wireless|^wl|wlp|wlo|wwan)/.test(n)) return 'wireless';
  if (n.includes('ethernet') || /(^eth|enp|ens|eno|^em[0-9]|^en[0-9]|usb|bond|br[0-9])/.test(n)) return 'ethernet';
  return 'other';
}

function hasUsableAddress(ipv4: string[], ipv6: string[]): boolean {
  if (ipv4.some((a) => !a.startsWith('127.'))) return true;
  for (const a of ipv6) {
    if (a === '::1') continue;
    if (a.toLowerCase().startsWith('fe80:')) continue;
    return true;
  }
  return false;
}

type NetworkBase = Omit<SystemInfo['network'], 'wifi'>;

function buildNetworkInfo(): NetworkBase {
  const raw = os.networkInterfaces();
  const interfaces: NetworkInterfaceInfo[] = [];
  const macs = new Set<string>();

  for (const [name, entries] of Object.entries(raw ?? {})) {
    if (!entries?.length) continue;
    const ipv4: string[] = [];
    const ipv6: string[] = [];
    let mac: string | null = null;
    let anyNonInternal = false;
    for (const e of entries) {
      if (e.mac && e.mac !== NIL_MAC) mac = e.mac;
      if (e.family === 'IPv4') ipv4.push(e.address);
      else if (e.family === 'IPv6') ipv6.push(e.address);
      if (!e.internal) anyNonInternal = true;
    }
    const portKind = classifyPortKind(name);
    const inUse = anyNonInternal && hasUsableAddress(ipv4, ipv6);
    interfaces.push({ name, mac, portKind, ipv4, ipv6, inUse });
    if (portKind !== 'loopback' && mac) macs.add(mac);
  }

  interfaces.sort((a, b) => a.name.localeCompare(b.name));

  const ethernetPortNames = interfaces.filter((i) => i.portKind === 'ethernet').map((i) => i.name);
  const wirelessPortNames = interfaces.filter((i) => i.portKind === 'wireless').map((i) => i.name);
  const interfacesWithIpCount = interfaces.filter((i) => i.portKind !== 'loopback' && i.inUse).length;

  return {
    summary: {
      distinctMacCount: macs.size,
      interfacesWithIpCount,
      ethernetPortNames,
      wirelessPortNames,
    },
    interfaces,
  };
}

function safeIfaceName(name: string): boolean {
  return name.length > 0 && name.length <= 48 && /^[a-zA-Z0-9._@-]+$/.test(name);
}

function dbmToApproxPercent(dbm: number): number {
  if (dbm >= -50) return 100;
  if (dbm <= -92) return 0;
  return Math.round(((dbm + 92) / 42) * 100);
}

async function readLinuxPciIds(iface: string): Promise<string | null> {
  const devPath = `/sys/class/net/${iface}/device`;
  try {
    const vendor = (await fs.readFile(path.join(devPath, 'vendor'), 'utf8').catch(() => '')).trim();
    const device = (await fs.readFile(path.join(devPath, 'device'), 'utf8').catch(() => '')).trim();
    if (vendor && device) return `PCI ${vendor} ${device}`;
  } catch {
    /* ignore */
  }
  return null;
}

async function linuxUdevHardware(iface: string): Promise<{ description: string | null; detail: string | null }> {
  const detail = await readLinuxPciIds(iface);
  if (!safeIfaceName(iface)) return { description: null, detail };
  try {
    const { stdout } = await execFileAsync('udevadm', ['info', '-q', 'property', '-p', `/sys/class/net/${iface}`], {
      timeout: 4000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    const vendor = stdout.match(/^ID_VENDOR_FROM_DATABASE=(.+)$/m)?.[1]?.trim();
    const model = stdout.match(/^ID_MODEL_FROM_DATABASE=(.+)$/m)?.[1]?.trim();
    const parts = [vendor, model].filter(Boolean);
    return { description: parts.length ? parts.join(' · ') : null, detail };
  } catch {
    return { description: null, detail };
  }
}

function parseIwLink(stdout: string): {
  connected: boolean;
  ssid: string | null;
  bssid: string | null;
  signalDbm: number | null;
  txRateMbps: number | null;
} {
  const t = stdout.trim();
  if (!t || /^not connected\.?$/im.test(t.split('\n')[0]?.trim() ?? '')) {
    return { connected: false, ssid: null, bssid: null, signalDbm: null, txRateMbps: null };
  }
  const ssid = stdout.match(/^\s*SSID:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const bssid = stdout.match(/Connected to\s+([0-9a-f:]+)/i)?.[1]?.toLowerCase() ?? null;
  const sig = stdout.match(/signal:\s*(-?\d+)\s*dBm/i);
  const signalDbm = sig ? Number(sig[1]) : null;
  const txm = stdout.match(/tx bitrate:\s*([\d.]+)\s*MBit\/s/i);
  const txRateMbps = txm ? Number(txm[1]) : null;
  return {
    connected: !!(ssid || bssid),
    ssid,
    bssid,
    signalDbm: Number.isFinite(signalDbm) ? signalDbm : null,
    txRateMbps: Number.isFinite(txRateMbps) ? txRateMbps : null,
  };
}

async function linuxIwLink(iface: string): Promise<{ stdout: string } | null> {
  if (!safeIfaceName(iface)) return null;
  try {
    const r = await execFileAsync('iw', ['dev', iface, 'link'], {
      timeout: 4000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    return { stdout: String(r.stdout || '') };
  } catch {
    return null;
  }
}

/** nmcli device show (NetworkManager) — fills SSID/state when iw is missing */
async function linuxNmcliWifi(iface: string): Promise<{
  connected: boolean;
  ssid: string | null;
  state: string | null;
}> {
  if (!safeIfaceName(iface)) return { connected: false, ssid: null, state: null };
  try {
    const { stdout } = await execFileAsync('nmcli', ['-t', 'device', 'show', iface], {
      timeout: 4000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    const state = stdout.match(/GENERAL\.STATE:\s*(.+)/)?.[1]?.trim() ?? null;
    const conn = stdout.match(/GENERAL\.CONNECTION:\s*(.+)/)?.[1]?.trim() ?? null;
    const connected = !!(state && /connected|activated/i.test(state) && conn && conn !== '--');
    const ssid = connected && conn ? conn : null;
    return { connected, ssid, state };
  } catch {
    return { connected: false, ssid: null, state: null };
  }
}

async function wifiLinux(iface: string): Promise<WifiAdapterInfo> {
  const { description: hwDesc, detail: hwDetail } = await linuxUdevHardware(iface);
  const iwOut = await linuxIwLink(iface);
  let dataSource: WifiAdapterInfo['dataSource'] = 'none';
  let connected = false;
  let ssid: string | null = null;
  let bssid: string | null = null;
  let signalDbm: number | null = null;
  let txRateMbps: number | null = null;
  let message: string | null = null;

  if (iwOut) {
    const p = parseIwLink(iwOut.stdout);
    connected = p.connected;
    ssid = p.ssid;
    bssid = p.bssid;
    signalDbm = p.signalDbm;
    txRateMbps = p.txRateMbps;
    dataSource = 'iw';
    if (!connected && iwOut.stdout.trim()) {
      const nm = await linuxNmcliWifi(iface);
      if (nm.connected && nm.ssid) {
        connected = true;
        ssid = nm.ssid;
        dataSource = 'nmcli';
      }
    }
  } else {
    const nm = await linuxNmcliWifi(iface);
    if (nm.state || nm.ssid) {
      dataSource = 'nmcli';
      connected = nm.connected;
      ssid = nm.ssid;
    } else {
      message = 'Install `iw` or use NetworkManager (`nmcli`) for Wi‑Fi status';
    }
  }

  const signalPercent = signalDbm != null && Number.isFinite(signalDbm) ? dbmToApproxPercent(signalDbm) : null;

  return {
    interfaceName: iface,
    hardwareDescription: hwDesc,
    hardwareDetail: hwDetail,
    connected,
    ssid,
    bssid,
    signalDbm,
    signalPercent,
    txRateMbps,
    dataSource,
    message,
  };
}

function normIfaceKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u2011/g, '-')
    .replace(/\u2010/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

type WinWifiBlock = {
  name: string | null;
  description: string | null;
  state: string | null;
  ssid: string | null;
  signalPercent: number | null;
};

function parseNetshWlanInterfaces(stdout: string): WinWifiBlock[] {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  const blocks: WinWifiBlock[] = [];
  let cur: Partial<WinWifiBlock> | null = null;
  const flush = () => {
    if (cur?.name) {
      blocks.push({
        name: cur.name,
        description: cur.description ?? null,
        state: cur.state ?? null,
        ssid: cur.ssid && String(cur.ssid).trim() ? cur.ssid : null,
        signalPercent: Number.isFinite(cur.signalPercent as number) ? (cur.signalPercent as number) : null,
      });
    }
    cur = null;
  };
  for (const line of lines) {
    const nm = line.match(/^\s*Name\s*:\s*(.+)$/i);
    if (nm) {
      flush();
      cur = { name: nm[1].trim() };
      continue;
    }
    if (!cur) continue;
    const d = line.match(/^\s*Description\s*:\s*(.+)$/i);
    if (d) cur.description = d[1].trim();
    const st = line.match(/^\s*State\s*:\s*(.+)$/i);
    if (st) cur.state = st[1].trim();
    const ss = line.match(/^\s*SSID\s*:\s*(.+)$/i);
    if (ss) cur.ssid = ss[1].trim();
    const sg = line.match(/^\s*Signal\s*:\s*(\d+)\s*%/i);
    if (sg) cur.signalPercent = Number(sg[1]);
  }
  flush();
  return blocks;
}

async function wifiWindows(iface: string): Promise<WifiAdapterInfo> {
  let hardwareDescription: string | null = null;
  let hardwareDetail: string | null = null;
  let connected = false;
  let ssid: string | null = null;
  let bssid: string | null = null;
  let signalDbm: number | null = null;
  let signalPercent: number | null = null;
  let txRateMbps: number | null = null;
  let dataSource: WifiAdapterInfo['dataSource'] = 'none';
  let message: string | null = null;

  try {
    const { stdout } = await execFileAsync(
      'netsh',
      ['wlan', 'show', 'interfaces'],
      { timeout: 6000, maxBuffer: 512 * 1024, windowsHide: true, encoding: 'utf8' }
    );
    const blocks = parseNetshWlanInterfaces(String(stdout));
    const want = normIfaceKey(iface);
    let b =
      blocks.find((x) => x.name && normIfaceKey(x.name) === want) ||
      (blocks.length === 1 ? blocks[0] : blocks.find((x) => /wi-?fi|wireless/i.test(x.name || '')));

    if (b) {
      dataSource = 'netsh';
      hardwareDescription = b.description;
      connected = !!(b.state && /connected/i.test(b.state));
      ssid = b.ssid;
      signalPercent = b.signalPercent;
    } else {
      message = 'No matching Wi‑Fi adapter block from netsh';
    }
  } catch (e: any) {
    message = e?.message || String(e);
  }

  return {
    interfaceName: iface,
    hardwareDescription,
    hardwareDetail,
    connected,
    ssid,
    bssid,
    signalDbm,
    signalPercent,
    txRateMbps,
    dataSource,
    message,
  };
}

async function wifiDarwin(iface: string): Promise<WifiAdapterInfo> {
  return {
    interfaceName: iface,
    hardwareDescription: null,
    hardwareDetail: null,
    connected: false,
    ssid: null,
    bssid: null,
    signalDbm: null,
    signalPercent: null,
    txRateMbps: null,
    dataSource: 'none',
    message: 'Wi‑Fi link details are not collected on macOS in this build',
  };
}

async function collectWifiAdapters(interfaces: NetworkInterfaceInfo[]): Promise<WifiAdapterInfo[]> {
  const wireless = interfaces.filter((i) => i.portKind === 'wireless');
  const out: WifiAdapterInfo[] = [];
  for (const i of wireless) {
    try {
      if (process.platform === 'linux') {
        out.push(await wifiLinux(i.name));
      } else if (process.platform === 'win32') {
        out.push(await wifiWindows(i.name));
      } else if (process.platform === 'darwin') {
        out.push(await wifiDarwin(i.name));
      } else {
        out.push({
          interfaceName: i.name,
          hardwareDescription: null,
          hardwareDetail: null,
          connected: false,
          ssid: null,
          bssid: null,
          signalDbm: null,
          signalPercent: null,
          txRateMbps: null,
          dataSource: 'none',
          message: 'Wi‑Fi probe not implemented for this platform',
        });
      }
    } catch (e: any) {
      out.push({
        interfaceName: i.name,
        hardwareDescription: null,
        hardwareDetail: null,
        connected: false,
        ssid: null,
        bssid: null,
        signalDbm: null,
        signalPercent: null,
        txRateMbps: null,
        dataSource: 'none',
        message: e?.message || String(e),
      });
    }
  }
  return out;
}

function num(v: bigint | number): number {
  return typeof v === 'bigint' ? Number(v) : v;
}

/**
 * Collects OS, CPU, memory, and disk usage for the filesystem that contains `dataPath`.
 */
export async function getSystemInfo(dataPath: string): Promise<SystemInfo> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const resolved = path.resolve(dataPath);

  let disk: SystemInfo['disk'] = {
    path: resolved,
    totalBytes: null,
    freeBytes: null,
    usedBytes: null,
    usedPercent: null,
  };

  try {
    const statfs = (fs as typeof fs & { statfs?: (p: string) => Promise<{ bsize: bigint | number; blocks: bigint | number; bfree: bigint | number; bavail: bigint | number }> }).statfs;
    if (typeof statfs !== 'function') {
      disk.error = 'Disk stats require Node.js 18.19+ / 20+ with fs.promises.statfs';
    } else {
      const st = await statfs(resolved);
      const bsize = num(st.bsize);
      const blocks = num(st.blocks);
      const bfree = num(st.bfree);
      const bavail = num(st.bavail);
      const totalBytes = blocks * bsize;
      const freeAllBytes = bfree * bsize;
      const availBytes = bavail * bsize;
      const usedBytes = totalBytes - freeAllBytes;
      disk = {
        path: resolved,
        totalBytes,
        freeBytes: availBytes,
        usedBytes,
        usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null,
      };
    }
  } catch (e: any) {
    disk.error = e?.message || String(e);
  }

  const la = os.loadavg();
  const loadAverage: [number, number, number] | null =
    process.platform === 'win32' ? null : [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0];

  const baseNet = buildNetworkInfo();
  const wifi = await collectWifiAdapters(baseNet.interfaces);
  const network: SystemInfo['network'] = { ...baseNet, wifi };

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    osType: os.type(),
    osRelease: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    processUptimeSeconds: Math.floor(process.uptime()),
    systemUptimeSeconds: Math.floor(os.uptime()),
    loadAverage,
    cpuCount: os.cpus().length,
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
    },
    disk,
    collectedAt: Date.now(),
    network,
  };
}
