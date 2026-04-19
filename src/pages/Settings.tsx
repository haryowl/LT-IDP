import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
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

function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
          <Typography variant="h6">System health</Typography>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <FormControlLabel
              control={<Switch checked={sysAutoRefresh} onChange={(e) => setSysAutoRefresh(e.target.checked)} size="small" />}
              label="Auto-refresh (30s)"
            />
            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={loadSystemInfo} disabled={sysLoading}>
              Refresh
            </Button>
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Memory and disk reflect this machine. Disk usage is for the filesystem that contains the application data directory (database and exports).
        </Typography>
        {sysLoading && !systemInfo ? (
          <LinearProgress />
        ) : systemInfo ? (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" color="text.secondary">
                Host &amp; OS
              </Typography>
              <Typography variant="body2">
                <strong>{systemInfo.hostname}</strong> · {systemInfo.platform} {systemInfo.osRelease} ({systemInfo.arch})
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {systemInfo.osType} · Node {systemInfo.nodeVersion}
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" color="text.secondary">
                Uptime
              </Typography>
              <Typography variant="body2">App process: {formatDuration(systemInfo.processUptimeSeconds)}</Typography>
              <Typography variant="body2">System: {formatDuration(systemInfo.systemUptimeSeconds)}</Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" color="text.secondary">
                CPU
              </Typography>
              <Typography variant="body2">{systemInfo.cpuCount} logical cores</Typography>
              {systemInfo.loadAverage && (
                <Typography variant="body2">
                  Load (1 / 5 / 15 min): {systemInfo.loadAverage.map((n) => n.toFixed(2)).join(' · ')}
                </Typography>
              )}
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" color="text.secondary">
                Memory
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, systemInfo.memory.usedPercent)}
                  sx={{ flex: 1, height: 8, borderRadius: 1 }}
                />
                <Typography variant="caption" sx={{ minWidth: 42 }}>
                  {systemInfo.memory.usedPercent.toFixed(0)}%
                </Typography>
              </Box>
              <Typography variant="body2">
                {formatBytes(systemInfo.memory.usedBytes)} used · {formatBytes(systemInfo.memory.freeBytes)} free ·{' '}
                {formatBytes(systemInfo.memory.totalBytes)} total
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="text.secondary">
                Data volume (filesystem)
              </Typography>
              {systemInfo.disk.error ? (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {systemInfo.disk.error}
                </Alert>
              ) : systemInfo.disk.totalBytes != null && systemInfo.disk.usedPercent != null ? (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                    {systemInfo.disk.path}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, mt: 0.5 }}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, systemInfo.disk.usedPercent)}
                      sx={{ flex: 1, height: 8, borderRadius: 1 }}
                    />
                    <Typography variant="caption" sx={{ minWidth: 42 }}>
                      {systemInfo.disk.usedPercent.toFixed(0)}%
                    </Typography>
                  </Box>
                  <Typography variant="body2">
                    {formatBytes(systemInfo.disk.usedBytes!)} used · {formatBytes(systemInfo.disk.freeBytes!)} available ·{' '}
                    {formatBytes(systemInfo.disk.totalBytes)} total
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Disk stats unavailable
                </Typography>
              )}
            </Grid>
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Last updated: {new Date(systemInfo.collectedAt).toLocaleString()}
              </Typography>
            </Grid>
          </Grid>
        ) : (
          <Typography color="text.secondary">Could not load system information.</Typography>
        )}
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
