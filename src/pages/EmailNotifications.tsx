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
import { Email as EmailIcon } from '@mui/icons-material';
import api from '../api/client';

interface Settings {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPasswordConfigured: boolean;
  fromAddress: string;
  toAddresses: string;
  scheduleEnabled: boolean;
  scheduleTime: string;
  scheduleIncludeSparing: boolean;
  scheduleIncludeAppLog: boolean;
  scheduleOnlyIfActivity: boolean;
  triggerSparingFailure: boolean;
  triggerCooldownMinutes: number;
  lastScheduledRunDate?: string | null;
  lastTriggerSentAt?: number | null;
}

const EmailNotifications: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [form, setForm] = useState<Partial<Settings>>({});

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.emailNotifications.get();
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
      if (smtpPassword.trim()) payload.smtpPassword = smtpPassword.trim();
      await api.emailNotifications.save(payload);
      setSmtpPassword('');
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
      const r = await api.emailNotifications.test();
      if (r?.ok) setSuccess('Test email sent. Check your inbox.');
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
        Email notifications
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Scheduled digest (SPARING / app log) and instant alerts when SPARING sends fail. Uses SMTP (Gmail, Office 365,
        etc.).
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
          SMTP
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <TextField
              label="SMTP host"
              fullWidth
              value={form.smtpHost || ''}
              onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
              placeholder="smtp.gmail.com"
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              label="Port"
              type="number"
              fullWidth
              value={form.smtpPort ?? 587}
              onChange={(e) => setForm((f) => ({ ...f, smtpPort: parseInt(e.target.value, 10) || 587 }))}
            />
          </Grid>
          <Grid item xs={6} md={2} display="flex" alignItems="center">
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.smtpSecure}
                  onChange={(e) => setForm((f) => ({ ...f, smtpSecure: e.target.checked }))}
                />
              }
              label="TLS/SSL (e.g. port 465)"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="SMTP username"
              fullWidth
              value={form.smtpUser || ''}
              onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label={form.smtpPasswordConfigured ? 'SMTP password (leave blank to keep)' : 'SMTP password'}
              type="password"
              fullWidth
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="From address"
              fullWidth
              value={form.fromAddress || ''}
              onChange={(e) => setForm((f) => ({ ...f, fromAddress: e.target.value }))}
              placeholder="same as username if unsure"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="To addresses"
              fullWidth
              value={form.toAddresses || ''}
              onChange={(e) => setForm((f) => ({ ...f, toAddresses: e.target.value }))}
              placeholder="a@x.com, b@x.com"
              helperText="Comma or semicolon separated"
            />
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Scheduled digest
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Once per day at the chosen local time. Includes last 24h SPARING stats (optional) and/or app log tail.
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={!!form.scheduleEnabled}
              onChange={(e) => setForm((f) => ({ ...f, scheduleEnabled: e.target.checked }))}
            />
          }
          label="Enable scheduled email"
        />
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Send at (local time)"
              type="time"
              fullWidth
              value={form.scheduleTime || '08:00'}
              onChange={(e) => setForm((f) => ({ ...f, scheduleTime: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.scheduleIncludeSparing}
                  onChange={(e) => setForm((f) => ({ ...f, scheduleIncludeSparing: e.target.checked }))}
                />
              }
              label="Include SPARING log summary (last 24h)"
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.scheduleIncludeAppLog}
                  onChange={(e) => setForm((f) => ({ ...f, scheduleIncludeAppLog: e.target.checked }))}
                />
              }
              label="Include application log (tail)"
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.scheduleOnlyIfActivity}
                  onChange={(e) => setForm((f) => ({ ...f, scheduleOnlyIfActivity: e.target.checked }))}
                />
              }
              label="Skip scheduled email if no SPARING activity in last 24h (still sends if app log section enabled)"
            />
          </Grid>
          {form.lastScheduledRunDate && (
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Last scheduled run date: {form.lastScheduledRunDate}
              </Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Trigger alerts
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={!!form.triggerSparingFailure}
              onChange={(e) => setForm((f) => ({ ...f, triggerSparingFailure: e.target.checked }))}
            />
          }
          label="Email immediately when a SPARING send fails (hourly / 2-min / test)"
        />
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Cooldown (minutes)"
              type="number"
              fullWidth
              value={form.triggerCooldownMinutes ?? 60}
              onChange={(e) =>
                setForm((f) => ({ ...f, triggerCooldownMinutes: Math.max(1, parseInt(e.target.value, 10) || 60) }))
              }
              helperText="Minimum time between failure alert emails"
            />
          </Grid>
          {form.lastTriggerSentAt != null && (
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Last trigger email: {new Date(form.lastTriggerSentAt).toLocaleString()}
              </Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      <Divider sx={{ my: 2 }} />
      <Box display="flex" gap={2} flexWrap="wrap">
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="outlined"
          startIcon={testing ? <CircularProgress size={18} /> : <EmailIcon />}
          onClick={test}
          disabled={testing}
        >
          Send test email
        </Button>
      </Box>
    </Box>
  );
};

export default EmailNotifications;
