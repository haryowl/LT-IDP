import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Chip,
} from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { useAuthStore } from '../store/authStore';
import { useErrorSnackbar } from '../contexts/ErrorSnackbarContext';
import api from '../api/client';
import packageJson from '../../package.json';

const REMEMBER_KEY = 'lt-idp-remember-username';
const FONT = '"Plus Jakarta Sans", "Segoe UI", sans-serif';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const { showError } = useErrorSnackbar();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setUsername(saved);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.auth.login({
        username,
        password,
      });

      if (result?.token && result?.user) {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_KEY, username);
        } else {
          localStorage.removeItem(REMEMBER_KEY);
        }
        const role =
          result.user.role === 'admin' ? 'admin' : result.user.role === 'guest' ? 'guest' : 'viewer';
        login(result.token, result.user.username, role);
        navigate('/');
      } else {
        setError('Login failed: Invalid response');
      }
    } catch (err: any) {
      const msg = err.message || 'Login failed. Please check your credentials.';
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = (e: React.MouseEvent) => {
    e.preventDefault();
    const msg = 'Password reset is managed by your administrator. Please contact PT. Loema Tekno Integrasi support.';
    setError(msg);
    showError(msg);
  };

  const fieldSx = {
    mb: 2,
    '& .MuiOutlinedInput-root': {
      borderRadius: '14px',
      backgroundColor: '#f4f5fb',
      fontFamily: FONT,
      '& fieldset': { borderColor: 'transparent' },
      '&:hover fieldset': { borderColor: '#d5d8ef' },
      '&.Mui-focused fieldset': { borderColor: '#6b5ce7', borderWidth: 1.5 },
    },
    '& .MuiInputLabel-root': {
      fontFamily: FONT,
      color: '#8b90a8',
      '&.Mui-focused': { color: '#6b5ce7' },
    },
    '& .MuiInputLabel-asterisk': { color: '#e53935' },
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 4,
        fontFamily: FONT,
        background: `
          radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124, 108, 240, 0.18), transparent 55%),
          linear-gradient(165deg, #f7f5ff 0%, #eef0fb 45%, #f5f6fc 100%)
        `,
        backgroundImage: `
          linear-gradient(rgba(107, 92, 231, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(107, 92, 231, 0.04) 1px, transparent 1px),
          radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124, 108, 240, 0.18), transparent 55%),
          linear-gradient(165deg, #f7f5ff 0%, #eef0fb 45%, #f5f6fc 100%)
        `,
        backgroundSize: '48px 48px, 48px 48px, auto, auto',
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 440,
          bgcolor: '#fff',
          borderRadius: '28px',
          boxShadow: '0 24px 64px rgba(55, 48, 120, 0.12), 0 2px 8px rgba(55, 48, 120, 0.06)',
          p: { xs: 3.5, sm: 4.5 },
          position: 'relative',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2.5 }}>
          <Box sx={{ position: 'relative' }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '16px',
                background: 'linear-gradient(145deg, #7c6cf0 0%, #5b4fd6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 10px 24px rgba(91, 79, 214, 0.35)',
              }}
            >
              <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: '1.35rem', fontFamily: FONT, letterSpacing: '-0.02em' }}>
                LT
              </Typography>
            </Box>
            <Box
              sx={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 14,
                height: 14,
                borderRadius: '50%',
                bgcolor: '#22c55e',
                border: '2.5px solid #fff',
                boxShadow: '0 0 0 1px rgba(34, 197, 94, 0.25)',
              }}
            />
          </Box>

          <Chip
            icon={<ShieldOutlinedIcon sx={{ fontSize: '16px !important', color: '#6b5ce7 !important' }} />}
            label="SECURE"
            size="small"
            sx={{
              height: 28,
              borderRadius: '999px',
              bgcolor: '#f0edff',
              color: '#5b4fd6',
              fontWeight: 700,
              fontSize: '0.7rem',
              letterSpacing: '0.06em',
              fontFamily: FONT,
              '& .MuiChip-label': { px: 1 },
              '& .MuiChip-icon': { ml: 0.75 },
            }}
          />
        </Box>

        <Typography
          component="h1"
          sx={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: { xs: '1.85rem', sm: '2rem' },
            color: '#111827',
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            mb: 0.5,
          }}
        >
          LT IDP
        </Typography>
        <Typography
          sx={{
            fontFamily: FONT,
            fontSize: '0.98rem',
            color: '#6b7280',
            fontWeight: 500,
            mb: 1.5,
          }}
        >
          Integrated Data Parser
        </Typography>

        <Chip
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#22c55e' }} />
              Secure Enterprise Access
            </Box>
          }
          size="small"
          sx={{
            mb: 3,
            height: 28,
            borderRadius: '999px',
            bgcolor: '#ecfdf5',
            color: '#15803d',
            fontWeight: 600,
            fontSize: '0.78rem',
            fontFamily: FONT,
            '& .MuiChip-label': { px: 1.25 },
          }}
        />

        <Box component="form" onSubmit={handleSubmit}>
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 2.5,
                borderRadius: '14px',
                fontFamily: FONT,
              }}
              onClose={() => setError('')}
            >
              {error}
            </Alert>
          )}

          <TextField
            fullWidth
            label="Username"
            required
            variant="outlined"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            disabled={loading}
            autoComplete="username"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <PersonOutlineIcon sx={{ color: '#9aa0b8', fontSize: 22 }} />
                </InputAdornment>
              ),
            }}
            sx={fieldSx}
          />

          <TextField
            fullWidth
            label="Password"
            required
            type={showPassword ? 'text' : 'password'}
            variant="outlined"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <LockOutlinedIcon sx={{ color: '#9aa0b8', fontSize: 22 }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                    edge="end"
                    size="small"
                    disabled={loading}
                  >
                    {showPassword ? (
                      <VisibilityOffOutlinedIcon sx={{ color: '#9aa0b8' }} />
                    ) : (
                      <VisibilityOutlinedIcon sx={{ color: '#9aa0b8' }} />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{ ...fieldSx, mb: 1 }}
          />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 3,
              mt: 0.5,
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                  sx={{
                    color: '#c4b5fd',
                    '&.Mui-checked': { color: '#6b5ce7' },
                  }}
                />
              }
              label="Remember me"
              sx={{
                m: 0,
                '& .MuiFormControlLabel-label': {
                  fontFamily: FONT,
                  fontSize: '0.875rem',
                  color: '#4b5563',
                  fontWeight: 500,
                },
              }}
            />
            <Link
              href="#"
              underline="hover"
              onClick={handleForgotPassword}
              sx={{
                fontFamily: FONT,
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#4f6ef7',
              }}
            >
              Forgot password?
            </Link>
          </Box>

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={loading}
            endIcon={!loading ? <ArrowForwardRoundedIcon /> : undefined}
            sx={{
              py: 1.55,
              borderRadius: '14px',
              fontSize: '1rem',
              fontWeight: 700,
              textTransform: 'none',
              fontFamily: FONT,
              letterSpacing: '0.01em',
              background: 'linear-gradient(100deg, #3d4fc9 0%, #6b5ce7 55%, #7c6cf0 100%)',
              boxShadow: '0 12px 28px rgba(91, 79, 214, 0.35)',
              '&:hover': {
                background: 'linear-gradient(100deg, #3343b0 0%, #5b4fd6 55%, #6b5ce7 100%)',
                boxShadow: '0 14px 32px rgba(91, 79, 214, 0.42)',
              },
              '&:disabled': {
                background: 'linear-gradient(100deg, #3d4fc9 0%, #6b5ce7 100%)',
                color: '#fff',
                opacity: 0.65,
              },
            }}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
          </Button>
        </Box>

        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box sx={{ flex: 1, height: 1, bgcolor: '#eceef5' }} />
            <Typography
              sx={{
                fontFamily: FONT,
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: '#9aa0b8',
              }}
            >
              ENTERPRISE EDITION
            </Typography>
            <Box sx={{ flex: 1, height: 1, bgcolor: '#eceef5' }} />
          </Box>

          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: '0.8rem',
              color: '#6b7280',
              fontWeight: 500,
              mb: 0.75,
            }}
          >
            Built by PT. Loema Tekno Integrasi
          </Typography>
          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: '0.72rem',
              color: '#9aa0b8',
            }}
          >
            © 2024 All rights reserved · v{packageJson.version || '1.0.0'}
          </Typography>
        </Box>
      </Box>

      <Typography
        sx={{
          mt: 3,
          fontFamily: FONT,
          fontSize: '0.75rem',
          color: '#8b90a8',
          fontWeight: 500,
          textAlign: 'center',
        }}
      >
        · AES-256 encrypted · SSO enabled · Audit logged
      </Typography>
    </Box>
  );
};

export default Login;
