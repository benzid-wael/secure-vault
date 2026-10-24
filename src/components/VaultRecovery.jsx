import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  Tabs,
  Tab,
  Paper,
  InputAdornment,
  IconButton,
  CircularProgress,
  Divider,
  FormControlLabel,
  Radio,
  RadioGroup,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Visibility,
  VisibilityOff,
  VpnKey as KeyIcon,
  History as HistoryIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';
import { validatePasswordStrength } from '../utils/passwordValidation';
import RecoveryKeyDisplay from './RecoveryKeyDisplay';

/** What a vault that uses a key file needs once recovered (New-54). */
const KEY_FILE_CHOICES = [
  ['create', 'Create a new key file'],
  ['existing', 'Use a key file I already have'],
  ['none', 'Stop requiring a key file'],
];

/**
 * @param {{vaultName: string, needsKeyFile?: boolean,
 *   onRecover: (data: any, method: string,
 *     notice?: {message: string, severity: string}) => void,
 *   onBack: () => void}} props
 */
const VaultRecovery = ({
  vaultName,
  needsKeyFile = false,
  onRecover,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  // A vault that uses a key file (New-54 step 5): once its recovery key is
  // accepted, a new password and what it does about its key file.
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [keyFileChoice, setKeyFileChoice] = useState('create');
  const [recovered, setRecovered] = useState(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
    setError('');
    setRecoveryKey('');
    setOldPassword('');
  };

  const handleRecoveryKeySubmit = async (e) => {
    e.preventDefault();
    if (!recoveryKey.trim()) {
      setError('Please enter your recovery key');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.electronAPI.verifyVaultRecoveryKey(
        vaultName,
        recoveryKey.trim()
      );
      if (result.success && result.keyFile) {
        setResetting(true);
      } else if (result.success) {
        // Load vault data with recovery key
        const loadResult = await window.electronAPI.loadVaultWithRecoveryKey(
          vaultName,
          recoveryKey.trim()
        );
        if (loadResult.success) {
          onRecover(loadResult.data, 'recovery-key');
        } else {
          setError(
            loadResult.error || 'Failed to load vault with recovery key'
          );
        }
      } else {
        setError(result.error || 'Invalid recovery key');
      }
    } catch (error) {
      setError('Recovery failed. Please check your recovery key.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    const weak = validatePasswordStrength(newPassword);
    if (weak.length > 0) return setError(weak[0]);
    if (newPassword !== confirmPassword) {
      return setError('The passwords don’t match');
    }
    setLoading(true);
    setError('');
    let result;
    try {
      result = await window.electronAPI.recoverVaultWithKeyFile(
        vaultName,
        recoveryKey.trim(),
        newPassword,
        { keyFile: keyFileChoice }
      );
    } catch {
      result = { success: false, error: 'Recovery failed. Try again.' };
    }
    setLoading(false);
    if (result.canceled) return;
    if (!result.success) return setError(result.error);
    const message = {
      create: `${vaultName} has a new password and key file (${result.keyFile}); the old ones no longer open it.`,
      existing: `${vaultName} has a new password and uses ${result.keyFile}; the old ones no longer open it.`,
      none: `${vaultName} has a new password and no longer needs a key file.`,
    }[keyFileChoice];
    const notice = {
      message: result.warning ? `${message} ${result.warning}` : message,
      severity: result.warning ? 'warning' : 'success',
    };
    // A new recovery key is shown before going on: the old one is gone.
    if (result.recoveryKey) {
      setRecovered({ recoveryKey: result.recoveryKey, notice });
    } else {
      onRecover(null, 'recovery-key', notice);
    }
  };

  const handleOldPasswordSubmit = async (e) => {
    e.preventDefault();
    if (!oldPassword.trim()) {
      setError('Please enter a previous password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const loadResult = await window.electronAPI.recoverVaultWithOldPassword(
        vaultName,
        oldPassword
      );
      if (loadResult.success) {
        onRecover(loadResult.data, 'old-password');
      } else {
        setError(
          loadResult.error || 'Unable to recover vault with this password'
        );
      }
    } catch (error) {
      setError(
        'Recovery failed. This password may not be in your vault history.'
      );
    } finally {
      setLoading(false);
    }
  };

  const formatRecoveryKeyInput = (value) => {
    // Remove all non-alphanumeric characters and convert to uppercase
    const cleaned = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    // Add dashes every 4 characters
    const formatted = cleaned.match(/.{1,4}/g)?.join('-') || cleaned;

    return formatted;
  };

  const handleRecoveryKeyChange = (e) => {
    const formatted = formatRecoveryKeyInput(e.target.value);
    setRecoveryKey(formatted);
    if (error) setError('');
  };

  const handleOldPasswordChange = (e) => {
    setOldPassword(e.target.value);
    if (error) setError('');
  };

  return (
    <div className="vault-container">
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton
          onClick={onBack}
          sx={{ color: 'white', mr: 2 }}
          aria-label="Go back"
        >
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ color: 'white', flexGrow: 1 }}>
          Recover Vault
        </Typography>
      </Box>

      <div className="vault-header">
        <SecurityIcon sx={{ fontSize: '4rem', color: '#ff9800', mb: 2 }} />
        <Typography
          variant="h4"
          className="vault-title"
          sx={{ fontSize: '2rem' }}
        >
          {vaultName}
        </Typography>
        <Typography variant="body1" className="vault-subtitle">
          Recover access to your vault using a recovery key or previous password
        </Typography>
      </div>

      <Paper
        sx={{
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          mt: 3,
        }}
      >
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          sx={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            '& .MuiTab-root': {
              color: 'rgba(255, 255, 255, 0.7)',
              '&.Mui-selected': {
                color: '#2196f3',
              },
            },
          }}
        >
          <Tab
            icon={<KeyIcon />}
            label="Recovery Key"
            sx={{ textTransform: 'none' }}
          />
          {!needsKeyFile && (
            <Tab
              icon={<HistoryIcon />}
              label="Previous Password"
              sx={{ textTransform: 'none' }}
            />
          )}
        </Tabs>

        <Box sx={{ p: 3 }}>
          {activeTab === 0 && resetting && (
            <form onSubmit={handleResetSubmit}>
              <Alert severity="success" sx={{ mb: 2 }}>
                The recovery key is right. Choose a new master password: the old
                password and key file stop opening {vaultName}.
              </Alert>
              <TextField
                fullWidth
                type="password"
                label="New Master Password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (error) setError('');
                }}
                autoFocus
                disabled={loading}
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                type="password"
                label="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError('');
                }}
                disabled={loading}
                sx={{ mb: 1 }}
              />
              <RadioGroup
                value={keyFileChoice}
                onChange={(e) => setKeyFileChoice(e.target.value)}
                sx={{ mb: 1, color: 'white' }}
              >
                {KEY_FILE_CHOICES.map(([value, label]) => (
                  <FormControlLabel
                    key={value}
                    value={value}
                    control={<Radio disabled={loading} />}
                    label={label}
                  />
                ))}
              </RadioGroup>
              {keyFileChoice === 'none' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  The new password alone will open the vault, and a new recovery
                  key is made: save it.
                </Alert>
              )}
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={loading || !newPassword || !confirmPassword}
                sx={{ py: 1.5 }}
              >
                {loading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  'Set Password and Open'
                )}
              </Button>
            </form>
          )}

          {activeTab === 0 && !resetting && (
            <form onSubmit={handleRecoveryKeySubmit}>
              <Typography variant="body1" sx={{ color: 'white', mb: 2 }}>
                Enter the recovery key that was generated when you created this
                vault:
              </Typography>

              <TextField
                fullWidth
                label="Recovery Key"
                value={recoveryKey}
                onChange={handleRecoveryKeyChange}
                variant="outlined"
                autoFocus
                disabled={loading}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                sx={{
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    fontFamily: 'monospace',
                    letterSpacing: '0.1em',
                  },
                }}
                helperText="Enter the recovery key with or without dashes"
              />

              <Alert
                severity="info"
                sx={{
                  mb: 2,
                  backgroundColor: 'rgba(33, 150, 243, 0.1)',
                  border: '1px solid rgba(33, 150, 243, 0.3)',
                  '& .MuiAlert-message': { color: 'white' },
                }}
              >
                Recovery keys are case-insensitive and dashes are optional. This
                key was shown to you when the vault was created.
              </Alert>

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={loading || !recoveryKey.trim()}
                sx={{
                  py: 1.5,
                  background:
                    'linear-gradient(45deg, #ff9800 30%, #ffb74d 90%)',
                  '&:hover': {
                    background:
                      'linear-gradient(45deg, #f57c00 30%, #ffa726 90%)',
                  },
                }}
              >
                {loading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  'Recover with Recovery Key'
                )}
              </Button>
            </form>
          )}

          {activeTab === 1 && (
            <form onSubmit={handleOldPasswordSubmit}>
              <Typography variant="body1" sx={{ color: 'white', mb: 2 }}>
                Enter your previous master password (the password you used
                before the current one):
              </Typography>

              <TextField
                fullWidth
                type={showPassword ? 'text' : 'password'}
                label="Previous Master Password"
                value={oldPassword}
                onChange={handleOldPasswordChange}
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
                        aria-label="Toggle password visibility"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  },
                }}
              />

              <Alert
                severity="warning"
                sx={{
                  mb: 2,
                  backgroundColor: 'rgba(255, 152, 0, 0.1)',
                  border: '1px solid rgba(255, 152, 0, 0.3)',
                  '& .MuiAlert-message': { color: 'white' },
                }}
              >
                Only your previous master password can be used for recovery. If
                you've changed your password more than once since then, this
                won't work.
              </Alert>

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={loading || !oldPassword.trim()}
                sx={{
                  py: 1.5,
                  background:
                    'linear-gradient(45deg, #ff9800 30%, #ffb74d 90%)',
                  '&:hover': {
                    background:
                      'linear-gradient(45deg, #f57c00 30%, #ffa726 90%)',
                  },
                }}
              >
                {loading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  'Recover with Previous Password'
                )}
              </Button>
            </form>
          )}
        </Box>
      </Paper>

      {recovered && (
        <RecoveryKeyDisplay
          open
          recoveryKey={recovered.recoveryKey}
          vaultName={vaultName}
          onClose={() => onRecover(null, 'recovery-key', recovered.notice)}
        />
      )}

      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          If you cannot recover your vault using these methods, your data may be
          permanently lost.
        </Typography>
      </Box>
    </div>
  );
};

export default VaultRecovery;
