import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Typography,
  TextField,
  Switch,
  FormControlLabel,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Chip,
  Tabs,
  Tab,
  Grid,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Send as SendIcon,
  CloudUpload as CloudUploadIcon,
} from '@mui/icons-material';
import api from '../api/client';

interface SparingConfig {
  id: string;
  loggerId: string;
  apiSecret?: string;
  apiSecretFetchedAt?: number;
  enabled: boolean;
  sendMode: 'hourly' | '2min' | 'both';
  lastHourlySend?: number;
  createdAt: number;
  updatedAt: number;
}

interface SparingMapping {
  id: string;
  mappingId: string;
  sparingParam: string;
  enabled: boolean;
  createdAt: number;
}

interface SparingLog {
  id: string;
  sendType: 'hourly' | '2min' | 'testing';
  hourTimestamp?: number;
  recordsCount: number;
  status: 'success' | 'failed';
  response?: string;
  durationMs?: number;
  timestamp: number;
}

const SparingConfig: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [config, setConfig] = useState<SparingConfig | null>(null);
  const [mappings, setMappings] = useState<SparingMapping[]>([]);
  const [availableMappings, setAvailableMappings] = useState<any[]>([]);
  const [logs, setLogs] = useState<SparingLog[]>([]);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fetchingSecret, setFetchingSecret] = useState(false);
  const [openMappingDialog, setOpenMappingDialog] = useState(false);
  const [newSparingParam, setNewSparingParam] = useState('');
  const [newMappingId, setNewMappingId] = useState('');
  const [exportLogDate, setExportLogDate] = useState<string>('');
  const [status, setStatus] = useState<{ enabled: boolean; sendMode: string; queueDepth: number; lastHourlySend?: number | null; last2MinSend?: number | null; nextRuns?: any }>({ enabled: false, sendMode: 'hourly', queueDepth: 0 });

  useEffect(() => {
    loadConfig();
    loadMappings();
    loadAvailableMappings();
    loadLogs();
    loadQueueItems();
    // Load status immediately and then poll
    loadStatus();
    const interval = setInterval(() => {
      loadLogs();
      loadQueueItems();
      loadStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadConfig = async () => {
    try {
      const data = await api.sparing?.getConfig();
      if (data) {
        setConfig(data);
      } else {
        // Initialize a local editable config so fields are not locked
        const now = Date.now();
        setConfig({
          // Temporary values for client-side editing; backend will upsert real row
          id: 'temp',
          loggerId: '',
          enabled: false,
          sendMode: 'hourly',
          createdAt: now,
          updatedAt: now,
        } as any);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load configuration');
    }
  };

  const loadMappings = async () => {
    try {
      const data = await api.sparing?.getMappings();
      setMappings(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mappings');
    }
  };

  const loadAvailableMappings = async () => {
    try {
      const data = await api.mappings?.list();
      setAvailableMappings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load available mappings:', err);
    }
  };

  const loadLogs = async () => {
    try {
      const data = await api.sparing?.getLogs(50);
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  };

  const loadQueueItems = async () => {
    try {
      const data = await api.sparing?.getQueueItems(100);
      setQueueItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load queue items:', err);
    }
  };

  const loadStatus = async () => {
    try {
      const s = await api.sparing?.getStatus();
      setStatus(s || { enabled: false, sendMode: 'hourly', queueDepth: 0 });
    } catch (err) {
      console.error('Failed to load status:', err);
    }
  };

  const handleUpdateConfig = async (updates: Partial<SparingConfig>) => {
    try {
      setError('');
      setSuccess('');
      setLoading(true);

      const updated = await api.sparing?.updateConfig({
        ...config,
        ...updates,
      });

      setConfig(updated);
      setSuccess('Configuration updated successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchSecret = async () => {
    try {
      setFetchingSecret(true);
      setError('');
      setSuccess('');

      if (!config?.loggerId) {
        setError('Please enter Logger ID first');
        return;
      }

      const secret = await api.sparing?.fetchApiSecret();
      await handleUpdateConfig({ apiSecret: secret });
      setSuccess('API Secret fetched successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch API secret');
    } finally {
      setFetchingSecret(false);
    }
  };

  const handleAddMapping = async () => {
    try {
      setError('');
      if (!newSparingParam || !newMappingId) {
        setError('Please fill in all fields');
        return;
      }

      await api.sparing?.upsertMapping(newSparingParam, newMappingId);
      await loadMappings();
      setOpenMappingDialog(false);
      setNewSparingParam('');
      setNewMappingId('');
      setSuccess('Mapping added successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to add mapping');
    }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this mapping?')) return;

    try {
      await api.sparing?.deleteMapping(id);
      await loadMappings();
      setSuccess('Mapping deleted successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete mapping');
    }
  };

  const handleProcessQueue = async () => {
    try {
      setLoading(true);
      setError('');
      await api.sparing?.processQueue();
      setSuccess('Queue processed');
      setTimeout(() => setSuccess(''), 3000);
      await loadLogs();
    } catch (err: any) {
      setError(err.message || 'Failed to process queue');
    } finally {
      setLoading(false);
    }
  };

  const handleSendNow = async () => {
    try {
      setLoading(true);
      setError('');
      await api.sparing?.sendNow();
      setSuccess('Data sent successfully');
      setTimeout(() => setSuccess(''), 3000);
      await loadLogs();
    } catch (err: any) {
      setError(err.message || 'Failed to send data');
    } finally {
      setLoading(false);
    }
  };

  const handleExportSparingLog = async () => {
    try {
      setError('');
      const dateParam = exportLogDate.trim() || undefined;
      const result = await api.sparing?.exportLog(dateParam);
      if (!result?.content) {
        setSuccess(dateParam ? `No SPARING log file for ${dateParam}.` : 'No SPARING log file to export yet. Logs are created when data is sent.');
        setTimeout(() => setSuccess(''), 4000);
        return;
      }
      const blob = new Blob([result.content || ''], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename || 'sparing-logs-export.jsonl';
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(dateParam ? `Exported log for ${dateParam}` : 'SPARING log exported');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to export SPARING log');
    }
  };

  const getMappingName = (mappingId: string) => {
    const mapping = availableMappings.find((m) => m.id === mappingId);
    return mapping?.name || mappingId;
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        SPARING Configuration
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        Configure data transmission to SPARING server
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

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 3 }}>
        <Tab label="Configuration" />
        <Tab label="Parameter Mappings" />
        <Tab label="Send Logs" />
        <Tab label="Queue" />
      </Tabs>

      {tabValue === 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            SPARING Settings
          </Typography>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Logger ID"
                value={config?.loggerId || ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...(prev || ({
                      id: 'temp',
                      loggerId: '',
                      enabled: false,
                      sendMode: 'hourly',
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    } as any)),
                    loggerId: e.target.value,
                  }))
                }
                fullWidth
                required
                onBlur={() => {
                  handleUpdateConfig({ loggerId: (config?.loggerId || '') });
                }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="API Secret"
                value={config?.apiSecret ? '••••••••' : ''}
                fullWidth
                disabled
                helperText="Fetch from SPARING server"
                InputProps={{
                  endAdornment: (
                    <Button
                      variant="outlined"
                      onClick={handleFetchSecret}
                      disabled={fetchingSecret || !config?.loggerId}
                      startIcon={fetchingSecret ? <CircularProgress size={20} /> : <RefreshIcon />}
                    >
                      {fetchingSecret ? 'Fetching...' : 'Fetch Secret'}
                    </Button>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="API Base URL"
                value={config?.apiBase || ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...(prev || ({
                      id: 'temp',
                      loggerId: '',
                      enabled: false,
                      sendMode: 'hourly',
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    } as any)),
                    apiBase: e.target.value,
                  }))
                }
                onBlur={() => {
                  const val = (config?.apiBase || '').trim();
                  handleUpdateConfig({ apiBase: val });
                }}
                placeholder="https://sparing.kemenlh.go.id/api"
                fullWidth
                helperText="Override SPARING API base (leave empty to use default)"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Secret URL (optional)"
                value={config?.apiSecretUrl || ''}
                onChange={(e) =>
                  setConfig((prev) => ({ ...(prev as any), apiSecretUrl: e.target.value }))}
                onBlur={() => handleUpdateConfig({ apiSecretUrl: (config?.apiSecretUrl || '').trim() })}
                placeholder="https://.../secret-sensor"
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Testing URL (optional)"
                value={config?.apiTestingUrl || ''}
                onChange={(e) =>
                  setConfig((prev) => ({ ...(prev as any), apiTestingUrl: e.target.value }))}
                onBlur={() => handleUpdateConfig({ apiTestingUrl: (config?.apiTestingUrl || '').trim() })}
                placeholder="https://.../testing"
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Send Hourly URL (optional)"
                value={config?.apiSendHourlyUrl || ''}
                onChange={(e) =>
                  setConfig((prev) => ({ ...(prev as any), apiSendHourlyUrl: e.target.value }))}
                onBlur={() => handleUpdateConfig({ apiSendHourlyUrl: (config?.apiSendHourlyUrl || '').trim() })}
                placeholder="https://.../send-hourly"
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Send 2-min URL (optional)"
                value={config?.apiSend2MinUrl || ''}
                onChange={(e) =>
                  setConfig((prev) => ({ ...(prev as any), apiSend2MinUrl: e.target.value }))}
                onBlur={() => handleUpdateConfig({ apiSend2MinUrl: (config?.apiSend2MinUrl || '').trim() })}
                placeholder="https://.../send"
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Send Mode"
                select
                value={config?.sendMode || 'hourly'}
                onChange={(e) => {
                  if (config) {
                    handleUpdateConfig({
                      sendMode: e.target.value as 'hourly' | '2min' | 'both',
                    });
                  }
                }}
                fullWidth
              >
                <MenuItem value="hourly">Hourly</MenuItem>
                <MenuItem value="2min">2 Minutes</MenuItem>
                <MenuItem value="both">Both</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={config?.enabled || false}
                    onChange={(e) => {
                      if (config) {
                        handleUpdateConfig({ enabled: e.target.checked });
                      }
                    }}
                    disabled={loading}
                  />
                }
                label="Enabled"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Max Retry Attempts"
                type="number"
                value={config?.retryMaxAttempts || 5}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 5;
                  setConfig((prev) =>
                    prev
                      ? { ...prev, retryMaxAttempts: val }
                      : ({
                          id: 'temp',
                          loggerId: '',
                          enabled: false,
                          sendMode: 'hourly',
                          retryMaxAttempts: val,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        } as any)
                  );
                }}
                onBlur={() => {
                  if (config) {
                    handleUpdateConfig({ retryMaxAttempts: config.retryMaxAttempts || 5 });
                  }
                }}
                inputProps={{ min: 1, max: 100 }}
                fullWidth
                helperText="Maximum number of retry attempts for failed sends (default: 5)"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Retry Interval (minutes)"
                type="number"
                value={config?.retryIntervalMinutes || 5}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 5;
                  setConfig((prev) =>
                    prev
                      ? { ...prev, retryIntervalMinutes: val }
                      : ({
                          id: 'temp',
                          loggerId: '',
                          enabled: false,
                          sendMode: 'hourly',
                          retryIntervalMinutes: val,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        } as any)
                  );
                }}
                onBlur={() => {
                  if (config) {
                    handleUpdateConfig({ retryIntervalMinutes: config.retryIntervalMinutes || 5 });
                  }
                }}
                inputProps={{ min: 1, max: 1440 }}
                fullWidth
                helperText="Interval between retry attempts in minutes (default: 5)"
              />
            </Grid>
            {config?.apiSecretFetchedAt && (
              <Grid item xs={12}>
                <Typography variant="body2" color="textSecondary">
                  API Secret fetched at:{' '}
                  {new Date(config.apiSecretFetchedAt).toLocaleString()}
                </Typography>
              </Grid>
            )}
            <Grid item xs={12}>
              <Typography variant="body2" color="textSecondary">
                Queue depth: {status.queueDepth}
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="body2" color="textSecondary">
                Last hourly send:{' '}
                {status?.lastHourlySend ? new Date(status.lastHourlySend).toLocaleString() : '-'}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Next hourly run:{' '}
                {status?.nextRuns?.hourly ? new Date(status.nextRuns.hourly).toLocaleString() : '-'}
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="body2" color="textSecondary">
                Last 2-min send:{' '}
                {status?.last2MinSend ? new Date(status.last2MinSend).toLocaleString() : '-'}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Next 2-min run:{' '}
                {status?.nextRuns?.twoMin ? new Date(status.nextRuns.twoMin).toLocaleString() : '-'}
              </Typography>
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              onClick={handleSendNow}
              disabled={loading || !config?.enabled}
            >
              Send Now (Test)
            </Button>
            <Button
              variant="outlined"
              onClick={handleProcessQueue}
              disabled={loading}
            >
              Process Queue
            </Button>
          </Box>
        </Paper>
      )}

      {tabValue === 1 && (
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h6">Parameter Mappings</Typography>
            <Button
              variant="contained"
              startIcon={<CloudUploadIcon />}
              onClick={() => setOpenMappingDialog(true)}
            >
              Add Mapping
            </Button>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>SPARING Parameter</TableCell>
                  <TableCell>Parameter Mapping</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell>{mapping.sparingParam}</TableCell>
                    <TableCell>{getMappingName(mapping.mappingId)}</TableCell>
                    <TableCell>
                      <Chip
                        label={mapping.enabled ? 'Enabled' : 'Disabled'}
                        color={mapping.enabled ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteMapping(mapping.id)}
                        color="error"
                        aria-label={`Remove sparing mapping ${mapping.sparingParam}`}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {mappings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      No mappings found. Click "Add Mapping" to create one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {tabValue === 2 && (
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
            <Typography variant="h6">
              Send Logs
            </Typography>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <TextField
                label="Export date"
                type="date"
                value={exportLogDate}
                onChange={(e) => setExportLogDate(e.target.value)}
                size="small"
                sx={{ width: 180 }}
                InputLabelProps={{ shrink: true }}
                helperText={exportLogDate ? 'Export this day only' : 'Leave empty = all days'}
              />
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleExportSparingLog}
              >
                Export SPARING log (JSONL)
              </Button>
            </Box>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Log file includes send_type, hour_timestamp, records_count, status, response, duration_ms, timestamp, json payload, and token. One JSON object per line.
          </Typography>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Timestamp</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Records</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Duration (ms)</TableCell>
                  <TableCell>Response</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      {new Date(log.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>{log.sendType}</TableCell>
                    <TableCell>{log.recordsCount}</TableCell>
                    <TableCell>
                      <Chip
                        label={log.status.toUpperCase()}
                        color={log.status === 'success' ? 'success' : 'error'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{log.durationMs || '-'}</TableCell>
                    <TableCell>
                      {log.response ? (
                        <Typography variant="body2" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {log.response}
                        </Typography>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No logs found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {tabValue === 3 && (
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h6">Queue Items</Typography>
            <Button variant="outlined" onClick={async () => {
              try {
                await api.sparing?.processQueue();
                await loadQueueItems();
                setSuccess('Queue processed');
                setTimeout(() => setSuccess(''), 3000);
              } catch (err: any) {
                setError(err.message || 'Failed to process queue');
              }
            }}>
              Process Queue Now
            </Button>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Created At</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Hour/Slot Timestamp</TableCell>
                  <TableCell>Records</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Retry Count</TableCell>
                  <TableCell>Last Attempt</TableCell>
                  <TableCell>Error Message</TableCell>
                  <TableCell>Sent At</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {queueItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {new Date(item.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{item.sendType}</TableCell>
                    <TableCell>
                      {item.hourTimestamp ? new Date(item.hourTimestamp).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>{item.recordsCount}</TableCell>
                    <TableCell>
                      <Chip
                        label={item.status.toUpperCase()}
                        color={
                          item.status === 'sent' ? 'success' :
                          item.status === 'failed' ? 'error' :
                          item.status === 'sending' ? 'warning' :
                          'default'
                        }
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{item.retryCount}</TableCell>
                    <TableCell>
                      {item.lastAttemptAt ? new Date(item.lastAttemptAt).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>
                      {item.errorMessage ? (
                        <Typography variant="body2" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.errorMessage}>
                          {item.errorMessage}
                        </Typography>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {item.sentAt ? new Date(item.sentAt).toLocaleString() : '-'}
                    </TableCell>
                  </TableRow>
                ))}
                {queueItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      No queue items found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Dialog open={openMappingDialog} onClose={() => setOpenMappingDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add SPARING Parameter Mapping</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="SPARING Parameter"
              value={newSparingParam}
              onChange={(e) => setNewSparingParam(e.target.value)}
              fullWidth
              required
              placeholder="e.g., suhu, kelembaban, tekanan"
            />
            <TextField
              label="Parameter Mapping"
              select
              value={newMappingId}
              onChange={(e) => setNewMappingId(e.target.value)}
              fullWidth
              required
            >
              {availableMappings.map((mapping) => (
                <MenuItem key={mapping.id} value={mapping.id}>
                  {mapping.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenMappingDialog(false)}>Cancel</Button>
          <Button onClick={handleAddMapping} variant="contained">
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SparingConfig;