import React, { useState } from 'react';
import {
  Typography,
  TextField,
  Button,
  Box,
  IconButton,
  InputAdornment,
  Alert,
  CircularProgress,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  ArrowBack as ArrowBackIcon,
  Lock as LockIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';

/**
 * `canRemember`: this computer can keep the password (New-52); the box
 * starts checked when `remembered`. `onLogin(password, options)` gets
 * `{remember}` only when the box is offered: true keeps the password,
 * false forgets a kept one. `initialError`: why a saved password didn't
 * unlock the vault. `needsKeyFile`: the vault uses a key file (New-54);
 * the password is sent with `{keyFile: true}` and main asks for the file.
 * A "needs its key file" answer switches to that too.
 */
const VaultLogin = ({
  vaultName,
  onLogin,
  onBack,
  onRecovery,
  canRemember = false,
  remembered = false,
  initialError = '',
  needsKeyFile = false,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError);
  const [keep, setKeep] = useState(remembered);
  const [keyFileMode, setKeyFileMode] = useState(needsKeyFile);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter your vault password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const options = {
        ...(canRemember && { remember: keep }),
        ...(keyFileMode && { keyFile: true }),
      };
      const result = await (Object.keys(options).length > 0
        ? onLogin(password, options)
        : onLogin(password));
      if (result.code === 'KEY_FILE_REQUIRED') {
        setKeyFileMode(true);
      } else if (!result.success && !result.canceled) {
        setError(result.error || 'Invalid password');
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
          Enter your master password to unlock this vault
        </Typography>
      </div>

      <form onSubmit={handleSubmit} className="vault-form">
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

        {keyFileMode && (
          <Alert severity="info" sx={{ mt: 2 }}>
            This vault also needs its key file. After you type the password,
            choose the key file.
          </Alert>
        )}

        {canRemember && (
          <Box sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={keep}
                  onChange={(e) => setKeep(e.target.checked)}
                  disabled={loading}
                />
              }
              label="Remember on this computer"
              sx={{ color: 'white' }}
            />
            <Typography
              variant="body2"
              sx={{ color: 'rgba(255, 255, 255, 0.6)' }}
            >
              Kept encrypted by the system keychain. Anyone using your account
              here can then open this vault in the app, after Touch ID where the
              Mac has it.
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
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
            disabled={loading || !password.trim()}
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
            ) : keyFileMode ? (
              'Choose Key File and Unlock'
            ) : (
              'Unlock Vault'
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
      </form>

      <div className="security-indicator">
        <SecurityIcon sx={{ color: '#4caf50' }} />
        <Typography className="security-text">
          {keep
            ? 'Your password is kept on this computer, encrypted by the system keychain'
            : 'Your password is never stored - only used to decrypt your vault'}
        </Typography>
      </div>
    </div>
  );
};

export default VaultLogin;
