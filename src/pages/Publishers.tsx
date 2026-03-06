import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
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
  Tooltip,
  Typography,
  Checkbox,
  ListItemText,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
interface Publisher {
  id: string;
  name: string;
  type: 'mqtt' | 'http';
  enabled: boolean;
  autoStart: boolean;
  mode: 'realtime' | 'buffer' | 'both';
  mqttBroker?: string;
  mqttPort?: number;
  mqttProtocol?: string;
  mqttTopic?: string;
  mqttQos?: number;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttUseTls?: boolean;
  httpUrl?: string;
  httpMethod?: string;
  httpHeaders?: string;
  useJwt?: boolean;
  jwtToken?: string;
  jwtHeader?: string;
  bufferSize?: number;
  bufferFlushInterval?: number;
  retryAttempts?: number;
  retryDelay?: number;
  jsonFormat?: 'simple' | 'custom';
  customJsonTemplate?: string;
  mappingIds: string[];
  scheduledEnabled?: boolean;
  scheduledInterval?: number;
  scheduledIntervalUnit?: 'seconds' | 'minutes' | 'hours';
  createdAt: number;
  updatedAt: number;
}

const Publishers: React.FC = () => {
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Publisher | null>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    type: 'mqtt' as 'mqtt' | 'http',
    enabled: true,
    autoStart: false,
    mode: 'realtime' as 'realtime' | 'buffer' | 'both',
    mqttBroker: '',
    mqttPort: 1883,
    mqttProtocol: 'mqtt',
    mqttTopic: '',
    mqttQos: 0,
    mqttUsername: '',
    mqttPassword: '',
    mqttUseTls: false,
    httpUrl: '',
    httpMethod: 'POST',
    httpHeaders: '',
    useJwt: false,
    jwtToken: '',
    jwtHeader: 'Authorization',
    bufferSize: 100,
    bufferFlushInterval: 60000,
    retryAttempts: 3,
    retryDelay: 1000,
    jsonFormat: 'simple' as 'simple' | 'custom',
    customJsonTemplate: '',
    mappingIds: [] as string[],
    scheduledEnabled: false,
    scheduledInterval: 5,
    scheduledIntervalUnit: 'minutes' as 'seconds' | 'minutes' | 'hours',
  });

  useEffect(() => {
    loadPublishers();
    loadMappings();
  }, []);

  const mappingLookup = useMemo(() => {
    const map = new Map<string, any>();
    mappings.forEach((mapping) => map.set(mapping.id, mapping));
    return map;
  }, [mappings]);

  const loadPublishers = async () => {
    try {
      const data = await window.electronAPI.publishers?.list();
      setPublishers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load publishers');
    }
  };

  const loadMappings = async () => {
    try {
      const data = await window.electronAPI.mappings?.list();
      setMappings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load mappings:', err);
    }
  };

  const handleOpen = (publisher?: Publisher) => {
    if (publisher) {
      setEditing(publisher);
      setFormData({
        name: publisher.name,
        type: publisher.type,
        enabled: publisher.enabled,
        autoStart: publisher.autoStart,
        mode: publisher.mode,
        mqttBroker: publisher.mqttBroker || '',
        mqttPort: publisher.mqttPort || 1883,
        mqttProtocol: publisher.mqttProtocol || 'mqtt',
        mqttTopic: publisher.mqttTopic || '',
        mqttQos: publisher.mqttQos || 0,
        mqttUsername: publisher.mqttUsername || '',
        mqttPassword: publisher.mqttPassword || '',
        mqttUseTls: publisher.mqttUseTls || false,
        httpUrl: publisher.httpUrl || '',
        httpMethod: publisher.httpMethod || 'POST',
        httpHeaders: publisher.httpHeaders
          ? JSON.stringify(publisher.httpHeaders, null, 2)
          : '',
        useJwt: publisher.useJwt || false,
        jwtToken: publisher.jwtToken || '',
        jwtHeader: publisher.jwtHeader || 'Authorization',
        bufferSize: publisher.bufferSize || 100,
        bufferFlushInterval: publisher.bufferFlushInterval || 60000,
        retryAttempts: publisher.retryAttempts || 3,
        retryDelay: publisher.retryDelay || 1000,
        jsonFormat: publisher.jsonFormat || 'simple',
        customJsonTemplate: publisher.customJsonTemplate || '',
        mappingIds: publisher.mappingIds || [],
        scheduledEnabled: publisher.scheduledEnabled || false,
        scheduledInterval: publisher.scheduledInterval || 5,
        scheduledIntervalUnit: publisher.scheduledIntervalUnit || 'minutes',
      });
    } else {
      setEditing(null);
      setFormData({
        name: '',
        type: 'mqtt',
        enabled: true,
        mode: 'realtime',
        mqttBroker: '',
        mqttPort: 1883,
        mqttProtocol: 'mqtt',
        mqttTopic: '',
        mqttQos: 0,
        mqttUsername: '',
        mqttPassword: '',
        mqttUseTls: false,
        httpUrl: '',
        httpMethod: 'POST',
        httpHeaders: '',
        useJwt: false,
        jwtToken: '',
        jwtHeader: 'Authorization',
        bufferSize: 100,
        bufferFlushInterval: 60000,
        retryAttempts: 3,
        retryDelay: 1000,
        jsonFormat: 'simple',
        customJsonTemplate: '',
        mappingIds: [],
        autoStart: false,
        scheduledEnabled: false,
        scheduledInterval: 5,
        scheduledIntervalUnit: 'minutes',
      });
    }
    setOpen(true);
    setError('');
  };

  const handleClose = () => {
    setOpen(false);
    setEditing(null);
  };

  const handleSubmit = async () => {
    try {
      setError('');
      let httpHeadersParsed: any = undefined;
      if (formData.httpHeaders) {
        try {
          httpHeadersParsed = JSON.parse(formData.httpHeaders);
        } catch (err: any) {
          setError('HTTP headers must be valid JSON.');
          return;
        }
      }

      const payload = {
        ...formData,
        httpHeaders: httpHeadersParsed,
      };

      if (formData.type === 'http' && formData.useJwt === false) {
        payload.jwtToken = '';
        payload.jwtHeader = 'Authorization';
      }

      if (editing) {
        await window.electronAPI.publishers?.update(editing.id, payload);
      } else {
        await window.electronAPI.publishers?.create(payload);
      }
      await loadPublishers();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save publisher');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this publisher?')) return;

    try {
      await window.electronAPI.publishers?.delete(id);
      await loadPublishers();
    } catch (err: any) {
      setError(err.message || 'Failed to delete publisher');
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await window.electronAPI.publishers?.toggle(id, enabled);
      await loadPublishers();
    } catch (err: any) {
      setError(err.message || 'Failed to toggle publisher');
    }
  };

  const handleAutoStartToggle = async (publisher: Publisher) => {
    try {
      await window.electronAPI.publishers?.update(publisher.id, {
        autoStart: !publisher.autoStart,
      });
      await loadPublishers();
    } catch (err: any) {
      setError(err.message || 'Failed to update auto start');
    }
  };

  const handleStart = async (publisher: Publisher) => {
    await handleToggle(publisher.id, true);
  };

  const handleStop = async (publisher: Publisher) => {
    await handleToggle(publisher.id, false);
  };

  const renderMappingChips = (publisher: Publisher) => {
    if (publisher.mappingIds.length === 0) {
      return <Chip label="All mappings" size="small" />;
    }

    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {publisher.mappingIds.map((id) => {
          const mapping = mappingLookup.get(id);
          return (
            <Chip
              key={id}
              label={mapping?.mappedName || mapping?.name || id}
              size="small"
              color="primary"
              variant="outlined"
            />
          );
        })}
      </Box>
    );
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Publishers</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
          Add Publisher
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
              <TableCell>Type</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell>Endpoint</TableCell>
              <TableCell>Mappings</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {publishers.map((publisher) => (
              <TableRow key={publisher.id}>
                <TableCell>{publisher.name}</TableCell>
                <TableCell>
                  <Chip label={publisher.type.toUpperCase()} size="small" />
                </TableCell>
                <TableCell>{publisher.mode}</TableCell>
                <TableCell>
                  {publisher.type === 'mqtt'
                    ? `${publisher.mqttBroker}:${publisher.mqttPort}/${publisher.mqttTopic}`
                    : publisher.httpUrl}
                </TableCell>
                <TableCell>{renderMappingChips(publisher)}</TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Chip
                      label={publisher.enabled ? 'Running' : 'Stopped'}
                      color={publisher.enabled ? 'success' : 'default'}
                      size="small"
                    />
                    <Tooltip title="Auto Start on Launch">
                      <Switch
                        checked={publisher.autoStart}
                        onChange={() => handleAutoStartToggle(publisher)}
                        size="small"
                      />
                    </Tooltip>
                    <Tooltip title="Start Publisher">
                      <span>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleStart(publisher)}
                          disabled={publisher.enabled}
                        >
                          <PlayIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Stop Publisher">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleStop(publisher)}
                          disabled={!publisher.enabled}
                        >
                          <StopIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleOpen(publisher)} aria-label={`Edit publisher ${publisher.name}`}>
                    <EditIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDelete(publisher.id)} color="error" aria-label={`Delete publisher ${publisher.name}`}>
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {publishers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  No publishers found. Click "Add Publisher" to create one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Publisher' : 'Add Publisher'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Type"
              select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as 'mqtt' | 'http' })}
              fullWidth
            >
              <MenuItem value="mqtt">MQTT</MenuItem>
              <MenuItem value="http">HTTP</MenuItem>
            </TextField>
            <TextField
              label="Mode"
              select
              value={formData.mode}
              onChange={(e) =>
                setFormData({ ...formData, mode: e.target.value as 'realtime' | 'buffer' | 'both' })
              }
              fullWidth
            >
              <MenuItem value="realtime">Realtime</MenuItem>
              <MenuItem value="buffer">Buffer</MenuItem>
              <MenuItem value="both">Both</MenuItem>
            </TextField>

            {formData.type === 'mqtt' && (
              <>
                <TextField
                  label="MQTT Broker"
                  value={formData.mqttBroker}
                  onChange={(e) => setFormData({ ...formData, mqttBroker: e.target.value })}
                  fullWidth
                  required
                />
                <TextField
                  label="Port"
                  type="number"
                  value={formData.mqttPort}
                  onChange={(e) =>
                    setFormData({ ...formData, mqttPort: parseInt(e.target.value) })
                  }
                  fullWidth
                />
                <TextField
                  label="Protocol"
                  value={formData.mqttProtocol}
                  onChange={(e) => setFormData({ ...formData, mqttProtocol: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="Topic"
                  value={formData.mqttTopic}
                  onChange={(e) => setFormData({ ...formData, mqttTopic: e.target.value })}
                  fullWidth
                  required
                />
                <TextField
                  label="QoS"
                  type="number"
                  value={formData.mqttQos}
                  onChange={(e) => setFormData({ ...formData, mqttQos: parseInt(e.target.value) })}
                  fullWidth
                  inputProps={{ min: 0, max: 2 }}
                />
                <TextField
                  label="Username"
                  value={formData.mqttUsername}
                  onChange={(e) => setFormData({ ...formData, mqttUsername: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="Password"
                  type="password"
                  value={formData.mqttPassword}
                  onChange={(e) => setFormData({ ...formData, mqttPassword: e.target.value })}
                  fullWidth
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.mqttUseTls}
                      onChange={(e) => setFormData({ ...formData, mqttUseTls: e.target.checked })}
                    />
                  }
                  label="Use TLS"
                />
              </>
            )}

            {formData.type === 'http' && (
              <>
                <TextField
                  label="URL"
                  value={formData.httpUrl}
                  onChange={(e) => setFormData({ ...formData, httpUrl: e.target.value })}
                  fullWidth
                  required
                />
                <TextField
                  label="Method"
                  select
                  value={formData.httpMethod}
                  onChange={(e) => setFormData({ ...formData, httpMethod: e.target.value })}
                  fullWidth
                >
                  <MenuItem value="POST">POST</MenuItem>
                  <MenuItem value="PUT">PUT</MenuItem>
                  <MenuItem value="PATCH">PATCH</MenuItem>
                </TextField>
                <TextField
                  label="Headers (JSON)"
                  value={formData.httpHeaders}
                  onChange={(e) => setFormData({ ...formData, httpHeaders: e.target.value })}
                  fullWidth
                  multiline
                  rows={3}
                  placeholder='{"Content-Type": "application/json"}'
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.useJwt}
                      onChange={(e) => setFormData({ ...formData, useJwt: e.target.checked })}
                    />
                  }
                  label="Use JWT"
                />
                {formData.useJwt && (
                  <>
                    <TextField
                      label="JWT Token"
                      value={formData.jwtToken}
                      onChange={(e) => setFormData({ ...formData, jwtToken: e.target.value })}
                      fullWidth
                    />
                    <TextField
                      label="JWT Header Name"
                      value={formData.jwtHeader}
                      onChange={(e) => setFormData({ ...formData, jwtHeader: e.target.value })}
                      fullWidth
                    />
                  </>
                )}
              </>
            )}

            {formData.mode !== 'realtime' && (
              <>
                <TextField
                  label="Buffer Size"
                  type="number"
                  value={formData.bufferSize}
                  onChange={(e) =>
                    setFormData({ ...formData, bufferSize: parseInt(e.target.value) })
                  }
                  fullWidth
                />
                <TextField
                  label="Buffer Flush Interval (ms)"
                  type="number"
                  value={formData.bufferFlushInterval}
                  onChange={(e) =>
                    setFormData({ ...formData, bufferFlushInterval: parseInt(e.target.value) })
                  }
                  fullWidth
                />
              </>
            )}

            <TextField
              label="JSON Format"
              select
              value={formData.jsonFormat}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  jsonFormat: e.target.value as 'simple' | 'custom',
                })
              }
              fullWidth
            >
              <MenuItem value="simple">Simple (name, value, unit, timestamp)</MenuItem>
              <MenuItem value="custom">Custom Template</MenuItem>
            </TextField>

            {formData.jsonFormat === 'custom' && (
              <TextField
                label="Custom JSON Template"
                value={formData.customJsonTemplate}
                onChange={(e) =>
                  setFormData({ ...formData, customJsonTemplate: e.target.value })
                }
                fullWidth
                multiline
                rows={8}
                placeholder={`({
  device: clientId,
  batchSize: batch.length,
  lastSample: {
    name: data?.mappingName,
    value: data?.value,
    timestamp: data?.timestamp
  },
  samples: batch.map(item => ({
    name: item.mappingName,
    value: item.value,
    timestamp: item.timestamp
  }))
})`}
                helperText="Provide either a JSON template with placeholders ({clientId}, {mappingName}, {value}, {unit}, {timestamp}, {quality}, {parameterId}) or a JavaScript expression that returns an object or string. Available variables: clientId, mappingId, mappingName, parameterId, value, unit, quality, timestamp, data, batch, publisher, Math, Date, JSON."
                sx={{ mb: 2 }}
              />
            )}
            {formData.jsonFormat === 'custom' && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="textSecondary" gutterBottom>
                  Example template:
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    bgcolor: 'grey.100',
                    borderRadius: 1,
                    p: 2,
                    fontSize: '0.85rem',
                    overflow: 'auto',
                  }}
                >
{`({
  device: clientId,
  endpoint: publisher.httpUrl || publisher.mqttTopic,
  payload: batch.map(item => ({
    id: item.mappingId,
    name: item.mappingName,
    value: item.value,
    quality: item.quality,
    timestamp: item.timestamp
  }))
})`}
                </Box>
                <Typography variant="body2" color="textSecondary">
                  You can return any JSON-serialisable structure. The template executes with <code>{'{clientId}'}</code>, <code>{'{mappingId}'}</code>, <code>{'{mappingName}'}</code>, <code>{'{parameterId}'}</code>, <code>{'{value}'}</code>, <code>{'{unit}'}</code>, <code>{'{timestamp}'}</code>, <code>{'{quality}'}</code>, plus objects <code>data</code> (current sample), <code>batch</code> (all buffered samples), <code>publisher</code>, <code>Math</code>, <code>Date</code> and <code>JSON</code>. Legacy placeholder replacement remains available for simpler use cases.
                </Typography>
              </Box>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                />
              }
              label="Enabled"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.autoStart}
                  onChange={(e) => setFormData({ ...formData, autoStart: e.target.checked })}
                />
              }
              label="Auto Start on Application Launch"
            />

            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="h6" gutterBottom>
                Scheduled Publishing (from Historical Database)
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                When enabled, publisher will read latest values from historical database and publish on a schedule.
                Realtime/buffer publishing will be disabled when scheduled publishing is enabled.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.scheduledEnabled}
                    onChange={(e) =>
                      setFormData({ ...formData, scheduledEnabled: e.target.checked })
                    }
                  />
                }
                label="Enable Scheduled Publishing"
              />
              {formData.scheduledEnabled && (
                <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                  <TextField
                    label="Interval"
                    type="number"
                    value={formData.scheduledInterval}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        scheduledInterval: parseInt(e.target.value) || 5,
                      })
                    }
                    inputProps={{ min: 1 }}
                    sx={{ width: 150 }}
                  />
                  <FormControl sx={{ minWidth: 150 }}>
                    <InputLabel>Unit</InputLabel>
                    <Select
                      value={formData.scheduledIntervalUnit}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          scheduledIntervalUnit: e.target.value as 'seconds' | 'minutes' | 'hours',
                        })
                      }
                      label="Unit"
                    >
                      <MenuItem value="seconds">Seconds</MenuItem>
                      <MenuItem value="minutes">Minutes</MenuItem>
                      <MenuItem value="hours">Hours</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              )}
            </Box>

            <FormControl fullWidth>
              <InputLabel id="publisher-mappings-label">Parameter Mappings</InputLabel>
              <Select
                labelId="publisher-mappings-label"
                multiple
                value={formData.mappingIds}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    mappingIds:
                      typeof e.target.value === 'string'
                        ? e.target.value.split(',')
                        : (e.target.value as string[]),
                  })
                }
                input={<OutlinedInput label="Parameter Mappings" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(selected as string[]).map((id) => {
                      const mapping = mappingLookup.get(id);
                      return (
                        <Chip
                          key={id}
                          label={mapping?.mappedName || mapping?.name || id}
                          size="small"
                          color="primary"
                        />
                      );
                    })}
                  </Box>
                )}
              >
                {mappings.map((mapping) => (
                  <MenuItem key={mapping.id} value={mapping.id}>
                    <Checkbox checked={formData.mappingIds.indexOf(mapping.id) > -1} />
                    <ListItemText
                      primary={mapping.mappedName || mapping.name}
                      secondary={mapping.parameterId ? `Parameter ID: ${mapping.parameterId}` : undefined}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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

export default Publishers;