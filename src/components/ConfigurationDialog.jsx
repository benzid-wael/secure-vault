import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Folder as FolderIcon,
  Security as SecurityIcon,
  Info as InfoIcon,
  Storage as StorageIcon,
  Computer as ComputerIcon,
  Schedule as ScheduleIcon,
  Key as KeyIcon,
} from '@mui/icons-material';

const ConfigurationDialog = ({ open, onClose, vaultName, vaultPassword }) => {
  const [loading, setLoading] = useState(true);
  const [vaultDirectory, setVaultDirectory] = useState('');
  const [vaultInfo, setVaultInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      loadConfiguration();
    }
  }, [open, vaultName, vaultPassword]);

  const loadConfiguration = async () => {
    setLoading(true);
    setError('');

    try {
      // Load vault directory
      if (window.electronAPI) {
        const dirResult = await window.electronAPI.getVaultDirectory();
        if (dirResult.success) {
          setVaultDirectory(dirResult.path);
        }

        // Load vault information
        if (vaultName && vaultPassword) {
          const vaultResult = await window.electronAPI.loadVault(
            vaultName,
            vaultPassword
          );
          if (vaultResult.success) {
            setVaultInfo(vaultResult.data);
          } else {
            setError('Failed to load vault information');
          }
        }
      }
    } catch (err) {
      setError('Error loading configuration');
      console.error('Configuration load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleString();
  };

  const formatFileSize = (entries) => {
    if (!entries) return '0 KB';
    // Rough estimate: each entry is about 200-500 bytes when encrypted
    const estimatedSize = entries.length * 350;
    if (estimatedSize < 1024) return `${estimatedSize} B`;
    if (estimatedSize < 1024 * 1024)
      return `${(estimatedSize / 1024).toFixed(1)} KB`;
    return `${(estimatedSize / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getPasswordAge = () => {
    if (!vaultInfo?.lastPasswordChange) return 'Unknown';
    const lastChange = new Date(vaultInfo.lastPasswordChange);
    const now = new Date();
    const diffDays = Math.floor((now - lastChange) / (1000 * 60 * 60 * 24));
    return `${diffDays} days ago`;
  };

  const handleClose = () => {
    setError('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1a1a1a',
          color: 'white',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        },
      }}
    >
      <DialogTitle sx={{ color: 'white', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SettingsIcon />
          <Typography variant="h6">Configuration</Typography>
          <Chip
            label="Ctrl+S"
            size="small"
            sx={{
              ml: 'auto',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              fontSize: '0.75rem',
            }}
          />
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 3 }}>
            {/* System Information */}
            <Box>
              <Typography
                variant="h6"
                sx={{
                  color: 'white',
                  mb: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <ComputerIcon />
                System Information
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <FolderIcon sx={{ color: '#2196f3' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary="Vault Storage Directory"
                    secondary={
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'rgba(255, 255, 255, 0.7)',
                          wordBreak: 'break-all',
                        }}
                      >
                        {vaultDirectory || 'Unknown'}
                      </Typography>
                    }
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <StorageIcon sx={{ color: '#4caf50' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary="Application Version"
                    secondary={
                      <Typography
                        variant="body2"
                        sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                      >
                        Secure Password Manager v1.0
                      </Typography>
                    }
                  />
                </ListItem>
              </List>
            </Box>

            <Divider sx={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />

            {/* Current Vault Information */}
            {vaultInfo && (
              <Box>
                <Typography
                  variant="h6"
                  sx={{
                    color: 'white',
                    mb: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <SecurityIcon />
                  Current Vault: {vaultName}
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <InfoIcon sx={{ color: '#ff9800' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary="Created"
                      secondary={
                        <Typography
                          variant="body2"
                          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                        >
                          {formatDate(vaultInfo.created)}
                        </Typography>
                      }
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <ScheduleIcon sx={{ color: '#9c27b0' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary="Last Password Change"
                      secondary={
                        <Typography
                          variant="body2"
                          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                        >
                          {formatDate(vaultInfo.lastPasswordChange)} (
                          {getPasswordAge()})
                        </Typography>
                      }
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <KeyIcon sx={{ color: '#f44336' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary="Stored Entries"
                      secondary={
                        <Typography
                          variant="body2"
                          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                        >
                          {vaultInfo.entries?.length || 0} entries (~
                          {formatFileSize(vaultInfo.entries)})
                        </Typography>
                      }
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <SecurityIcon sx={{ color: '#00bcd4' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary="Password History"
                      secondary={
                        <Typography
                          variant="body2"
                          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                        >
                          {vaultInfo.passwordHistory?.length || 0} previous
                          passwords stored
                        </Typography>
                      }
                    />
                  </ListItem>
                </List>
              </Box>
            )}

            <Divider sx={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />

            {/* Security Settings */}
            {vaultInfo?.settings && (
              <Box>
                <Typography
                  variant="h6"
                  sx={{
                    color: 'white',
                    mb: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <SecurityIcon />
                  Security Settings
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  <Chip
                    label={`Password Change Enforcement: ${vaultInfo.settings.enforcePasswordChange ? 'Enabled' : 'Disabled'}`}
                    color={
                      vaultInfo.settings.enforcePasswordChange
                        ? 'success'
                        : 'default'
                    }
                    variant="outlined"
                  />
                  <Chip
                    label={`Warning Days: ${vaultInfo.settings.passwordChangeWarningDays || 90}`}
                    color="info"
                    variant="outlined"
                  />
                  <Chip
                    label={`Password Reuse Prevention: ${vaultInfo.settings.preventPasswordReuse ? 'Enabled' : 'Disabled'}`}
                    color={
                      vaultInfo.settings.preventPasswordReuse
                        ? 'success'
                        : 'default'
                    }
                    variant="outlined"
                  />
                  <Chip
                    label={`Max Password History: ${vaultInfo.settings.maxPasswordHistory || 1}`}
                    color="info"
                    variant="outlined"
                  />
                </Box>
              </Box>
            )}

            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                <strong>Keyboard Shortcut:</strong> Press Ctrl+S (Cmd+S on Mac)
                anytime to open this configuration dialog.
              </Typography>
            </Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 1 }}>
        <Button
          onClick={handleClose}
          variant="contained"
          sx={{
            background: 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
            '&:hover': {
              background: 'linear-gradient(45deg, #1976d2 30%, #1cb5e0 90%)',
            },
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfigurationDialog;
