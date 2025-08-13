import React, { useState, useEffect } from 'react';
import {
  Typography,
  TextField,
  Button,
  Box,
  IconButton,
  InputAdornment,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Grid,
  Chip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  ArrowBack as ArrowBackIcon,
  Lock as LockIcon,
  Security as SecurityIcon,
  Key as KeyIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
} from '@mui/icons-material';
import { AuthenticationManager } from '../utils/authentication/AuthenticationManager.js';

const EnhancedVaultLogin = ({ vaultName, onLogin, onBack, onRecovery }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authManager] = useState(() => {
    return new AuthenticationManager();
  });
  const [availableMethods, setAvailableMethods] = useState([]);
  const [configuredMethods, setConfiguredMethods] = useState([]);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [setupMethod, setSetupMethod] = useState(null);
  const [setupPassword, setSetupPassword] = useState('');

  useEffect(() => {
    // Wait a bit for the auth manager to initialize other providers
    const timer = setTimeout(() => {
      loadAuthenticationMethods();
    }, 100);

    return () => clearTimeout(timer);
  }, [vaultName]);

  useEffect(() => {}, [selectedMethod]);

  const loadAuthenticationMethods = async () => {
    try {
      // Force refresh providers to ensure all are loaded
      await authManager.refreshProviders();

      const suggestions =
        await authManager.getAuthenticationSuggestions(vaultName);
      console.log('Authentication suggestions:', suggestions);

      const available = suggestions.filter((s) => s.available);
      const configured = suggestions.filter((s) => s.configured);

      console.log(
        'Available methods:',
        available.map((m) => m.provider.getDisplayName())
      );
      console.log(
        'Configured methods:',
        configured.map((m) => m.provider.getDisplayName())
      );

      setAvailableMethods(available);
      setConfiguredMethods(configured);

      // Auto-select the best available method
      if (configured.length > 0) {
        setSelectedMethod(configured[0].provider);
      } else if (available.length > 0) {
        setSelectedMethod(available[0].provider);
      }

      console.log(
        'Final state - availableMethods:',
        available.length,
        'configuredMethods:',
        configured.length
      );
    } catch (error) {
      console.error('Error loading authentication methods:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedMethod) {
      setError('Please select an authentication method');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let result;

      if (selectedMethod.getMethodId() === 'password') {
        if (!password.trim()) {
          setError('Please enter your vault password');
          setLoading(false);
          return;
        }
        result = await selectedMethod.authenticate(vaultName, { password });
      } else {
        // For passkey and other methods, no additional input needed
        result = await selectedMethod.authenticate(vaultName);
      }

      if (result.success) {
        // Extract password from result for backward compatibility
        const extractedPassword = result.data?.password || password;
        onLogin(extractedPassword);
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch (error) {
      setError('Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    if (error) setError('');
  };

  const handleMethodSelect = (method) => {
    console.log(
      'Method selected:',
      method.getDisplayName(),
      method.getMethodId()
    );
    setSelectedMethod(method);
    setError('');
  };

  const handleSetupMethod = (method) => {
    setSetupMethod(method);
    setSetupPassword('');
    setShowSetupDialog(true);
  };

  const handleSetupSubmit = async () => {
    if (!setupPassword.trim()) {
      setError('Password is required to set up authentication method');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await authManager.initializeMethod(
        vaultName,
        setupMethod.getMethodId(),
        {
          password: setupPassword,
        }
      );

      if (result.success) {
        setShowSetupDialog(false);
        setSetupMethod(null);
        setSetupPassword('');
        await loadAuthenticationMethods(); // Refresh the list
      } else {
        setError(result.error || 'Failed to set up authentication method');
      }
    } catch (error) {
      setError('Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMethod = async (method) => {
    if (method.getMethodId() === 'password') {
      setError('Cannot remove password authentication');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await authManager.removeMethod(
        vaultName,
        method.getMethodId()
      );

      if (result.success) {
        await loadAuthenticationMethods(); // Refresh the list
      } else {
        setError(result.error || 'Failed to remove authentication method');
      }
    } catch (error) {
      setError('Failed to remove authentication method');
    } finally {
      setLoading(false);
    }
  };

  const renderMethodCard = (method, configured = false) => {
    const isSelected = selectedMethod?.getMethodId() === method.getMethodId();
    const isPassword = method.getMethodId() === 'password';
    return (
      <Card
        key={method.getMethodId()}
        sx={{
          cursor: 'pointer',
          border: isSelected ? 2 : 1,
          borderColor: isSelected ? '#2196f3' : 'rgba(255, 255, 255, 0.2)',
          backgroundColor: isSelected
            ? 'rgba(33, 150, 243, 0.1)'
            : 'rgba(255, 255, 255, 0.05)',
          '&:hover': {
            borderColor: '#2196f3',
            backgroundColor: 'rgba(33, 150, 243, 0.15)',
          },
        }}
        onClick={() => handleMethodSelect(method)}
      >
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h4">{method.getIcon()}</Typography>
              <Box>
                <Typography variant="h6" sx={{ color: 'white' }}>
                  {method.getDisplayName()}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                >
                  {configured ? 'Configured' : 'Available'}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {configured && (
                <Chip
                  label="Configured"
                  size="small"
                  color="success"
                  variant="outlined"
                />
              )}
              {!configured && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSetupMethod(method);
                  }}
                  disabled={loading}
                >
                  <AddIcon />
                </IconButton>
              )}
              {configured && !isPassword && (
                <IconButton
                  size="small"
                  color="error"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveMethod(method);
                  }}
                  disabled={loading}
                >
                  <RemoveIcon />
                </IconButton>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="vault-container">
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={onBack} sx={{ color: 'white', mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ color: 'white', flexGrow: 1 }}>
          Unlock Vault
        </Typography>
      </Box>

      <div className="vault-header">
        <LockIcon sx={{ fontSize: '4rem', color: '#2196f3', mb: 2 }} />
        <Typography
          variant="h4"
          className="vault-title"
          sx={{ fontSize: '2rem' }}
        >
          {vaultName}
        </Typography>
        <Typography variant="body1" className="vault-subtitle">
          Choose an authentication method to unlock this vault
        </Typography>
      </div>

      <div className="vault-form">
        <Typography variant="h6" sx={{ mb: 2, color: 'white' }}>
          Authentication Methods
        </Typography>

        <Box sx={{ mb: 3 }}>
          {configuredMethods.map(({ provider }) => (
            <Box key={provider.getMethodId()} sx={{ mb: 2 }}>
              {renderMethodCard(provider, true)}
            </Box>
          ))}

          {availableMethods
            .filter(
              ({ provider }) =>
                !configuredMethods.find(
                  (c) => c.provider.getMethodId() === provider.getMethodId()
                )
            )
            .map(({ provider }) => (
              <Box key={provider.getMethodId()} sx={{ mb: 2 }}>
                {renderMethodCard(provider, false)}
              </Box>
            ))}
        </Box>
      </div>

      {selectedMethod && selectedMethod.getMethodId() === 'password' && (
        <div className="vault-form">
          <TextField
            fullWidth
            type={showPassword ? 'text' : 'password'}
            label="Master Password"
            value={password}
            onChange={handlePasswordChange}
            variant="outlined"
            autoFocus
            disabled={loading}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    disabled={loading}
                  >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
              },
            }}
          />
        </div>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {vaultName === 'default' &&
        selectedMethod?.getMethodId() === 'password' &&
        !error && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Default vault password: <strong>changeme123</strong>
            <br />
            <em>Please change this password after first login for security.</em>
          </Alert>
        )}

      <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
        <Button
          type="button"
          variant="outlined"
          onClick={onBack}
          disabled={loading}
          sx={{ flex: 1 }}
        >
          Back
        </Button>
        <Button
          type="submit"
          variant="contained"
          onClick={handleSubmit}
          disabled={
            loading ||
            (selectedMethod?.getMethodId() === 'password' && !password.trim())
          }
          sx={{
            flex: 2,
            py: 1.5,
            background: 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
            '&:hover': {
              background: 'linear-gradient(45deg, #1976d2 30%, #1cb5e0 90%)',
            },
          }}
        >
          {loading ? (
            <CircularProgress size={24} color="inherit" />
          ) : (
            `Unlock with ${selectedMethod?.getDisplayName() || 'Selected Method'}`
          )}
        </Button>
      </Box>

      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <Button
          variant="text"
          onClick={onRecovery}
          disabled={loading}
          sx={{
            color: 'rgba(255, 255, 255, 0.7)',
            textTransform: 'none',
            '&:hover': {
              color: '#ff9800',
              backgroundColor: 'rgba(255, 152, 0, 0.1)',
            },
          }}
        >
          Forgot your password? Use recovery options
        </Button>
      </Box>

      <div className="security-indicator">
        <SecurityIcon sx={{ color: '#4caf50' }} />
        <Typography className="security-text">
          Your credentials are never stored - only used to decrypt your vault
        </Typography>
      </div>

      {/* Setup Dialog */}
      <Dialog
        open={showSetupDialog}
        onClose={() => setShowSetupDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Set up {setupMethod?.getDisplayName()}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            To set up {setupMethod?.getDisplayName()}, you need to provide your
            current vault password.
          </Typography>
          <TextField
            fullWidth
            type="password"
            label="Current Vault Password"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            variant="outlined"
            autoFocus
            disabled={loading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSetupDialog(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSetupSubmit}
            variant="contained"
            disabled={loading || !setupPassword.trim()}
          >
            {loading ? <CircularProgress size={20} /> : 'Set Up'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default EnhancedVaultLogin;
