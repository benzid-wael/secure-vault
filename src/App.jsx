import React, { useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import VaultSelector from './components/VaultSelector';
import VaultLogin from './components/VaultLogin';
import PasswordManager from './components/PasswordManager';
import CreateVault from './components/CreateVault';
import ConfigurationDialog from './components/ConfigurationDialog';
import './App.css';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#2196f3',
    },
    secondary: {
      main: '#f50057',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '&:hover fieldset': {
              borderColor: '#2196f3',
            },
          },
        },
      },
    },
  },
});

function App() {
  const [currentVault, setCurrentVault] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [availableVaults, setAvailableVaults] = useState([]);
  const [currentView, setCurrentView] = useState('selector'); // selector, login, manager, create
  const [showConfiguration, setShowConfiguration] = useState(false);

  useEffect(() => {
    loadAvailableVaults();

    // Set up menu event listeners
    if (window.electronAPI) {
      window.electronAPI.onMenuNewVault(() => {
        setCurrentView('create');
      });

      window.electronAPI.onMenuOpenVault(() => {
        setCurrentView('selector');
        setIsAuthenticated(false);
        setCurrentVault(null);
      });

      window.electronAPI.onMenuLockVault(() => {
        lockVault();
      });

      window.electronAPI.onMenuConfiguration(() => {
        setShowConfiguration(true);
      });
    }

    // Set up keyboard shortcut for configuration dialog (Ctrl+S)
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        setShowConfiguration(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners('menu-new-vault');
        window.electronAPI.removeAllListeners('menu-open-vault');
        window.electronAPI.removeAllListeners('menu-lock-vault');
        window.electronAPI.removeAllListeners('menu-configuration');
      }
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const loadAvailableVaults = async () => {
    if (window.electronAPI) {
      try {
        const vaults = await window.electronAPI.getVaults();
        setAvailableVaults(vaults);
      } catch (error) {
        console.error('Error loading vaults:', error);
      }
    }
  };

  const handleVaultSelect = (vaultName) => {
    setCurrentVault(vaultName);
    setCurrentView('login');
  };

  const handleVaultLogin = async (password) => {
    if (window.electronAPI && currentVault) {
      try {
        const result = await window.electronAPI.verifyVaultPassword(
          currentVault,
          password
        );
        if (result.success) {
          setVaultPassword(password);
          setIsAuthenticated(true);
          setCurrentView('manager');
          return { success: true };
        } else {
          return { success: false, error: result.error };
        }
      } catch (error) {
        return { success: false, error: 'Authentication failed' };
      }
    }
    return { success: false, error: 'No vault selected' };
  };

  const handleVaultCreate = async (vaultName, masterPassword) => {
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.createVault(
          vaultName,
          masterPassword
        );
        if (result.success) {
          await loadAvailableVaults();
          setCurrentVault(vaultName);
          setVaultPassword(masterPassword);
          setIsAuthenticated(true);
          setCurrentView('manager');
          return { success: true };
        } else {
          return { success: false, error: result.error };
        }
      } catch (error) {
        return { success: false, error: 'Failed to create vault' };
      }
    }
    return { success: false, error: 'Electron API not available' };
  };

  const lockVault = () => {
    setIsAuthenticated(false);
    setCurrentVault(null);
    setVaultPassword('');
    setCurrentView('selector');
  };

  const goBack = () => {
    if (currentView === 'login' || currentView === 'create') {
      setCurrentView('selector');
      setCurrentVault(null);
    }
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'selector':
        return (
          <VaultSelector
            vaults={availableVaults}
            onVaultSelect={handleVaultSelect}
            onCreateNew={() => setCurrentView('create')}
          />
        );
      case 'login':
        return (
          <VaultLogin
            vaultName={currentVault}
            onLogin={handleVaultLogin}
            onBack={goBack}
          />
        );
      case 'create':
        return (
          <CreateVault
            onCreateVault={handleVaultCreate}
            onBack={goBack}
            existingVaults={availableVaults}
          />
        );
      case 'manager':
        return (
          <PasswordManager
            vaultName={currentVault}
            vaultPassword={vaultPassword}
            onLock={lockVault}
          />
        );
      default:
        return <Navigate to="/selector" replace />;
    }
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <div className="App">
        {renderCurrentView()}

        {/* Configuration Dialog - Available globally with Ctrl+S */}
        <ConfigurationDialog
          open={showConfiguration}
          onClose={() => setShowConfiguration(false)}
          vaultName={currentVault}
          vaultPassword={vaultPassword}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;
