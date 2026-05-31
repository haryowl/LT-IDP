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
  CircularProgress,
} from '@mui/material';
import { Delete as DeleteIcon, Refresh as RefreshIcon, Send as SendIcon } from '@mui/icons-material';
import api from '../api/client';

const TMAT_PARAMS = [
  { value: 'tmat_value', label: 'tmat_value — Tinggi Muka Air Tanah' },
  { value: 'hujan_value', label: 'hujan_value — Curah hujan' },
  { value: 'kelembapan_tanah', label: 'kelembapan_tanah — Kelembapan tanah' },
  { value: 'suhu_value', label: 'suhu_value — Suhu' },
  { value: 'ph_value', label: 'ph_value — pH air' },
  { value: 'baterai_value', label: 'baterai_value — Level baterai' },
  { value: 'tss_value', label: 'tss_value — Total Suspended Solids' },
];

interface TmatConfig {
  id: string;
  deviceIdUnik: string;
  apiKey?: string;
  apiUrl?: string;
  enabled: boolean;
  pushIntervalSeconds: number;
  lastSend?: number;
  retryMaxAttempts?: number;
  retryIntervalMinutes?: number;
  createdAt: number;
  updatedAt: number;
}

interface TmatMapping {
  id: string;
  mappingId: string;
  tmatParam: string;
  enabled: boolean;
  createdAt: number;
}

interface TmatLog {
  id: string;
  status: 'success' | 'failed';
  response?: string;
  durationMs?: number;
  timestamp: number;
}

const DEFAULT_API_URL =
  'https://gambutindonesia.kemenlh.go.id/backoffice-SPAgambut/api/v1/realtime_push';

