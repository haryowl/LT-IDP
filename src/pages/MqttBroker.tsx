import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Typography,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  Chip,
  Grid,
  CircularProgress,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';

interface MqttBrokerConfig {
  id: string;
  name: string;
  enabled: boolean;
  autoStart: boolean;
  port: number;
  wsPort?: number;
  allowAnonymous: boolean;
  username?: string;
  password?: string;
  useTls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  tlsCa?: string;
  maxConnections: number;
  retainedMessages: boolean;
  persistenceEnabled: boolean;
  logLevel: string;
  createdAt: number;
  updatedAt: number;
}

const MqttBroker: React.FC = () => {
  const [config, setConfig] = useState<MqttBrokerConfig | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [localIp, setLocalIp] = useState<string>('');

  // Get local IP address
  useEffect(() => {
    const getLocalIp = async () => {
      try {
        const ip = await window.electronAPI.system?.getLocalIp();
        setLocalIp(ip || 'localhost');
      } catch (err) {
        console.error('Failed to get local IP:', err);
        setLocalIp('localhost');
      }
    };
    getLocalIp();
  }, []);

  useEffect(() => {
    loadConfig();
    loadStatus();
    checkInstalled();
    const interval = setInterval(loadStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const data = await window.electronAPI.mqtt?.broker?.get();
      if (data) {
        setConfig({ ...data, autoStart: !!data.autoStart });
      } else {
        // No config exists, initialize default
        await initializeDefaultConfig();
      }
    } catch (err: any) {
      console.error('Failed to load configuration:', err);
      // Try to initialize default config if load fails
      await initializeDefaultConfig();
    } finally {
      setLoading(false);
    }
  };

  const initializeDefaultConfig = async () => {
    try {
      const defaultConfig: Partial<MqttBrokerConfig> = {
        name: 'Local MQTT Broker',
        enabled: true,
        autoStart: false,
        port: 11883,
        wsPort: 19001,
        allowAnonymous: true,
        useTls: false,
        maxConnections: 100,
        retainedMessages: true,
        persistenceEnabled: true,
        logLevel: 'warning',
      };
      const saved = await window.electronAPI.mqtt?.broker?.save(defaultConfig);
      if (saved) {
        setConfig({ ...saved, autoStart: !!saved.autoStart });
      } else {
        // Fallback: use local default config
        setConfig({
          id: '',
          name: 'Local MQTT Broker',
          enabled: true,
          autoStart: false,
          port: 11883,
          wsPort: 19001,
          allowAnonymous: true,
          useTls: false,
          maxConnections: 100,
          retainedMessages: true,
          persistenceEnabled: true,
          logLevel: 'warning',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    } catch (err: any) {
      console.error('Failed to initialize configuration:', err);
      // Fallback: use local default config
      setConfig({
        id: '',
        name: 'Local MQTT Broker',
        enabled: true,
        autoStart: false,
        port: 11883,
        wsPort: 19001,
        allowAnonymous: true,
        useTls: false,
        maxConnections: 100,
        retainedMessages: true,
        persistenceEnabled: true,
        logLevel: 'warning',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  };

  const loadStatus = async () => {
    try {
      const data = await window.electronAPI.mqtt?.broker?.getStatus();
      console.log('[MQTT Broker] Status:', data);
      setStatus(data);
    } catch (err) {
      console.error('[MQTT Broker] Failed to load status:', err);
    }
  };

  const checkInstalled = async () => {
    try {
      const installed = await window.electronAPI.mqtt?.broker?.checkInstalled();
      setIsInstalled(installed);
    } catch (err) {
      console.error('Failed to check if Mosquitto is installed:', err);
    }
  };

  const handleSave = async () => {
    if (!config) return;

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const updated = await window.electronAPI.mqtt?.broker?.save(config);
      setConfig(updated);
      setSuccess('Configuration saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    try {
      setStarting(true);
      setError('');
      setSuccess('');

      console.log('[MQTT Broker] Starting broker...');
      await window.electronAPI.mqtt?.broker?.start();
      console.log('[MQTT Broker] Broker started successfully');
      setSuccess('Broker started successfully');
      setTimeout(() => setSuccess(''), 3000);
      await loadStatus();
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to start broker';
      console.error('[MQTT Broker] Start error:', errorMessage);
      console.error('[MQTT Broker] Full error object:', err);
      setError(errorMessage);
      // Keep error visible longer for detailed messages
      setTimeout(() => setError(''), 10000);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      setStopping(true);
      setError('');
      setSuccess('');

      await window.electronAPI.mqtt?.broker?.stop();
      setSuccess('Broker stopped successfully');
      setTimeout(() => setSuccess(''), 3000);
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to stop broker');
    } finally {
      setStopping(false);
    }
  };


  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">MQTT Broker</Typography>
        <Box display="flex" gap={2}>
          {status?.running ? (
            <Button
              variant="contained"
              color="error"
              startIcon={stopping ? <CircularProgress size={20} /> : <StopIcon />}
              onClick={handleStop}
              disabled={stopping}
            >
              Stop Broker
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              startIcon={starting ? <CircularProgress size={20} /> : <PlayIcon />}
              onClick={handleStart}
              disabled={starting || isInstalled === false}
            >
              Start Broker
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadStatus}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert 
          severity="error" 
          sx={{ 
            mb: 2,
            whiteSpace: 'pre-wrap',
            '& .MuiAlert-message': {
              width: '100%',
            },
          }} 
          onClose={() => setError('')}
        >
          <Typography variant="body2" component="div" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
            {error}
          </Typography>
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {isInstalled === false && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Mosquitto MQTT broker is not installed. Please install Mosquitto to use this feature.
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Configuration
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {loading && !config ? (
                <Box sx={{ p: 2, textAlign: 'center' }}>
                  <CircularProgress />
                  <Typography variant="body2" sx={{ mt: 2 }}>
                    Loading configuration...
                  </Typography>
                </Box>
              ) : config ? (
                <>
                  <TextField
                    label="Name"
                    value={config.name || ''}
                    onChange={(e) =>
                      setConfig({ ...config, name: e.target.value })
                    }
                    fullWidth
                  />
                  <TextField
                    label="Port"
                    type="number"
                    value={config.port}
                    onChange={(e) =>
                      setConfig({ ...config, port: parseInt(e.target.value) })
                    }
                    fullWidth
                  />
                  <TextField
                    label="WebSocket Port"
                    type="number"
                    value={config.wsPort || 19001}
                    onChange={(e) =>
                      setConfig({ ...config, wsPort: parseInt(e.target.value) })
                    }
                    fullWidth
                  />
                  <TextField
                    label="Max Connections"
                    type="number"
                    value={config.maxConnections}
                    onChange={(e) =>
                      setConfig({ ...config, maxConnections: parseInt(e.target.value) })
                    }
                    fullWidth
                  />
                  <TextField
                    label="Log Level"
                    select
                    value={config.logLevel}
                    onChange={(e) =>
                      setConfig({ ...config, logLevel: e.target.value })
                    }
                    fullWidth
                    SelectProps={{ native: true }}
                  >
                    <option value="error">Error</option>
                    <option value="warning">Warning</option>
                    <option value="notice">Notice</option>
                    <option value="information">Information</option>
                    <option value="debug">Debug</option>
                    <option value="none">None</option>
                  </TextField>

                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.allowAnonymous}
                        onChange={(e) =>
                          setConfig({ ...config, allowAnonymous: e.target.checked })
                        }
                      />
                    }
                    label="Allow Anonymous Access"
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.autoStart}
                        onChange={(e) =>
                          setConfig({ ...config, autoStart: e.target.checked })
                        }
                      />
                    }
                    label="Auto Start on Application Launch"
                  />

                  {!config.allowAnonymous && (
                    <>
                      <TextField
                        label="Username"
                        value={config.username || ''}
                        onChange={(e) =>
                          setConfig({ ...config, username: e.target.value })
                        }
                        fullWidth
                      />
                      <TextField
                        label="Password"
                        type="password"
                        value={config.password || ''}
                        onChange={(e) =>
                          setConfig({ ...config, password: e.target.value })
                        }
                        fullWidth
                      />
                    </>
                  )}

                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.useTls}
                        onChange={(e) =>
                          setConfig({ ...config, useTls: e.target.checked })
                        }
                      />
                    }
                    label="Use TLS/SSL"
                  />

                  {config.useTls && (
                    <>
                      <TextField
                        label="TLS Certificate Path"
                        value={config.tlsCert || ''}
                        onChange={(e) =>
                          setConfig({ ...config, tlsCert: e.target.value })
                        }
                        fullWidth
                      />
                      <TextField
                        label="TLS Key Path"
                        value={config.tlsKey || ''}
                        onChange={(e) =>
                          setConfig({ ...config, tlsKey: e.target.value })
                        }
                        fullWidth
                      />
                      <TextField
                        label="TLS CA Path"
                        value={config.tlsCa || ''}
                        onChange={(e) =>
                          setConfig({ ...config, tlsCa: e.target.value })
                        }
                        fullWidth
                      />
                    </>
                  )}

                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.retainedMessages}
                        onChange={(e) =>
                          setConfig({ ...config, retainedMessages: e.target.checked })
                        }
                      />
                    }
                    label="Retained Messages"
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.persistenceEnabled}
                        onChange={(e) =>
                          setConfig({ ...config, persistenceEnabled: e.target.checked })
                        }
                      />
                    }
                    label="Persistence Enabled"
                  />

                  <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={saving}
                    fullWidth
                  >
                    {saving ? <CircularProgress size={24} /> : 'Save Configuration'}
                  </Button>
                </>
              ) : null}
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Status
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box display="flex" alignItems="center" gap={1}>
                {status?.running ? (
                  <>
                    <CheckCircleIcon color="success" />
                    <Chip label="Running" color="success" />
                  </>
                ) : (
                  <>
                    <ErrorIcon color="error" />
                    <Chip label="Stopped" color="error" />
                  </>
                )}
              </Box>

              {status?.running && config && (
                <>
                  <Box sx={{ mt: 2, p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      <strong>Connection Information for Local Devices:</strong>
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 1 }}>
                      <strong>Broker Address:</strong> <code>{localIp}</code> or <code>localhost</code>
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 1 }}>
                      <strong>Port:</strong> <code>{config.port}</code>
                    </Typography>
                    {config.wsPort && (
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 1 }}>
                        <strong>WebSocket Port:</strong> <code>{config.wsPort}</code>
                      </Typography>
                    )}
                    {!config.allowAnonymous && (
                      <>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 1 }}>
                          <strong>Username:</strong> <code>{config.username || 'N/A'}</code>
                        </Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 1 }}>
                          <strong>Password:</strong> <code>••••••••</code>
                        </Typography>
                      </>
                    )}
                    <Typography variant="body2" sx={{ mt: 1, fontSize: '0.75rem' }}>
                      <strong>How it works:</strong> The broker listens on <code>0.0.0.0</code> (all network interfaces), 
                      allowing devices on your local network to connect. When devices publish messages to any topic, 
                      this app automatically receives and processes them through parameter mappings.
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1, fontSize: '0.75rem', fontStyle: 'italic' }}>
                      <strong>Tip:</strong> Configure parameter mappings with source type "MQTT" and device "Local MQTT Broker (Internal)" 
                      to process incoming messages from network devices.
                    </Typography>
                  </Box>

                  <Typography variant="body2">
                    <strong>Active Connections:</strong> {status.connections || 0}
                  </Typography>
                  {status.startTime && (
                    <Typography variant="body2">
                      <strong>Uptime:</strong>{' '}
                      {Math.floor((Date.now() - status.startTime) / 1000 / 60)} minutes
                    </Typography>
                  )}
                </>
              )}

              {status?.lastError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {status.lastError}
                </Alert>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MqttBroker;
