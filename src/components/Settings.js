import React, { useState, useEffect } from 'react';
import {
  Typography,
  Card,
  CardContent,
  Button,
  Switch,
  FormControlLabel,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Alert,
  Snackbar,
  IconButton,
  InputAdornment,
  Divider,
  Chip,
  LinearProgress
} from '@mui/material';
import {
  Edit as EditIcon,
  Visibility,
  VisibilityOff,
  Security as SecurityIcon,
  History as HistoryIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import { getPasswordStrength, validatePasswordStrength } from '../../shared/passwordValidation';

const Settings = ({ vaultName, vaultPassword, onBack, onPasswordChanged }) => {
  const [settings, setSettings] = useState({
    enforcePasswordChange: false,
    passwordChangeWarningDays: 90,
    preventPasswordReuse: true,
    maxPasswordHistory: 1
  });
  const [vaultInfo, setVaultInfo] = useState(null);
  const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [validationErrors, setValidationErrors] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [loading, setLoading] = useState(true);
  const [hasBackup, setHasBackup] = useState(false);

  useEffect(() => {
    loadVaultInfo();
    checkBackupStatus();
  }, []);

  const loadVaultInfo = async () => {
    if (window.electronAPI && vaultName && vaultPassword) {
      try {
        const result = await window.electronAPI.loadVault(vaultName, vaultPassword);
        if (result.success) {
          setVaultInfo(result.data);
          // Load settings from vault data if they exist
          if (result.data.settings) {
            setSettings({ ...settings, ...result.data.settings });
          }
        } else {
          showSnackbar('Failed to load vault information', 'error');
        }
      } catch (error) {
        showSnackbar('Error loading vault information', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const checkBackupStatus = async () => {
    if (window.electronAPI && vaultName) {
      try {
        const result = await window.electronAPI.hasVaultBackup(vaultName);
        if (result.success) {
          setHasBackup(result.hasBackup);
        }
      } catch (error) {
        console.error('Error checking backup status:', error);
      }
    }
  };

  const handleRestoreBackup = async () => {
    if (window.electronAPI && vaultName) {
      try {
        const result = await window.electronAPI.restoreVaultBackup(vaultName);
        if (result.success) {
          showSnackbar('Vault restored from backup successfully');
          setHasBackup(false);
          loadVaultInfo(); // Reload vault info after restore
        } else {
          showSnackbar(result.error || 'Failed to restore backup', 'error');
        }
      } catch (error) {
        showSnackbar('Error restoring backup', 'error');
      }
    }
  };

  const getDaysSinceLastPasswordChange = () => {
    if (!vaultInfo?.lastPasswordChange) {
      return Math.floor((new Date() - new Date(vaultInfo?.created || new Date())) / (1000 * 60 * 60 * 24));
    }
    return Math.floor((new Date() - new Date(vaultInfo.lastPasswordChange)) / (1000 * 60 * 60 * 24));
  };

  const validatePasswordForm = () => {
    const errors = {};
    
    if (!passwordForm.currentPassword) {
      errors.currentPassword = 'Current password is required';
    } else if (passwordForm.currentPassword !== vaultPassword) {
      errors.currentPassword = 'Current password is incorrect';
    }
    
    if (!passwordForm.newPassword) {
      errors.newPassword = 'New password is required';
    } else {
      // Use the shared password strength validation
      const strengthErrors = validatePasswordStrength(passwordForm.newPassword);
      if (strengthErrors.length > 0) {
        errors.newPassword = strengthErrors[0];
      }
    }
    
    if (!passwordForm.confirmPassword) {
      errors.confirmPassword = 'Please confirm your new password';
    } else if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    
    // Check if new password is different from current (basic client-side check)
    if (settings.preventPasswordReuse && passwordForm.newPassword === passwordForm.currentPassword) {
      errors.newPassword = 'New password must be different from current password.';
    }
    
    return errors;
  };

  const handleChangePassword = async () => {
    const errors = validatePasswordForm();
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      // Call the electron API to change the master password
      const result = await window.electronAPI.changeMasterPassword(
        vaultName,
        passwordForm.currentPassword,
        passwordForm.newPassword
      );

      if (result.success) {
        setShowChangePasswordDialog(false);
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setValidationErrors({});
        showSnackbar('Master password changed successfully');
        
        // Notify parent component about password change
        if (onPasswordChanged) {
          onPasswordChanged(passwordForm.newPassword);
        }
        
        // Reload vault info to get updated data
        loadVaultInfo();
      } else {
        showSnackbar(result.error || 'Failed to change master password', 'error');
      }
    } catch (error) {
      showSnackbar('Error changing master password', 'error');
    }
  };

  const handleSettingsChange = async (newSettings) => {
    try {
      const result = await window.electronAPI.updateVaultSettings(vaultName, vaultPassword, newSettings);
      if (result.success) {
        setSettings(newSettings);
        showSnackbar('Settings updated successfully');
      } else {
        showSnackbar('Failed to update settings', 'error');
      }
    } catch (error) {
      showSnackbar('Error updating settings', 'error');
    }
  };

  const getPasswordStrengthColor = (days) => {
    if (days < 30) return '#4caf50'; // Green
    if (days < 60) return '#ff9800'; // Orange
    if (days < 90) return '#f44336'; // Red
    return '#9c27b0'; // Purple for very old
  };

  const getPasswordStrengthText = (days) => {
    if (days < 30) return 'Recently changed';
    if (days < 60) return 'Consider changing';
    if (days < 90) return 'Should change soon';
    return 'Change immediately';
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Typography>Loading settings...</Typography>
      </Box>
    );
  }

  const daysSinceChange = getDaysSinceLastPasswordChange();

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={onBack} sx={{ mr: 2, color: 'white' }}>
          <ArrowBackIcon />
        </IconButton>
        <SecurityIcon sx={{ mr: 2, color: 'white' }} />
        <Typography variant="h4" sx={{ color: 'white', fontWeight: 'bold' }}>
          Security Settings
        </Typography>
      </Box>

      {/* Master Password Section */}
      <Card sx={{ mb: 3, backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <SecurityIcon sx={{ mr: 2, color: '#2196f3' }} />
            <Typography variant="h6" sx={{ color: 'white' }}>
              Master Password
            </Typography>
          </Box>
          
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <HistoryIcon sx={{ mr: 1, color: 'rgba(255, 255, 255, 0.7)' }} />
            <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)', mr: 2 }}>
              Last changed: {daysSinceChange} days ago
            </Typography>
            <Chip
              label={getPasswordStrengthText(daysSinceChange)}
              size="small"
              sx={{
                backgroundColor: getPasswordStrengthColor(daysSinceChange),
                color: 'white',
                fontWeight: 'bold'
              }}
            />
          </Box>

          {daysSinceChange >= settings.passwordChangeWarningDays && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Your master password is {daysSinceChange} days old. Consider changing it for better security.
            </Alert>
          )}

          <Button
            variant="contained"
            startIcon={<EditIcon />}
            onClick={() => setShowChangePasswordDialog(true)}
            sx={{ mt: 1 }}
          >
            Change Master Password
          </Button>

          {hasBackup && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                A backup of your vault is available. If you're experiencing issues accessing your vault,
                you can restore from the backup.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={handleRestoreBackup}
                sx={{ color: '#2196f3', borderColor: '#2196f3' }}
              >
                Restore from Backup
              </Button>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Security Policy Settings */}
      <Card sx={{ mb: 3, backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
        <CardContent>
          <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
            Security Policies
          </Typography>

          <Box sx={{ mb: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.preventPasswordReuse}
                  onChange={(e) => handleSettingsChange({ ...settings, preventPasswordReuse: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography sx={{ color: 'white' }}>Prevent Password Reuse</Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    Warn when trying to reuse a previous master password
                  </Typography>
                </Box>
              }
            />
          </Box>

          <Divider sx={{ my: 2, backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />

          <Box sx={{ mb: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enforcePasswordChange}
                  onChange={(e) => handleSettingsChange({ ...settings, enforcePasswordChange: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography sx={{ color: 'white' }}>Enforce Password Changes</Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    Force password change after specified days
                  </Typography>
                </Box>
              }
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="Warning Days"
              type="number"
              value={settings.passwordChangeWarningDays}
              onChange={(e) => {
                const value = Math.max(1, parseInt(e.target.value) || 1);
                handleSettingsChange({ ...settings, passwordChangeWarningDays: value });
              }}
              sx={{ minWidth: 200 }}
              helperText="Show warning after this many days"
              inputProps={{ min: 1 }}
            />
            <TextField
              label="Password History Limit"
              type="number"
              value={settings.maxPasswordHistory}
              onChange={(e) => {
                const value = Math.max(1, parseInt(e.target.value) || 1);
                handleSettingsChange({ ...settings, maxPasswordHistory: value });
              }}
              sx={{ minWidth: 200 }}
              helperText="Number of previous passwords to remember"
              inputProps={{ min: 1, max: 20 }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Change Password Dialog */}
      <Dialog
        open={showChangePasswordDialog}
        onClose={() => {
          setShowChangePasswordDialog(false);
          setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
          setValidationErrors({});
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#1a1a1a',
            color: 'white'
          }
        }}
      >
        <DialogTitle sx={{ color: 'white' }}>
          Change Master Password
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              label="Current Password"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) => {
                setPasswordForm({ ...passwordForm, currentPassword: e.target.value });
                if (validationErrors.currentPassword) {
                  setValidationErrors({ ...validationErrors, currentPassword: undefined });
                }
              }}
              fullWidth
              error={!!validationErrors.currentPassword}
              helperText={validationErrors.currentPassword}
              required
            />
            <TextField
              label="New Password"
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => {
                setPasswordForm({ ...passwordForm, newPassword: e.target.value });
                if (validationErrors.newPassword) {
                  setValidationErrors({ ...validationErrors, newPassword: undefined });
                }
              }}
              fullWidth
              error={!!validationErrors.newPassword}
              helperText={validationErrors.newPassword}
              required
            />
            
            {passwordForm.newPassword && (
              <Box sx={{ mt: 1, mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Password Strength: {getPasswordStrengthInfo().strength}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={parseInt(getPasswordStrengthInfo().width)}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: '#e0e0e0',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: getPasswordStrengthInfo().color,
                      borderRadius: 4,
                    },
                  }}
                />
              </Box>
            )}
            <TextField
              label="Confirm New Password"
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => {
                setPasswordForm({ ...passwordForm, confirmPassword: e.target.value });
                if (validationErrors.confirmPassword) {
                  setValidationErrors({ ...validationErrors, confirmPassword: undefined });
                }
              }}
              fullWidth
              error={!!validationErrors.confirmPassword}
              helperText={validationErrors.confirmPassword}
              required
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setShowChangePasswordDialog(false);
              setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
              setValidationErrors({});
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleChangePassword}
            variant="contained"
            startIcon={<CheckIcon />}
          >
            Change Password
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Settings;
