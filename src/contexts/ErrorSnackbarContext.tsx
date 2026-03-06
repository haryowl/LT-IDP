import React, { createContext, useCallback, useContext, useState } from 'react';
import { Snackbar, Alert, AlertColor } from '@mui/material';

interface ErrorSnackbarContextValue {
  showError: (message: string, severity?: AlertColor) => void;
  showSuccess: (message: string) => void;
}

const ErrorSnackbarContext = createContext<ErrorSnackbarContextValue | null>(null);

export function ErrorSnackbarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<AlertColor>('error');

  const showError = useCallback((msg: string, sev: AlertColor = 'error') => {
    setMessage(msg);
    setSeverity(sev);
    setOpen(true);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setMessage(msg);
    setSeverity('success');
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <ErrorSnackbarContext.Provider value={{ showError, showSuccess }}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={6000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleClose} severity={severity} variant="filled" sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
    </ErrorSnackbarContext.Provider>
  );
}

export function useErrorSnackbar(): ErrorSnackbarContextValue {
  const ctx = useContext(ErrorSnackbarContext);
  if (!ctx) return { showError: () => {}, showSuccess: () => {} };
  return ctx;
}
