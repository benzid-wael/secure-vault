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
  LinearProgress,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';
import {
  getPasswordStrength,
  validatePasswordStrength,
} from '../utils/passwordValidation';
import RecoveryKeyDisplay from './RecoveryKeyDisplay';

const CreateVault = ({ onCreateVault, onBack, existingVaults }) => {
  const [vaultName, setVaultName] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showRecoveryKey, setShowRecoveryKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');

  const passwordStrength = getPasswordStrength(masterPassword);

  const validateForm = () => {
    if (!vaultName.trim()) {
      setError('Please enter a vault name');
      return false;
    }

    if (existingVaults.includes(vaultName.trim())) {
      setError('A vault with this name already exists');
      return false;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(vaultName.trim())) {
      setError(
        'Vault name can only contain letters, numbers, hyphens, and underscores'
      );
      return false;
    }

    if (!masterPassword) {
      setError('Please enter a master password');
      return false;
    }

    // Use shared password strength validation
    const passwordErrors = validatePasswordStrength(masterPassword);
    if (passwordErrors.length > 0) {
      setError(passwordErrors[0]);
      return false;
    }

    if (masterPassword !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await onCreateVault(vaultName.trim(), masterPassword);
      if (!result.success) {
        setError(result.error || 'Failed to create vault');
      } else {
        setIsSuccess(true);
        // Show recovery key if provided
        if (result.recoveryKey) {
          setRecoveryKey(result.recoveryKey);
          setShowRecoveryKey(true);
        }
      }
    } catch (error) {
      setError('Failed to create vault. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVaultNameChange = (e) => {
    setVaultName(e.target.value);
    if (error) setError('');
  };

  const handlePasswordChange = (e) => {
    setMasterPassword(e.target.value);
    if (error) setError('');
  };

  const handleConfirmPasswordChange = (e) => {
    setConfirmPassword(e.target.value);
    if (error) setError('');
  };

  return (
    <div className="vault-container">
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={onBack} sx={{ color: 'white', mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ color: 'white', flexGrow: 1 }}>
          Create New Vault
        </Typography>
      </Box>

      <div className="vault-header">
        <AddIcon sx={{ fontSize: '4rem', color: '#2196f3', mb: 2 }} />
        <Typography
          variant="h4"
          className="vault-title"
          sx={{ fontSize: '2rem' }}
        >
          New Secure Vault
        </Typography>
        <Typography variant="body1" className="vault-subtitle">
          Create a new encrypted vault to store your passwords
        </Typography>
      </div>

      <form onSubmit={handleSubmit} className="vault-form">
        <TextField
          fullWidth
          label="Vault Name"
          value={vaultName}
          onChange={handleVaultNameChange}
          variant="outlined"
          autoFocus
          disabled={loading}
          placeholder="e.g., personal, work, family"
          sx={{
            '& .MuiOutlinedInput-root': {
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            },
          }}
        />

        <TextField
          fullWidth
          type={showPassword ? 'text' : 'password'}
          label="Master Password"
          value={masterPassword}
          onChange={handlePasswordChange}
          variant="outlined"
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

        {masterPassword && (
          <Box sx={{ mt: 1 }}>
            <Typography
              variant="body2"
              sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 1 }}
            >
              Password Strength:{' '}
              <span
                style={{
                  color: passwordStrength.color,
                  textTransform: 'capitalize',
                }}
              >
                {passwordStrength.strength}
              </span>
            </Typography>
            <LinearProgress
              variant="determinate"
              value={parseInt(passwordStrength.width)}
              sx={{
                height: 4,
                borderRadius: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: passwordStrength.color,
                  borderRadius: 2,
                },
              }}
            />
          </Box>
        )}

        <TextField
          fullWidth
          type={showConfirmPassword ? 'text' : 'password'}
          label="Confirm Master Password"
          value={confirmPassword}
          onChange={handleConfirmPasswordChange}
          variant="outlined"
          disabled={loading}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  edge="end"
                  disabled={loading}
                >
                  {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
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

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {!isSuccess && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <strong>Important:</strong> Your master password cannot be recovered
            if lost. Make sure to remember it or store it in a safe place.
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
            disabled={loading}
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
              'Create Vault'
            )}
          </Button>
        </Box>
      </form>

      <div className="security-indicator">
        <SecurityIcon sx={{ color: '#4caf50' }} />
        <Typography className="security-text">
          Your vault will be encrypted with AES-256-GCM using PBKDF2 key
          derivation
        </Typography>
      </div>

      <RecoveryKeyDisplay
        open={showRecoveryKey}
        onClose={() => setShowRecoveryKey(false)}
        recoveryKey={recoveryKey}
        vaultName={vaultName}
        isNewVault={true}
      />
    </div>
  );
};

export default CreateVault;
