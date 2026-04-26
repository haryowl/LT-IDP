import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
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
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, PlayArrow as PlayIcon } from '@mui/icons-material';
import api from '../api/client';

type AdvancedRule = {
  id: string;
  name: string;
  enabled: boolean;
  expression: string;
  inputs: string[];
  snapshotMappingIds: string[];
  cooldownSeconds?: number;
  reTriggerMode?: 'edge_only' | 'periodic_while_true';
  reTriggerIntervalSeconds?: number;
  timerIntervalSeconds?: number;
  actions: {
    alert?: { severity: 'info' | 'warning' | 'error' };
    publish?: { publisherIds: string[] };
    modbusWrite?: {
      enabled: boolean;
      deviceId: string;
      registerId: string;
      mode: 'once' | 'toggle_interval';
      valueTrue?: unknown;
      valueFalse?: unknown;
      intervalSeconds?: number;
      writeFalseOnStop?: boolean;
    };
  };
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
};

type AdvancedRuleEvent = {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  triggeredAt: number;
  payload: any;
};

const AdvancedRules: React.FC = () => {
  const [rules, setRules] = useState<AdvancedRule[]>([]);
  const [events, setEvents] = useState<AdvancedRuleEvent[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [publishers, setPublishers] = useState<any[]>([]);
  const [modbusDevices, setModbusDevices] = useState<any[]>([]);
  const [modbusRegisters, setModbusRegisters] = useState<any[]>([]);
  const [error, setError] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdvancedRule | null>(null);

  const emptyForm = {
    name: '',
    enabled: true,
    expression: 'num(value(\"mappingId\")) > 0',
    inputs: [] as string[],
    snapshotMappingIds: [] as string[],
    cooldownSeconds: 0,
    reTriggerMode: 'edge_only' as const,
    reTriggerIntervalSeconds: 60,
    timerIntervalSeconds: 0,
    alertEnabled: true,
    alertSeverity: 'warning' as const,
    publishEnabled: false,
    publishPublisherIds: [] as string[],
    modbusEnabled: false,
    modbusDeviceId: '',
    modbusRegisterId: '',
    modbusMode: 'once' as const,
    modbusValueTrueText: 'true',
    modbusValueFalseText: 'false',
    modbusIntervalSeconds: 1,
    modbusWriteFalseOnStop: true,
  };

  const [formData, setFormData] = useState({ ...emptyForm });

  useEffect(() => {
    loadAll();
    // refresh events periodically
    const id = window.setInterval(() => loadEvents(), 3000);
    return () => window.clearInterval(id);
  }, []);

  const mappingLookup = useMemo(() => {
    const m = new Map<string, any>();
    mappings.forEach((x) => m.set(x.id, x));
    return m;
  }, [mappings]);

  const selectedModbusRegister = useMemo(() => {
    return modbusRegisters.find((r) => r.id === (formData as any).modbusRegisterId);
  }, [modbusRegisters, formData]);

  const loadAll = async () => {
    try {
      setError('');
      const [r, m, p] = await Promise.all([
        api.advancedRules?.list?.(),
        api.mappings?.list?.(),
        api.publishers?.list?.(),
      ]);
      setRules(Array.isArray(r) ? (r as any) : []);
      setMappings(Array.isArray(m) ? m : []);
      setPublishers(Array.isArray(p) ? p : []);
      // Modbus lists are used only for action configuration; best effort.
      try {
        const d = await api.modbus?.devices?.list?.();
        setModbusDevices(Array.isArray(d) ? (d as any) : []);
      } catch {
        setModbusDevices([]);
      }
      await loadEvents();
    } catch (e: any) {
      setError(e?.message || 'Failed to load advanced rules');
    }
  };

  const loadRegisters = async (deviceId: string) => {
    try {
      if (!deviceId) {
        setModbusRegisters([]);
        return;
      }
      const list = await api.modbus?.registers?.list?.(deviceId);
      const regs = Array.isArray(list) ? (list as any[]) : [];
      // writes supported only for FC1 / FC3
      setModbusRegisters(regs.filter((r) => r && (r.functionCode === 1 || r.functionCode === 3)));
    } catch {
      setModbusRegisters([]);
    }
  };

  function isToggleCompatible(reg: any): boolean {
    if (!reg) return false;
    if (reg.functionCode === 1) return Number(reg.quantity || 1) === 1;
    if (reg.functionCode === 3) return String(reg.dataType || '').toLowerCase() === 'bool' && Number(reg.quantity || 1) === 1;
    return false;
  }

  function parseWriteValueForRegister(reg: any, raw: string): unknown {
    const t = String(raw || '').trim();
    if (!reg) return t;

    if (reg.functionCode === 1) {
      if (Number(reg.quantity || 1) > 1) {
        try {
          const arr = JSON.parse(raw) as unknown;
          if (!Array.isArray(arr)) throw new Error('Use a JSON array, e.g. [true,false,0,1]');
          if (arr.length !== Number(reg.quantity)) throw new Error(`Array must have exactly ${reg.quantity} elements.`);
          return arr;
        } catch (e: any) {
          if (e?.message?.includes('Array') || e?.message?.includes('JSON')) throw e;
          throw new Error('Invalid JSON array value for multi-coil write.');
        }
      }
      const lower = t.toLowerCase();
      if (lower === 'true' || t === '1') return true;
      if (lower === 'false' || t === '0') return false;
      throw new Error('Enter true/false/1/0 for a single coil.');
    }

    if (reg.functionCode === 3 && String(reg.dataType || '').toLowerCase() === 'bool') {
      const lower = t.toLowerCase();
      if (lower === 'true' || t === '1') return true;
      if (lower === 'false' || t === '0') return false;
      throw new Error('Enter true/false/1/0.');
    }

    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error('Enter a valid number.');
    return n;
  }

  const loadEvents = async () => {
    try {
      const list = await api.advancedRules?.events?.(200);
      setEvents(Array.isArray(list) ? (list as any) : []);
    } catch {
      setEvents([]);
    }
  };

  const handleOpen = (rule?: AdvancedRule) => {
    if (!rule) {
      setEditing(null);
      setFormData({ ...emptyForm });
      setOpen(true);
      return;
    }
    setEditing(rule);
    const mw = rule.actions?.modbusWrite;
    setFormData({
      name: rule.name,
      enabled: rule.enabled,
      expression: rule.expression,
      inputs: rule.inputs || [],
      snapshotMappingIds: rule.snapshotMappingIds || [],
      cooldownSeconds: rule.cooldownSeconds || 0,
      reTriggerMode: (rule.reTriggerMode || 'edge_only') as any,
      reTriggerIntervalSeconds: rule.reTriggerIntervalSeconds || 60,
      timerIntervalSeconds: rule.timerIntervalSeconds || 0,
      alertEnabled: !!rule.actions?.alert,
      alertSeverity: (rule.actions?.alert?.severity || 'warning') as any,
      publishEnabled: !!rule.actions?.publish,
      publishPublisherIds: rule.actions?.publish?.publisherIds || [],
      modbusEnabled: !!mw?.enabled,
      modbusDeviceId: mw?.deviceId || '',
      modbusRegisterId: mw?.registerId || '',
      modbusMode: (mw?.mode || 'once') as any,
      modbusValueTrueText: mw?.valueTrue === undefined ? 'true' : JSON.stringify(mw.valueTrue),
      modbusValueFalseText: mw?.valueFalse === undefined ? 'false' : JSON.stringify(mw.valueFalse),
      modbusIntervalSeconds: mw?.intervalSeconds ?? 1,
      modbusWriteFalseOnStop: mw?.writeFalseOnStop !== false,
    });
    if (mw?.deviceId) void loadRegisters(mw.deviceId);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditing(null);
  };

  const handleSubmit = async () => {
    try {
      setError('');
      const selectedReg = selectedModbusRegister;
      const modbusAction =
        formData.modbusEnabled && formData.modbusDeviceId && formData.modbusRegisterId
          ? (() => {
              const mode = formData.modbusMode as 'once' | 'toggle_interval';
              if (mode === 'toggle_interval' && !isToggleCompatible(selectedReg)) {
                throw new Error('Toggle mode requires a single boolean coil (FC1 qty=1) or boolean holding register (FC3 type=bool qty=1).');
              }
              const valueTrue = parseWriteValueForRegister(selectedReg, formData.modbusValueTrueText);
              const valueFalse =
                mode === 'toggle_interval' ? parseWriteValueForRegister(selectedReg, formData.modbusValueFalseText) : undefined;
              return {
                enabled: true,
                deviceId: formData.modbusDeviceId,
                registerId: formData.modbusRegisterId,
                mode,
                valueTrue,
                ...(mode === 'toggle_interval'
                  ? {
                      valueFalse,
                      intervalSeconds: Number(formData.modbusIntervalSeconds || 1),
                      writeFalseOnStop: !!formData.modbusWriteFalseOnStop,
                    }
                  : {}),
              };
            })()
          : undefined;
      const payload: any = {
        name: formData.name,
        enabled: formData.enabled,
        expression: formData.expression,
        inputs: formData.inputs,
        snapshotMappingIds: formData.snapshotMappingIds,
        cooldownSeconds: Number(formData.cooldownSeconds || 0),
        reTriggerMode: formData.reTriggerMode,
        reTriggerIntervalSeconds: Number(formData.reTriggerIntervalSeconds || 60),
        timerIntervalSeconds: Number(formData.timerIntervalSeconds || 0) || undefined,
        actions: {
          ...(formData.alertEnabled ? { alert: { severity: formData.alertSeverity } } : {}),
          ...(formData.publishEnabled ? { publish: { publisherIds: formData.publishPublisherIds } } : {}),
          ...(modbusAction ? { modbusWrite: modbusAction } : {}),
        },
      };

      if (editing) await api.advancedRules?.update?.(editing.id, payload);
      else await api.advancedRules?.create?.(payload);
      await loadAll();
      handleClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save rule');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await api.advancedRules?.delete?.(id);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete rule');
    }
  };

  const handleTest = async (id: string) => {
    try {
      await api.advancedRules?.test?.(id);
      await loadEvents();
    } catch (e: any) {
      setError(e?.message || 'Failed to test rule');
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Advanced Rules
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Expression-based rules that can reference multiple mappings and trigger alerts or immediate publish events.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
          New rule
        </Button>
        <Button variant="outlined" onClick={loadAll}>
          Refresh
        </Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Rules
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Enabled</TableCell>
                <TableCell>Inputs</TableCell>
                <TableCell>Actions</TableCell>
                <TableCell>Last trigger</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.enabled ? <Chip size="small" color="success" label="On" /> : <Chip size="small" label="Off" />}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {(r.inputs || []).slice(0, 4).map((id) => mappingLookup.get(id)?.mappedName || id).join(', ')}
                      {(r.inputs || []).length > 4 ? '…' : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {r.actions?.alert && <Chip size="small" label={`Alert: ${r.actions.alert.severity}`} />}
                      {r.actions?.publish && <Chip size="small" label={`Publish: ${r.actions.publish.publisherIds.length}`} />}
                      {r.actions?.modbusWrite?.enabled && (
                        <Chip
                          size="small"
                          label={`Modbus: ${r.actions.modbusWrite.mode === 'toggle_interval' ? 'toggle' : 'once'}`}
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button size="small" variant="outlined" startIcon={<PlayIcon />} onClick={() => handleTest(r.id)}>
                        Test
                      </Button>
                      <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => handleOpen(r)}>
                        Edit
                      </Button>
                      <Button size="small" color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => handleDelete(r.id)}>
                        Delete
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No rules yet.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Recent events
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Rule</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Message</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(e.triggeredAt).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>{e.ruleName}</TableCell>
                  <TableCell>
                    <Chip size="small" color={e.severity === 'error' ? 'error' : e.severity === 'warning' ? 'warning' : 'default'} label={e.severity} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{e.message}</Typography>
                  </TableCell>
                </TableRow>
              ))}
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary">No events yet.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Advanced Rule' : 'New Advanced Rule'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField label="Name" value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} fullWidth required />
            <FormControlLabel
              control={<Switch checked={formData.enabled} onChange={(e) => setFormData((p) => ({ ...p, enabled: e.target.checked }))} />}
              label="Enabled"
            />

            <TextField
              label="Expression"
              value={formData.expression}
              onChange={(e) => setFormData((p) => ({ ...p, expression: e.target.value }))}
              fullWidth
              multiline
              minRows={4}
              helperText={'Available helpers: value(mappingId), num(x), has(mappingId), ageMs(mappingId), if(cond,a,b), now(), Math.*'}
            />

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Inputs (trigger on change)</InputLabel>
                  <Select
                    multiple
                    value={formData.inputs}
                    onChange={(e) => setFormData((p) => ({ ...p, inputs: e.target.value as string[] }))}
                    input={<OutlinedInput label="Inputs (trigger on change)" />}
                    renderValue={(selected) =>
                      (selected as string[]).map((id) => mappingLookup.get(id)?.mappedName || id).join(', ')
                    }
                  >
                    {mappings.map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        <Checkbox checked={formData.inputs.includes(m.id)} />
                        <ListItemText primary={m.mappedName || m.name} secondary={m.parameterId || m.sourceDeviceId} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Snapshot mappings</InputLabel>
                  <Select
                    multiple
                    value={formData.snapshotMappingIds}
                    onChange={(e) => setFormData((p) => ({ ...p, snapshotMappingIds: e.target.value as string[] }))}
                    input={<OutlinedInput label="Snapshot mappings" />}
                    renderValue={(selected) =>
                      (selected as string[]).map((id) => mappingLookup.get(id)?.mappedName || id).join(', ')
                    }
                  >
                    {mappings.map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        <Checkbox checked={formData.snapshotMappingIds.includes(m.id)} />
                        <ListItemText primary={m.mappedName || m.name} secondary={m.parameterId || m.sourceDeviceId} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Cooldown (sec)"
                  type="number"
                  value={formData.cooldownSeconds}
                  onChange={(e) => setFormData((p) => ({ ...p, cooldownSeconds: Number(e.target.value || 0) }))}
                  fullWidth
                  inputProps={{ min: 0, max: 86400, step: 1 }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Re-trigger mode"
                  select
                  value={formData.reTriggerMode}
                  onChange={(e) => setFormData((p) => ({ ...p, reTriggerMode: e.target.value as any }))}
                  fullWidth
                >
                  <MenuItem value="edge_only">Edge only</MenuItem>
                  <MenuItem value="periodic_while_true">Periodic while true</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Re-trigger interval (sec)"
                  type="number"
                  value={formData.reTriggerIntervalSeconds}
                  onChange={(e) => setFormData((p) => ({ ...p, reTriggerIntervalSeconds: Number(e.target.value || 0) }))}
                  fullWidth
                  inputProps={{ min: 1, max: 86400, step: 1 }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Timer eval interval (sec)"
                  type="number"
                  value={formData.timerIntervalSeconds}
                  onChange={(e) => setFormData((p) => ({ ...p, timerIntervalSeconds: Number(e.target.value || 0) }))}
                  fullWidth
                  inputProps={{ min: 0, max: 3600, step: 1 }}
                  helperText="0 = off"
                />
              </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                Actions
              </Typography>
              <Stack spacing={1.5}>
                <FormControlLabel
                  control={<Switch checked={formData.alertEnabled} onChange={(e) => setFormData((p) => ({ ...p, alertEnabled: e.target.checked }))} />}
                  label="Alert (store + broadcast)"
                />
                {formData.alertEnabled && (
                  <TextField
                    label="Alert severity"
                    select
                    value={formData.alertSeverity}
                    onChange={(e) => setFormData((p) => ({ ...p, alertSeverity: e.target.value as any }))}
                    fullWidth
                  >
                    <MenuItem value="info">info</MenuItem>
                    <MenuItem value="warning">warning</MenuItem>
                    <MenuItem value="error">error</MenuItem>
                  </TextField>
                )}
                <FormControlLabel
                  control={<Switch checked={formData.publishEnabled} onChange={(e) => setFormData((p) => ({ ...p, publishEnabled: e.target.checked }))} />}
                  label="Publish event (MQTT/HTTP)"
                />
                {formData.publishEnabled && (
                  <FormControl fullWidth>
                    <InputLabel>Publish to publishers</InputLabel>
                    <Select
                      multiple
                      value={formData.publishPublisherIds}
                      onChange={(e) => setFormData((p) => ({ ...p, publishPublisherIds: e.target.value as string[] }))}
                      input={<OutlinedInput label="Publish to publishers" />}
                      renderValue={(selected) =>
                        (selected as string[])
                          .map((id) => publishers.find((p) => p.id === id)?.name || id)
                          .join(', ')
                      }
                    >
                      {publishers.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                          <Checkbox checked={formData.publishPublisherIds.includes(p.id)} />
                          <ListItemText primary={p.name} secondary={p.type} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.modbusEnabled}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setFormData((p) => ({ ...p, modbusEnabled: on }));
                        if (on && formData.modbusDeviceId) void loadRegisters(formData.modbusDeviceId);
                      }}
                    />
                  }
                  label="Modbus write"
                />
                {formData.modbusEnabled && (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label="Modbus device"
                        select
                        value={formData.modbusDeviceId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setFormData((p) => ({ ...p, modbusDeviceId: id, modbusRegisterId: '' }));
                          void loadRegisters(id);
                        }}
                        fullWidth
                      >
                        {modbusDevices.map((d) => (
                          <MenuItem key={d.id} value={d.id}>
                            {d.name || d.id}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label="Register (writes: FC1/FC3)"
                        select
                        value={formData.modbusRegisterId}
                        onChange={(e) => setFormData((p) => ({ ...p, modbusRegisterId: e.target.value }))}
                        fullWidth
                        disabled={!formData.modbusDeviceId}
                      >
                        {modbusRegisters.map((r) => (
                          <MenuItem key={r.id} value={r.id}>
                            {r.name} — FC{r.functionCode} addr {r.address} qty {r.quantity} type {r.dataType}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label="Mode"
                        select
                        value={formData.modbusMode}
                        onChange={(e) => setFormData((p) => ({ ...p, modbusMode: e.target.value as any }))}
                        fullWidth
                      >
                        <MenuItem value="once">Once (write when rule triggers)</MenuItem>
                        <MenuItem value="toggle_interval">Toggle interval (while rule is true)</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label={formData.modbusMode === 'toggle_interval' ? 'Value TRUE' : 'Value'}
                        value={formData.modbusValueTrueText}
                        onChange={(e) => setFormData((p) => ({ ...p, modbusValueTrueText: e.target.value }))}
                        fullWidth
                        helperText="For booleans: true/false/1/0. For numbers: 123. For multi-coil: JSON array."
                      />
                    </Grid>
                    {formData.modbusMode === 'toggle_interval' && (
                      <>
                        <Grid item xs={12} md={6}>
                          <TextField
                            label="Value FALSE"
                            value={formData.modbusValueFalseText}
                            onChange={(e) => setFormData((p) => ({ ...p, modbusValueFalseText: e.target.value }))}
                            fullWidth
                          />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField
                            label="Toggle interval (sec)"
                            type="number"
                            value={formData.modbusIntervalSeconds}
                            onChange={(e) => setFormData((p) => ({ ...p, modbusIntervalSeconds: Number(e.target.value || 0) }))}
                            inputProps={{ min: 1, max: 3600, step: 1 }}
                            fullWidth
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={!!formData.modbusWriteFalseOnStop}
                                onChange={(e) => setFormData((p) => ({ ...p, modbusWriteFalseOnStop: e.target.checked }))}
                              />
                            }
                            label="Write FALSE once when rule becomes false"
                          />
                          {formData.modbusRegisterId && !isToggleCompatible(selectedModbusRegister) && (
                            <Alert severity="warning" sx={{ mt: 1 }}>
                              Toggle mode requires a single boolean coil (FC1 qty=1) or boolean holding register (FC3 type=bool qty=1).
                            </Alert>
                          )}
                        </Grid>
                      </>
                    )}
                  </Grid>
                )}
              </Stack>
            </Paper>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disableElevation>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdvancedRules;

