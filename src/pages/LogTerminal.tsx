import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  IconButton,
  Alert,
} from '@mui/material';
import {
  Clear as ClearIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
import api from '../api/client';

interface LogEntry {
  id: string;
  timestamp: number;
  type: 'modbus' | 'mqtt' | 'publisher';
  message: string;
  data?: any;
}

const LogTerminal: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(true);
  const [filter, setFilter] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunning) {
      const unsubscribeModbus = api.on?.('modbus:data', (data: any) => {
        addLog({
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          type: 'modbus',
          message: `Modbus Data: ${JSON.stringify(data)}`,
          data,
        });
      });

      const unsubscribeMqtt = api.on?.('mqtt:data', (data: any) => {
        addLog({
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          type: 'mqtt',
          message: `MQTT Data: ${JSON.stringify(data)}`,
          data,
        });
      });

      const unsubscribePublisher = api.on?.('publisher:log', (logData: any) => {
        addLog({
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          type: 'publisher',
          message: `Publisher Log: ${JSON.stringify(logData)}`,
          data: logData,
        });
      });

      return () => {
        if (unsubscribeModbus) unsubscribeModbus();
        if (unsubscribeMqtt) unsubscribeMqtt();
        if (unsubscribePublisher) unsubscribePublisher();
      };
    }
  }, [isRunning]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (log: LogEntry) => {
    setLogs((prev) => [...prev.slice(-499), log]); // Keep last 500 logs
  };

  const handleClear = () => {
    setLogs([]);
  };

  const filteredLogs = logs.filter((log) => {
    if (!filter) return true;
    const searchLower = filter.toLowerCase();
    return (
      log.type.toLowerCase().includes(searchLower) ||
      log.message.toLowerCase().includes(searchLower)
    );
  });

  const getLogColor = (type: string) => {
    switch (type) {
      case 'modbus':
        return '#1976d2';
      case 'mqtt':
        return '#2e7d32';
      case 'publisher':
        return '#ed6c02';
      default:
        return '#666';
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Log Terminal</Typography>
        <Box display="flex" gap={2}>
          <TextField
            size="small"
            placeholder="Filter logs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            sx={{ width: 200 }}
          />
          <Button
            variant="outlined"
            startIcon={isRunning ? <StopIcon /> : <PlayIcon />}
            onClick={() => setIsRunning(!isRunning)}
          >
            {isRunning ? 'Stop' : 'Start'}
          </Button>
          <IconButton onClick={handleClear} color="error" aria-label="Clear log">
            <ClearIcon />
          </IconButton>
        </Box>
      </Box>

      {!isRunning && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Log monitoring is paused
        </Alert>
      )}

      <Paper
        sx={{
          p: 2,
          height: 'calc(100vh - 250px)',
          overflow: 'auto',
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          fontFamily: 'monospace',
          fontSize: '12px',
        }}
      >
        {filteredLogs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No logs to display. {isRunning ? 'Waiting for data...' : 'Log monitoring is paused.'}
          </Typography>
        ) : (
          filteredLogs.map((log) => (
            <Box
              key={log.id}
              sx={{
                mb: 1,
                borderLeft: `3px solid ${getLogColor(log.type)}`,
                pl: 1,
              }}
            >
              <Box display="flex" gap={1}>
                <Typography
                  component="span"
                  sx={{
                    color: getLogColor(log.type),
                    fontWeight: 'bold',
                    minWidth: 80,
                  }}
                >
                  [{log.type.toUpperCase()}]
                </Typography>
                <Typography component="span" sx={{ color: '#888', minWidth: 150 }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </Typography>
                <Typography component="span">{log.message}</Typography>
              </Box>
            </Box>
          ))
        )}
        <div ref={logEndRef} />
      </Paper>
    </Box>
  );
};

export default LogTerminal;
