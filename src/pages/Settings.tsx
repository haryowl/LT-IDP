import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import WiFiIcon from '@mui/icons-material/Wifi';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import LanOutlinedIcon from '@mui/icons-material/LanOutlined';
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined';
import LoopOutlinedIcon from '@mui/icons-material/LoopOutlined';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import SettingsEthernetOutlinedIcon from '@mui/icons-material/SettingsEthernetOutlined';
import DeviceHubOutlinedIcon from '@mui/icons-material/DeviceHubOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import api from '../api/client';
import { systemTimestampDefaults } from './ParameterMappings';
import { useAuthStore } from '../store/authStore';

interface ParameterMapping {
  id: string;
  name: string;
  sourceType: 'modbus' | 'mqtt' | 'system';
  sourceDeviceId: string;
  mappedName: string;
  dataType: string;
  inputFormat?: string;
  inputTimezone?: string;
  outputFormat?: string;
  outputTimezone?: string;
}

interface WifiAdapterRow {
  interfaceName: string;
  hardwareDescription: string | null;
  hardwareDetail: string | null;
  connected: boolean;
  ssid: string | null;
  bssid: string | null;
  signalDbm: number | null;
  signalPercent: number | null;
  txRateMbps: number | null;
  dataSource: 'iw' | 'nmcli' | 'netsh' | 'none';
  message: string | null;
}

interface GnssConfig {
  enabled: boolean;
  portPath: string | null;
  baudRate: number;
  historyIntervalSeconds?: number;
  filterEnabled?: boolean;
  minSatellites?: number;
  minFixQuality?: number;
  maxJumpMeters?: number;
  maxSpeedKmh?: number;
  /** Minimum SOG (km/h) to add to trip distance; 0 = off */
  minTripSpeedKmh?: number;
  holdLastGoodSeconds?: number;
  smoothingWindow?: number;
  minUpdateIntervalMs?: number;
}

interface GnssStatus {
  config: GnssConfig;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastConnectAt: number | null;
  lastDisconnectAt: number | null;
  rawFix?: {
    valid: boolean;
    latitude: number | null;
    longitude: number | null;
    altitudeM: number | null;
    speedKmh: number | null;
    courseDegrees?: number | null;
    bearingDegrees?: number | null;
    tripDistanceMeters?: number;
    satellites: number | null;
    fixQuality: number | null;
    lastSentenceAt: number | null;
    lastSentenceType: string | null;
  };
  filteredFix?: {
    valid: boolean;
    latitude: number | null;
    longitude: number | null;
    altitudeM: number | null;
    speedKmh: number | null;
    courseDegrees?: number | null;
    bearingDegrees?: number | null;
    tripDistanceMeters?: number;
    satellites: number | null;
    fixQuality: number | null;
    lastSentenceAt: number | null;
    lastSentenceType: string | null;
  };
}

interface SystemInfo {
  hostname: string;
  platform: string;
  osType: string;
  osRelease: string;
  arch: string;
  nodeVersion: string;
  processUptimeSeconds: number;
  systemUptimeSeconds: number;
  loadAverage: [number, number, number] | null;
  cpuCount: number;
  cpuTemperatureC?: number | null;
  cpuTemperatureSource?: string | null;
  memory: { totalBytes: number; freeBytes: number; usedBytes: number; usedPercent: number };
  disk: {
    path: string;
    totalBytes: number | null;
    freeBytes: number | null;
    usedBytes: number | null;
    usedPercent: number | null;
    error?: string;
  };
  collectedAt: number;
  network?: {
    summary: {
      distinctMacCount: number;
      interfacesWithIpCount: number;
      ethernetPortNames: string[];
      wirelessPortNames?: string[];
    };
    interfaces: Array<{
      name: string;
      mac: string | null;
      portKind: 'ethernet' | 'wireless' | 'loopback' | 'other';
      ipv4: string[];
      ipv6: string[];
      inUse: boolean;
    }>;
    wifi?: WifiAdapterRow[];
  };
}

type WifiScanRow = {
  ssid: string;
  security: string;
  signal: number | null;
  inUse: boolean;
  device?: string | null;
};

type NetIpRow = {
  device: string;
  type: string;
  state: string;
  connection: string | null;
  ipv4Address: string | null;
  ipv4Gateway: string | null;
  ipv4Dns: string[];
};

function formatBytes(b: number): string {
  if (b < 1024) return `${Math.round(b)} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let n = b;
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function portKindLabel(k: string): string {
  switch (k) {
    case 'ethernet':
      return 'Ethernet';
    case 'wireless':
      return 'Wireless';
    case 'loopback':
      return 'Loopback';
    default:
      return 'Other';
  }
}

function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtCoord(v: number | null, digits = 6): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtDeg(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(0)}°`;
}

function fmtTripM(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v < 1000) return `${v.toFixed(0)} m`;
  return `${(v / 1000).toFixed(3)} km`;
}

function usageTone(percent: number): 'success' | 'warning' | 'error' {
  if (percent >= 90) return 'error';
  if (percent >= 75) return 'warning';
  return 'success';
}

/** Wi‑Fi signal % (higher is better): map to bar color */
function wifiSignalTone(percent: number): 'success' | 'warning' | 'error' {
  if (percent < 30) return 'error';
  if (percent < 55) return 'warning';
  return 'success';
}

function ifaceKindIcon(portKind: string) {
  switch (portKind) {
    case 'ethernet':
      return <SettingsEthernetOutlinedIcon fontSize="small" />;
    case 'wireless':
      return <WifiOutlinedIcon fontSize="small" />;
    case 'loopback':
      return <LoopOutlinedIcon fontSize="small" />;
    default:
      return <DeviceHubOutlinedIcon fontSize="small" />;
  }
}

type SystemHealthSectionProps = {
  systemInfo: SystemInfo | null;
  sysLoading: boolean;
  loadSystemInfo: () => void;
  sysAutoRefresh: boolean;
  setSysAutoRefresh: (v: boolean) => void;
};

