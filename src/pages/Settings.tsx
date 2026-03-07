import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import api from '../api/client';
import { systemTimestampDefaults } from './ParameterMappings';

interface ParameterMapping {
  id: string;
  name: string;
  sourceType: 'modbus' | 'mqtt' | 'system';
  sourceDeviceId: string;
  mappedName: string;
  dataType: string;
  inputFormat?: string;
  inputTimezone?: string;
  outputFormat?: string;
  outputTimezone?: string;
}

const timestampFormatOptions = [
  'UNIX_MS',
  'ISO8601',
  'YYYY-MM-DD HH:mm:ss',
  'DD/MM/YYYY HH:mm:ss',
  'MM/DD/YYYY HH:mm:ss',
  'YYYY-MM-DD',
  'HH:mm:ss',
];

const Settings: React.FC = () => {
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [timestampMapping, setTimestampMapping] = useState<ParameterMapping | null>(null);
  const [timestampForm, setTimestampForm] = useState({
    inputFormat: systemTimestampDefaults.inputFormat,
    inputTimezone: systemTimestampDefaults.inputTimezone,
    outputFormat: systemTimestampDefaults.outputFormat,
    outputTimezone: systemTimestampDefaults.outputTimezone,
  });
  const [timestampInterval, setTimestampInterval] = useState<number>(60);
  const [timestampSaving, setTimestampSaving] = useState(false);
  const [timestampMessage, setTimestampMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const timezoneOptions = useMemo(() => {
    const tz: string[] = [];
    for (let offset = -12; offset <= 14; offset++) {
      const sign = offset >= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      tz.push(`UTC${sign}${abs.toString().padStart(2, '0')}`);
    }
    return tz;
  }, []);

  useEffect(() => {
    loadSettings();
    loadTimestampMapping();
  }, []);

  const loadSettings = async () => {
    try {
      const id = await api.system?.getClientId();
      setClientId(id || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
    }
  };

  const loadTimestampMapping = async () => {
    try {
      const data = await api.mappings?.list();
      const mapping = Array.isArray(data)
        ? data.find(
            (m: ParameterMapping) =>
              m.sourceType === 'system' &&
              (m.sourceDeviceId === 'system-timestamp' || m.mappedName?.toLowerCase().includes('time'))
          )
        : null;

      if (mapping) {
        setTimestampMapping(mapping);
        setTimestampForm({
          inputFormat: mapping.inputFormat || systemTimestampDefaults.inputFormat,
          inputTimezone: mapping.inputTimezone || systemTimestampDefaults.inputTimezone,
          outputFormat: mapping.outputFormat || systemTimestampDefaults.outputFormat,
          outputTimezone: mapping.outputTimezone || systemTimestampDefaults.outputTimezone,
        });
      } else {
        setTimestampMapping(null);
      }

      const intervalValue = await api.system?.getTimestampInterval();
      if (typeof intervalValue === 'number') {
        setTimestampInterval(intervalValue);
      }
    } catch (error: any) {
      setTimestampMessage({
        type: 'error',
        text: error.message || 'Failed to load system timestamp configuration.',
      });
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      await api.system?.setClientId(clientId);
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTimestamp = async () => {
    if (!timestampMapping) {
      return;
    }

    try {
      setTimestampSaving(true);
      setTimestampMessage(null);
      await api.mappings?.update(timestampMapping.id, {
        inputFormat: timestampForm.inputFormat || null,
        inputTimezone: timestampForm.inputTimezone || null,
        outputFormat: timestampForm.outputFormat || null,
        outputTimezone: timestampForm.outputTimezone || null,
      });
      await api.system?.setTimestampInterval(timestampInterval);
      setTimestampMessage({ type: 'success', text: 'System timestamp format updated.' });
      await loadTimestampMapping();
    } catch (error: any) {
      setTimestampMessage({
        type: 'error',
        text: error.message || 'Failed to update system timestamp format.',
      });
    } finally {
      setTimestampSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        System Configuration
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          System Identification
        </Typography>
        <Divider sx={{ mb: 3 }} />
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              fullWidth
              helperText="Unique identifier for this client"
            />
          </Grid>
        </Grid>
        <Box sx={{ mt: 3 }}>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={loading}
          >
            Save Settings
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          System Timestamp Format
        </Typography>
        <Divider sx={{ mb: 3 }} />

        {timestampMessage && (
          <Alert
            severity={timestampMessage.type}
            sx={{ mb: 2 }}
            onClose={() => setTimestampMessage(null)}
          >
            {timestampMessage.text}
          </Alert>
        )}

        {timestampMapping ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Chip label={`Mapping: ${timestampMapping.mappedName}`} sx={{ mr: 1 }} />
              <Chip label={`Source: ${timestampMapping.sourceType}`} />
            </Box>
            <Autocomplete
              options={timestampFormatOptions}
              freeSolo
              value={timestampForm.inputFormat}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputFormat: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputFormat: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Input Format"
                  helperText="Format of the incoming timestamp (e.g., ISO8601, UNIX_MS)"
                />
              )}
            />
            <Autocomplete
              options={timezoneOptions}
              freeSolo
              value={timestampForm.inputTimezone}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputTimezone: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, inputTimezone: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Input Timezone"
                  helperText="Timezone of the incoming timestamp (e.g., UTC+0)"
                />
              )}
            />
            <Autocomplete
              options={timestampFormatOptions}
              freeSolo
              value={timestampForm.outputFormat}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputFormat: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputFormat: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Output Format"
                  helperText="Format for the output timestamp"
                />
              )}
            />
            <Autocomplete
              options={timezoneOptions}
              freeSolo
              value={timestampForm.outputTimezone}
              onChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputTimezone: value || '' }))
              }
              onInputChange={(_, value) =>
                setTimestampForm((prev) => ({ ...prev, outputTimezone: value }))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Output Timezone"
                  helperText="Timezone for the output timestamp"
                />
              )}
            />
            <TextField
              label="Store Interval (seconds)"
              type="number"
              value={timestampInterval}
              onChange={(e) => {
                const value = Number(e.target.value);
                setTimestampInterval(Number.isFinite(value) && value > 0 ? Math.floor(value) : 1);
              }}
              helperText="How often the system timestamp is saved to historical data"
            />
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="textSecondary">
                Common placeholders when formatting:
              </Typography>
              <Typography variant="body2" color="textSecondary">
                <code>UNIX_MS</code>, <code>ISO8601</code>, <code>YYYY-MM-DD HH:mm:ss</code>, <code>UTC+7</code>, etc.
              </Typography>
            </Box>
            <Box display="flex" justifyContent="flex-end">
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveTimestamp}
                disabled={timestampSaving}
              >
                {timestampSaving ? 'Saving...' : 'Save Timestamp Format'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Alert severity="info">
            No system timestamp mapping found. Create one under Parameter Mappings to manage its format here.
          </Alert>
        )}
      </Paper>
    </Box>
  );
};

export default Settings;
