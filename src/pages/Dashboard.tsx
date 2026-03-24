import React, { useEffect, useState } from 'react';
import {
  Box,
  Chip,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
} from '@mui/material';
import {
  Memory as MemoryIcon,
  Router as RouterIcon,
  Hub as HubIcon,
  Publish as PublishIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import api, { normalizeConnectionStatus } from '../api/client';

interface DashboardStats {
  modbusDevices: number;
  mqttDevices: number;
  mappings: number;
  publishers: number;
  modbusConnected: number;
  mqttConnected: number;
}

interface TxHealthState {
  mqttSuccess: number;
  mqttFail: number;
  httpSuccess: number;
  httpFail: number;
  lastMqttMessage?: string;
  lastHttpMessage?: string;
  lastMqttAt?: number;
  lastHttpAt?: number;
}

interface SparingHealthState {
  success: number;
  failed: number;
  queueDepth: number;
  lastHourlySend?: number | null;
  last2MinSend?: number | null;
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats>({
    modbusDevices: 0,
    mqttDevices: 0,
    mappings: 0,
    publishers: 0,
    modbusConnected: 0,
    mqttConnected: 0,
  });
  const [loading, setLoading] = useState(true);
  const [modbusReconnectAttempts, setModbusReconnectAttempts] = useState(0);
  const [modbusLastReconnectAt, setModbusLastReconnectAt] = useState<number | undefined>(undefined);
  const [txHealth, setTxHealth] = useState<TxHealthState>({
    mqttSuccess: 0,
    mqttFail: 0,
    httpSuccess: 0,
    httpFail: 0,
  });
  const [sparingHealth, setSparingHealth] = useState<SparingHealthState>({
    success: 0,
    failed: 0,
    queueDepth: 0,
  });

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [
          modbusDevices,
          mqttDevices,
          mappings,
          publishers,
          modbusStatus,
          mqttStatus,
          sparingLogs,
          sparingStatus,
        ] = await Promise.all([
          api.modbus.devices.list().catch(() => []),
          api.mqtt.devices.list().catch(() => []),
          api.mappings.list().catch(() => []),
          api.publishers.list().catch(() => []),
          api.modbus.getStatus().catch(() => ({})),
          api.mqtt.getStatus().catch(() => ({})),
          api.sparing.getLogs(100).catch(() => []),
          api.sparing.getStatus().catch(() => ({})),
        ]);

        const modbusList = normalizeConnectionStatus(modbusStatus || []);
        const modbusRaw = Array.isArray(modbusStatus)
          ? modbusStatus
          : Array.isArray((modbusStatus as any)?.data)
            ? (modbusStatus as any).data
            : [];
        const mqttList = normalizeConnectionStatus(mqttStatus || []);
        const modbusConnectedCount = modbusList.filter((s) => s.connected).length;
        const mqttConnectedCount = mqttList.filter((s) => s.connected).length;
        const reconnectAttempts = modbusRaw.reduce((acc: number, s: any) => acc + (Number(s.reconnectAttempts) || 0), 0);
        const lastReconnect = modbusRaw.reduce((max: number, s: any) => {
          const t = Number(s.lastReconnectAt || 0);
          return t > max ? t : max;
        }, 0);

        setStats({
          modbusDevices: Array.isArray(modbusDevices) ? modbusDevices.length : 0,
          mqttDevices: Array.isArray(mqttDevices) ? mqttDevices.length : 0,
          mappings: Array.isArray(mappings) ? mappings.length : 0,
          publishers: Array.isArray(publishers) ? publishers.length : 0,
          modbusConnected: modbusConnectedCount,
          mqttConnected: mqttConnectedCount,
        });
        setModbusReconnectAttempts(reconnectAttempts);
        setModbusLastReconnectAt(lastReconnect > 0 ? lastReconnect : undefined);

        const logs = Array.isArray(sparingLogs) ? sparingLogs : [];
        const success = logs.filter((l: any) => l.status === 'success').length;
        const failed = logs.filter((l: any) => l.status === 'failed').length;
        setSparingHealth({
          success,
          failed,
          queueDepth: Number((sparingStatus as any)?.queueDepth || 0),
          lastHourlySend: (sparingStatus as any)?.lastHourlySend,
          last2MinSend: (sparingStatus as any)?.last2MinSend,
        });
      } catch (error) {
        console.error('Failed to load dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
    const interval = setInterval(loadStats, 5000); // Refresh every 5 seconds
    const unsubscribePublisherLog = api.on('publisher:log', (logData: any) => {
      const msg = String(logData?.message || '');
      const level = String(logData?.level || '').toLowerCase();
      const isMqtt = msg.includes('MQTT Publisher') || msg.includes('topic "');
      const isHttp = msg.includes('HTTP Publisher') || msg.includes('http') || msg.includes(' to http');
      if (!isMqtt && !isHttp) return;
      const isSuccess =
        level === 'info' &&
        (msg.startsWith('Published data:') || msg.startsWith('Flushed buffer:') || msg.startsWith('Scheduled publish:'));
      const isFail =
        level === 'error' || msg.includes('Failed to publish') || msg.includes('Scheduled publish failed');
      setTxHealth((prev) => {
        const next = { ...prev };
        if (isMqtt) {
          if (isSuccess) next.mqttSuccess += 1;
          if (isFail) next.mqttFail += 1;
          next.lastMqttMessage = msg;
          next.lastMqttAt = Date.now();
        }
        if (isHttp) {
          if (isSuccess) next.httpSuccess += 1;
          if (isFail) next.httpFail += 1;
          next.lastHttpMessage = msg;
          next.lastHttpAt = Date.now();
        }
        return next;
      });
    });

    return () => {
      clearInterval(interval);
      if (typeof unsubscribePublisherLog === 'function') unsubscribePublisherLog();
    };
  }, []);

  const StatCard = ({
    title,
    value,
    icon,
    color,
  }: {
    title: string;
    value: number | string;
    icon: React.ReactNode;
    color: string;
  }) => (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography color="textSecondary" gutterBottom variant="body2">
              {title}
            </Typography>
            <Typography variant="h4" component="div">
              {loading ? '...' : value}
            </Typography>
          </Box>
          <Box sx={{ color }}>{icon}</Box>
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        System Overview and Statistics
      </Typography>

      <Grid container spacing={3} sx={{ mt: 2 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Modbus Devices"
            value={stats.modbusDevices}
            icon={<MemoryIcon sx={{ fontSize: 40 }} />}
            color="#1976d2"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="MQTT Devices"
            value={stats.mqttDevices}
            icon={<RouterIcon sx={{ fontSize: 40 }} />}
            color="#2e7d32"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Parameter Mappings"
            value={stats.mappings}
            icon={<HubIcon sx={{ fontSize: 40 }} />}
            color="#ed6c02"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Publishers"
            value={stats.publishers}
            icon={<PublishIcon sx={{ fontSize: 40 }} />}
            color="#9c27b0"
          />
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} sm={6} md={6}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <CheckCircleIcon sx={{ color: '#2e7d32', mr: 1 }} />
              <Typography variant="h6">Modbus Connections</Typography>
            </Box>
            <Typography variant="h3">
              {stats.modbusConnected} / {stats.modbusDevices}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Active connections
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={6}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <CheckCircleIcon sx={{ color: '#2e7d32', mr: 1 }} />
              <Typography variant="h6">MQTT Connections</Typography>
            </Box>
            <Typography variant="h3">
              {stats.mqttConnected} / {stats.mqttDevices}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Active connections
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Modbus Reconnect Health
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
              <Chip label={`Reconnect attempts: ${modbusReconnectAttempts}`} color={modbusReconnectAttempts > 0 ? 'warning' : 'success'} />
              <Chip
                label={modbusLastReconnectAt ? `Last reconnect: ${new Date(modbusLastReconnectAt).toLocaleString()}` : 'Last reconnect: -'}
                variant="outlined"
              />
            </Box>
            <Typography variant="body2" color="textSecondary">
              Attempts increase when device link is lost and auto-reconnect is triggered.
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              SPARING Transmission Health
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
              <Chip label={`Success: ${sparingHealth.success}`} color="success" />
              <Chip label={`Failed: ${sparingHealth.failed}`} color={sparingHealth.failed > 0 ? 'error' : 'default'} />
              <Chip label={`Queue: ${sparingHealth.queueDepth}`} color={sparingHealth.queueDepth > 0 ? 'warning' : 'default'} />
            </Box>
            <Typography variant="body2" color="textSecondary">
              Last hourly: {sparingHealth.lastHourlySend ? new Date(sparingHealth.lastHourlySend).toLocaleString() : '-'}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Last 2-min: {sparingHealth.last2MinSend ? new Date(sparingHealth.last2MinSend).toLocaleString() : '-'}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              MQTT 3rd-party Transmit Status
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
              <Chip label={`Success: ${txHealth.mqttSuccess}`} color="success" />
              <Chip label={`Failed: ${txHealth.mqttFail}`} color={txHealth.mqttFail > 0 ? 'error' : 'default'} />
            </Box>
            <Typography variant="body2" color="textSecondary" sx={{ wordBreak: 'break-word' }}>
              Last event: {txHealth.lastMqttMessage || '-'}
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              HTTP 3rd-party Transmit Status
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
              <Chip label={`Success: ${txHealth.httpSuccess}`} color="success" />
              <Chip label={`Failed: ${txHealth.httpFail}`} color={txHealth.httpFail > 0 ? 'error' : 'default'} />
            </Box>
            <Typography variant="body2" color="textSecondary" sx={{ wordBreak: 'break-word' }}>
              Last event: {txHealth.lastHttpMessage || '-'}
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;