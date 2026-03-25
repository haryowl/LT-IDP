import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  ListItemText,
} from '@mui/material';
import api from '../api/client';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Help as HelpIcon,
} from '@mui/icons-material';

/** Value = stored `dataType`; label + description shown in the Data Type dropdown */
const DATA_TYPE_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: 'int16',
    label: 'int16 (signed 16-bit integer)',
    description: 'Whole numbers, typical Modbus register width. Range about −32,768 … 32,767.',
  },
  {
    value: 'int32',
    label: 'int32 (signed 32-bit integer)',
    description: 'Whole numbers with a large signed range.',
  },
  {
    value: 'uint16',
    label: 'uint16 (unsigned 16-bit integer)',
    description: 'Whole numbers 0 … 65,535; common for Modbus.',
  },
  {
    value: 'uint32',
    label: 'uint32 (unsigned 32-bit integer)',
    description: 'Large positive whole numbers.',
  },
  {
    value: 'float32',
    label: 'float32 (single-precision decimal)',
    description: 'Fractional values; typical default for sensors and analogs.',
  },
  {
    value: 'float64',
    label: 'float64 (double-precision decimal)',
    description: 'Fractional values with higher precision.',
  },
  {
    value: 'number',
    label: 'number (generic numeric)',
    description: 'Any numeric value; input is converted with JavaScript Number().',
  },
  {
    value: 'boolean',
    label: 'boolean',
    description: 'Logical true / false.',
  },
  {
    value: 'string',
    label: 'string',
    description: 'Text.',
  },
  {
    value: 'timestamp',
    label: 'timestamp',
    description: 'Date/time string; set input/output format and timezone below.',
  },
];

interface ParameterMapping {
  id: string;
  name: string;
  parameterId?: string;
  description?: string;
  sourceType: 'modbus' | 'mqtt' | 'system';
  sourceDeviceId: string;
  registerId?: string;
  topic?: string;
  jsonPath?: string;
  mappedName: string;
  unit?: string;
  dataType: string;
  inputFormat?: string;
  inputTimezone?: string;
  outputFormat?: string;
  outputTimezone?: string;
  transformExpression?: string;
  storeHistory: boolean;
  createdAt: number;
  updatedAt: number;
}

