import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
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
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

interface ModbusDevice {
  id: string;
  name: string;
  type: 'tcp' | 'rtu';
  enabled: boolean;
  autoStart: boolean;
  host?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  slaveId: number;
  pollInterval: number;
  recordInterval?: number;
  timeout: number;
  retryAttempts: number;
  createdAt: number;
  updatedAt: number;
}

interface ModbusRegister {
  id: string;
  deviceId: string;
  name: string;
  functionCode: number;
  address: number;
  quantity: number;
  dataType: string;
  byteOrder?: string;
  wordOrder?: string;
  scaleFactor?: number;
  offset?: number;
  unit?: string;
}

const ModbusDevices: React.FC = () => {
  const [devices, setDevices] = useState<ModbusDevice[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ModbusDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});

  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<ModbusDevice | null>(null);
  const [registers, setRegisters] = useState<ModbusRegister[]>([]);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerFormOpen, setRegisterFormOpen] = useState(false);
  const [registerEditing, setRegisterEditing] = useState<ModbusRegister | null>(null);
  const [registerFormData, setRegisterFormData] = useState({
    name: '',
    functionCode: 3,
    address: 0,
    quantity: 1,
    dataType: 'uint16',
    unit: '',
    byteOrder: 'ABCD',
    wordOrder: 'BE',
    scaleFactor: '',
    offset: '',
  });

  const [formData, setFormData] = useState({
    name: '',
    type: 'tcp' as 'tcp' | 'rtu',
    enabled: true,
    autoStart: false,
    host: '',
    port: 502,
    serialPort: '',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    slaveId: 1,
    pollInterval: 1000,
    recordInterval: 5000,
    timeout: 5000,
    retryAttempts: 3,
  });

  useEffect(() => {
    loadDevices();
    loadConnectionStatus();
    const interval = setInterval(loadConnectionStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const resetRegisterForm = () => {
    setRegisterFormData({
      name: '',
      functionCode: 3,
      address: 0,
      quantity: 1,
      dataType: 'uint16',
      unit: '',
      byteOrder: 'ABCD',
      wordOrder: 'BE',
      scaleFactor: '',
      offset: '',
    });
    setRegisterEditing(null);
  };

  const loadDevices = async () => {
    try {
      const data = await window.electronAPI.modbus?.devices?.list();
      const deviceList = Array.isArray(data) ? data : [];
      setDevices(deviceList);
      if (selectedDevice) {
        const updated = deviceList.find((d) => d.id === selectedDevice.id);
        if (updated) {
          setSelectedDevice(updated);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  const loadConnectionStatus = async () => {
    try {
      const status = await window.electronAPI.modbus?.getStatus();
      const connections = status?.connections || {};
      const statusMap: Record<string, boolean> = {};
      Object.keys(connections).forEach((id) => {
        statusMap[id] = connections[id]?.connected || false;
      });
      setConnectionStatus(statusMap);
    } catch (err) {
      console.error('Failed to load connection status:', err);
    }
  };

  const loadDeviceRegisters = async (deviceId: string) => {
    try {
      setRegisterLoading(true);
      const data = await window.electronAPI.modbus?.registers?.list(deviceId);
      setRegisters(Array.isArray(data) ? data : []);
      setRegisterError('');
    } catch (err: any) {
      setRegisterError(err.message || 'Failed to load registers');
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleOpenRegisters = (device: ModbusDevice) => {
    setSelectedDevice(device);
    setRegisterDialogOpen(true);
    setRegisterError('');
    resetRegisterForm();
    loadDeviceRegisters(device.id);
  };

  const handleRegisterDialogClose = () => {
    setRegisterDialogOpen(false);
    setSelectedDevice(null);
    setRegisters([]);
    setRegisterError('');
    resetRegisterForm();
  };

  const handleRegisterFormOpen = (register?: ModbusRegister) => {
    if (register) {
      setRegisterEditing(register);
      setRegisterFormData({
        name: register.name,
        functionCode: register.functionCode,
        address: register.address,
        quantity: register.quantity,
        dataType: register.dataType,
        unit: register.unit || '',
        byteOrder: register.byteOrder || '',
        wordOrder: register.wordOrder || 'BE',
        scaleFactor:
          typeof register.scaleFactor === 'number' && !Number.isNaN(register.scaleFactor)
            ? String(register.scaleFactor)
            : '',
        offset:
          typeof register.offset === 'number' && !Number.isNaN(register.offset)
            ? String(register.offset)
            : '',
      });
    } else {
      resetRegisterForm();
    }
    setRegisterFormOpen(true);
  };

  const handleRegisterFormClose = () => {
    setRegisterFormOpen(false);
    resetRegisterForm();
  };

  const handleRegisterDelete = async (registerId: string) => {
    if (!selectedDevice) {
      return;
    }

    const confirmed = window.confirm('Delete this register?');
    if (!confirmed) {
      return;
    }

    try {
      await window.electronAPI.modbus?.registers?.delete(registerId);
      await loadDeviceRegisters(selectedDevice.id);
    } catch (err: any) {
      setRegisterError(err.message || 'Failed to delete register');
    }
  };

  const handleRegisterFormSubmit = async () => {
    if (!selectedDevice) {
      return;
    }

    setRegisterError('');

    const functionCode = Number(registerFormData.functionCode);
    const address = Number(registerFormData.address);
    const quantity = Number(registerFormData.quantity);

    if (Number.isNaN(functionCode) || functionCode < 1 || functionCode > 4) {
      setRegisterError('Function code must be between 1 and 4.');
      return;
    }
    if (Number.isNaN(address) || address < 0) {
      setRegisterError('Address must be a non-negative number.');
      return;
    }
    if (Number.isNaN(quantity) || quantity < 1) {
      setRegisterError('Quantity must be at least 1.');
      return;
    }

    const scaleFactor =
      registerFormData.scaleFactor === '' ? undefined : Number(registerFormData.scaleFactor);
    if (scaleFactor !== undefined && Number.isNaN(scaleFactor)) {
      setRegisterError('Scale factor must be a number.');
      return;
    }

    const offset =
      registerFormData.offset === '' ? undefined : Number(registerFormData.offset);
    if (offset !== undefined && Number.isNaN(offset)) {
      setRegisterError('Offset must be a number.');
      return;
    }

    const payload: any = {
      deviceId: selectedDevice.id,
      name: registerFormData.name.trim() || `Register ${functionCode}-${address}`,
      functionCode,
      address,
      quantity,
      dataType: registerFormData.dataType,
      unit: registerFormData.unit.trim() || undefined,
      byteOrder: registerFormData.byteOrder || undefined,
      wordOrder: registerFormData.wordOrder || undefined,
      scaleFactor,
      offset,
    };

    try {
      if (registerEditing) {
        const { deviceId: _omit, ...updatePayload } = payload;
        await window.electronAPI.modbus?.registers?.update(registerEditing.id, updatePayload);
      } else {
        await window.electronAPI.modbus?.registers?.create(payload);
      }
      await loadDeviceRegisters(selectedDevice.id);
      handleRegisterFormClose();
    } catch (err: any) {
      setRegisterError(err.message || 'Failed to save register');
    }
  };

  const handleOpen = (device?: ModbusDevice) => {
    if (device) {
      setEditing(device);
      setFormData({
        name: device.name,
        type: device.type,
        enabled: device.enabled,
        autoStart: device.autoStart,
        host: device.host || '',
        port: device.port || 502,
        serialPort: device.serialPort || '',
        baudRate: device.baudRate || 9600,
        dataBits: device.dataBits || 8,
        stopBits: device.stopBits || 1,
        parity: device.parity || 'none',
        slaveId: device.slaveId,
        pollInterval: device.pollInterval,
        recordInterval: device.recordInterval || 5000,
        timeout: device.timeout,
        retryAttempts: device.retryAttempts,
      });
    } else {
      setEditing(null);
      setFormData({
        name: '',
        type: 'tcp',
        enabled: true,
        autoStart: false,
        host: '',
        port: 502,
        serialPort: '',
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        slaveId: 1,
        pollInterval: 1000,
        recordInterval: 5000,
        timeout: 5000,
        retryAttempts: 3,
      });
    }
    setOpen(true);
    setError('');
  };

  const handleClose = () => {
    setOpen(false);
    setEditing(null);
    setError('');
  };

  const handleSubmit = async () => {
    try {
      setError('');
      const deviceData = { ...formData };

      if (editing) {
        await window.electronAPI.modbus?.devices?.update(editing.id, deviceData);
      } else {
        await window.electronAPI.modbus?.devices?.create(deviceData);
      }

      await loadDevices();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save device');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this device?')) return;

    try {
      await window.electronAPI.modbus?.devices?.delete(id);
      await loadDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to delete device');
    }
  };

  const handleToggle = async (device: ModbusDevice) => {
    try {
      await window.electronAPI.modbus?.devices?.update(device.id, {
        ...device,
        enabled: !device.enabled,
      });
      await loadDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to toggle device');
    }
  };

  const handleAutoStartToggle = async (device: ModbusDevice) => {
    try {
      await window.electronAPI.modbus?.devices?.update(device.id, {
        ...device,
        autoStart: !device.autoStart,
      });
      await loadDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to update auto-start');
    }
  };

  const handleConnect = async (id: string) => {
    try {
      setError('');
      await window.electronAPI.modbus?.connect(id);
      await loadConnectionStatus();
      await loadDevices();
      if (registerDialogOpen && selectedDevice?.id === id) {
        await loadDeviceRegisters(id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await window.electronAPI.modbus?.disconnect(id);
      await loadConnectionStatus();
      await loadDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Modbus Devices</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpen()}
        >
          Add Device
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
              <TableCell>Connection</TableCell>
              <TableCell>Slave ID</TableCell>
              <TableCell>Poll Interval</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell>{device.name}</TableCell>
                <TableCell>
                  <Chip label={device.type.toUpperCase()} size="small" />
                </TableCell>
                <TableCell>
                  {device.type === 'tcp' ? `${device.host}:${device.port}` : device.serialPort}
                </TableCell>
                <TableCell>{device.slaveId}</TableCell>
                <TableCell>{device.pollInterval}ms</TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Chip
                      label={connectionStatus[device.id] ? 'Connected' : 'Disconnected'}
                      color={connectionStatus[device.id] ? 'success' : 'default'}
                      size="small"
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={device.enabled}
                          onChange={() => handleToggle(device)}
                          size="small"
                        />
                      }
                      label="Enabled"
                      sx={{ ml: 1 }}
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={device.autoStart}
                          onChange={() => handleAutoStartToggle(device)}
                          size="small"
                        />
                      }
                      label="Auto Start"
                      sx={{ ml: 1 }}
                    />
                  </Box>
                </TableCell>
                <TableCell align="right">
                  {connectionStatus[device.id] ? (
                    <IconButton
                      size="small"
                      aria-label={`Disconnect ${device.name}`}
                      onClick={() => handleDisconnect(device.id)}
                      color="error"
                    >
                      <StopIcon />
                    </IconButton>
                  ) : (
                    <IconButton
                      size="small"
                      aria-label={`Connect ${device.name}`}
                      onClick={() => handleConnect(device.id)}
                      color="primary"
                    >
                      <PlayIcon />
                    </IconButton>
                  )}
                  <IconButton
                    size="small"
                    color="info"
                    aria-label={`Manage registers for ${device.name}`}
                    onClick={() => handleOpenRegisters(device)}
                  >
                    <SettingsIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleOpen(device)} aria-label={`Edit ${device.name}`}>
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(device.id)}
                    aria-label={`Delete ${device.name}`}
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {devices.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  No devices found. Click "Add Device" to create one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Device' : 'Add Modbus Device'}</DialogTitle>
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
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value as 'tcp' | 'rtu' })
              }
              fullWidth
            >
              <MenuItem value="tcp">TCP/IP</MenuItem>
              <MenuItem value="rtu">RTU (Serial)</MenuItem>
            </TextField>

            {formData.type === 'tcp' ? (
              <>
                <TextField
                  label="Host"
                  value={formData.host}
                  onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                  fullWidth
                  required
                />
                <TextField
                  label="Port"
                  type="number"
                  value={formData.port}
                  onChange={(e) =>
                    setFormData({ ...formData, port: parseInt(e.target.value) })
                  }
                  fullWidth
                />
              </>
            ) : (
              <>
                <TextField
                  label="Serial Port"
                  value={formData.serialPort}
                  onChange={(e) =>
                    setFormData({ ...formData, serialPort: e.target.value })
                  }
                  fullWidth
                  required
                />
                <TextField
                  label="Baud Rate"
                  type="number"
                  value={formData.baudRate}
                  onChange={(e) =>
                    setFormData({ ...formData, baudRate: parseInt(e.target.value) })
                  }
                  fullWidth
                />
                <TextField
                  label="Data Bits"
                  type="number"
                  value={formData.dataBits}
                  onChange={(e) =>
                    setFormData({ ...formData, dataBits: parseInt(e.target.value) })
                  }
                  fullWidth
                />
                <TextField
                  label="Stop Bits"
                  type="number"
                  value={formData.stopBits}
                  onChange={(e) =>
                    setFormData({ ...formData, stopBits: parseInt(e.target.value) })
                  }
                  fullWidth
                />
                <TextField
                  label="Parity"
                  select
                  value={formData.parity}
                  onChange={(e) => setFormData({ ...formData, parity: e.target.value })}
                  fullWidth
                >
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="even">Even</MenuItem>
                  <MenuItem value="odd">Odd</MenuItem>
                  <MenuItem value="mark">Mark</MenuItem>
                  <MenuItem value="space">Space</MenuItem>
                </TextField>
              </>
            )}

            <TextField
              label="Slave ID"
              type="number"
              value={formData.slaveId}
              onChange={(e) =>
                setFormData({ ...formData, slaveId: parseInt(e.target.value) })
              }
              fullWidth
            />
            <TextField
              label="Poll Interval (ms)"
              type="number"
              value={formData.pollInterval}
              onChange={(e) =>
                setFormData({ ...formData, pollInterval: parseInt(e.target.value) })
              }
              fullWidth
            />
            <TextField
              label="Record Interval (ms)"
              type="number"
              value={formData.recordInterval}
              onChange={(e) =>
                setFormData({ ...formData, recordInterval: parseInt(e.target.value) })
              }
              fullWidth
            />
            <TextField
              label="Timeout (ms)"
              type="number"
              value={formData.timeout}
              onChange={(e) =>
                setFormData({ ...formData, timeout: parseInt(e.target.value) })
              }
              fullWidth
            />
            <TextField
              label="Retry Attempts"
              type="number"
              value={formData.retryAttempts}
              onChange={(e) =>
                setFormData({ ...formData, retryAttempts: parseInt(e.target.value) })
              }
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.enabled}
                  onChange={(e) =>
                    setFormData({ ...formData, enabled: e.target.checked })
                  }
                />
              }
              label="Enabled"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.autoStart}
                  onChange={(e) =>
                    setFormData({ ...formData, autoStart: e.target.checked })
                  }
                />
              }
              label="Auto Start"
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

      <Dialog
        open={registerDialogOpen}
        onClose={handleRegisterDialogClose}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {selectedDevice ? `Modbus Registers • ${selectedDevice.name}` : 'Modbus Registers'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Registers define which Modbus addresses are polled for this device. If no registers are
            configured, the system will attempt to auto-discover a few defaults the first time you
            start the device, but you can refine them here for precise data acquisition.
          </Typography>

          {registerError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRegisterError('')}>
              {registerError}
            </Alert>
          )}

          {registerLoading ? (
            <Box display="flex" justifyContent="center" alignItems="center" py={6}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Function</TableCell>
                    <TableCell>Address</TableCell>
                    <TableCell>Quantity</TableCell>
                    <TableCell>Data Type</TableCell>
                    <TableCell>Unit</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {registers.map((register) => (
                    <TableRow key={register.id}>
                      <TableCell>{register.name}</TableCell>
                      <TableCell>FC {register.functionCode}</TableCell>
                      <TableCell>{register.address}</TableCell>
                      <TableCell>{register.quantity}</TableCell>
                      <TableCell>{register.dataType}</TableCell>
                      <TableCell>{register.unit || '—'}</TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => handleRegisterFormOpen(register)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleRegisterDelete(register.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {registers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        No registers defined yet. Add one manually or start the device to trigger
                        auto-discovery.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRegisterDialogClose}>Close</Button>
          <Button variant="contained" onClick={() => handleRegisterFormOpen()}>
            Add Register
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={registerFormOpen} onClose={handleRegisterFormClose} maxWidth="sm" fullWidth>
        <DialogTitle>{registerEditing ? 'Edit Register' : 'Add Register'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Name"
              value={registerFormData.name}
              onChange={(e) => setRegisterFormData({ ...registerFormData, name: e.target.value })}
              fullWidth
              placeholder="e.g. Temperature Sensor"
            />
            <TextField
              label="Function Code"
              select
              value={registerFormData.functionCode}
              onChange={(e) =>
                setRegisterFormData({
                  ...registerFormData,
                  functionCode: Number(e.target.value),
                })
              }
              fullWidth
            >
              <MenuItem value={1}>1 - Coils (Read/Write)</MenuItem>
              <MenuItem value={2}>2 - Discrete Inputs (Read Only)</MenuItem>
              <MenuItem value={3}>3 - Holding Registers (Read/Write)</MenuItem>
              <MenuItem value={4}>4 - Input Registers (Read Only)</MenuItem>
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Address"
                type="number"
                value={registerFormData.address}
                onChange={(e) =>
                  setRegisterFormData({ ...registerFormData, address: Number(e.target.value) })
                }
                fullWidth
              />
              <TextField
                label="Quantity"
                type="number"
                value={registerFormData.quantity}
                onChange={(e) =>
                  setRegisterFormData({ ...registerFormData, quantity: Number(e.target.value) })
                }
                fullWidth
              />
            </Box>
            <TextField
              label="Data Type"
              select
              value={registerFormData.dataType}
              onChange={(e) =>
                setRegisterFormData({ ...registerFormData, dataType: e.target.value })
              }
              fullWidth
            >
              <MenuItem value="bool">Boolean</MenuItem>
              <MenuItem value="int16">Int16</MenuItem>
              <MenuItem value="uint16">UInt16</MenuItem>
              <MenuItem value="int32">Int32</MenuItem>
              <MenuItem value="uint32">UInt32</MenuItem>
              <MenuItem value="float">Float (32-bit)</MenuItem>
              <MenuItem value="double">Double (64-bit)</MenuItem>
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Word Order"
                select
                value={registerFormData.wordOrder}
                onChange={(e) =>
                  setRegisterFormData({ ...registerFormData, wordOrder: e.target.value })
                }
                fullWidth
              >
                <MenuItem value="BE">Big Endian</MenuItem>
                <MenuItem value="LE">Little Endian</MenuItem>
              </TextField>
              <TextField
                label="Byte Order"
                select
                value={registerFormData.byteOrder}
                onChange={(e) =>
                  setRegisterFormData({ ...registerFormData, byteOrder: e.target.value })
                }
                fullWidth
              >
                <MenuItem value="ABCD">ABCD</MenuItem>
                <MenuItem value="BADC">BADC</MenuItem>
                <MenuItem value="CDAB">CDAB</MenuItem>
                <MenuItem value="DCBA">DCBA</MenuItem>
                <MenuItem value="">(Not Applicable)</MenuItem>
              </TextField>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Scale Factor"
                type="number"
                value={registerFormData.scaleFactor}
                onChange={(e) =>
                  setRegisterFormData({ ...registerFormData, scaleFactor: e.target.value })
                }
                fullWidth
                placeholder="Optional"
              />
              <TextField
                label="Offset"
                type="number"
                value={registerFormData.offset}
                onChange={(e) =>
                  setRegisterFormData({ ...registerFormData, offset: e.target.value })
                }
                fullWidth
                placeholder="Optional"
              />
            </Box>
            <TextField
              label="Unit"
              value={registerFormData.unit}
              onChange={(e) => setRegisterFormData({ ...registerFormData, unit: e.target.value })}
              fullWidth
              placeholder="e.g. °C, kPa"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRegisterFormClose}>Cancel</Button>
          <Button variant="contained" onClick={handleRegisterFormSubmit}>
            {registerEditing ? 'Save Changes' : 'Add Register'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModbusDevices;