import React, { useEffect, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Grid,
  Alert,
  Divider,
  CircularProgress,
} from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import api from '../api/client';

interface Settings {
  enabled: boolean;
  apiBaseUrl: string;
  token: string;
  secretKeyConfigured: boolean;
  phoneNumbers: string;
  notifyThresholdAlerts: boolean;
  notifyAdvancedAlerts: boolean;
  notifyDiskLow: boolean;
  diskFreePercentThreshold: number;
  cooldownMinutes: number;
  lastThresholdSentAt?: number | null;
  lastAdvancedSentAt?: number | null;
  lastDiskAlertAt?: number | null;
}

const WhatsAppNotifications: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [form, setForm] = useState<Partial<Settings>>({});

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.whatsappNotifications.get();
      setForm(data as Settings);
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const payload: any = { ...form };
      if (secretKey.trim()) payload.secretKey = secretKey.trim();
      await api.whatsappNotifications.save(payload);
      setSecretKey('');
      setSuccess('Settings saved');
      await load();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    try {
      setTesting(true);
      setError('');
      const r = await api.whatsappNotifications.test();
      if (r?.ok) setSuccess('Test WhatsApp message sent. Check the recipient phone.');
      else setError(r?.error || 'Test failed');
      setTimeout(() => setSuccess(''), 5000);
    } catch (e: any) {
      setError(e?.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        WhatsApp notifications
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Send alerts via Wablas (API v2). Covers Threshold Rules, Advanced Rules (alert action), and low disk space.
        Keep your Wablas device connected in the dashboard.
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
        <FormControlLabel
          control={
            <Switch
              checked={!!form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
          }
          label="Enable WhatsApp notifications"
        />
        <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
          Wablas API
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              label="API base URL"
              fullWidth
              value={form.apiBaseUrl || ''}
              onChange={(e) => setForm((f) => ({ ...f, apiBaseUrl: e.target.value }))}
              placeholder="https://jogja.wablas.com"
              helperText="Regional host, e.g. https://jogja.wablas.com (no trailing path)"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Token"
              fullWidth
              value={form.token || ''}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
              helperText="Device → Settings in Wablas"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label={form.secretKeyConfigured ? 'Secret key (leave blank to keep)' : 'Secret key'}
              type="password"
              fullWidth
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete="new-password"
              helperText="Generated in device settings"
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Recipient phone numbers"
              fullWidth
              value={form.phoneNumbers || ''}
              onChange={(e) => setForm((f) => ({ ...f, phoneNumbers: e.target.value }))}
              placeholder="0812xxxxxxxx, 62813xxxxxxxx"
              helperText="Comma or semicolon separated. Leading 0 is converted to 62…"
            />
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          What to notify
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={!!form.notifyThresholdAlerts}
              onChange={(e) => setForm((f) => ({ ...f, notifyThresholdAlerts: e.target.checked }))}
            />
          }
          label="Threshold Rules (value / stale / connection alerts)"
        />
        <FormControlLabel
          control={
            <Switch
              checked={!!form.notifyAdvancedAlerts}
              onChange={(e) => setForm((f) => ({ ...f, notifyAdvancedAlerts: e.target.checked }))}
            />
          }
          label="Advanced Rules when Alert action is configured"
        />
        <FormControlLabel
          control={
            <Switch
              checked={!!form.notifyDiskLow}
              onChange={(e) => setForm((f) => ({ ...f, notifyDiskLow: e.target.checked }))}
            />
          }
          label="System health: low disk free space"
        />
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Disk free threshold (%)"
              type="number"
              fullWidth
              value={form.diskFreePercentThreshold ?? 10}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  diskFreePercentThreshold: Math.max(0, Math.min(100, parseFloat(e.target.value) || 10)),
                }))
              }
              helperText="Alert when free space is at or below this %"
              inputProps={{ min: 0, max: 100, step: 0.5 }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Cooldown (minutes)"
              type="number"
              fullWidth
              value={form.cooldownMinutes ?? 30}
              onChange={(e) =>
                setForm((f) => ({ ...f, cooldownMinutes: Math.max(1, parseInt(e.target.value, 10) || 30) }))
              }
              helperText="Minimum time between alerts of the same type"
            />
          </Grid>
        </Grid>
        <Box sx={{ mt: 2 }}>
          {form.lastThresholdSentAt != null && (
            <Typography variant="caption" display="block" color="text.secondary">
              Last threshold WhatsApp: {new Date(form.lastThresholdSentAt).toLocaleString()}
            </Typography>
          )}
          {form.lastAdvancedSentAt != null && (
            <Typography variant="caption" display="block" color="text.secondary">
              Last advanced WhatsApp: {new Date(form.lastAdvancedSentAt).toLocaleString()}
            </Typography>
          )}
          {form.lastDiskAlertAt != null && (
            <Typography variant="caption" display="block" color="text.secondary">
              Last disk WhatsApp: {new Date(form.lastDiskAlertAt).toLocaleString()}
            </Typography>
          )}
        </Box>
      </Paper>

      <Divider sx={{ my: 2 }} />
      <Box display="flex" gap={2} flexWrap="wrap">
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="outlined"
          startIcon={testing ? <CircularProgress size={18} /> : <WhatsAppIcon />}
          onClick={test}
          disabled={testing}
        >
          Send test message
        </Button>
      </Box>
    </Box>
  );
};

export default WhatsAppNotifications;
