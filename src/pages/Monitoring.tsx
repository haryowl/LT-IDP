import React, { useEffect, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
} from '@mui/material';
import { useErrorSnackbar } from '../contexts/ErrorSnackbarContext';

interface RealtimeData {
  mappingId: string;
  mappingName: string;
  parameterId?: string;
  value: any;
  unit?: string;
  timestamp: number;
  quality: 'good' | 'bad' | 'uncertain';
}

const Monitoring: React.FC = () => {
  const { showError } = useErrorSnackbar();
  const [data, setData] = useState<Record<string, RealtimeData>>({});
  const [mappings, setMappings] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const load = async () => {
      try {
        const list = await window.electronAPI.mappings?.list();
        const next = Array.isArray(list) ? list : [];
        setMappings(next);
      } catch (err: any) {
        const msg = err.message || 'Failed to load mappings';
        setError(msg);
        showError(msg);
      }
    };
    load();

    unsubscribe = window.electronAPI.on?.('data:realtime', (realtimeData: RealtimeData) => {
      setData((prev) => ({
        ...prev,
        [realtimeData.mappingId]: realtimeData,
      }));
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (mappings.length === 0) return;
    const mappingIds = mappings.map((m) => m.id);
    window.electronAPI.data?.subscribeRealtime(mappingIds).catch((err: any) => {
      const msg = err?.message || 'Failed to subscribe to realtime data';
      setError(msg);
      showError(msg);
    });
  }, [mappings]);

  const formatValue = (value: any, unit?: string) => {
    if (value === null || value === undefined) return '-';
    const formatted = typeof value === 'number' ? value.toFixed(2) : String(value);
    return unit ? `${formatted} ${unit}` : formatted;
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getQualityColor = (quality: string) => {
    switch (quality) {
      case 'good':
        return 'success';
      case 'bad':
        return 'error';
      case 'uncertain':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Real-time Monitoring
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        Live data from connected devices
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Mapping Name</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Quality</TableCell>
              <TableCell>Last Update</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.map((mapping) => {
              const realtimeData = data[mapping.id];
              return (
                <TableRow key={mapping.id}>
                  <TableCell>{mapping.name}</TableCell>
                  <TableCell>
                    <Typography variant="h6">
                      {realtimeData
                        ? formatValue(realtimeData.value, realtimeData.unit || mapping.unit)
                        : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {realtimeData ? (
                      <Chip
                        label={realtimeData.quality.toUpperCase()}
                        color={getQualityColor(realtimeData.quality) as any}
                        size="small"
                      />
                    ) : (
                      <Chip label="NO DATA" color="default" size="small" />
                    )}
                  </TableCell>
                  <TableCell>
                    {realtimeData
                      ? formatTimestamp(realtimeData.timestamp)
                      : '-'}
                  </TableCell>
                </TableRow>
              );
            })}
            {mappings.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  No parameter mappings found. Create mappings to see real-time data.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default Monitoring;