import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Typography,
  TextField,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  Alert,
  Grid,
  Divider,
  Switch,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';
// Using native datetime-local input for simplicity
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../api/client';
import { useAuthStore } from '../store/authStore';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type StorageSummary = {
  dbPath: string;
  dbMainBytes: number;
  dbWalBytes: number;
  dbShmBytes: number;
  historicalRowCount: number;
  historicalOldestTimestamp: number | null;
  historicalNewestTimestamp: number | null;
  exportDir: string;
  exportTotalBytes: number;
  exportFileCount: number;
  disk: { path: string; freeBytes: number; totalBytes: number; freePercent: number } | null;
  logs?: { directory: string; totalBytes: number; fileCount: number };
};

type CleanupSettings = {
  retentionDays: number;
  exportRetentionDays: number;
  lowDiskAutoPurge: boolean;
  lowDiskFreePctThreshold: number;
  lowDiskEmergencyKeepDays: number;
  lastRetentionRunAt: number | null;
};

interface HistoricalDataPoint {
  id: string;
  mappingId: string;
  timestamp: number;
  value: string;
  quality: 'good' | 'bad' | 'uncertain';
}

const HistoricalData: React.FC = () => {
  const role = useAuthStore((s) => s.role);
  const isAdmin = role === 'admin';

  const [mappings, setMappings] = useState<any[]>([]);
  const [selectedMappings, setSelectedMappings] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [data, setData] = useState<HistoricalDataPoint[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);
  const [cleanupSettings, setCleanupSettings] = useState<CleanupSettings | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [pruneBefore, setPruneBefore] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 16);
  });
  const [manualOlderDays, setManualOlderDays] = useState('90');

  const loadStorageAndSettings = useCallback(async () => {
    setStorageLoading(true);
    try {
      const [sum, cfg] = await Promise.all([api.data.storageSummary(), api.data.cleanupSettingsGet()]);
      setStorageSummary(sum as StorageSummary);
      setCleanupSettings(cfg as CleanupSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to load storage summary');
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMappings();
    loadStorageAndSettings();
  }, [loadStorageAndSettings]);

  const loadMappings = async () => {
    try {
      const data = await api.mappings.list();
      setMappings(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mappings');
    }
  };

  const handleQuery = async () => {
    if (!startDate || !endDate || selectedMappings.length === 0) {
      setError('Please select start date, end date, and at least one mapping');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const startTime = startDate.getTime();
      const endTime = endDate.getTime();

      const result = await api.data.query({
        startTime,
        endTime,
        mappingIds: selectedMappings,
      });

      const dataArray = Array.isArray(result) ? result : [];
      setData(dataArray);

      // Transform data for chart
      const mappingNames: Record<string, string> = {};
      mappings.forEach((m) => {
        if (selectedMappings.includes(m.id)) {
          mappingNames[m.id] = m.name;
        }
      });

      const groupedByTime: Record<number, any> = {};
      dataArray.forEach((point) => {
        const time = point.timestamp;
        if (!groupedByTime[time]) {
          groupedByTime[time] = { timestamp: new Date(time).toLocaleString() };
        }
        groupedByTime[time][mappingNames[point.mappingId]] = parseFloat(point.value) || 0;
      });

      setChartData(Object.values(groupedByTime).sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ));
    } catch (err: any) {
      setError(err.message || 'Failed to query data');
    } finally {
      setLoading(false);
    }
  };

  const getMappingName = (mappingId: string) => {
    const mapping = mappings.find((m) => m.id === mappingId);
    return mapping?.name || mappingId;
  };

  const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00'];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Historical Data
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        Query and visualize historical data
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <Typography variant="h6">Storage and cleanup</Typography>
          <Button
            size="small"
            startIcon={storageLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={() => void loadStorageAndSettings()}
            disabled={storageLoading}
          >
            Refresh
          </Button>
        </Box>
        <Typography variant="body2" color="textSecondary" paragraph>
          Historical samples live in the SQLite database. Scheduled jobs (about every six hours) apply retention and, when the disk is almost full,
          optional emergency pruning. Use manual actions below if you need space immediately after exporting anything important.
        </Typography>
        {storageSummary && (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={4}>
              <Typography variant="subtitle2">Database file</Typography>
              <Typography variant="body2">{formatBytes(storageSummary.dbMainBytes + storageSummary.dbWalBytes + storageSummary.dbShmBytes)} total</Typography>
              <Typography variant="caption" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                {storageSummary.dbPath}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Typography variant="subtitle2">Historical rows</Typography>
              <Typography variant="body2">{storageSummary.historicalRowCount.toLocaleString()}</Typography>
              {storageSummary.historicalOldestTimestamp != null && storageSummary.historicalNewestTimestamp != null && (
                <Typography variant="caption" color="textSecondary" display="block">
                  {new Date(storageSummary.historicalOldestTimestamp).toLocaleString()} —{' '}
                  {new Date(storageSummary.historicalNewestTimestamp).toLocaleString()}
                </Typography>
              )}
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Typography variant="subtitle2">Exports folder</Typography>
              <Typography variant="body2">
                {storageSummary.exportFileCount} files, {formatBytes(storageSummary.exportTotalBytes)}
              </Typography>
              <Typography variant="caption" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                {storageSummary.exportDir}
              </Typography>
            </Grid>
            {storageSummary.logs && (
              <Grid item xs={12} sm={6} md={4}>
                <Typography variant="subtitle2">Rotated logs</Typography>
                <Typography variant="body2">
                  {storageSummary.logs.fileCount} files, {formatBytes(storageSummary.logs.totalBytes)}
                </Typography>
                <Typography variant="caption" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                  {storageSummary.logs.directory}
                </Typography>
              </Grid>
            )}
            {storageSummary.disk && (
              <Grid item xs={12} sm={6} md={4}>
                <Typography variant="subtitle2">Disk (volume of database)</Typography>
                <Typography variant="body2">
                  {storageSummary.disk.freePercent.toFixed(1)}% free ({formatBytes(storageSummary.disk.freeBytes)} /{' '}
                  {formatBytes(storageSummary.disk.totalBytes)})
                </Typography>
                <Typography variant="caption" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                  {storageSummary.disk.path}
                </Typography>
              </Grid>
            )}
          </Grid>
        )}
        {cleanupSettings && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" gutterBottom>
              Automatic retention
            </Typography>
            {!isAdmin && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Only an admin can change retention or run destructive cleanup actions.
              </Alert>
            )}
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Max history age (days)"
                  type="number"
                  fullWidth
                  disabled={!isAdmin}
                  value={cleanupSettings.retentionDays}
                  onChange={(e) =>
                    setCleanupSettings((c) =>
                      c ? { ...c, retentionDays: Math.max(0, parseInt(e.target.value, 10) || 0) } : c
                    )
                  }
                  helperText="0 = no automatic delete by age. Non-zero: data older than this is removed on the schedule."
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Export file max age (days)"
                  type="number"
                  fullWidth
                  disabled={!isAdmin}
                  value={cleanupSettings.exportRetentionDays}
                  onChange={(e) =>
                    setCleanupSettings((c) =>
                      c ? { ...c, exportRetentionDays: Math.max(0, parseInt(e.target.value, 10) || 0) } : c
                    )
                  }
                  helperText="CSV/JSON exports under the exports folder older than this are deleted on the schedule."
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={cleanupSettings.lowDiskAutoPurge}
                      onChange={(e) =>
                        setCleanupSettings((c) => (c ? { ...c, lowDiskAutoPurge: e.target.checked } : c))
                      }
                      disabled={!isAdmin}
                    />
                  }
                  label="Emergency prune when disk almost full"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Low disk threshold (% free)"
                  type="number"
                  fullWidth
                  disabled={!isAdmin || !cleanupSettings.lowDiskAutoPurge}
                  value={cleanupSettings.lowDiskFreePctThreshold}
                  onChange={(e) =>
                    setCleanupSettings((c) =>
                      c ? { ...c, lowDiskFreePctThreshold: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) } : c
                    )
                  }
                  helperText="When free space is at or below this (and volume stats are available), keep only recent history/logs/exports."
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Emergency keep (days)"
                  type="number"
                  fullWidth
                  disabled={!isAdmin || !cleanupSettings.lowDiskAutoPurge}
                  value={cleanupSettings.lowDiskEmergencyKeepDays}
                  onChange={(e) =>
                    setCleanupSettings((c) =>
                      c ? { ...c, lowDiskEmergencyKeepDays: Math.max(1, parseInt(e.target.value, 10) || 1) } : c
                    )
                  }
                  helperText="Roughly how many recent days to keep when emergency pruning runs."
                />
              </Grid>
              <Grid item xs={12}>
                {cleanupSettings.lastRetentionRunAt && (
                  <Typography variant="caption" color="textSecondary">
                    Last scheduled retention run: {new Date(cleanupSettings.lastRetentionRunAt).toLocaleString()}
                  </Typography>
                )}
              </Grid>
              {isAdmin && (
                <Grid item xs={12} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  <Button
                    variant="contained"
                    onClick={async () => {
                      if (!cleanupSettings) return;
                      try {
                        await api.data.cleanupSettingsPut(cleanupSettings);
                        setError('');
                        await loadStorageAndSettings();
                      } catch (err: any) {
                        setError(err.message || 'Failed to save settings');
                      }
                    }}
                  >
                    Save retention settings
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={async () => {
                      try {
                        await api.data.retentionRun();
                        await loadStorageAndSettings();
                      } catch (err: any) {
                        setError(err.message || 'Retention run failed');
                      }
                    }}
                  >
                    Run retention now
                  </Button>
                </Grid>
              )}
            </Grid>
            {isAdmin && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1" gutterBottom>
                  Manual cleanup (cannot be undone)
                </Typography>
                <Grid container spacing={2} alignItems="flex-end">
                  <Grid item xs={12} md={4}>
                    <TextField
                      label="Delete historical data before"
                      type="datetime-local"
                      fullWidth
                      InputLabelProps={{ shrink: true }}
                      value={pruneBefore}
                      onChange={(e) => setPruneBefore(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} md="auto">
                    <Button
                      color="warning"
                      variant="outlined"
                      onClick={async () => {
                        const ts = new Date(pruneBefore).getTime();
                        if (!Number.isFinite(ts)) {
                          setError('Invalid cutoff date');
                          return;
                        }
                        if (
                          !window.confirm(
                            `Delete all historical rows with timestamp before ${new Date(ts).toLocaleString()}? This cannot be undone.`
                          )
                        ) {
                          return;
                        }
                        try {
                          const r = await api.data.pruneHistorical({ beforeTimestamp: ts });
                          setError('');
                          alert(`Deleted ${(r as any).deleted ?? 0} row(s). Consider "Shrink database" if the file is still large.`);
                          await loadStorageAndSettings();
                        } catch (err: any) {
                          setError(err.message || 'Prune failed');
                        }
                      }}
                    >
                      Delete old history
                    </Button>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      label="Older than (days)"
                      value={manualOlderDays}
                      onChange={(e) => setManualOlderDays(e.target.value)}
                      type="number"
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={6} md="auto">
                    <Button
                      variant="outlined"
                      onClick={async () => {
                        const d = parseInt(manualOlderDays, 10);
                        if (!Number.isFinite(d) || d < 1) {
                          setError('Enter a valid number of days (≥ 1)');
                          return;
                        }
                        if (!window.confirm(`Delete export files older than ${d} day(s)?`)) return;
                        try {
                          const r = await api.data.pruneExports(d);
                          setError('');
                          alert(`Removed ${(r as any).deletedFiles ?? 0} file(s).`);
                          await loadStorageAndSettings();
                        } catch (err: any) {
                          setError(err.message || 'Prune exports failed');
                        }
                      }}
                    >
                      Prune old exports
                    </Button>
                  </Grid>
                  <Grid item xs={6} md="auto">
                    <Button
                      variant="outlined"
                      onClick={async () => {
                        const d = parseInt(manualOlderDays, 10);
                        if (!Number.isFinite(d) || d < 1) {
                          setError('Enter a valid number of days (≥ 1)');
                          return;
                        }
                        if (!window.confirm(`Delete rotated log files older than ${d} day(s)? Active log files are kept.`)) return;
                        try {
                          const r = await api.data.pruneLogs(d);
                          setError('');
                          alert(`Removed ${(r as any).deletedFiles ?? 0} log file(s).`);
                          await loadStorageAndSettings();
                        } catch (err: any) {
                          setError(err.message || 'Prune logs failed');
                        }
                      }}
                    >
                      Prune old logs
                    </Button>
                  </Grid>
                  <Grid item xs={12}>
                    <Button
                      color="secondary"
                      variant="outlined"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            'Run VACUUM on the SQLite database? The app may pause briefly while space is reclaimed.'
                          )
                        ) {
                          return;
                        }
                        try {
                          await api.data.vacuum();
                          setError('');
                          await loadStorageAndSettings();
                          alert('Database vacuum completed.');
                        } catch (err: any) {
                          setError(err.message || 'Vacuum failed');
                        }
                      }}
                    >
                      Shrink database (VACUUM)
                    </Button>
                  </Grid>
                </Grid>
              </>
            )}
          </>
        )}
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              label="Start Date"
              type="datetime-local"
              value={startDate ? new Date(startDate).toISOString().slice(0, 16) : ''}
              onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : null)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="End Date"
              type="datetime-local"
              value={endDate ? new Date(endDate).toISOString().slice(0, 16) : ''}
              onChange={(e) => setEndDate(e.target.value ? new Date(e.target.value) : null)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Select Mappings</InputLabel>
              <Select
                multiple
                value={selectedMappings}
                onChange={(e) => setSelectedMappings(e.target.value as string[])}
                renderValue={(selected) =>
                  (selected as string[])
                    .map((id) => getMappingName(id))
                    .join(', ')
                }
              >
                {mappings
                  .filter((m) => m.storeHistory)
                  .map((mapping) => (
                    <MenuItem key={mapping.id} value={mapping.id}>
                      {mapping.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Button
              variant="contained"
              fullWidth
              startIcon={<SearchIcon />}
              onClick={handleQuery}
              disabled={loading}
            >
              Query
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {chartData.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Chart View
          </Typography>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip />
              <Legend />
              {selectedMappings.map((mappingId, index) => {
                const mappingName = getMappingName(mappingId);
                return (
                  <Line
                    key={mappingId}
                    type="monotone"
                    dataKey={mappingName}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Timestamp</TableCell>
              <TableCell>Mapping</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Quality</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((point) => (
              <TableRow key={point.id}>
                <TableCell>{new Date(point.timestamp).toLocaleString()}</TableCell>
                <TableCell>{getMappingName(point.mappingId)}</TableCell>
                <TableCell>{point.value}</TableCell>
                <TableCell>{point.quality}</TableCell>
              </TableRow>
            ))}
            {data.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  No data found. Click "Query" to fetch historical data.
                </TableCell>
              </TableRow>
            )}
            {loading && (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  Loading...
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default HistoricalData;