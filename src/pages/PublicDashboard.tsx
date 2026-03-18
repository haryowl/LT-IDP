import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Grid,
  Paper,
  TextField,
  Toolbar,
  Typography,
  Alert,
  Divider,
  IconButton,
  InputAdornment,
  CircularProgress,
  MenuItem,
  Select,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getWebSocketUrl } from '../api/client';

type Mapping = {
  id: string;
  name: string;
  mappedName: string;
  unit?: string;
  sourceType?: string;
  sourceDeviceId?: string;
};

type RealtimePoint = {
  ts: number;
  v: number;
};

type RealtimePayload = {
  mappingId: string;
  mappingName: string;
  parameterId?: string;
  timestamp: number;
  value: any;
  unit?: string;
  quality?: string;
};

function getRoTokenFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const u = new URL(window.location.href);
  const direct = (u.searchParams.get('token') || u.searchParams.get('ro') || '').trim();
  if (direct) return direct;
  // HashRouter puts query params after the hash (e.g. #/public?token=...)
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return '';
  const qs = hash.slice(qIdx + 1);
  const sp = new URLSearchParams(qs);
  return (sp.get('token') || sp.get('ro') || '').trim();
}

function fmtValue(v: any): string {
  if (v == null) return '-';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toString() : String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const MAX_SERIES_POINTS = 180; // ~3 minutes at 1s updates, or longer for slower streams

const PublicDashboard: React.FC = () => {
  const [roToken, setRoToken] = useState<string>(getRoTokenFromUrl());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [search, setSearch] = useState('');
  const [selectedForChart, setSelectedForChart] = useState<string>('');
  const [latest, setLatest] = useState<Record<string, RealtimePayload>>({});
  const [series, setSeries] = useState<Record<string, RealtimePoint[]>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = mappings.slice().sort((a, b) => (a.mappedName || a.name).localeCompare(b.mappedName || b.name));
    if (!q) return list;
    return list.filter((m) => {
      const s = `${m.name} ${m.mappedName} ${m.id} ${m.unit || ''}`.toLowerCase();
      return s.includes(q);
    });
  }, [mappings, search]);

  const selectedMapping = useMemo(() => mappings.find((m) => m.id === selectedForChart), [mappings, selectedForChart]);

  const loadMappings = async () => {
    try {
      setLoading(true);
      setError('');
      if (!roToken) {
        setError('Missing read-only token. Open /public?token=YOUR_TOKEN');
        return;
      }
      const res = await fetch(`/api/public/mappings?ro=${encodeURIComponent(roToken)}`, {
        cache: 'no-store',
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || res.statusText);
      const data = text ? JSON.parse(text) : [];
      setMappings(Array.isArray(data) ? data : []);
      if (!selectedForChart && Array.isArray(data) && data.length > 0) {
        setSelectedForChart(data[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load mappings');
    } finally {
      setLoading(false);
    }
  };

  const connectWs = () => {
    if (!roToken) return;
    const base = getWebSocketUrl();
    const ws = new WebSocket(`${base}/api/public-ws?ro=${encodeURIComponent(roToken)}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as any);
        if (!m || m.type !== 'data:realtime') return;
        const p = m.data as RealtimePayload;
        setLatest((prev) => ({ ...prev, [p.mappingId]: p }));
        if (typeof p.value === 'number' && Number.isFinite(p.value)) {
          setSeries((prev) => {
            const cur = prev[p.mappingId] ? prev[p.mappingId].slice() : [];
            cur.push({ ts: p.timestamp, v: p.value });
            if (cur.length > MAX_SERIES_POINTS) cur.splice(0, cur.length - MAX_SERIES_POINTS);
            return { ...prev, [p.mappingId]: cur };
          });
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      wsRef.current = null;
      // light reconnect
      setTimeout(() => {
        if (!wsRef.current) connectWs();
      }, 2000);
    };
  };

  useEffect(() => {
    void loadMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roToken) return;
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    connectWs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roToken]);

  const chartData = useMemo(() => {
    const pts = selectedForChart ? series[selectedForChart] || [] : [];
    return pts.map((p) => ({ t: new Date(p.ts).toLocaleTimeString(), v: p.v }));
  }, [selectedForChart, series]);

  const kpis = useMemo(() => {
    const total = mappings.length;
    const active = Object.keys(latest).length;
    const numeric = Object.values(latest).filter((p) => typeof p.value === 'number' && Number.isFinite(p.value)).length;
    return { total, active, numeric };
  }, [mappings.length, latest]);

  const copyLink = async () => {
    try {
      const origin = window.location.origin + window.location.pathname;
      const hash = window.location.hash || '#/public';
      const [hashPath, hashQuery] = hash.split('?');
      const sp = new URLSearchParams(hashQuery || '');
      sp.set('token', roToken);
      const link = `${origin}${hashPath}?${sp.toString()}`;
      await navigator.clipboard.writeText(link);
    } catch {
      // ignore
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0b1220 0%, #1a2a6c 55%, #202b44 100%)' }}>
      <AppBar position="sticky" elevation={0} sx={{ background: 'rgba(9, 18, 35, 0.65)', backdropFilter: 'blur(10px)' }}>
        <Toolbar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              LT‑IDP Public Realtime Dashboard
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              Read-only access • live mapped parameters
            </Typography>
          </Box>
          <Button color="inherit" startIcon={<CopyIcon />} onClick={copyLink} sx={{ mr: 1 }}>
            Copy link
          </Button>
          <IconButton color="inherit" onClick={loadMappings} title="Reload mappings">
            <RefreshIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2, background: 'rgba(255,255,255,0.92)' }}>
              <Typography variant="overline" color="text.secondary">
                Read-only token
              </Typography>
              <TextField
                value={roToken}
                onChange={(e) => setRoToken(e.target.value.trim())}
                placeholder="Paste token here"
                size="small"
                fullWidth
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Button onClick={loadMappings} disabled={!roToken || loading} size="small" variant="contained">
                        Apply
                      </Button>
                    </InputAdornment>
                  ),
                }}
                helperText="Open this page as /public?token=YOUR_TOKEN"
              />
            </Paper>
          </Grid>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 2, background: 'rgba(255,255,255,0.92)' }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Typography variant="overline" color="text.secondary">
                    Total mappings
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 800 }}>
                    {kpis.total}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="overline" color="text.secondary">
                    Active (seen)
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 800 }}>
                    {kpis.active}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="overline" color="text.secondary">
                    Numeric signals
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 800 }}>
                    {kpis.numeric}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>
        </Grid>

        <Grid container spacing={2}>
          <Grid item xs={12} lg={5}>
            <Paper sx={{ p: 2, background: 'rgba(255,255,255,0.92)' }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Live values
                </Typography>
                <TextField
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  size="small"
                  placeholder="Search mapping…"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
              <Divider sx={{ my: 2 }} />

              {loading && (
                <Box display="flex" alignItems="center" gap={1} sx={{ mb: 2 }}>
                  <CircularProgress size={18} /> <Typography variant="body2">Loading…</Typography>
                </Box>
              )}

              <Box sx={{ maxHeight: 560, overflow: 'auto' }}>
                {filtered.map((m) => {
                  const p = latest[m.id];
                  const value = p ? fmtValue(p.value) : '-';
                  const unit = (p?.unit ?? m.unit ?? '').trim();
                  const ts = p?.timestamp ? new Date(p.timestamp).toLocaleTimeString() : '';
                  const selected = m.id === selectedForChart;
                  return (
                    <Paper
                      key={m.id}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        mb: 1,
                        cursor: 'pointer',
                        borderColor: selected ? 'primary.main' : 'divider',
                        background: selected ? 'rgba(25,118,210,0.08)' : 'transparent',
                      }}
                      onClick={() => setSelectedForChart(m.id)}
                    >
                      <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
                        <Box>
                          <Typography sx={{ fontWeight: 700 }}>{m.mappedName || m.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {m.name} • {m.sourceType}/{m.sourceDeviceId}
                          </Typography>
                        </Box>
                        <Box textAlign="right">
                          <Typography variant="h6" sx={{ fontWeight: 800 }}>
                            {value} {unit ? <span style={{ fontWeight: 600, opacity: 0.7 }}>{unit}</span> : null}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {ts || '—'}
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                  );
                })}
                {filtered.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No mappings match your search.
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} lg={7}>
            <Paper sx={{ p: 2, background: 'rgba(255,255,255,0.92)' }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Trend
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedMapping ? `${selectedMapping.mappedName || selectedMapping.name} (${selectedMapping.unit || '-'})` : 'Select a mapping'}
                  </Typography>
                </Box>
                <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                  <Chip label="Realtime" color="success" size="small" />
                  <Select
                    size="small"
                    value={selectedForChart}
                    onChange={(e) => setSelectedForChart(e.target.value as string)}
                    sx={{ minWidth: 220 }}
                  >
                    {mappings.map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        {m.mappedName || m.name}
                      </MenuItem>
                    ))}
                  </Select>
                </Box>
              </Box>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ height: 420 }}>
                {chartData.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Waiting for numeric realtime data…
                  </Typography>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="t" minTickGap={25} />
                      <YAxis domain={['auto', 'auto']} />
                      <Tooltip />
                      <Line type="monotone" dataKey="v" stroke="#1976d2" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Box>
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Tip: Use the admin Settings page to regenerate the read-only token if it leaks.
                </Typography>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default PublicDashboard;

