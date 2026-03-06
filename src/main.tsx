import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import theme from './theme';
import { ErrorSnackbarProvider } from './contexts/ErrorSnackbarContext';
import './global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorSnackbarProvider>
        <App />
      </ErrorSnackbarProvider>
    </ThemeProvider>
  </React.StrictMode>
);