const TmatConfigPage: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [config, setConfig] = useState<TmatConfig | null>(null);
  const [mappings, setMappings] = useState<TmatMapping[]>([]);
  const [availableMappings, setAvailableMappings] = useState<any[]>([]);
  const [logs, setLogs] = useState<TmatLog[]>([]);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [openMappingDialog, setOpenMappingDialog] = useState(false);
  const [newTmatParam, setNewTmatParam] = useState('tmat_value');
  const [newMappingId, setNewMappingId] = useState('');
  const [status, setStatus] = useState<any>({});

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => {
      loadLogs();
      loadQueueItems();
      loadStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadAll = () => {
    loadConfig();
    loadMappings();
    loadAvailableMappings();
    loadLogs();
    loadQueueItems();
    loadStatus();
  };

  const loadConfig = async () => {
    try {
      const data = await api.tmat?.getConfig();
      if (data) {
        setConfig(data);
      } else {
        const now = Date.now();
        setConfig({
          id: 'temp',
          deviceIdUnik: '',
          enabled: false,
          pushIntervalSeconds: 60,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load configuration');
    }
  };

  const loadMappings = async () => {
    try {
      const data = await api.tmat?.getMappings();
      setMappings(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mappings');
    }
  };

  const loadAvailableMappings = async () => {
    try {
      const data = await api.mappings?.list();
      setAvailableMappings(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    }
  };

  const loadLogs = async () => {
    try {
      const data = await api.tmat?.getLogs(50);
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    }
  };

  const loadQueueItems = async () => {
    try {
      const data = await api.tmat?.getQueueItems(50);
      setQueueItems(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    }
  };

  const loadStatus = async () => {
    try {
      const data = await api.tmat?.getStatus();
      setStatus(data || {});
    } catch {
      /* ignore */
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const saved = await api.tmat?.updateConfig(config);
      setConfig(saved);
      setSuccess('Configuration saved');
      loadStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMapping = async () => {
    if (!newTmatParam || !newMappingId) return;
    setLoading(true);
    setError('');
    try {
      await api.tmat?.upsertMapping(newTmatParam, newMappingId);
      setOpenMappingDialog(false);
      setNewTmatParam('tmat_value');
      setNewMappingId('');
      await loadMappings();
      setSuccess('Mapping added');
    } catch (err: any) {
      setError(err.message || 'Failed to add mapping');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!window.confirm('Delete this mapping?')) return;
    try {
      await api.tmat?.deleteMapping(id);
      await loadMappings();
    } catch (err: any) {
      setError(err.message || 'Failed to delete mapping');
    }
  };

  const handleSendNow = async () => {
    setLoading(true);
    setError('');
    try {
      await api.tmat?.sendNow();
      setSuccess('TMAT push sent');
      loadLogs();
      loadStatus();
    } catch (err: any) {
      setError(err.message || 'Send failed');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessQueue = async () => {
    setLoading(true);
    try {
      await api.tmat?.processQueue();
      setSuccess('Queue processed');
      loadQueueItems();
      loadLogs();
    } catch (err: any) {
      setError(err.message || 'Queue processing failed');
    } finally {
      setLoading(false);
    }
  };

  const mappingName = (id: string) => availableMappings.find((m) => m.id === id)?.mappedName || id;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        TMAT — KLH Monitoring API
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        Sends sensor data to KLH TMAT server via{' '}
        <code>realtime_push</code> (API Protocol v1.2). Auth: header <code>X-API-KEY</code> + body{' '}
        <code>device_id_unik</code>. Format: <code>application/x-www-form-urlencoded</code>.
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

      <Paper sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip label={status.enabled ? 'Enabled' : 'Disabled'} color={status.enabled ? 'success' : 'default'} />
          <Chip label={`Queue: ${status.queueDepth ?? 0}`} />
          <Chip label={`Interval: ${status.pushIntervalSeconds ?? 60}s`} />
          {status.lastSend && (
            <Chip label={`Last send: ${new Date(status.lastSend).toLocaleString()}`} size="small" />
          )}
          <Button startIcon={<RefreshIcon />} onClick={loadAll} size="small">
            Refresh
          </Button>
          <Button startIcon={<SendIcon />} variant="contained" onClick={handleSendNow} disabled={loading}>
            Send Now
          </Button>
        </Box>
      </Paper>

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 2 }}>
        <Tab label="Configuration" />
        <Tab label="Parameter Mappings" />
        <Tab label="Send Logs" />
        <Tab label="Retry Queue" />
      </Tabs>

      {tabValue === 0 && config && (
        <Paper sx={{ p: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              />
            }
            label="Enable TMAT push"
          />
          <TextField
            label="Device ID (device_id_unik)"
            value={config.deviceIdUnik}
            onChange={(e) => setConfig({ ...config, deviceIdUnik: e.target.value })}
            fullWidth
            sx={{ mt: 2 }}
            placeholder="TMAT-001"
            helperText="Registered logger device ID from KLH"
          />
          <TextField
            label="X-API-KEY"
            value={config.apiKey || ''}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            fullWidth
            sx={{ mt: 2 }}
            type="password"
          />
          <TextField
            label="API URL"
            value={config.apiUrl || DEFAULT_API_URL}
            onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
            fullWidth
            sx={{ mt: 2 }}
            helperText="Default: gambutindonesia.kemenlh.go.id …/realtime_push"
          />
          <TextField
            label="Push interval (seconds)"
            type="number"
            value={config.pushIntervalSeconds}
            onChange={(e) =>
              setConfig({ ...config, pushIntervalSeconds: parseInt(e.target.value) || 60 })
            }
            fullWidth
            sx={{ mt: 2 }}
            helperText="How often to POST latest mapped values (realtime_push)"
          />
          <TextField
            label="Max retry attempts"
            type="number"
            value={config.retryMaxAttempts ?? 5}
            onChange={(e) =>
              setConfig({ ...config, retryMaxAttempts: parseInt(e.target.value) || 5 })
            }
            fullWidth
            sx={{ mt: 2 }}
          />
          <TextField
            label="Retry queue check (minutes)"
            type="number"
            value={config.retryIntervalMinutes ?? 5}
            onChange={(e) =>
              setConfig({ ...config, retryIntervalMinutes: parseInt(e.target.value) || 5 })
            }
            fullWidth
            sx={{ mt: 2 }}
          />
          <Button variant="contained" sx={{ mt: 3 }} onClick={handleSaveConfig} disabled={loading}>
            {loading ? <CircularProgress size={24} /> : 'Save Configuration'}
          </Button>
        </Paper>
      )}

      {tabValue === 1 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6">TMAT field → Parameter mapping</Typography>
            <Button variant="contained" onClick={() => setOpenMappingDialog(true)}>
              Add mapping
            </Button>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>TMAT parameter</TableCell>
                  <TableCell>Parameter mapping</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mappings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <code>{m.tmatParam}</code>
                    </TableCell>
                    <TableCell>{mappingName(m.mappingId)}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" color="error" onClick={() => handleDeleteMapping(m.id)}>
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {mappings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      No mappings — add at least one TMAT field
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {tabValue === 2 && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Response</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{new Date(log.timestamp).toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip size="small" label={log.status} color={log.status === 'success' ? 'success' : 'error'} />
                  </TableCell>
                  <TableCell>{log.durationMs != null ? `${log.durationMs} ms` : '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log.response?.substring(0, 200)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tabValue === 3 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ mb: 2 }}>
            <Button variant="outlined" onClick={handleProcessQueue} disabled={loading}>
              Process queue now
            </Button>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Created</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Retries</TableCell>
                  <TableCell>Error</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {queueItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{item.status}</TableCell>
                    <TableCell>{item.retryCount}</TableCell>
                    <TableCell>{item.errorMessage || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Dialog open={openMappingDialog} onClose={() => setOpenMappingDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add TMAT parameter mapping</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="TMAT body field"
            value={newTmatParam}
            onChange={(e) => setNewTmatParam(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          >
            {TMAT_PARAMS.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Parameter mapping"
            value={newMappingId}
            onChange={(e) => setNewMappingId(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
          >
            {availableMappings.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.mappedName}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenMappingDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddMapping} disabled={loading}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TmatConfigPage;
