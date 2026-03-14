import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Radio,
  RadioGroup,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PlayArrow as PlayIcon,
} from '@mui/icons-material';
import api from '../api/client';

interface ThresholdWatchItem {
  mappingId: string;
  min?: number;
  max?: number;
  staleSeconds?: number;
}

interface ThresholdWatchedDevice {
  deviceId: string;
  type: 'modbus' | 'mqtt';
  disconnectedSeconds?: number;
}

interface ThresholdRule {
  id: string;
  name: string;
  enabled: boolean;
  httpUrl: string;
  httpMethod: 'POST' | 'PUT';
  httpHeaders?: Record<string, string>;
  useJwt?: boolean;
  jwtToken?: string;
  jwtHeader?: string;
  jsonFormat?: 'simple' | 'custom';
  customJsonTemplate?: string;
  watchedMappings: ThresholdWatchItem[];
  watchedDevices?: ThresholdWatchedDevice[];
  snapshotMappingIds: string[];
  cooldownSeconds?: number;
  reTriggerMode?: 'edge_only' | 'periodic_while_breach';
  reTriggerIntervalSeconds?: number;
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
}

const emptyWatch: ThresholdWatchItem = { mappingId: '' };

const ThresholdPublishRules: React.FC = () => {
  const [rules, setRules] = useState<ThresholdRule[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [modbusDevices, setModbusDevices] = useState<any[]>([]);
  const [mqttDevices, setMqttDevices] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ThresholdRule | null>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    enabled: true,
    httpUrl: '',
    httpMethod: 'POST' as 'POST' | 'PUT',
    httpHeaders: '',
    useJwt: false,
    jwtToken: '',
    jwtHeader: 'Authorization',
    jsonFormat: 'simple' as 'simple' | 'custom',
    customJsonTemplate: '',
    watchedMappings: [emptyWatch] as ThresholdWatchItem[],
    watchedDevices: [] as ThresholdWatchedDevice[],
    snapshotMappingIds: [] as string[],
    cooldownSeconds: 0,
    reTriggerMode: 'edge_only' as const,
    reTriggerIntervalSeconds: 60,
  });

  useEffect(() => {
    loadRules();
    loadMappings();
    loadDevices();
  }, []);

  const loadDevices = async () => {
    try {
      const [modbus, mqtt] = await Promise.all([
        api.modbus?.devices?.list?.() ?? Promise.resolve([]),
        api.mqtt?.devices?.list?.() ?? Promise.resolve([]),
      ]);
      setModbusDevices(Array.isArray(modbus) ? modbus : []);
      setMqttDevices(Array.isArray(mqtt) ? mqtt : []);
    } catch {
      setModbusDevices([]);
      setMqttDevices([]);
    }
  };

  const mappingLookup = useMemo(() => {
    const map = new Map<string, any>();
    mappings.forEach((mapping) => map.set(mapping.id, mapping));
    return map;
  }, [mappings]);

  const loadRules = async () => {
    try {
      const data = await api.thresholdRules?.list();
      setRules(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load threshold rules');
    }
  };

  const loadMappings = async () => {
    try {
      const data = await api.mappings?.list();
      setMappings(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mappings');
    }
  };

  const handleOpen = (rule?: ThresholdRule) => {
    if (rule) {
      setEditing(rule);
      setFormData({
        name: rule.name,
        enabled: rule.enabled,
        httpUrl: rule.httpUrl,
        httpMethod: rule.httpMethod || 'POST',
        httpHeaders: rule.httpHeaders ? JSON.stringify(rule.httpHeaders, null, 2) : '',
        useJwt: !!rule.useJwt,
        jwtToken: rule.jwtToken || '',
        jwtHeader: rule.jwtHeader || 'Authorization',
        jsonFormat: rule.jsonFormat || 'simple',
        customJsonTemplate: rule.customJsonTemplate || '',
        watchedMappings: rule.watchedMappings?.length ? rule.watchedMappings : [emptyWatch],
        watchedDevices: rule.watchedDevices ?? [],
        snapshotMappingIds: rule.snapshotMappingIds || [],
        cooldownSeconds: rule.cooldownSeconds || 0,
        reTriggerMode: rule.reTriggerMode || 'edge_only',
        reTriggerIntervalSeconds: rule.reTriggerIntervalSeconds ?? 60,
      });
    } else {
      setEditing(null);
      setFormData({
        name: '',
        enabled: true,
        httpUrl: '',
        httpMethod: 'POST',
        httpHeaders: '',
        useJwt: false,
        jwtToken: '',
        jwtHeader: 'Authorization',
        jsonFormat: 'simple',
        customJsonTemplate: '',
        watchedMappings: [emptyWatch],
        watchedDevices: [],
        snapshotMappingIds: [],
        cooldownSeconds: 0,
      });
    }
    setError('');
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditing(null);
  };

  const handleWatchChange = (index: number, patch: Partial<ThresholdWatchItem>) => {
    setFormData((prev) => ({
      ...prev,
      watchedMappings: prev.watchedMappings.map((watch, i) => (i === index ? { ...watch, ...patch } : watch)),
    }));
  };

  const handleAddWatch = () => {
    setFormData((prev) => ({
      ...prev,
      watchedMappings: [...prev.watchedMappings, { ...emptyWatch }],
    }));
  };

  const handleRemoveWatch = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      watchedMappings: prev.watchedMappings.filter((_, i) => i !== index).length
        ? prev.watchedMappings.filter((_, i) => i !== index)
        : [{ ...emptyWatch }],
    }));
  };

  const handleWatchedDeviceChange = (index: number, patch: Partial<ThresholdWatchedDevice>) => {
    setFormData((prev) => ({
      ...prev,
      watchedDevices: prev.watchedDevices.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }));
  };

  const handleAddWatchedDevice = () => {
    setFormData((prev) => ({
      ...prev,
      watchedDevices: [...prev.watchedDevices, { deviceId: '', type: 'modbus' }],
    }));
  };

  const handleRemoveWatchedDevice = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      watchedDevices: prev.watchedDevices.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async () => {
    try {
      setError('');
      const watchedMappings = formData.watchedMappings
        .filter((item) => item.mappingId)
        .map((item) => ({
          mappingId: item.mappingId,
          min: item.min === undefined || item.min === null || Number.isNaN(item.min) ? undefined : Number(item.min),
          max: item.max === undefined || item.max === null || Number.isNaN(item.max) ? undefined : Number(item.max),
          staleSeconds: item.staleSeconds !== undefined && item.staleSeconds !== null && !Number.isNaN(item.staleSeconds) && item.staleSeconds > 0 ? Number(item.staleSeconds) : undefined,
        }));

      const watchedDevices = (formData.watchedDevices ?? [])
        .filter((d) => d.deviceId && d.type)
        .map((d) => ({
          deviceId: d.deviceId,
          type: d.type as 'modbus' | 'mqtt',
          disconnectedSeconds: d.disconnectedSeconds !== undefined && d.disconnectedSeconds !== null && !Number.isNaN(d.disconnectedSeconds) && d.disconnectedSeconds >= 0 ? Number(d.disconnectedSeconds) : undefined,
        }));

      const hasValidWatch = watchedMappings.some((item) => item.min != null || item.max != null || (item.staleSeconds != null && item.staleSeconds > 0));
      if (!hasValidWatch && watchedDevices.length === 0) {
        setError('Add at least one watched mapping (with min/max or "no data for X seconds") or at least one watched device for connection alerts.');
        return;
      }
      if (watchedMappings.length > 0 && watchedMappings.some((item) => item.min == null && item.max == null && (item.staleSeconds == null || item.staleSeconds <= 0))) {
        setError('Each watched mapping must have min, max, and/or "Alert if no data for (seconds)".');
        return;
      }
      if (!formData.httpUrl.trim()) {
        setError('HTTP URL is required.');
        return;
      }

      let httpHeadersParsed: any = undefined;
      if (formData.httpHeaders.trim()) {
        try {
          httpHeadersParsed = JSON.parse(formData.httpHeaders);
        } catch {
          setError('HTTP headers must be valid JSON.');
          return;
        }
      }

      const payload = {
        ...formData,
        httpHeaders: httpHeadersParsed,
        watchedMappings,
        watchedDevices,
        reTriggerMode: formData.reTriggerMode || 'edge_only',
        reTriggerIntervalSeconds: formData.reTriggerMode === 'periodic_while_breach'
          ? Math.max(0, Number(formData.reTriggerIntervalSeconds) || 60)
          : undefined,
      };

      if (editing) {
        await api.thresholdRules?.update(editing.id, payload);
      } else {
        await api.thresholdRules?.create(payload);
      }
      await loadRules();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save threshold rule');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this threshold rule?')) return;
    try {
      await api.thresholdRules?.delete(id);
      await loadRules();
    } catch (err: any) {
      setError(err.message || 'Failed to delete threshold rule');
    }
  };

  const handleToggleEnabled = async (rule: ThresholdRule) => {
    try {
      await api.thresholdRules?.update(rule.id, { enabled: !rule.enabled });
      await loadRules();
    } catch (err: any) {
      setError(err.message || 'Failed to update rule');
    }
  };

  const handleTest = async (id: string) => {
    try {
      setError('');
      await api.thresholdRules?.test(id);
    } catch (err: any) {
      setError(err.message || 'Failed to test rule');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Threshold Publish Rules</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
          Add Rule
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>HTTP Endpoint</TableCell>
              <TableCell>Watched</TableCell>
              <TableCell>Snapshot</TableCell>
              <TableCell>Last Triggered</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{rule.name}</TableCell>
                <TableCell>{rule.httpMethod} {rule.httpUrl}</TableCell>
                <TableCell>{rule.watchedMappings.length}</TableCell>
                <TableCell>{rule.snapshotMappingIds.length}</TableCell>
                <TableCell>{rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).toLocaleString() : '-'}</TableCell>
                <TableCell>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={rule.enabled}
                        onChange={() => handleToggleEnabled(rule)}
                        size="small"
                      />
                    }
                    label={rule.enabled ? 'Enabled' : 'Disabled'}
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleTest(rule.id)} color="primary" aria-label={`Test ${rule.name}`}>
                    <PlayIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleOpen(rule)} aria-label={`Edit ${rule.name}`}>
                    <EditIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDelete(rule.id)} color="error" aria-label={`Delete ${rule.name}`}>
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  No threshold rules found. Click "Add Rule" to create one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Threshold Rule' : 'Add Threshold Rule'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
            />
            <FormControlLabel
              control={<Switch checked={formData.enabled} onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })} />}
              label="Enabled"
            />
            <TextField
              label="HTTP URL"
              value={formData.httpUrl}
              onChange={(e) => setFormData({ ...formData, httpUrl: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Method"
              select
              value={formData.httpMethod}
              onChange={(e) => setFormData({ ...formData, httpMethod: e.target.value as 'POST' | 'PUT' })}
              fullWidth
            >
              <MenuItem value="POST">POST</MenuItem>
              <MenuItem value="PUT">PUT</MenuItem>
            </TextField>
            <TextField
              label="Headers (JSON)"
              value={formData.httpHeaders}
              onChange={(e) => setFormData({ ...formData, httpHeaders: e.target.value })}
              fullWidth
              multiline
              rows={3}
              placeholder='{"Content-Type":"application/json"}'
            />
            <FormControlLabel
              control={<Switch checked={formData.useJwt} onChange={(e) => setFormData({ ...formData, useJwt: e.target.checked })} />}
              label="Use JWT"
            />
            {formData.useJwt && (
              <>
                <TextField label="JWT Token" value={formData.jwtToken} onChange={(e) => setFormData({ ...formData, jwtToken: e.target.value })} fullWidth />
                <TextField label="JWT Header Name" value={formData.jwtHeader} onChange={(e) => setFormData({ ...formData, jwtHeader: e.target.value })} fullWidth />
              </>
            )}

            <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="h6" gutterBottom>Watched Mappings and Thresholds</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Trigger when value is out of range and/or when no data received for X seconds (stale).
              </Typography>
              {formData.watchedMappings.map((watch, index) => (
                <Box key={index} sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'center' }}>
                  <TextField
                    label="Mapping"
                    select
                    value={watch.mappingId}
                    onChange={(e) => handleWatchChange(index, { mappingId: e.target.value })}
                    sx={{ minWidth: 180 }}
                  >
                    {mappings.map((mapping) => (
                      <MenuItem key={mapping.id} value={mapping.id}>
                        {mapping.mappedName || mapping.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Min"
                    type="number"
                    value={watch.min ?? ''}
                    onChange={(e) => handleWatchChange(index, { min: e.target.value === '' ? undefined : Number(e.target.value) })}
                    sx={{ width: 90 }}
                  />
                  <TextField
                    label="Max"
                    type="number"
                    value={watch.max ?? ''}
                    onChange={(e) => handleWatchChange(index, { max: e.target.value === '' ? undefined : Number(e.target.value) })}
                    sx={{ width: 90 }}
                  />
                  <TextField
                    label="No data for (sec)"
                    type="number"
                    placeholder="Optional"
                    value={watch.staleSeconds ?? ''}
                    onChange={(e) => handleWatchChange(index, { staleSeconds: e.target.value === '' ? undefined : Number(e.target.value) })}
                    sx={{ width: 120 }}
                    helperText="Alert if no update"
                  />
                  <IconButton color="error" onClick={() => handleRemoveWatch(index)} aria-label="Remove watched mapping">
                    <DeleteIcon />
                  </IconButton>
                </Box>
              ))}
              <Button onClick={handleAddWatch} startIcon={<AddIcon />}>Add Watched Mapping</Button>
            </Box>

            <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="h6" gutterBottom>Watched Devices (Connection Alerts)</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Trigger when a Modbus or MQTT device is disconnected (optionally after X seconds).
              </Typography>
              {formData.watchedDevices.map((wd, index) => (
                <Box key={index} sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'center' }}>
                  <TextField
                    label="Type"
                    select
                    value={wd.type}
                    onChange={(e) => handleWatchedDeviceChange(index, { type: e.target.value as 'modbus' | 'mqtt', deviceId: '' })}
                    sx={{ minWidth: 100 }}
                  >
                    <MenuItem value="modbus">Modbus</MenuItem>
                    <MenuItem value="mqtt">MQTT</MenuItem>
                  </TextField>
                  <TextField
                    label="Device"
                    select
                    value={wd.deviceId}
                    onChange={(e) => handleWatchedDeviceChange(index, { deviceId: e.target.value })}
                    sx={{ minWidth: 200 }}
                  >
                    {(wd.type === 'modbus' ? modbusDevices : mqttDevices).map((d: any) => (
                      <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Disconnected for (sec)"
                    type="number"
                    placeholder="0 = immediately"
                    value={wd.disconnectedSeconds ?? ''}
                    onChange={(e) => handleWatchedDeviceChange(index, { disconnectedSeconds: e.target.value === '' ? undefined : Number(e.target.value) })}
                    sx={{ width: 140 }}
                    inputProps={{ min: 0 }}
                  />
                  <IconButton color="error" onClick={() => handleRemoveWatchedDevice(index)} aria-label="Remove watched device">
                    <DeleteIcon />
                  </IconButton>
                </Box>
              ))}
              <Button onClick={handleAddWatchedDevice} startIcon={<AddIcon />}>Add Watched Device</Button>
            </Box>

            <FormControl fullWidth>
              <InputLabel id="snapshot-mappings-label">Snapshot Mappings</InputLabel>
              <Select
                labelId="snapshot-mappings-label"
                multiple
                value={formData.snapshotMappingIds}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    snapshotMappingIds: typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]),
                  })
                }
                input={<OutlinedInput label="Snapshot Mappings" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(selected as string[]).map((id) => (
                      <Chip key={id} label={mappingLookup.get(id)?.mappedName || mappingLookup.get(id)?.name || id} size="small" />
                    ))}
                  </Box>
                )}
              >
                {mappings.map((mapping) => (
                  <MenuItem key={mapping.id} value={mapping.id}>
                    <Checkbox checked={formData.snapshotMappingIds.indexOf(mapping.id) > -1} />
                    <ListItemText primary={mapping.mappedName || mapping.name} secondary={mapping.parameterId ? `Parameter ID: ${mapping.parameterId}` : undefined} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Cooldown (seconds)"
              type="number"
              value={formData.cooldownSeconds}
              onChange={(e) => setFormData({ ...formData, cooldownSeconds: Math.max(0, Number(e.target.value) || 0) })}
              fullWidth
              helperText="Prevents repeated sends while the same rule triggers again soon after."
            />

            <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle1" gutterBottom>Re-trigger when value stays out of range</Typography>
              <RadioGroup
                value={formData.reTriggerMode || 'edge_only'}
                onChange={(e) => setFormData({ ...formData, reTriggerMode: e.target.value as 'edge_only' | 'periodic_while_breach' })}
              >
                <FormControlLabel
                  value="edge_only"
                  control={<Radio />}
                  label="Edge only: Re-trigger only when value returns to normal, then goes out of range again"
                />
                <FormControlLabel
                  value="periodic_while_breach"
                  control={<Radio />}
                  label="Periodic while breach: Re-trigger every X seconds while value stays out of range"
                />
              </RadioGroup>
              {formData.reTriggerMode === 'periodic_while_breach' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, ml: 4 }}>
                  <TextField
                    type="number"
                    label="Interval (seconds)"
                    value={formData.reTriggerIntervalSeconds ?? 60}
                    onChange={(e) => setFormData({ ...formData, reTriggerIntervalSeconds: Math.max(1, Number(e.target.value) || 60) })}
                    sx={{ width: 120 }}
                    size="small"
                    inputProps={{ min: 1 }}
                  />
                  <Typography variant="body2" color="text.secondary">Minimum time between triggers while breach continues</Typography>
                </Box>
              )}
            </Box>

            <TextField
              label="JSON Format"
              select
              value={formData.jsonFormat}
              onChange={(e) => setFormData({ ...formData, jsonFormat: e.target.value as 'simple' | 'custom' })}
              fullWidth
            >
              <MenuItem value="simple">Simple</MenuItem>
              <MenuItem value="custom">Custom Template</MenuItem>
            </TextField>

            {formData.jsonFormat === 'custom' && (
              <>
                <TextField
                  label="Custom JSON Template"
                  value={formData.customJsonTemplate}
                  onChange={(e) => setFormData({ ...formData, customJsonTemplate: e.target.value })}
                  fullWidth
                  multiline
                  rows={8}
                  placeholder={`({
  rule: rule.name,
  alarm: trigger.mappingName,
  value: trigger.value,
  snapshot: snapshotMap
})`}
                  helperText="Variables: rule, trigger, snapshot, snapshotMap, clientId, isTest, Date, Math, JSON"
                />
                <Typography variant="body2" color="text.secondary">
                  Example: <code>({`{ alarm: trigger.mappingName, value: trigger.value, snapshot: snapshotMap }`})</code>
                </Typography>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained">
            {editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ThresholdPublishRules;
