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
  };
}
