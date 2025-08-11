import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Paper,
  IconButton,
  Alert,
  Tooltip,
  Chip,
  CircularProgress
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Warning as WarningIcon,
  Security as SecurityIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';

const RecoveryKeyDisplay = ({ 
  open, 
  onClose, 
  recoveryKey, 
  vaultName, 
  vaultPassword,
  onRegenerateKey,
  isNewVault = false 
}) => {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const handleCopyKey = async () => {
    if (recoveryKey) {
      try {
        await navigator.clipboard.writeText(recoveryKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy recovery key:', error);
      }
    }
  };

  const handleRegenerateKey = async () => {
    if (!onRegenerateKey) return;
    
    setRegenerating(true);
    try {
      await onRegenerateKey();
    } catch (error) {
      console.error('Failed to regenerate recovery key:', error);
    } finally {
      setRegenerating(false);
    }
  };

  const formatRecoveryKey = (key) => {
    if (!key) return '';
    return showKey ? key : key.replace(/./g, '•');
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(30, 30, 30, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }
      }}
    >
      <DialogTitle sx={{ color: 'white', display: 'flex', alignItems: 'center', gap: 2 }}>
        <SecurityIcon sx={{ color: '#2196f3' }} />
        {isNewVault ? 'Vault Recovery Key Generated' : 'Vault Recovery Key'}
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Alert 
            severity="warning" 
            icon={<WarningIcon />}
            sx={{ 
              mb: 2,
              backgroundColor: 'rgba(255, 152, 0, 0.1)',
              border: '1px solid rgba(255, 152, 0, 0.3)',
              '& .MuiAlert-message': { color: 'white' }
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
              Important: Save this recovery key in a secure location!
            </Typography>
            <Typography variant="body2">
              • This key can be used to recover your vault if you forget your master password
              • Store it separately from your vault (not on the same device)
              • Anyone with this key can access your vault
              • You cannot recover this key if lost
            </Typography>
          </Alert>

          <Paper 
            sx={{ 
              p: 3, 
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              position: 'relative'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" sx={{ color: 'white' }}>
                Recovery Key for "{vaultName}"
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title={showKey ? 'Hide key' : 'Show key'}>
                  <IconButton 
                    onClick={() => setShowKey(!showKey)}
                    sx={{ color: 'white' }}
                    size="small"
                  >
                    {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </Tooltip>
                <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
                  <IconButton 
                    onClick={handleCopyKey}
                    sx={{ color: copied ? '#4caf50' : 'white' }}
                    size="small"
                  >
                    <CopyIcon />
                  </IconButton>
                </Tooltip>
                {onRegenerateKey && (
                  <Tooltip title="Generate new recovery key">
                    <IconButton 
                      onClick={handleRegenerateKey}
                      disabled={regenerating}
                      sx={{ color: 'white' }}
                      size="small"
                    >
                      {regenerating ? (
                        <CircularProgress size={20} color="inherit" />
                      ) : (
                        <RefreshIcon />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>

            <Box 
              sx={{ 
                fontFamily: 'monospace',
                fontSize: '1.1rem',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                p: 2,
                borderRadius: 1,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                wordBreak: 'break-all',
                color: showKey ? '#4caf50' : 'rgba(255, 255, 255, 0.7)',
                letterSpacing: '0.1em'
              }}
            >
              {formatRecoveryKey(recoveryKey)}
            </Box>

            {copied && (
              <Chip 
                label="Copied to clipboard!" 
                color="success" 
                size="small"
                sx={{ 
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  backgroundColor: '#4caf50'
                }}
              />
            )}
          </Paper>

          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 1 }}>
              Recovery Key Guidelines:
            </Typography>
            <Box component="ul" sx={{ color: 'rgba(255, 255, 255, 0.7)', pl: 2, m: 0 }}>
              <li>Write it down on paper and store in a safe place</li>
              <li>Consider storing a copy in a secure password manager</li>
              <li>Do not store it on the same device as your vault</li>
              <li>Do not share it with anyone unless absolutely necessary</li>
              <li>You can regenerate a new key anytime from vault settings</li>
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button 
          onClick={onClose}
          variant="contained"
          sx={{
            background: 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
            '&:hover': {
              background: 'linear-gradient(45deg, #1976d2 30%, #1cb5e0 90%)',
            }
          }}
        >
          {isNewVault ? 'I have saved my recovery key' : 'Close'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RecoveryKeyDisplay;
