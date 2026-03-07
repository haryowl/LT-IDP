import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Switch,
  FormControlLabel,
  Typography,
  Alert,
  Chip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
import api from '../api/client';

interface MqttDevice {
  id: string;
  name: string;
  enabled: boolean;
  autoStart: boolean;
  broker: string;
  port: number;
  protocol: string;
  clientId: string;
  username?: string;
  password?: string;
  qos: number;
  topics: string[];
  useTls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  tlsCa?: string;
  rejectUnauthorized: boolean;
  keepAlive: number;
  reconnectPeriod: number;
  createdAt: number;
  updatedAt: number;
}

const MqttDevices: React.FC = () => {
  const [devices, setDevices] = useState<MqttDevice[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MqttDevice | null>(null);
  const [error, setError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});

  const [formData, setFormData] = useState({
    name: '',
    enabled: true,
    autoStart: false,
    broker: '',
    port: 1883,
    protocol: 'mqtt',
    clientId: '',
    username: '',
    password: '',
    qos: 0,
    topics: '',
    useTls: false,
    rejectUnauthorized: true,
    keepAlive: 60,
    reconnectPeriod: 5000,
  });

  useEffect(() => {
    loadDevices();
    loadConnectionStatus();
    const interval = setInterval(loadConnectionStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadDevices = async () => {
    try {
      const data = await api.mqtt?.devices?.list();
      setDevices(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load devices');
    }
  };

  const loadConnectionStatus = async () => {
    try {
      const status = await api.mqtt?.getStatus();
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

  const handleOpen = (device?: MqttDevice) => {
    if (device) {
      setEditing(device);
      setFormData({
        name: device.name,
        enabled: device.enabled,
        autoStart: device.autoStart,
        broker: device.broker,
        port: device.port,
        protocol: device.protocol,
        clientId: device.clientId,
        username: device.username || '',
        password: device.password || '',
        qos: device.qos,
        topics: device.topics.join(','),
        useTls: device.useTls,
        rejectUnauthorized: device.rejectUnauthorized,
        keepAlive: device.keepAlive,
        reconnectPeriod: device.reconnectPeriod,
      });
    } else {
      setEditing(null);
      setFormData({
        name: '',
        enabled: true,
        autoStart: false,
        broker: '',
        port: 1883,
        protocol: 'mqtt',
        clientId: '',
        username: '',
        password: '',
        qos: 0,
        topics: '',
        useTls: false,
        rejectUnauthorized: true,
        keepAlive: 60,
        reconnectPeriod: 5000,
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
      const deviceData = {
        ...formData,
        topics: formData.topics.split(',').map((t) => t.trim()).filter((t) => t),
      };

      if (editing) {
        await api.mqtt?.devices?.update(editing.id, deviceData);
      } else {
        await api.mqtt?.devices?.create(deviceData);
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
      await api.mqtt?.devices?.delete(id);
      await loadDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to delete device');
    }
  };

  const handleConnect = async (id: string) => {
    try {
      await api.mqtt?.connect(id);
      await loadConnectionStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    }
  };

  const handleDisconnect = async (id: string) => {
  const handleToggleEnabled = async (device: MqttDevice) => {
    try {
      await api.mqtt?.devices?.update(device.id, {
        ...device,
        enabled: !device.enabled,
      });
      await loadDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to update device');
    }
  };

  const handleAutoStartToggle = async (device: MqttDevice) => {
    try {
      await api.mqtt?.devices?.update(device.id, {
        ...device,
        autoStart: !device.autoStart,
      });
      await loadDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to update auto-start');
    }
  };

    try {
      await api.mqtt?.disconnect(id);
      await loadConnectionStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">MQTT Devices</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
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
              <TableCell>Broker</TableCell>
              <TableCell>Port</TableCell>
              <TableCell>Client ID</TableCell>
              <TableCell>Topics</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell>{device.name}</TableCell>
                <TableCell>{device.broker}</TableCell>
                <TableCell>{device.port}</TableCell>
                <TableCell>{device.clientId}</TableCell>
                <TableCell>
                  {device.topics.length > 0 ? device.topics.join(', ') : '-'}
                </TableCell>
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
                          onChange={() => handleToggleEnabled(device)}
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
                  <IconButton size="small" onClick={() => handleOpen(device)} aria-label={`Edit ${device.name}`}>
                    <EditIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDelete(device.id)} color="error" aria-label={`Delete ${device.name}`}>
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
        <DialogTitle>{editing ? 'Edit Device' : 'Add MQTT Device'}</DialogTitle>
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
              label="Broker"
              value={formData.broker}
              onChange={(e) => setFormData({ ...formData, broker: e.target.value })}
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
            <TextField
              label="Protocol"
              value={formData.protocol}
              onChange={(e) => setFormData({ ...formData, protocol: e.target.value })}
              fullWidth
            />
            <TextField
              label="Client ID"
              value={formData.clientId}
              onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Username"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              fullWidth
            />
            <TextField
              label="QoS"
              type="number"
              value={formData.qos}
              onChange={(e) => setFormData({ ...formData, qos: parseInt(e.target.value) })}
              fullWidth
              inputProps={{ min: 0, max: 2 }}
            />
            <TextField
              label="Topics (comma-separated)"
              value={formData.topics}
              onChange={(e) => setFormData({ ...formData, topics: e.target.value })}
              fullWidth
              placeholder="topic1, topic2, topic3"
            />
            <TextField
              label="Keep Alive (seconds)"
              type="number"
              value={formData.keepAlive}
              onChange={(e) =>
                setFormData({ ...formData, keepAlive: parseInt(e.target.value) })
              }
              fullWidth
            />
            <TextField
              label="Reconnect Period (ms)"
              type="number"
              value={formData.reconnectPeriod}
              onChange={(e) =>
                setFormData({ ...formData, reconnectPeriod: parseInt(e.target.value) })
              }
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.useTls}
                  onChange={(e) => setFormData({ ...formData, useTls: e.target.checked })}
                />
              }
              label="Use TLS"
            />
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
    </Box>
  );
};

export default MqttDevices;