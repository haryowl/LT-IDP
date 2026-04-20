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
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import LanOutlinedIcon from '@mui/icons-material/LanOutlined';
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined';
import LoopOutlinedIcon from '@mui/icons-material/LoopOutlined';
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
    };
    interfaces: Array<{
      name: string;
      mac: string | null;
      portKind: 'ethernet' | 'wireless' | 'loopback' | 'other';
      ipv4: string[];
      ipv6: string[];
      inUse: boolean;
    }>;
  };
}

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

function usageTone(percent: number): 'success' | 'warning' | 'error' {
  if (percent >= 90) return 'error';
  if (percent >= 75) return 'warning';
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
        p: { xs: 2, sm: 3 },
        mb: 3,
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

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar
            sx={{
              width: 44,
              height: 44,
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
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>
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

      <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 2.5, py: 0.5, borderRadius: 2, bgcolor: alpha(theme.palette.info.main, 0.06), border: '1px solid', borderColor: alpha(theme.palette.info.main, 0.12) }}>
        <Typography variant="body2">
          Memory and CPU reflect this machine. <strong>Data volume</strong> shows the filesystem that holds your app data (database and exports).
        </Typography>
      </Alert>

      {sysLoading && !systemInfo ? (
        <Box sx={{ py: 4 }}>
          <LinearProgress sx={{ borderRadius: 2, height: 8 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
            Loading system metrics…
          </Typography>
        </Box>
      ) : systemInfo ? (
        <Stack spacing={2.5}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', borderRadius: 2, borderColor: alpha(theme.palette.divider, 0.12) }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', width: 48, height: 48 }}>
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
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <Avatar sx={{ bgcolor: alpha(theme.palette.secondary.main, 0.15), color: 'secondary.main', width: 48, height: 48 }}>
                      <AccessTimeOutlinedIcon />
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
                        Uptime
                      </Typography>
                      <Grid container spacing={2} sx={{ mt: 0.5 }}>
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
                      <Divider sx={{ my: 2 }} />
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
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar sx={{ bgcolor: alpha(theme.palette.info.main, 0.14), color: 'info.dark', width: 44, height: 44 }}>
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
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                <HubOutlinedIcon color="action" />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Network interfaces
                </Typography>
              </Stack>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={4}>
                  <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), height: '100%' }}>
                    <CardContent sx={{ py: 1.75, px: 2 }}>
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
                <Grid item xs={12} sm={4}>
                  <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), height: '100%' }}>
                    <CardContent sx={{ py: 1.75, px: 2 }}>
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
                <Grid item xs={12} sm={4}>
                  <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), height: '100%' }}>
                    <CardContent sx={{ py: 1.75, px: 2 }}>
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
              </Grid>

              <Stack spacing={1.25}>
                {sortedIfaces.map((iface) => (
                  <Card
                    key={iface.name}
                    variant="outlined"
                    sx={{
                      borderRadius: 2,
                      borderColor: iface.inUse ? alpha(theme.palette.success.main, 0.35) : alpha(theme.palette.divider, 0.12),
                      bgcolor: iface.inUse ? alpha(theme.palette.success.main, 0.03) : alpha(theme.palette.action.hover, 0.04),
                    }}
                  >
                    <CardContent sx={{ py: 2, px: 2.25, '&:last-child': { pb: 2 } }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Avatar sx={{ width: 40, height: 40, bgcolor: alpha(theme.palette.text.primary, 0.07) }}>{ifaceKindIcon(iface.portKind)}</Avatar>
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
                      <Stack spacing={0.75} sx={{ mt: 2, pl: { sm: 6.5 } }}>
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
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
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

  useEffect(() => {
    loadSettings();
    loadTimestampMapping();
    loadSystemInfo();
    if (role === 'admin') loadReadOnlyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  useEffect(() => {
    if (!sysAutoRefresh) return;
    const id = window.setInterval(() => loadSystemInfo(), 30000);
    return () => window.clearInterval(id);
  }, [sysAutoRefresh, loadSystemInfo]);

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

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          System Identification
        </Typography>
        <Divider sx={{ mb: 3 }} />
        <Grid container spacing={3}>
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
        <Box sx={{ mt: 3 }}>
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
