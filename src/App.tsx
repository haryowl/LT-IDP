import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuthStore } from './store/authStore';
import type { UserRole } from './store/authStore';
import api from './api/client';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ModbusDevices from './pages/ModbusDevices';
import MqttDevices from './pages/MqttDevices';
import ParameterMappings from './pages/ParameterMappings';
import Publishers from './pages/Publishers';
import Monitoring from './pages/Monitoring';
import HistoricalData from './pages/HistoricalData';
import SparingConfig from './pages/SparingConfig';
import MqttBroker from './pages/MqttBroker';
import LogTerminal from './pages/LogTerminal';
import Settings from './pages/Settings';

function SparingGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((state) => state.role);
  if (role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthRestoreLoader() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        background: 'linear-gradient(135deg, #f5f7fa 0%, #e8eaf6 100%)',
      }}
    >
      <CircularProgress size={48} sx={{ color: 'primary.main' }} />
      <Typography color="textSecondary">Loading session...</Typography>
    </Box>
  );
}

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setFromSession = useAuthStore((state) => state.setFromSession);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    api.auth
      .getStoredSession()
      .then((session) => {
        if (!session?.token) {
          setAuthInitialized(true);
          return;
        }
        return api.auth.verify(session.token).then((result: any) => {
          if (result?.valid && result?.user) {
            const role = (result.user.role === 'admin' ? 'admin' : 'viewer') as UserRole;
            setFromSession(session.token, session.username, role);
          }
        });
      })
      .catch(() => {})
      .finally(() => setAuthInitialized(true));
  }, [setFromSession]);

  if (!authInitialized) return <AuthRestoreLoader />;

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/" />} />
        <Route
          path="/"
          element={isAuthenticated ? <Layout /> : <Navigate to="/login" />}
        >
          <Route index element={<Dashboard />} />
          <Route path="modbus" element={<ModbusDevices />} />
          <Route path="mqtt" element={<MqttDevices />} />
          <Route path="mappings" element={<ParameterMappings />} />
          <Route path="publishers" element={<Publishers />} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="historical" element={<HistoricalData />} />
          <Route path="sparing" element={<SparingGuard><SparingConfig /></SparingGuard>} />
          <Route path="mqtt-broker" element={<MqttBroker />} />
          <Route path="log-terminal" element={<LogTerminal />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;

