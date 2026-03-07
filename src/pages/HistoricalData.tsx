import React, { useEffect, useState } from 'react';
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
} from '@mui/material';
// Using native datetime-local input for simplicity
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import SearchIcon from '@mui/icons-material/Search';
import api from '../api/client';

interface HistoricalDataPoint {
  id: string;
  mappingId: string;
  timestamp: number;
  value: string;
  quality: 'good' | 'bad' | 'uncertain';
}

const HistoricalData: React.FC = () => {
  const [mappings, setMappings] = useState<any[]>([]);
  const [selectedMappings, setSelectedMappings] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [data, setData] = useState<HistoricalDataPoint[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMappings();
  }, []);

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