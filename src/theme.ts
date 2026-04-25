import { createTheme } from '@mui/material/styles';

// Professional color palette - Deep blue and slate tones
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1a237e', // Deep indigo
      light: '#534bae',
      dark: '#000051',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#37474f', // Blue grey
      light: '#62727b',
      dark: '#102027',
      contrastText: '#ffffff',
    },
    background: {
      default: '#f5f7fa', // Soft grey-blue
      paper: '#ffffff',
    },
    text: {
      primary: '#1a202c', // Almost black
      secondary: '#4a5568', // Medium grey
    },
    divider: '#e2e8f0',
    error: {
      main: '#d32f2f',
      light: '#ef5350',
      dark: '#c62828',
    },
    warning: {
      main: '#ed6c02',
      light: '#ff9800',
      dark: '#e65100',
    },
    info: {
      main: '#0288d1',
      light: '#03a9f4',
      dark: '#01579b',
    },
    success: {
      main: '#2e7d32',
      light: '#4caf50',
      dark: '#1b5e20',
    },
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
      '"Apple Color Emoji"',
      '"Segoe UI Emoji"',
      '"Segoe UI Symbol"',
    ].join(','),
    h1: {
      fontWeight: 700,
      fontSize: '2.1rem',
      lineHeight: 1.2,
      letterSpacing: '-0.01562em',
    },
    h2: {
      fontWeight: 700,
      fontSize: '1.8rem',
      lineHeight: 1.3,
      letterSpacing: '-0.00833em',
    },
    h3: {
      fontWeight: 600,
      fontSize: '1.55rem',
      lineHeight: 1.4,
    },
    h4: {
      fontWeight: 600,
      fontSize: '1.3rem',
      lineHeight: 1.4,
    },
    h5: {
      fontWeight: 600,
      fontSize: '1.125rem',
      lineHeight: 1.5,
    },
    h6: {
      fontWeight: 600,
      fontSize: '1.03rem',
      lineHeight: 1.5,
    },
    body1: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
    },
    body2: {
      fontSize: '0.8125rem',
      lineHeight: 1.45,
    },
    button: {
      fontWeight: 600,
      textTransform: 'none',
      letterSpacing: '0.02857em',
      fontSize: '0.8125rem',
    },
  },
  shape: {
    borderRadius: 8,
  },
  shadows: [
    'none',
    '0px 1px 3px rgba(0, 0, 0, 0.06), 0px 1px 2px rgba(0, 0, 0, 0.04)',
    '0px 2px 6px rgba(0, 0, 0, 0.08), 0px 2px 4px rgba(0, 0, 0, 0.06)',
    '0px 4px 12px rgba(0, 0, 0, 0.1), 0px 2px 6px rgba(0, 0, 0, 0.08)',
    '0px 6px 16px rgba(0, 0, 0, 0.12), 0px 4px 8px rgba(0, 0, 0, 0.1)',
    '0px 8px 24px rgba(0, 0, 0, 0.14), 0px 6px 12px rgba(0, 0, 0, 0.12)',
    '0px 10px 32px rgba(0, 0, 0, 0.16), 0px 8px 16px rgba(0, 0, 0, 0.14)',
    '0px 12px 40px rgba(0, 0, 0, 0.18), 0px 10px 20px rgba(0, 0, 0, 0.16)',
    '0px 14px 48px rgba(0, 0, 0, 0.2), 0px 12px 24px rgba(0, 0, 0, 0.18)',
    '0px 16px 56px rgba(0, 0, 0, 0.22), 0px 14px 28px rgba(0, 0, 0, 0.2)',
    '0px 18px 64px rgba(0, 0, 0, 0.24), 0px 16px 32px rgba(0, 0, 0, 0.22)',
    '0px 20px 72px rgba(0, 0, 0, 0.26), 0px 18px 36px rgba(0, 0, 0, 0.24)',
    '0px 22px 80px rgba(0, 0, 0, 0.28), 0px 20px 40px rgba(0, 0, 0, 0.26)',
    '0px 24px 88px rgba(0, 0, 0, 0.3), 0px 22px 44px rgba(0, 0, 0, 0.28)',
    '0px 26px 96px rgba(0, 0, 0, 0.32), 0px 24px 48px rgba(0, 0, 0, 0.3)',
    '0px 28px 104px rgba(0, 0, 0, 0.34), 0px 26px 52px rgba(0, 0, 0, 0.32)',
    '0px 30px 112px rgba(0, 0, 0, 0.36), 0px 28px 56px rgba(0, 0, 0, 0.34)',
    '0px 32px 120px rgba(0, 0, 0, 0.38), 0px 30px 60px rgba(0, 0, 0, 0.36)',
    '0px 34px 128px rgba(0, 0, 0, 0.4), 0px 32px 64px rgba(0, 0, 0, 0.38)',
    '0px 36px 136px rgba(0, 0, 0, 0.42), 0px 34px 68px rgba(0, 0, 0, 0.4)',
    '0px 38px 144px rgba(0, 0, 0, 0.44), 0px 36px 72px rgba(0, 0, 0, 0.42)',
    '0px 40px 152px rgba(0, 0, 0, 0.46), 0px 38px 76px rgba(0, 0, 0, 0.44)',
    '0px 42px 160px rgba(0, 0, 0, 0.48), 0px 40px 80px rgba(0, 0, 0, 0.46)',
    '0px 44px 168px rgba(0, 0, 0, 0.5), 0px 42px 84px rgba(0, 0, 0, 0.48)',
    '0px 46px 176px rgba(0, 0, 0, 0.52), 0px 44px 88px rgba(0, 0, 0, 0.5)',
  ],
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.08), 0px 2px 4px rgba(0, 0, 0, 0.06)',
          backgroundColor: '#ffffff',
          color: '#1a202c',
        },
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: 48,
          paddingLeft: 12,
          paddingRight: 12,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: '1px solid #e2e8f0',
          boxShadow: '2px 0 8px rgba(0, 0, 0, 0.04)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.08), 0px 2px 4px rgba(0, 0, 0, 0.06)',
        },
        elevation1: {
          boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.06), 0px 1px 2px rgba(0, 0, 0, 0.04)',
        },
        elevation2: {
          boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.08), 0px 2px 4px rgba(0, 0, 0, 0.06)',
        },
        elevation3: {
          boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.1), 0px 2px 6px rgba(0, 0, 0, 0.08)',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: '6px 14px',
        },
        contained: {
          boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.08), 0px 2px 4px rgba(0, 0, 0, 0.06)',
          '&:hover': {
            boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.12), 0px 2px 6px rgba(0, 0, 0, 0.1)',
          },
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          padding: 6,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
        margin: 'dense',
      },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            '& .MuiOutlinedInput-input': {
              paddingTop: 8,
              paddingBottom: 8,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: '#534bae',
            },
          },
        },
      },
    },
    MuiFormControl: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.8125rem',
        },
      },
    },
    MuiSelect: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 34,
          fontSize: '0.8125rem',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '2px 8px',
          paddingTop: 6,
          paddingBottom: 6,
          '&.Mui-selected': {
            backgroundColor: '#e8eaf6',
            color: '#1a237e',
            '&:hover': {
              backgroundColor: '#c5cae9',
            },
            '& .MuiListItemIcon-root': {
              color: '#1a237e',
            },
          },
          '&:hover': {
            backgroundColor: '#f5f7fa',
          },
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: {
          minWidth: 34,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
          height: 26,
        },
        label: {
          paddingLeft: 8,
          paddingRight: 8,
          fontSize: '0.75rem',
        },
      },
    },
    MuiTable: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: 10,
          paddingRight: 10,
          fontSize: '0.8125rem',
        },
        head: {
          fontSize: '0.75rem',
          fontWeight: 700,
          whiteSpace: 'nowrap',
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          paddingTop: 12,
          paddingBottom: 10,
          paddingLeft: 14,
          paddingRight: 14,
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 14,
          paddingRight: 14,
        },
        dividers: {
          paddingTop: 12,
          paddingBottom: 12,
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          paddingTop: 8,
          paddingBottom: 10,
          paddingLeft: 14,
          paddingRight: 14,
          gap: 8,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: 10,
          paddingRight: 10,
        },
        message: {
          paddingTop: 0,
          paddingBottom: 0,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.08), 0px 2px 4px rgba(0, 0, 0, 0.06)',
        },
      },
    },
  },
});

export default theme;





