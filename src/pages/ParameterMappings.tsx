import React, { useEffect, useMemo, useState } from 'react';
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
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Help as HelpIcon,
} from '@mui/icons-material';

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
  const systemSources = useMemo(
    () => [
      { id: 'system-timestamp', label: 'System Timestamp' },
      { id: 'system-clientId', label: 'System Client ID' },
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

  const loadMappings = async () => {
    try {
      const data = await window.electronAPI.mappings?.list();
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
        window.electronAPI.modbus?.devices?.list() || Promise.resolve([]),
        window.electronAPI.mqtt?.devices?.list() || Promise.resolve([]),
      ]);
      setModbusDevices(Array.isArray(modbus) ? modbus : []);
      setMqttDevices(Array.isArray(mqtt) ? mqtt : []);
    } catch (err) {
      console.error('Failed to load devices:', err);
    }
  };

  const loadRegisters = async (deviceId: string) => {
    try {
      const registers = await window.electronAPI.modbus?.registers?.list(deviceId);
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
        await window.electronAPI.mappings?.update(editing.id, formData);
      } else {
        await window.electronAPI.mappings?.create(formData);
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
      await window.electronAPI.mappings?.delete(id);
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
                label="System Source"
                select
                value={formData.sourceDeviceId || 'system-timestamp'}
                onChange={(e) => setFormData({ ...formData, sourceDeviceId: e.target.value })}
                fullWidth
              >
                {systemSources.map((source) => (
                  <MenuItem key={source.id} value={source.id}>
                    {source.label}
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
                <TextField
                  label="JSON Path"
                  value={formData.jsonPath}
                  onChange={(e) => setFormData({ ...formData, jsonPath: e.target.value })}
                  fullWidth
                  placeholder="$.value or data.temperature"
                />
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
              label="Data Type"
              select
              value={formData.dataType}
              onChange={(e) => setFormData({ ...formData, dataType: e.target.value })}
              fullWidth
            >
              <MenuItem value="int16">int16</MenuItem>
              <MenuItem value="int32">int32</MenuItem>
              <MenuItem value="uint16">uint16</MenuItem>
              <MenuItem value="uint32">uint32</MenuItem>
              <MenuItem value="float32">float32</MenuItem>
              <MenuItem value="float64">float64</MenuItem>
              <MenuItem value="boolean">boolean</MenuItem>
              <MenuItem value="string">string</MenuItem>
              <MenuItem value="timestamp">timestamp</MenuItem>
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