const ParameterMappings: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [mappings, setMappings] = useState<ParameterMapping[]>([]);
  const [modbusDevices, setModbusDevices] = useState<any[]>([]);
  const [mqttDevices, setMqttDevices] = useState<any[]>([]);
  const [modbusRegisters, setModbusRegisters] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ParameterMapping | null>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    parameterId: '',
    description: '',
    sourceType: 'modbus' as 'modbus' | 'mqtt' | 'system',
    sourceDeviceId: '',
    registerId: '',
    topic: '',
    jsonPath: '',
    mappedName: '',
    unit: '',
    dataType: 'float32',
    inputFormat: 'ISO8601',
    inputTimezone: 'UTC+0',
    outputFormat: 'ISO8601',
    outputTimezone: 'UTC+0',
    transformExpression: '',
    storeHistory: true,
  });
  
  const [showTransformHelp, setShowTransformHelp] = useState(false);
  const [showJsonPathHelp, setShowJsonPathHelp] = useState(false);
  /** IDs must match `SYSTEM_TELEMETRY_SOURCE_IDS` in electron/services/transmissionTelemetry.ts */
  const systemSources = useMemo(
    () => [
      {
        id: 'system-timestamp',
        label: 'Current time (updates every second)',
        description: 'Unix time or formatted clock; choose Data type “timestamp” and formats below.',
      },
      {
        id: 'system-clientId',
        label: 'This app’s Client ID',
        description: 'Same ID as in Settings; use Data type “string”.',
      },
      {
        id: 'system-sparing-success-count',
        label: 'SPARING — success send count',
        description: 'Total successful SPARING API sends since app start. Data type: number (generic numeric) or uint32.',
      },
      {
        id: 'system-sparing-fail-count',
        label: 'SPARING — failed send count',
        description: 'Total failed SPARING sends since app start. Data type: number.',
      },
      {
        id: 'system-sparing-queue-depth',
        label: 'SPARING — pending retry queue size',
        description: 'Number of rows waiting in the SPARING retry queue (live from database). Data type: number.',
      },
      {
        id: 'system-mqtt-success-count',
        label: 'MQTT publisher — successful publishes',
        description: 'Total successful MQTT publish operations (all publishers) since app start. Data type: number.',
      },
      {
        id: 'system-mqtt-fail-count',
        label: 'MQTT publisher — failed publishes',
        description: 'Total failed MQTT publish attempts since app start. Data type: number.',
      },
      {
        id: 'system-http-success-count',
        label: 'HTTP publisher — successful requests',
        description: 'Total successful HTTP publisher requests (all publishers) since app start. Data type: number.',
      },
      {
        id: 'system-http-fail-count',
        label: 'HTTP publisher — failed requests',
        description: 'Total failed HTTP publisher requests since app start. Data type: number.',
      },
    ],
    []
  );
  const [timestampFormats, setTimestampFormats] = useState<string[]>([]);
  const [timezones, setTimezones] = useState<string[]>([]);

  useEffect(() => {
    loadMappings();
    loadDevices();
  }, []);

  useEffect(() => {
    setTimestampFormats([
      'UNIX_MS',
      'ISO8601',
      'YYYY-MM-DD HH:mm:ss',
      'DD/MM/YYYY HH:mm:ss',
      'MM/DD/YYYY HH:mm:ss',
      'YYYY-MM-DD',
      'HH:mm:ss',
    ]);

    const tzList: string[] = [];
    for (let offset = -12; offset <= 14; offset++) {
      const sign = offset >= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      tzList.push(`UTC${sign}${abs.toString().padStart(2, '0')}`);
    }
    setTimezones(tzList);
  }, []);

  useEffect(() => {
    if (formData.sourceType === 'modbus' && formData.sourceDeviceId) {
      loadRegisters(formData.sourceDeviceId);
    }
  }, [formData.sourceDeviceId, formData.sourceType]);

  // Pre-fill form when navigating from MQTT Discovered topics (Create mapping)
  useEffect(() => {
    const state = location.state as { suggestedTopic?: string; suggestedSourceDeviceId?: string } | null;
    if (state?.suggestedTopic && state?.suggestedSourceDeviceId) {
      setEditing(null);
      setFormData((prev) => ({
        ...prev,
        sourceType: 'mqtt',
        sourceDeviceId: state.suggestedSourceDeviceId,
        topic: state.suggestedTopic,
        name: prev.name || state.suggestedTopic.replace(/\//g, '_').slice(0, 40) || 'mqtt_mapping',
      }));
      setOpen(true);
      setError('');
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const loadMappings = async () => {
    try {
      const data = await api.mappings?.list();
      setMappings(Array.isArray(data) ? data : []);
      const systemMapping = Array.isArray(data)
        ? data.find(
            (m: any) =>
              m.sourceType === 'system' &&
              (m.sourceDeviceId === 'system-timestamp' || m.name?.toLowerCase().includes('timestamp'))
          )
        : undefined;
      if (systemMapping) {
        setFormData((prev) => ({
          ...prev,
          inputFormat: systemMapping.inputFormat || prev.inputFormat,
          inputTimezone: systemMapping.inputTimezone || prev.inputTimezone,
          outputFormat: systemMapping.outputFormat || prev.outputFormat,
          outputTimezone: systemMapping.outputTimezone || prev.outputTimezone,
        }));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load mappings');
    }
  };

  const loadDevices = async () => {
    try {
      const [modbus, mqtt] = await Promise.all([
        api.modbus?.devices?.list() || Promise.resolve([]),
        api.mqtt?.devices?.list() || Promise.resolve([]),
      ]);
      setModbusDevices(Array.isArray(modbus) ? modbus : []);
      setMqttDevices(Array.isArray(mqtt) ? mqtt : []);
    } catch (err) {
      console.error('Failed to load devices:', err);
    }
  };

  const loadRegisters = async (deviceId: string) => {
    try {
      const registers = await api.modbus?.registers?.list(deviceId);
      setModbusRegisters(Array.isArray(registers) ? registers : []);
    } catch (err) {
      console.error('Failed to load registers:', err);
    }
  };

  const handleOpen = (mapping?: ParameterMapping) => {
    if (mapping) {
      setEditing(mapping);
      setFormData({
        name: mapping.name,
        parameterId: mapping.parameterId || '',
        description: mapping.description || '',
        sourceType: mapping.sourceType,
        sourceDeviceId:
          mapping.sourceType === 'system'
            ? mapping.sourceDeviceId || 'system-timestamp'
            : mapping.sourceDeviceId,
        registerId: mapping.registerId || '',
        topic: mapping.topic || '',
        jsonPath: mapping.jsonPath || '',
        mappedName: mapping.mappedName,
        unit: mapping.unit || '',
        dataType: mapping.dataType,
        inputFormat: mapping.inputFormat || 'ISO8601',
        inputTimezone: mapping.inputTimezone || 'UTC+0',
        outputFormat: mapping.outputFormat || 'ISO8601',
        outputTimezone: mapping.outputTimezone || 'UTC+0',
        transformExpression: mapping.transformExpression || '',
        storeHistory: mapping.storeHistory,
      });
    } else {
      setEditing(null);
      setFormData({
        name: '',
        parameterId: '',
        description: '',
        sourceType: 'modbus',
        sourceDeviceId: '',
        registerId: '',
        topic: '',
        jsonPath: '',
        mappedName: '',
        unit: '',
        dataType: 'float32',
        inputFormat: 'ISO8601',
        inputTimezone: 'UTC+0',
        outputFormat: 'ISO8601',
        outputTimezone: 'UTC+0',
        transformExpression: '',
        storeHistory: true,
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
      if (editing) {
        await api.mappings?.update(editing.id, formData);
      } else {
        await api.mappings?.create(formData);
      }
      await loadMappings();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save mapping');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this mapping?')) return;

    try {
      await api.mappings?.delete(id);
      await loadMappings();
    } catch (err: any) {
      setError(err.message || 'Failed to delete mapping');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Parameter Mappings</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
          Add Mapping
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
              <TableCell>Source Type</TableCell>
              <TableCell>Device</TableCell>
              <TableCell>Mapped Name</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell>Store History</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.map((mapping) => {
              const device =
                mapping.sourceType === 'modbus'
                  ? modbusDevices.find((d) => d.id === mapping.sourceDeviceId)
                  : mqttDevices.find((d) => d.id === mapping.sourceDeviceId);

              return (
                <TableRow key={mapping.id}>
                  <TableCell>{mapping.name}</TableCell>
                  <TableCell>{mapping.sourceType.toUpperCase()}</TableCell>
                  <TableCell>{device?.name || '-'}</TableCell>
                  <TableCell>{mapping.mappedName}</TableCell>
                  <TableCell>{mapping.unit || '-'}</TableCell>
                  <TableCell>{mapping.storeHistory ? 'Yes' : 'No'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleOpen(mapping)} aria-label={`Edit mapping ${mapping.name}`}>
                      <EditIcon />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(mapping.id)} color="error" aria-label={`Delete mapping ${mapping.name}`}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            {mappings.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  No mappings found. Click "Add Mapping" to create one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Mapping' : 'Add Parameter Mapping'}</DialogTitle>
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
              label="Source Type"
              select
              value={formData.sourceType}
              onChange={(e) => {
                const newSource = e.target.value as 'modbus' | 'mqtt' | 'system';
                setFormData({
                  ...formData,
                  sourceType: newSource,
                  sourceDeviceId:
                    newSource === 'system' ? (formData.sourceDeviceId || 'system-timestamp') : '',
                  registerId: '',
                  topic: '',
                });
              }}
              fullWidth
            >
              <MenuItem value="modbus">Modbus</MenuItem>
              <MenuItem value="mqtt">MQTT</MenuItem>
              <MenuItem value="system">System</MenuItem>
            </TextField>
            {formData.sourceType === 'system' && (
              <TextField
                label="System source"
                select
                value={formData.sourceDeviceId || 'system-timestamp'}
                onChange={(e) => {
                  const id = e.target.value;
                  const isTelemetryCounter =
                    id.startsWith('system-sparing-') || id.startsWith('system-mqtt-') || id.startsWith('system-http-');
                  setFormData((prev) => ({
                    ...prev,
                    sourceDeviceId: id,
                    ...(isTelemetryCounter ? { dataType: 'number' as const } : {}),
                  }));
                }}
                fullWidth
                helperText="Built-in values from this application (not from Modbus or MQTT). Transmission counters reset when the app restarts; queue depth is live from the database."
              >
                {systemSources.map((source) => (
                  <MenuItem key={source.id} value={source.id} sx={{ alignItems: 'flex-start', py: 1 }}>
                    <ListItemText primary={source.label} secondary={source.description} />
                  </MenuItem>
                ))}
              </TextField>
            )}

            {formData.sourceType === 'modbus' && (
              <>
                <TextField
                  label="Device"
                  select
                  value={formData.sourceDeviceId}
                  onChange={(e) => setFormData({ ...formData, sourceDeviceId: e.target.value })}
                  fullWidth
                >
                  {modbusDevices.map((device) => (
                    <MenuItem key={device.id} value={device.id}>
                      {device.name}
                    </MenuItem>
                  ))}
                </TextField>
                {formData.sourceDeviceId && (
                  <TextField
                    label="Register"
                    select
                    value={formData.registerId}
                    onChange={(e) => setFormData({ ...formData, registerId: e.target.value })}
                    fullWidth
                  >
                    {modbusRegisters.map((register) => (
                      <MenuItem key={register.id} value={register.id}>
                        {register.name} (FC{register.functionCode}, Addr: {register.address})
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </>
            )}

            {formData.sourceType === 'mqtt' && (
              <>
                <TextField
                  label="Device"
                  select
                  value={formData.sourceDeviceId}
                  onChange={(e) => setFormData({ ...formData, sourceDeviceId: e.target.value })}
                  fullWidth
                >
                  {mqttDevices.map((device) => (
                    <MenuItem key={device.id} value={device.id}>
                      {device.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Topic"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  fullWidth
                />
                <Box>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <TextField
                      label="JSON Path"
                      value={formData.jsonPath}
                      onChange={(e) => setFormData({ ...formData, jsonPath: e.target.value })}
                      fullWidth
                      placeholder="e.g. value, data.temperature"
                      helperText="Leave empty to use the full message as value. Use dot notation to extract nested fields."
                    />
                    <IconButton
                      onClick={() => setShowJsonPathHelp(!showJsonPathHelp)}
                      size="small"
                      aria-label="JSON Path help"
                    >
                      <HelpIcon />
                    </IconButton>
                  </Box>
                  <Collapse in={showJsonPathHelp}>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      <Typography variant="body2" gutterBottom>
                        <strong>JSON Path (dot notation) examples:</strong>
                      </Typography>
                      <Typography variant="body2" component="div">
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                          <li><strong>Root field:</strong> <code>value</code> for <code>{"{ \"value\": 42 }"}</code></li>
                          <li><strong>Nested:</strong> <code>data.temperature</code> for <code>{"{ \"data\": { \"temperature\": 25.5 } }"}</code></li>
                          <li><strong>Deep:</strong> <code>sensors.temp</code> for <code>{"{ \"sensors\": { \"temp\": 22 } }"}</code></li>
                          <li><strong>Leave empty</strong> if the MQTT payload is a plain number or string</li>
                        </ul>
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Use dot-separated keys to navigate nested JSON. Arrays are not supported; use a nested object key.
                      </Typography>
                    </Alert>
                  </Collapse>
                </Box>
              </>
            )}

            <TextField
              label="Mapped Name"
              value={formData.mappedName}
              onChange={(e) => setFormData({ ...formData, mappedName: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Data type"
              select
              value={formData.dataType}
              onChange={(e) => setFormData({ ...formData, dataType: e.target.value })}
              fullWidth
              helperText="What kind of value this parameter holds. Use integer types for typical Modbus counts; float for analogs; timestamp for clocks. Use “Transform” below to scale or convert."
            >
              {!DATA_TYPE_OPTIONS.some((o) => o.value === formData.dataType) && formData.dataType ? (
                <MenuItem value={formData.dataType} sx={{ alignItems: 'flex-start', py: 1 }}>
                  <ListItemText
                    primary={`${formData.dataType} (saved in database)`}
                    secondary="This value is not in the standard list. You can keep it or pick a standard type above."
                  />
                </MenuItem>
              ) : null}
              {DATA_TYPE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value} sx={{ alignItems: 'flex-start', py: 1 }}>
                  <ListItemText primary={opt.label} secondary={opt.description} />
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Unit"
              value={formData.unit}
              onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              fullWidth
            />
            <TextField
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              fullWidth
              multiline
              rows={3}
            />
            
            <Box>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <TextField
                  label="Transform Expression (Custom Calculation/Formula)"
                  value={formData.transformExpression}
                  onChange={(e) =>
                    setFormData({ ...formData, transformExpression: e.target.value })
                  }
                  fullWidth
                  placeholder="e.g., value * 1.8 + 32"
                  helperText="JavaScript expression to transform the value. Use 'value' for the input value."
                />
                <IconButton
                  onClick={() => setShowTransformHelp(!showTransformHelp)}
                  size="small"
                >
                  <HelpIcon />
                </IconButton>
              </Box>
              
              <Collapse in={showTransformHelp}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    <strong>Transform Expression Examples:</strong>
                  </Typography>
                  <Typography variant="body2" component="div">
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      <li><strong>Scale:</strong> <code>value * 10</code></li>
                      <li><strong>Offset:</strong> <code>value + 100</code></li>
                      <li><strong>Temperature conversion:</strong> <code>value * 1.8 + 32</code> (Celsius to Fahrenheit)</li>
                      <li><strong>Round to 2 decimals:</strong> <code>Math.round(value * 100) / 100</code></li>
                      <li><strong>Absolute value:</strong> <code>Math.abs(value)</code></li>
                      <li><strong>Square root:</strong> <code>Math.sqrt(value)</code></li>
                      <li><strong>Power:</strong> <code>Math.pow(value, 2)</code></li>
                      <li><strong>Conditional:</strong> <code>value &gt; 0 ? value : 0</code></li>
                      <li><strong>Logarithm:</strong> <code>Math.log(value)</code></li>
                    </ul>
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    <strong>Available variables:</strong> <code>value</code> (input value), <code>Math</code>, <code>Number</code>, <code>String</code>, <code>Boolean</code>, <code>Date</code>
                  </Typography>
                </Alert>
              </Collapse>
            </Box>

            {formData.dataType === 'timestamp' && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Timestamp Format Configuration:
                </Typography>
                <Autocomplete
                  options={timestampFormats}
                  freeSolo
                  value={formData.inputFormat}
                  onChange={(_, newValue) =>
                    setFormData({ ...formData, inputFormat: newValue || '' })
                  }
                  onInputChange={(_, newValue) =>
                    setFormData({ ...formData, inputFormat: newValue })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Input Format"
                      helperText="Format of the input timestamp"
                      sx={{ mb: 2 }}
                    />
                  )}
                />
                <Autocomplete
                  options={timezones}
                  freeSolo
                  value={formData.inputTimezone}
                  onChange={(_, newValue) =>
                    setFormData({ ...formData, inputTimezone: newValue || '' })
                  }
                  onInputChange={(_, newValue) =>
                    setFormData({ ...formData, inputTimezone: newValue })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Input Timezone"
                      helperText="Timezone of the input timestamp"
                      sx={{ mb: 2 }}
                    />
                  )}
                />
                <Autocomplete
                  options={timestampFormats}
                  freeSolo
                  value={formData.outputFormat}
                  onChange={(_, newValue) =>
                    setFormData({ ...formData, outputFormat: newValue || '' })
                  }
                  onInputChange={(_, newValue) =>
                    setFormData({ ...formData, outputFormat: newValue })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Output Format"
                      helperText="Desired output format"
                      sx={{ mb: 2 }}
                    />
                  )}
                />
                <Autocomplete
                  options={timezones}
                  freeSolo
                  value={formData.outputTimezone}
                  onChange={(_, newValue) =>
                    setFormData({ ...formData, outputTimezone: newValue || '' })
                  }
                  onInputChange={(_, newValue) =>
                    setFormData({ ...formData, outputTimezone: newValue })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Output Timezone"
                      helperText="Timezone for the output timestamp"
                    />
                  )}
                />
              </Box>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={formData.storeHistory}
                  onChange={(e) =>
                    setFormData({ ...formData, storeHistory: e.target.checked })
                  }
                />
              }
              label="Store History"
            />
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

export const systemTimestampDefaults = {
  inputFormat: 'ISO8601',
  inputTimezone: 'UTC+0',
  outputFormat: 'ISO8601',
  outputTimezone: 'UTC+0',
};

export default ParameterMappings;