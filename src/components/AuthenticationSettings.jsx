import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Remove as RemoveIcon,
  Security as SecurityIcon,
  Key as KeyIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { useAuthentication } from '../hooks/useAuthentication.js';

const AuthenticationSettings = ({ vaultName, vaultPassword }) => {
  const {
    availableMethods,
    configuredMethods,
    loading,
    error,
    initializeMethod,
    removeMethod,
    clearError,
  } = useAuthentication(vaultName);

  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [setupMethod, setSetupMethod] = useState(null);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);

  useEffect(() => {
    if (vaultPassword) {
      setSetupPassword(vaultPassword);
    }
  }, [vaultPassword]);

  const handleSetupMethod = (method) => {
    setSetupMethod(method);
    setShowSetupDialog(true);
  };

  const handleSetupSubmit = async () => {
    if (!setupPassword.trim()) {
      return;
    }

    setSetupLoading(true);

    try {
      const result = await initializeMethod(setupMethod.getMethodId(), {
        password: setupPassword
      });

      if (result.success) {
        setShowSetupDialog(false);
        setSetupMethod(null);
        setSetupPassword('');
      }
    } catch (error) {
      console.error('Setup failed:', error);
    } finally {
      setSetupLoading(false);
    }
  };

  const handleRemoveMethod = async (method) => {
    if (method.getMethodId() === 'password') {
      return; // Cannot remove password authentication
    }

    try {
      await removeMethod(method.getMethodId());
    } catch (error) {
      console.error('Remove failed:', error);
    }
  };

  const renderMethodCard = (method, configured = false) => {
    const isPassword = method.getMethodId() === 'password';

    return (
      <Card
        key={method.getMethodId()}
        sx={{
          border: 1,
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h4">{method.getIcon()}</Typography>
              <Box>
                <Typography variant="h6">{method.getDisplayName()}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {configured ? 'Configured' : 'Available'}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {configured && (
                <Chip
                  label="Configured"
                  size="small"
                  color="success"
                  variant="outlined"
                />
              )}
              {!configured && !isPassword && (
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => handleSetupMethod(method)}
                  disabled={loading}
                >
                  Set Up
                </Button>
              )}
              {configured && !isPassword && (
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleRemoveMethod(method)}
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

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <SecurityIcon />
        Authentication Methods
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={clearError}>
          {error}
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure additional authentication methods for your vault. You can use multiple methods to unlock your vault.
      </Typography>

      <Grid container spacing={2}>
        {configuredMethods.map(({ provider }) => (
          <Grid item xs={12} sm={6} key={provider.getMethodId()}>
            {renderMethodCard(provider, true)}
          </Grid>
        ))}
        
        {availableMethods
          .filter(({ provider }) => !configuredMethods.find(c => c.provider.getMethodId() === provider.getMethodId()))
          .map(({ provider }) => (
            <Grid item xs={12} sm={6} key={provider.getMethodId()}>
              {renderMethodCard(provider, false)}
            </Grid>
          ))}
      </Grid>

      {configuredMethods.length === 0 && availableMethods.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          No additional authentication methods are available on this device.
        </Alert>
      )}

      {/* Setup Dialog */}
      <Dialog open={showSetupDialog} onClose={() => setShowSetupDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Set up {setupMethod?.getDisplayName()}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            To set up {setupMethod?.getDisplayName()}, you need to provide your current vault password.
          </Typography>
          <TextField
            fullWidth
            type="password"
            label="Current Vault Password"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            variant="outlined"
            autoFocus
            disabled={setupLoading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSetupDialog(false)} disabled={setupLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSetupSubmit}
            variant="contained"
            disabled={setupLoading || !setupPassword.trim()}
          >
            {setupLoading ? <CircularProgress size={20} /> : 'Set Up'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AuthenticationSettings;
