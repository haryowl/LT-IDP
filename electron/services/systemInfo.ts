import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

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
    };
    interfaces: NetworkInterfaceInfo[];
  };
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

function buildNetworkInfo(): SystemInfo['network'] {
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
  const interfacesWithIpCount = interfaces.filter((i) => i.portKind !== 'loopback' && i.inUse).length;

  return {
    summary: {
      distinctMacCount: macs.size,
      interfacesWithIpCount,
      ethernetPortNames,
    },
    interfaces,
  };
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
    network: buildNetworkInfo(),
  };
}