function SystemHealthSection({
  systemInfo,
  sysLoading,
  loadSystemInfo,
  sysAutoRefresh,
  setSysAutoRefresh,
}: SystemHealthSectionProps) {
  const theme = useTheme();
  const trackBg = alpha(theme.palette.text.primary, 0.09);

  const sortedIfaces = useMemo(() => {
    if (!systemInfo?.network?.interfaces) return [];
    return [...systemInfo.network.interfaces].sort((a, b) => {
      if (a.portKind === 'loopback' && b.portKind !== 'loopback') return 1;
      if (b.portKind === 'loopback' && a.portKind !== 'loopback') return -1;
      if (a.inUse !== b.inUse) return a.inUse ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [systemInfo?.network?.interfaces]);

  const wifiByName = useMemo(() => {
    const m = new Map<string, WifiAdapterRow>();
    for (const w of systemInfo?.network?.wifi ?? []) m.set(w.interfaceName, w);
    return m;
  }, [systemInfo?.network?.wifi]);

  const barSx = (tone: 'success' | 'warning' | 'error') => ({
    height: 11,
    borderRadius: 99,
    bgcolor: trackBg,
    '& .MuiLinearProgress-bar': {
      borderRadius: 99,
      bgcolor: theme.palette[tone].main,
    },
  });

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 1.5, sm: 2 },
        mb: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: alpha(theme.palette.divider, 0.14),
        background: `linear-gradient(160deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, ${alpha(theme.palette.background.paper, 1)} 42%, ${alpha(theme.palette.secondary?.main ?? theme.palette.primary.main, 0.04)} 100%)`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {sysLoading && systemInfo && (
        <LinearProgress
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            borderRadius: 0,
            opacity: 0.85,
          }}
        />
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.25}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        sx={{ mb: 1.25 }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: alpha(theme.palette.primary.main, 0.14),
              color: 'primary.main',
            }}
          >
            <SpeedOutlinedIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              System health
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Live view of this host
            </Typography>
          </Box>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
        >
          <FormControlLabel
            control={<Switch checked={sysAutoRefresh} onChange={(e) => setSysAutoRefresh(e.target.checked)} size="small" />}
            label={<Typography variant="body2">Auto-refresh · 30s</Typography>}
            sx={{ mr: 0 }}
          />
          <Button variant="contained" size="small" startIcon={<RefreshIcon />} onClick={loadSystemInfo} disabled={sysLoading} disableElevation>
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Alert
        severity="info"
        icon={<InfoOutlinedIcon />}
        sx={{
          mb: 1.5,
          py: 0.5,
          borderRadius: 2,
          bgcolor: alpha(theme.palette.info.main, 0.06),
          border: '1px solid',
          borderColor: alpha(theme.palette.info.main, 0.12),
        }}
      >
        <Typography variant="body2">
          Memory and CPU reflect this machine. <strong>Data volume</strong> shows the filesystem that holds your app data (database and exports).
        </Typography>
      </Alert>

      {sysLoading && !systemInfo ? (
        <Box sx={{ py: 3 }}>
          <LinearProgress sx={{ borderRadius: 2, height: 8 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
            Loading system metrics…
          </Typography>
        </Box>
      ) : systemInfo ? (
        <Stack spacing={1.75}>
          <Grid container spacing={1.5}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', borderRadius: 2, borderColor: alpha(theme.palette.divider, 0.12) }}>
                <CardContent sx={{ p: 1.75 }}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', width: 40, height: 40 }}>
                      <ComputerOutlinedIcon />
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
                        Host &amp; OS
                      </Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700, wordBreak: 'break-word', mt: 0.25 }}>
                        {systemInfo.hostname}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {systemInfo.platform} {systemInfo.osRelease} · {systemInfo.arch}
                      </Typography>
                      <Chip size="small" label={systemInfo.osType} sx={{ mt: 1.5, fontWeight: 500 }} variant="outlined" />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                        Node {systemInfo.nodeVersion}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', borderRadius: 2, borderColor: alpha(theme.palette.divider, 0.12) }}>
                <CardContent sx={{ p: 1.75 }}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <Avatar sx={{ bgcolor: alpha(theme.palette.secondary.main, 0.15), color: 'secondary.main', width: 40, height: 40 }}>
                      <AccessTimeOutlinedIcon />
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
                        Uptime
                      </Typography>
                      <Grid container spacing={1.25} sx={{ mt: 0.5 }}>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary" display="block">
                            App process
                          </Typography>
                          <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {formatDuration(systemInfo.processUptimeSeconds)}
                          </Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary" display="block">
                            System
                          </Typography>
                          <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {formatDuration(systemInfo.systemUptimeSeconds)}
                          </Typography>
                        </Grid>
                      </Grid>
                      <Divider sx={{ my: 1.5 }} />
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar sx={{ width: 36, height: 36, bgcolor: alpha(theme.palette.warning.main, 0.12), color: 'warning.dark' }}>
                          <SpeedOutlinedIcon fontSize="small" />
                        </Avatar>
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            CPU
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {systemInfo.cpuCount} logical cores
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Temp: {systemInfo.cpuTemperatureC != null ? `${systemInfo.cpuTemperatureC.toFixed(1)} °C` : '—'}
                            {systemInfo.cpuTemperatureSource ? ` · ${systemInfo.cpuTemperatureSource}` : ''}
                          </Typography>
                          {systemInfo.loadAverage ? (
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 0.75 }}>
                              {(['1m', '5m', '15m'] as const).map((label, i) => (
                                <Chip
                                  key={label}
                                  size="small"
                                  label={`${label}: ${systemInfo.loadAverage![i].toFixed(2)}`}
                                  variant="filled"
                                  sx={{ bgcolor: alpha(theme.palette.text.primary, 0.06), fontWeight: 500 }}
                                />
                              ))}
                            </Stack>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Load average not available on this platform
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', borderRadius: 2, borderColor: alpha(theme.palette.divider, 0.12) }}>
                <CardContent sx={{ p: 1.75 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <Avatar sx={{ bgcolor: alpha(theme.palette.info.main, 0.14), color: 'info.dark', width: 38, height: 38 }}>
                        <MemoryOutlinedIcon />
                      </Avatar>
                      <Box>
                        <Typography variant="overline" color="text.secondary">
                          Memory
                        </Typography>
                        <Typography
                          variant="h4"
                          sx={{
                            fontWeight: 700,
                            lineHeight: 1.1,
                            color: theme.palette[usageTone(systemInfo.memory.usedPercent)].main,
                          }}
                        >
                          {systemInfo.memory.usedPercent.toFixed(0)}%
                          <Typography component="span" variant="body2" color="text.secondary" sx={{ fontWeight: 400, ml: 0.5 }}>
                            used
                          </Typography>
                        </Typography>
                      </Box>
                    </Stack>
                    <Chip label={usageTone(systemInfo.memory.usedPercent) === 'success' ? 'Healthy' : usageTone(systemInfo.memory.usedPercent) === 'warning' ? 'Elevated' : 'High'} color={usageTone(systemInfo.memory.usedPercent)} size="small" sx={{ fontWeight: 600 }} />
                  </Stack>
                  <LinearProgress variant="determinate" value={Math.min(100, systemInfo.memory.usedPercent)} sx={barSx(usageTone(systemInfo.memory.usedPercent))} />
                  <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 1.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>{formatBytes(systemInfo.memory.usedBytes)}</strong> used
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      <strong>{formatBytes(systemInfo.memory.freeBytes)}</strong> free
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      <strong>{formatBytes(systemInfo.memory.totalBytes)}</strong> total
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', borderRadius: 2, borderColor: alpha(theme.palette.divider, 0.12) }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                    <Avatar sx={{ bgcolor: alpha(theme.palette.success.main, 0.14), color: 'success.dark', width: 44, height: 44 }}>
                      <StorageOutlinedIcon />
                    </Avatar>
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        Data volume
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Application data disk
                      </Typography>
                    </Box>
                  </Stack>
                  {systemInfo.disk.error ? (
                    <Alert severity="warning" sx={{ borderRadius: 2 }}>
                      {systemInfo.disk.error}
                    </Alert>
                  ) : systemInfo.disk.totalBytes != null && systemInfo.disk.usedPercent != null ? (
                    <>
                      <Typography variant="caption" component="div" color="text.secondary" sx={{ wordBreak: 'break-all', mb: 1.5, fontFamily: 'ui-monospace, monospace' }}>
                        {systemInfo.disk.path}
                      </Typography>
                      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.75 }}>
                        <Typography variant="h4" sx={{ fontWeight: 700, color: theme.palette[usageTone(systemInfo.disk.usedPercent)].main }}>
                          {systemInfo.disk.usedPercent.toFixed(0)}%
                        </Typography>
                        <Chip label={usageTone(systemInfo.disk.usedPercent) === 'success' ? 'Plenty of space' : usageTone(systemInfo.disk.usedPercent) === 'warning' ? 'Worth watching' : 'Low space'} color={usageTone(systemInfo.disk.usedPercent)} size="small" sx={{ fontWeight: 600 }} />
                      </Stack>
                      <LinearProgress variant="determinate" value={Math.min(100, systemInfo.disk.usedPercent)} sx={barSx(usageTone(systemInfo.disk.usedPercent))} />
                      <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 1.5 }}>
                        <Typography variant="body2" color="text.secondary">
                          <strong>{formatBytes(systemInfo.disk.usedBytes!)}</strong> used
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          <strong>{formatBytes(systemInfo.disk.freeBytes!)}</strong> free
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          <strong>{formatBytes(systemInfo.disk.totalBytes)}</strong> total
                        </Typography>
                      </Stack>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Disk stats unavailable on this Node build.
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {systemInfo.network && (
            <Box>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
                <HubOutlinedIcon color="action" />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Network interfaces
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Wi‑Fi hardware uses udev (Linux) or the adapter description from <code>netsh</code> (Windows). SSID, BSSID, and signal use <code>iw</code>, NetworkManager, or <code>netsh</code> when those tools are available.
              </Typography>
              <Grid container spacing={1.25} sx={{ mb: 1.5 }}>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), height: '100%' }}>
                    <CardContent sx={{ py: 1.25, px: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        MAC addresses
                      </Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }}>
                        {systemInfo.network.summary.distinctMacCount}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        distinct (non-loopback)
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), height: '100%' }}>
                    <CardContent sx={{ py: 1.25, px: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        Interfaces in use
                      </Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }}>
                        {systemInfo.network.summary.interfacesWithIpCount}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        have a routable / LAN address
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), height: '100%' }}>
                    <CardContent sx={{ py: 1.25, px: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        Ethernet (wired)
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 600, mt: 0.5, wordBreak: 'break-word' }}>
                        {systemInfo.network.summary.ethernetPortNames.length > 0
                          ? systemInfo.network.summary.ethernetPortNames.join(', ')
                          : 'None matched by name'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Heuristic from OS labels
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), height: '100%' }}>
                    <CardContent sx={{ py: 1.25, px: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        Wireless (Wi‑Fi)
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 600, mt: 0.5, wordBreak: 'break-word' }}>
                        {(systemInfo.network.summary.wirelessPortNames ?? []).length > 0
                          ? (systemInfo.network.summary.wirelessPortNames ?? []).join(', ')
                          : 'None matched by name'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Details below per interface
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>

              <Stack spacing={1}>
                {sortedIfaces.map((iface) => {
                  const wf = iface.portKind === 'wireless' ? wifiByName.get(iface.name) : undefined;
                  return (
                  <Card
                    key={iface.name}
                    variant="outlined"
                    sx={{
                      borderRadius: 2,
                      borderColor: iface.inUse ? alpha(theme.palette.success.main, 0.35) : alpha(theme.palette.divider, 0.12),
                      bgcolor: iface.inUse ? alpha(theme.palette.success.main, 0.03) : alpha(theme.palette.action.hover, 0.04),
                    }}
                  >
                    <CardContent sx={{ py: 1.5, px: 1.75, '&:last-child': { pb: 1.5 } }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                        <Stack direction="row" spacing={1.25} alignItems="center">
                          <Avatar sx={{ width: 34, height: 34, bgcolor: alpha(theme.palette.text.primary, 0.07) }}>{ifaceKindIcon(iface.portKind)}</Avatar>
                          <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                              {iface.name}
                            </Typography>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" alignItems="center">
                              <Chip size="small" label={portKindLabel(iface.portKind)} variant="outlined" />
                              {iface.portKind === 'ethernet' && <LanOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
                              {iface.portKind === 'wireless' && <WifiOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
                            </Stack>
                          </Box>
                        </Stack>
                        <Chip
                          label={iface.inUse ? 'In use' : 'No active IP'}
                          color={iface.inUse ? 'success' : 'default'}
                          size="small"
                          sx={{ fontWeight: 600 }}
                          variant={iface.inUse ? 'filled' : 'outlined'}
                        />
                      </Stack>
                      <Stack spacing={0.5} sx={{ mt: 1.25, pl: { sm: 5.75 } }}>
                        <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>
                          <Box component="span" color="text.secondary" sx={{ display: 'inline-block', minWidth: 52 }}>
                            MAC
                          </Box>
                          {iface.mac ?? '—'}
                        </Typography>
                        {iface.ipv4.length > 0 && (
                          <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>
                            <Box component="span" color="text.secondary" sx={{ display: 'inline-block', minWidth: 52 }}>
                              IPv4
                            </Box>
                            {iface.ipv4.join(', ')}
                          </Typography>
                        )}
                        {iface.ipv6.length > 0 && (
                          <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                            <Box component="span" color="text.secondary" sx={{ display: 'inline-block', minWidth: 52, verticalAlign: 'top' }}>
                              IPv6
                            </Box>
                            {iface.ipv6.join(', ')}
                          </Typography>
                        )}
                        {wf && (
                          <>
                            <Divider sx={{ my: 1 }} />
                            <Typography variant="caption" color="text.secondary" fontWeight={700} letterSpacing={0.4} display="block" sx={{ mb: 0.75 }}>
                              Wi‑Fi hardware &amp; association
                            </Typography>
                            {wf.hardwareDescription && (
                              <Typography variant="body2" sx={{ mb: 0.5 }}>
                                <Box component="span" color="text.secondary" sx={{ fontWeight: 600 }}>
                                  Adapter
                                </Box>{' '}
                                {wf.hardwareDescription}
                              </Typography>
                            )}
                            {wf.hardwareDetail && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontFamily: 'ui-monospace, monospace' }}>
                                {wf.hardwareDetail}
                              </Typography>
                            )}
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" sx={{ mb: 0.75 }}>
                              <Chip
                                size="small"
                                label={wf.connected ? 'Associated to AP' : 'Not associated'}
                                color={wf.connected ? 'success' : 'default'}
                                variant={wf.connected ? 'filled' : 'outlined'}
                                sx={{ fontWeight: 600 }}
                              />
                              <Chip size="small" label={`Source: ${wf.dataSource}`} variant="outlined" />
                            </Stack>
                            {wf.ssid && (
                              <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', mb: 0.5 }}>
                                <Box component="span" color="text.secondary" sx={{ display: 'inline-block', minWidth: 52 }}>
                                  SSID
                                </Box>
                                {wf.ssid}
                              </Typography>
                            )}
                            {wf.bssid && (
                              <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', mb: 0.5 }}>
                                <Box component="span" color="text.secondary" sx={{ display: 'inline-block', minWidth: 52 }}>
                                  BSSID
                                </Box>
                                {wf.bssid}
                              </Typography>
                            )}
                            {(wf.signalDbm != null || wf.signalPercent != null) && (
                              <Box sx={{ mt: 1 }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                    Signal
                                  </Typography>
                                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                    {wf.signalDbm != null && <>{wf.signalDbm} dBm</>}
                                    {wf.signalDbm != null && wf.signalPercent != null && ' · '}
                                    {wf.signalPercent != null && <>{wf.signalPercent}% (approx.)</>}
                                  </Typography>
                                </Stack>
                                {wf.signalPercent != null && (
                                  <LinearProgress
                                    variant="determinate"
                                    value={Math.min(100, wf.signalPercent)}
                                    sx={{
                                      height: 8,
                                      borderRadius: 99,
                                      bgcolor: trackBg,
                                      '& .MuiLinearProgress-bar': {
                                        borderRadius: 99,
                                        bgcolor: theme.palette[wifiSignalTone(wf.signalPercent)].main,
                                      },
                                    }}
                                  />
                                )}
                              </Box>
                            )}
                            {wf.txRateMbps != null && (
                              <Typography variant="body2" sx={{ mt: 1, fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>
                                <Box component="span" color="text.secondary" sx={{ display: 'inline-block', minWidth: 52 }}>
                                  TX rate
                                </Box>
                                {wf.txRateMbps} Mbit/s
                              </Typography>
                            )}
                            {wf.message && (
                              <Alert severity="info" sx={{ mt: 1.5, py: 0.25, borderRadius: 2 }}>
                                {wf.message}
                              </Alert>
                            )}
                          </>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                  );
                })}
              </Stack>
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right' }}>
            Last updated · {new Date(systemInfo.collectedAt).toLocaleString()}
          </Typography>
        </Stack>
      ) : (
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          Could not load system information. Check your connection and try Refresh.
        </Alert>
      )}
    </Paper>
  );
}

const timestampFormatOptions = [
  'UNIX_MS',
  'ISO8601',
  'YYYY-MM-DD HH:mm:ss',
  'DD/MM/YYYY HH:mm:ss',
  'MM/DD/YYYY HH:mm:ss',
  'YYYY-MM-DD',
  'HH:mm:ss',
];

const Settings: React.FC = () => {
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const role = useAuthStore((s) => s.role);

  const [readOnlyToken, setReadOnlyToken] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwNew2, setPwNew2] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [timestampMapping, setTimestampMapping] = useState<ParameterMapping | null>(null);
  const [timestampForm, setTimestampForm] = useState({
    inputFormat: systemTimestampDefaults.inputFormat,
    inputTimezone: systemTimestampDefaults.inputTimezone,
    outputFormat: systemTimestampDefaults.outputFormat,
    outputTimezone: systemTimestampDefaults.outputTimezone,
  });
  const [timestampInterval, setTimestampInterval] = useState<number>(60);
  const [timestampSaving, setTimestampSaving] = useState(false);
  const [timestampMessage, setTimestampMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysAutoRefresh, setSysAutoRefresh] = useState(false);

  const [serialPorts, setSerialPorts] = useState<Array<{ path: string; manufacturer?: string }>>([]);
  const [gnssConfig, setGnssConfig] = useState<GnssConfig>({
    enabled: false,
    portPath: null,
    baudRate: 9600,
    historyIntervalSeconds: 5,
  });

  // Wi‑Fi control (Linux / NetworkManager) — web mode only
  const [wifiIfname, setWifiIfname] = useState<string>('');
  const [wifiScan, setWifiScan] = useState<WifiScanRow[]>([]);
  const [wifiScanLoading, setWifiScanLoading] = useState(false);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiBusy, setWifiBusy] = useState(false);
  const [wifiStatus, setWifiStatus] = useState<{ devices: Array<{ device: string; state: string; connection: string | null }> } | null>(null);

  const [netIpStatus, setNetIpStatus] = useState<{ devices: NetIpRow[] } | null>(null);
  const [ipDevice, setIpDevice] = useState<string>('');
  const [ipMethod, setIpMethod] = useState<'auto' | 'manual'>('auto');
  const [ipAddress, setIpAddress] = useState<string>('');
  const [ipGateway, setIpGateway] = useState<string>('');
  const [ipDns, setIpDns] = useState<string>('');
  const [ipTestConnectivity, setIpTestConnectivity] = useState<boolean>(true);
  const [ipRollbackSeconds, setIpRollbackSeconds] = useState<number>(30);
  const [ipBusy, setIpBusy] = useState<boolean>(false);

  const wifiInterfaces = useMemo(() => {
    const ifaces = systemInfo?.network?.interfaces ?? [];
    return ifaces.filter((i) => i.portKind === 'wireless').map((i) => i.name);
  }, [systemInfo?.network?.interfaces]);

  const wiredInterfaces = useMemo(() => {
    const ifaces = systemInfo?.network?.interfaces ?? [];
    return ifaces.filter((i) => i.portKind === 'ethernet').map((i) => i.name);
  }, [systemInfo?.network?.interfaces]);

  const ipInterfaces = useMemo(() => [...wifiInterfaces, ...wiredInterfaces], [wifiInterfaces, wiredInterfaces]);

  useEffect(() => {
    if (!wifiIfname && wifiInterfaces.length > 0) setWifiIfname(wifiInterfaces[0]);
  }, [wifiInterfaces, wifiIfname]);

  useEffect(() => {
    if (!ipDevice && ipInterfaces.length > 0) setIpDevice(ipInterfaces[0]);
  }, [ipInterfaces, ipDevice]);

  const loadWifiStatus = useCallback(async () => {
    try {
      const st = await (api as any).wifi?.status?.();
      setWifiStatus(st || null);
    } catch (_) {
      setWifiStatus(null);
    }
  }, []);

  const scanWifi = useCallback(async () => {
    setWifiScanLoading(true);
    try {
      const res = await (api as any).wifi?.scan?.(wifiIfname || undefined);
      setWifiScan(Array.isArray(res?.networks) ? res.networks : []);
      await loadWifiStatus();
    } catch (e: any) {
      setError(e?.message || 'Failed to scan Wi‑Fi networks');
    } finally {
      setWifiScanLoading(false);
    }
  }, [wifiIfname, loadWifiStatus]);

  const loadNetIpStatus = useCallback(async () => {
    try {
      const st = await (api as any).netIp?.status?.();
      setNetIpStatus(st || null);
    } catch (_) {
      setNetIpStatus(null);
    }
  }, []);

  const hydrateIpFormFromStatus = useCallback(
    (device: string, st: { devices: NetIpRow[] } | null) => {
      const row = st?.devices?.find((d) => d.device === device);
      if (!row) return;
      setIpAddress(row.ipv4Address || '');
      setIpGateway(row.ipv4Gateway || '');
      setIpDns((row.ipv4Dns || []).join(', '));
    },
    []
  );

  useEffect(() => {
    if (ipDevice) hydrateIpFormFromStatus(ipDevice, netIpStatus);
  }, [ipDevice, netIpStatus, hydrateIpFormFromStatus]);

  const applyIpSettings = useCallback(async () => {
    setIpBusy(true);
    try {
      if (!ipDevice) throw new Error('Select an interface');
      const dnsList = ipDns
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: any = {
        device: ipDevice,
        method: ipMethod,
        testConnectivity: ipTestConnectivity,
        safetyRollbackSeconds: ipRollbackSeconds,
      };
      if (ipMethod === 'manual') {
        payload.address = ipAddress.trim();
        payload.gateway = ipGateway.trim() || undefined;
        payload.dns = dnsList;
      }
      const res = await (api as any).netIp?.set?.(payload);
      if (res?.status) setNetIpStatus(res.status);
      setSuccess('IP settings applied');
    } catch (e: any) {
      setError(e?.message || 'Failed to apply IP settings');
    } finally {
      setIpBusy(false);
    }
  }, [ipDevice, ipMethod, ipAddress, ipGateway, ipDns, ipTestConnectivity, ipRollbackSeconds]);

  const connectWifi = useCallback(async () => {
    setWifiBusy(true);
    try {
      await (api as any).wifi?.connect?.({ ssid: wifiSsid.trim(), password: wifiPassword || undefined, ifname: wifiIfname || undefined });
      setSuccess('Wi‑Fi connect request sent');
      await scanWifi();
    } catch (e: any) {
      setError(e?.message || 'Failed to connect Wi‑Fi');
    } finally {
      setWifiBusy(false);
    }
  }, [wifiSsid, wifiPassword, wifiIfname, scanWifi]);

  const disconnectWifi = useCallback(async () => {
    setWifiBusy(true);
    try {
      if (!wifiIfname) throw new Error('Select a Wi‑Fi interface first');
      await (api as any).wifi?.disconnect?.({ ifname: wifiIfname });
      setSuccess('Wi‑Fi disconnected');
      await scanWifi();
    } catch (e: any) {
      setError(e?.message || 'Failed to disconnect Wi‑Fi');
    } finally {
      setWifiBusy(false);
    }
  }, [wifiIfname, scanWifi]);
  const [gnssStatus, setGnssStatus] = useState<GnssStatus | null>(null);
  const [gnssLoading, setGnssLoading] = useState(false);
  const [gnssSaving, setGnssSaving] = useState(false);
  const [gnssTripResetting, setGnssTripResetting] = useState(false);

  const timezoneOptions = useMemo(() => {
    const tz: string[] = [];
    for (let offset = -12; offset <= 14; offset++) {
      const sign = offset >= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      tz.push(`UTC${sign}${abs.toString().padStart(2, '0')}`);
    }
    return tz;
  }, []);

  const loadSystemInfo = useCallback(async () => {
    try {
      setSysLoading(true);
      const info = await api.system?.getSystemInfo?.();
      setSystemInfo((info as SystemInfo) || null);
    } catch {
      setSystemInfo(null);
    } finally {
      setSysLoading(false);
    }
  }, []);

  const loadSerialPorts = useCallback(async () => {
    try {
      const list = await api.modbus?.listSerialPorts?.();
      setSerialPorts(Array.isArray(list) ? list : []);
    } catch {
      setSerialPorts([]);
    }
  }, []);

  const loadGnss = useCallback(async () => {
    try {
      setGnssLoading(true);
      const [cfg, st] = await Promise.all([api.gnss?.getConfig?.(), api.gnss?.getStatus?.()]);
      if (cfg) setGnssConfig(cfg as GnssConfig);
      if (st) setGnssStatus(st as GnssStatus);
    } catch {
      // GNSS endpoints exist only in web mode
    } finally {
      setGnssLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadTimestampMapping();
    loadSystemInfo();
    loadSerialPorts();
    loadGnss();
    if (role === 'admin') loadReadOnlyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  useEffect(() => {
    if (!sysAutoRefresh) return;
    const id = window.setInterval(() => loadSystemInfo(), 30000);
    return () => window.clearInterval(id);
  }, [sysAutoRefresh, loadSystemInfo]);

  useEffect(() => {
    if (!gnssConfig.enabled) return;
    const id = window.setInterval(() => {
      api.gnss
        ?.getStatus?.()
        .then((st) => setGnssStatus((st as GnssStatus) || null))
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(id);
  }, [gnssConfig.enabled]);

  const saveGnssConfig = async () => {
    try {
      setGnssSaving(true);
      const res: any = await api.gnss?.saveConfig?.(gnssConfig);
      if (res?.config) setGnssConfig(res.config);
      if (res?.status) setGnssStatus(res.status);
      setSuccess('GNSS settings saved');
      setTimeout(() => setSuccess(''), 2500);
    } catch (e: any) {
      setError(e?.message || 'Failed to save GNSS config');
    } finally {
      setGnssSaving(false);
    }
  };

  const resetGnssTripDistance = async () => {
    try {
      setGnssTripResetting(true);
      const res: any = await api.gnss?.resetTripDistance?.();
      if (res?.status) setGnssStatus(res.status as GnssStatus);
      else await loadGnss();
      setSuccess('Trip distance reset to 0');
      setTimeout(() => setSuccess(''), 2500);
    } catch (e: any) {
      setError(e?.message || 'Failed to reset trip distance');
    } finally {
      setGnssTripResetting(false);
    }
  };

  const loadSettings = async () => {
    try {
      const id = await api.system?.getClientId();
      setClientId(id || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
    }
  };

  const loadReadOnlyToken = async () => {
    try {
      setTokenLoading(true);
      const r: any = await api.systemSecurity.getReadOnlyToken();
      const token = typeof r === 'string' ? r : r?.token;
      setReadOnlyToken(token || '');
    } catch (e: any) {
      // don't block settings load
      console.warn('Failed to load read-only token:', e?.message);
    } finally {
      setTokenLoading(false);
    }
  };

  const regenerateReadOnlyToken = async () => {
    try {
      setTokenLoading(true);
      const r: any = await api.systemSecurity.regenerateReadOnlyToken();
      const token = typeof r === 'string' ? r : r?.token;
      setReadOnlyToken(token || '');
      setSuccess('Read-only token regenerated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e?.message || 'Failed to regenerate token');
    } finally {
      setTokenLoading(false);
    }
  };

  const loadTimestampMapping = async () => {
    try {
      const data = await api.mappings?.list();
      const mapping = Array.isArray(data)
        ? data.find(
            (m: ParameterMapping) =>
              m.sourceType === 'system' &&
              (m.sourceDeviceId === 'system-timestamp' || m.mappedName?.toLowerCase().includes('time'))
          )
        : null;

      if (mapping) {
        setTimestampMapping(mapping);
        setTimestampForm({
          inputFormat: mapping.inputFormat || systemTimestampDefaults.inputFormat,
          inputTimezone: mapping.inputTimezone || systemTimestampDefaults.inputTimezone,
          outputFormat: mapping.outputFormat || systemTimestampDefaults.outputFormat,
          outputTimezone: mapping.outputTimezone || systemTimestampDefaults.outputTimezone,
        });
      } else {
        setTimestampMapping(null);
      }

      const intervalValue = await api.system?.getTimestampInterval();
      if (typeof intervalValue === 'number') {
        setTimestampInterval(intervalValue);
      }
    } catch (error: any) {
      setTimestampMessage({
        type: 'error',
        text: error.message || 'Failed to load system timestamp configuration.',
      });
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      await api.system?.setClientId(clientId);
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTimestamp = async () => {
    if (!timestampMapping) {
      return;
    }

    try {
      setTimestampSaving(true);
      setTimestampMessage(null);
      await api.mappings?.update(timestampMapping.id, {
        inputFormat: timestampForm.inputFormat || null,
        inputTimezone: timestampForm.inputTimezone || null,
        outputFormat: timestampForm.outputFormat || null,
        outputTimezone: timestampForm.outputTimezone || null,
      });
      await api.system?.setTimestampInterval(timestampInterval);
      setTimestampMessage({ type: 'success', text: 'System timestamp format updated.' });
      await loadTimestampMapping();
    } catch (error: any) {
      setTimestampMessage({
        type: 'error',
        text: error.message || 'Failed to update system timestamp format.',
      });
    } finally {
      setTimestampSaving(false);
    }
  };

  const handleChangePassword = async () => {
    try {
      setPwSaving(true);
      setPwMessage(null);
      if (!pwCurrent || !pwNew) {
        setPwMessage({ type: 'error', text: 'Please fill current and new password.' });
        return;
      }
      if (pwNew !== pwNew2) {
        setPwMessage({ type: 'error', text: 'New password confirmation does not match.' });
        return;
      }
      await api.auth.changePassword(pwCurrent, pwNew);
      setPwCurrent('');
      setPwNew('');
      setPwNew2('');
      setPwMessage({ type: 'success', text: 'Password changed successfully.' });
    } catch (e: any) {
      setPwMessage({ type: 'error', text: e?.message || 'Failed to change password.' });
    } finally {
      setPwSaving(false);
    }
  };

  const fix = gnssStatus?.filteredFix ?? gnssStatus?.rawFix;
  const hasCoords = !!(fix && typeof fix.latitude === 'number' && typeof fix.longitude === 'number');
  const lat = hasCoords ? (fix!.latitude as number) : null;
  const lon = hasCoords ? (fix!.longitude as number) : null;
  const bboxDelta = 0.02;
  const osmEmbedUrl =
    hasCoords && lat != null && lon != null
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
          `${lon - bboxDelta},${lat - bboxDelta},${lon + bboxDelta},${lat + bboxDelta}`
        )}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`
      : null;
  const osmLinkUrl =
    hasCoords && lat != null && lon != null
      ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(lat))}&mlon=${encodeURIComponent(
          String(lon)
        )}#map=15/${encodeURIComponent(String(lat))}/${encodeURIComponent(String(lon))}`
      : null;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        System Configuration
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          System Identification
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              fullWidth
              helperText="Unique identifier for this client"
            />
          </Grid>
        </Grid>
        <Box sx={{ mt: 2 }}>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={loading}
          >
            Save Settings
          </Button>
        </Box>
      </Paper>

      <SystemHealthSection
        systemInfo={systemInfo}
        sysLoading={sysLoading}
        loadSystemInfo={loadSystemInfo}
        sysAutoRefresh={sysAutoRefresh}
        setSysAutoRefresh={setSysAutoRefresh}
      />

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1.25} mb={1.25}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Avatar sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>
              <WiFiIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                Wi‑Fi (Linux)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Connect/disconnect using NetworkManager (<code>nmcli</code>)
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Button size="small" variant="outlined" onClick={loadWifiStatus} disabled={wifiScanLoading || wifiBusy}>
              Refresh status
            </Button>
            <Button size="small" variant="outlined" onClick={loadNetIpStatus} disabled={wifiScanLoading || wifiBusy || ipBusy}>
              Refresh IP
            </Button>
            <Button size="small" variant="outlined" onClick={scanWifi} disabled={wifiScanLoading || wifiBusy}>
              {wifiScanLoading ? 'Scanning…' : 'Scan'}
            </Button>
          </Stack>
        </Box>
        <Divider sx={{ mb: 1.5 }} />

        <Grid container spacing={1.5}>
          <Grid item xs={12} md={5}>
            <Stack spacing={1.25}>
              <TextField
                select
                label="Wi‑Fi interface"
                value={wifiIfname}
                onChange={(e) => setWifiIfname(e.target.value)}
                fullWidth
                helperText={wifiInterfaces.length === 0 ? 'No wireless interfaces detected in System health' : undefined}
              >
                {wifiInterfaces.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="SSID"
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                fullWidth
                placeholder="e.g. MyHotspot"
              />
              <TextField
                label="Password (optional)"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                type="password"
                fullWidth
                placeholder="Leave empty for open networks"
              />

              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                IP settings (Wi‑Fi / LAN)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Linux only. Be careful when setting static IP remotely.
              </Typography>

              <TextField select label="Interface" value={ipDevice} onChange={(e) => setIpDevice(e.target.value)} fullWidth>
                {ipInterfaces.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label="IPv4 method"
                value={ipMethod}
                onChange={(e) => setIpMethod(e.target.value as 'auto' | 'manual')}
                fullWidth
              >
                <MenuItem value="auto">DHCP (auto)</MenuItem>
                <MenuItem value="manual">Static (manual)</MenuItem>
              </TextField>

              <TextField
                label="IPv4 address (CIDR)"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                fullWidth
                disabled={ipMethod !== 'manual'}
                placeholder="e.g. 192.168.1.50/24"
              />
              <TextField
                label="Gateway (optional)"
                value={ipGateway}
                onChange={(e) => setIpGateway(e.target.value)}
                fullWidth
                disabled={ipMethod !== 'manual'}
                placeholder="e.g. 192.168.1.1"
              />
              <TextField
                label="DNS (comma-separated)"
                value={ipDns}
                onChange={(e) => setIpDns(e.target.value)}
                fullWidth
                disabled={ipMethod !== 'manual'}
                placeholder="e.g. 1.1.1.1, 8.8.8.8"
              />

              <Grid container spacing={1.5}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Rollback timer (sec)"
                    type="number"
                    value={ipRollbackSeconds}
                    onChange={(e) => setIpRollbackSeconds(Number(e.target.value || 0))}
                    fullWidth
                    helperText="0 = no timer (rollback immediately on failed test)"
                    inputProps={{ min: 0, max: 300, step: 5 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControlLabel
                    control={<Switch checked={ipTestConnectivity} onChange={(e) => setIpTestConnectivity(e.target.checked)} />}
                    label="Connectivity test (ping)"
                  />
                </Grid>
              </Grid>

              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button variant="contained" onClick={applyIpSettings} disabled={ipBusy || !ipDevice} disableElevation>
                  {ipBusy ? 'Applying…' : 'Apply IP'}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setIpMethod('auto');
                    setIpAddress('');
                    setIpGateway('');
                    setIpDns('');
                    setIpTestConnectivity(true);
                    setIpRollbackSeconds(30);
                  }}
                  disabled={ipBusy}
                >
                  Reset form
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  variant="contained"
                  onClick={connectWifi}
                  disabled={wifiBusy || wifiScanLoading || !wifiSsid.trim()}
                  disableElevation
                >
                  {wifiBusy ? 'Working…' : 'Connect'}
                </Button>
                <Button variant="outlined" onClick={disconnectWifi} disabled={wifiBusy || wifiScanLoading || !wifiIfname}>
                  Disconnect
                </Button>
              </Stack>

              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                    Status
                  </Typography>
                  {wifiStatus?.devices?.length ? (
                    <Stack spacing={0.5}>
                      {wifiStatus.devices.map((d) => (
                        <Typography key={d.device} variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>
                          <Box component="span" color="text.secondary" sx={{ display: 'inline-block', minWidth: 64 }}>
                            {d.device}
                          </Box>
                          {d.connection || '—'}{' '}
                          <Box component="span" color="text.secondary">
                            ({d.state})
                          </Box>
                        </Typography>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Not available. This requires Linux + NetworkManager (<code>nmcli</code>).
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Stack>
          </Grid>

          <Grid item xs={12} md={7}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Scan results
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Click a row to fill SSID
                  </Typography>
                </Stack>
                {wifiScan.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No scan data yet. Click <strong>Scan</strong>.
                  </Typography>
                ) : (
                  <Stack spacing={0.5}>
                    {wifiScan.slice(0, 30).map((n) => (
                      <Paper
                        key={`${n.ssid}:${n.device ?? ''}`}
                        variant="outlined"
                        sx={{
                          p: 1,
                          borderRadius: 2,
                          cursor: 'pointer',
                          bgcolor: n.inUse ? (t) => alpha(t.palette.success.main, 0.06) : 'transparent',
                          borderColor: n.inUse ? (t) => alpha(t.palette.success.main, 0.25) : undefined,
                        }}
                        onClick={() => setWifiSsid(n.ssid)}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                              {n.ssid}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {n.security || 'open'}{n.device ? ` · ${n.device}` : ''}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            label={n.inUse ? 'In use' : `${n.signal ?? '—'}%`}
                            color={n.inUse ? 'success' : 'default'}
                            variant={n.inUse ? 'filled' : 'outlined'}
                            sx={{ fontWeight: 600, flexShrink: 0 }}
                          />
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1.25} mb={1.25}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Avatar sx={{ bgcolor: (t) => alpha(t.palette.info.main, 0.14), color: 'info.dark' }}>
              <GpsFixedIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                GNSS (USB)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                BEITIAN BS-708 (NMEA) — latitude/longitude + map
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Button size="small" variant="outlined" onClick={loadSerialPorts} disabled={gnssLoading}>
              Refresh ports
            </Button>
            <Button size="small" variant="outlined" onClick={loadGnss} disabled={gnssLoading}>
              Refresh status
            </Button>
          </Stack>
        </Box>
        <Divider sx={{ mb: 1.5 }} />

        <Grid container spacing={1.5}>
          <Grid item xs={12} md={5}>
            <Stack spacing={1.25}>
              <FormControlLabel
                control={
                  <Switch
                    checked={gnssConfig.enabled}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, enabled: e.target.checked }))}
                  />
                }
                label="Enable GNSS reader"
              />

              <Autocomplete
                options={serialPorts}
                getOptionLabel={(o) => (o?.manufacturer ? `${o.path} — ${o.manufacturer}` : o.path)}
                value={serialPorts.find((p) => p.path === gnssConfig.portPath) || (gnssConfig.portPath ? { path: gnssConfig.portPath } : null)}
                onChange={(_, v) => setGnssConfig((p) => ({ ...p, portPath: (v as any)?.path || null }))}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Serial port"
                    helperText="Select the USB GNSS serial device (e.g. /dev/ttyACM0)"
                  />
                )}
              />

              <TextField
                label="Baud rate"
                type="number"
                value={gnssConfig.baudRate}
                onChange={(e) => setGnssConfig((p) => ({ ...p, baudRate: Number(e.target.value || 0) }))}
                inputProps={{ min: 4800, max: 921600, step: 100 }}
                helperText="BS-708 is typically 9600"
              />

              <TextField
                label="History store interval (seconds)"
                type="number"
                value={gnssConfig.historyIntervalSeconds ?? 5}
                onChange={(e) =>
                  setGnssConfig((p) => ({ ...p, historyIntervalSeconds: Number(e.target.value || 0) || 1 }))
                }
                inputProps={{ min: 1, max: 3600, step: 1 }}
                helperText="How often GNSS mappings are written to historical data (realtime updates can be faster)"
              />

              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Accuracy filters
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={gnssConfig.filterEnabled !== false}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, filterEnabled: e.target.checked }))}
                  />
                }
                label="Enable GNSS filtering"
              />
              <Grid container spacing={1.5}>
                <Grid item xs={6}>
                  <TextField
                    label="Min satellites"
                    type="number"
                    value={gnssConfig.minSatellites ?? 4}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, minSatellites: Number(e.target.value || 0) }))}
                    inputProps={{ min: 0, max: 64, step: 1 }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Min fix quality"
                    type="number"
                    value={gnssConfig.minFixQuality ?? 1}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, minFixQuality: Number(e.target.value || 0) }))}
                    inputProps={{ min: 0, max: 10, step: 1 }}
                    helperText="GGA quality (1=GPS, 2=DGPS)"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Max jump (meters)"
                    type="number"
                    value={gnssConfig.maxJumpMeters ?? 25}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, maxJumpMeters: Number(e.target.value || 0) }))}
                    inputProps={{ min: 0, max: 10000, step: 1 }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Max speed (km/h)"
                    type="number"
                    value={gnssConfig.maxSpeedKmh ?? 200}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, maxSpeedKmh: Number(e.target.value || 0) }))}
                    inputProps={{ min: 0, max: 1000, step: 1 }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Min speed for trip (km/h)"
                    type="number"
                    value={gnssConfig.minTripSpeedKmh ?? 0}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, minTripSpeedKmh: Number(e.target.value || 0) }))}
                    inputProps={{ min: 0, max: 500, step: 0.5 }}
                    helperText="0 = off. Uses RMC speed; below this, trip anchor moves without adding distance."
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Hold last good (sec)"
                    type="number"
                    value={gnssConfig.holdLastGoodSeconds ?? 10}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, holdLastGoodSeconds: Number(e.target.value || 0) }))}
                    inputProps={{ min: 0, max: 3600, step: 1 }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Smoothing window"
                    type="number"
                    value={gnssConfig.smoothingWindow ?? 1}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, smoothingWindow: Number(e.target.value || 0) }))}
                    inputProps={{ min: 1, max: 25, step: 1 }}
                    helperText="1 = off"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Min update interval (ms)"
                    type="number"
                    value={gnssConfig.minUpdateIntervalMs ?? 200}
                    onChange={(e) => setGnssConfig((p) => ({ ...p, minUpdateIntervalMs: Number(e.target.value || 0) }))}
                    inputProps={{ min: 0, max: 30000, step: 50 }}
                    helperText="Optional throttle for accepting fixes"
                    fullWidth
                  />
                </Grid>
              </Grid>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <Button variant="contained" onClick={saveGnssConfig} disabled={gnssSaving || gnssLoading} disableElevation>
                  {gnssSaving ? 'Saving…' : 'Save GNSS settings'}
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={resetGnssTripDistance}
                  disabled={gnssTripResetting || gnssLoading}
                  disableElevation
                >
                  {gnssTripResetting ? 'Resetting…' : 'Reset trip distance'}
                </Button>
              </Box>

              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                    Status
                  </Typography>
                  {gnssStatus ? (
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                        <Chip
                          size="small"
                          color={gnssStatus.connected ? 'success' : gnssStatus.connecting ? 'warning' : 'default'}
                          label={gnssStatus.connected ? 'Connected' : gnssStatus.connecting ? 'Connecting…' : 'Disconnected'}
                          sx={{ fontWeight: 600 }}
                        />
                        {fix?.valid ? (
                          <Chip size="small" color="success" label="Fix valid" variant="outlined" />
                        ) : (
                          <Chip size="small" label="No valid fix" variant="outlined" />
                        )}
                        {fix?.satellites != null && <Chip size="small" label={`Sat: ${fix.satellites}`} variant="outlined" />}
                        {fix?.lastSentenceType && <Chip size="small" label={`NMEA: ${fix.lastSentenceType}`} variant="outlined" />}
                      </Stack>
                      {gnssStatus.error && <Alert severity="warning">{gnssStatus.error}</Alert>}
                      <Typography variant="body2" color="text.secondary">
                        Lat: <strong>{fmtCoord(fix?.latitude ?? null)}</strong> · Lon: <strong>{fmtCoord(fix?.longitude ?? null)}</strong>
                      </Typography>
                      {gnssStatus.rawFix && gnssStatus.filteredFix && (
                        <Typography variant="caption" color="text.secondary">
                          Raw: {fmtCoord(gnssStatus.rawFix.latitude ?? null)} / {fmtCoord(gnssStatus.rawFix.longitude ?? null)}{' '}
                          · Filtered: {fmtCoord(gnssStatus.filteredFix.latitude ?? null)} / {fmtCoord(gnssStatus.filteredFix.longitude ?? null)}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        Alt: {fix?.altitudeM != null ? `${fix.altitudeM.toFixed(1)} m` : '—'} · Speed:{' '}
                        {fix?.speedKmh != null ? `${fix.speedKmh.toFixed(1)} km/h` : '—'} · Fix quality:{' '}
                        {fix?.fixQuality != null ? fix.fixQuality : '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Course (COG): <strong>{fmtDeg(fix?.courseDegrees)}</strong> · Movement bearing:{' '}
                        <strong>{fmtDeg(fix?.bearingDegrees)}</strong> · Trip distance:{' '}
                        <strong>{fmtTripM(fix?.tripDistanceMeters)}</strong>
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Last update:{' '}
                        {fix?.lastSentenceAt ? new Date(fix.lastSentenceAt).toLocaleString() : '—'}
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      GNSS status is available only in web mode.
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Stack>
          </Grid>

          <Grid item xs={12} md={7}>
            <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
              <CardContent sx={{ p: 0, height: '100%' }}>
                {osmEmbedUrl ? (
                  <Box sx={{ position: 'relative', width: '100%', height: { xs: 320, md: 420 } }}>
                    <Box
                      component="iframe"
                      title="GNSS map"
                      src={osmEmbedUrl}
                      sx={{ border: 0, width: '100%', height: '100%', borderRadius: 2 }}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <Box sx={{ position: 'absolute', right: 10, top: 10, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {osmLinkUrl && (
                        <Button
                          size="small"
                          variant="contained"
                          href={osmLinkUrl}
                          target="_blank"
                          rel="noreferrer"
                          disableElevation
                        >
                          Open map
                        </Button>
                      )}
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ p: 2.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                      Map
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Connect GNSS and wait for a valid fix to show the map.
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Security
        </Typography>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Change password
            </Typography>
            {pwMessage && (
              <Alert severity={pwMessage.type} sx={{ mb: 2 }} onClose={() => setPwMessage(null)}>
                {pwMessage.text}
              </Alert>
            )}
            <TextField
              label="Current password"
              type="password"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
              fullWidth
              sx={{ mb: 2 }}
            />
            <TextField
              label="New password"
              type="password"
              value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              fullWidth
              sx={{ mb: 2 }}
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={pwNew2}
              onChange={(e) => setPwNew2(e.target.value)}
              fullWidth
            />
            <Box sx={{ mt: 2 }}>
              <Button variant="contained" onClick={handleChangePassword} disabled={pwSaving}>
                {pwSaving ? 'Saving…' : 'Update password'}
              </Button>
            </Box>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Public dashboard read-only token
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This token grants read-only access to the public dashboard: <code>/public?token=…</code>. Keep it secret.
              Regenerate if it leaks.
            </Typography>
            {role !== 'admin' ? (
              <Alert severity="info">Only admin can view/regenerate the read-only token.</Alert>
            ) : (
              <>
                <TextField
                  label="Read-only token"
                  value={readOnlyToken}
                  fullWidth
                  InputProps={{ readOnly: true }}
                  helperText={tokenLoading ? 'Loading…' : 'Use /public?token=THIS_TOKEN'}
                />
                <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button variant="outlined" onClick={loadReadOnlyToken} disabled={tokenLoading}>
                    Refresh
                  </Button>
                  <Button color="warning" variant="contained" onClick={regenerateReadOnlyToken} disabled={tokenLoading}>
                    Regenerate token
                  </Button>
                </Box>
              </>
            )}
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          System Timestamp Format
        </Typography>
        <Divider sx={{ mb: 3 }} />

        {timestampMessage && (
          <Alert
            severity={timestampMessage.type}
            sx={{ mb: 2 }}
            onClose={() => setTimestampMessage(null)}
          >
            {timestampMessage.text}
          </Alert>
        )}

        {timestampMapping ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Chip label={`Mapping: ${timestampMapping.mappedName}`} sx={{ mr: 1 }} />
              <Chip label={`Source: ${timestampMapping.sourceType}`} />
            </Box>
            <Autocomplete
              options={timestampFormatOptions}
              freeSolo
              value={timestampForm.inputFormat}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputFormat: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputFormat: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Input Format"
                  helperText="Format of the incoming timestamp (e.g., ISO8601, UNIX_MS)"
                />
              )}
            />
            <Autocomplete
              options={timezoneOptions}
              freeSolo
              value={timestampForm.inputTimezone}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputTimezone: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputTimezone: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Input Timezone"
                  helperText="Timezone of the incoming timestamp (e.g., UTC+0)"
                />
              )}
            />
            <Autocomplete
              options={timestampFormatOptions}
              freeSolo
              value={timestampForm.outputFormat}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputFormat: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputFormat: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Output Format"
                  helperText="Format for the output timestamp"
                />
              )}
            />
            <Autocomplete
              options={timezoneOptions}
              freeSolo
              value={timestampForm.outputTimezone}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputTimezone: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputTimezone: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Output Timezone"
                  helperText="Timezone for the output timestamp"
                />
              )}
            />
            <TextField
              label="Store Interval (seconds)"
              type="number"
              value={timestampInterval}
              onChange={(e) => {
                const value = Number(e.target.value);
                setTimestampInterval(Number.isFinite(value) && value > 0 ? Math.floor(value) : 1);
              }}
              helperText="How often the system timestamp is saved to historical data"
            />
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="textSecondary">
                Common placeholders when formatting:
              </Typography>
              <Typography variant="body2" color="textSecondary">
                <code>UNIX_MS</code>, <code>ISO8601</code>, <code>YYYY-MM-DD HH:mm:ss</code>, <code>UTC+7</code>, etc.
              </Typography>
            </Box>
            <Box display="flex" justifyContent="flex-end">
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveTimestamp}
                disabled={timestampSaving}
              >
                {timestampSaving ? 'Saving...' : 'Save Timestamp Format'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Alert severity="info">
            No system timestamp mapping found. Create one under Parameter Mappings to manage its format here.
          </Alert>
        )}
      </Paper>
    </Box>
  );
};

export default Settings;
