import React, { useEffect, useState } from 'react';
import {
  Box,
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

interface DashboardStats {
  modbusDevices: number;
  mqttDevices: number;
  mappings: number;
  publishers: number;
  modbusConnected: number;
  mqttConnected: number;
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

  useEffect(() => {
    const loadStats = async () => {
      try {
        if (!window.electronAPI) {
          console.error('Electron API not available');
          return;
        }

        const [
          modbusDevices,
          mqttDevices,
          mappings,
          publishers,
          modbusStatus,
          mqttStatus,
        ] = await Promise.all([
          window.electronAPI.modbus?.devices?.list() || Promise.resolve([]),
          window.electronAPI.mqtt?.devices?.list() || Promise.resolve([]),
          window.electronAPI.mappings?.list() || Promise.resolve([]),
          window.electronAPI.publishers?.list() || Promise.resolve([]),
          window.electronAPI.modbus?.getStatus() || Promise.resolve({}),
          window.electronAPI.mqtt?.getStatus() || Promise.resolve({}),
        ]);

        const modbusConnections = modbusStatus.connections || {};
        const mqttConnections = mqttStatus.connections || {};

        setStats({
          modbusDevices: Array.isArray(modbusDevices) ? modbusDevices.length : 0,
          mqttDevices: Array.isArray(mqttDevices) ? mqttDevices.length : 0,
          mappings: Array.isArray(mappings) ? mappings.length : 0,
          publishers: Array.isArray(publishers) ? publishers.length : 0,
          modbusConnected: Object.keys(modbusConnections).filter(
            (key) => modbusConnections[key]?.connected
          ).length,
          mqttConnected: Object.keys(mqttConnections).filter(
            (key) => mqttConnections[key]?.connected
          ).length,
        });
      } catch (error) {
        console.error('Failed to load dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
    const interval = setInterval(loadStats, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
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
    </Box>
  );
};

export default Dashboard;