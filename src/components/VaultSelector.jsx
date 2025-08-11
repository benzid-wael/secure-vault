import { useState } from 'react';
import {
  Typography,
  Button,
  Box,
  Card,
  CardContent,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  Security as SecurityIcon,
  FolderOpen as FolderIcon,
  Star as StarIcon,
  Delete as DeleteIcon,
  Warning as WarningIcon
} from '@mui/icons-material';

const VaultSelector = ({ vaults, onVaultSelect, onCreateNew, onVaultDeleted }) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vaultToDelete, setVaultToDelete] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteClick = (vaultName, event) => {
    event.stopPropagation(); // Prevent vault selection
    setVaultToDelete(vaultName);
    setDeleteDialogOpen(true);
    setDeletePassword('');
    setDeleteError('');
  };

  const handleDeleteConfirm = async () => {
    if (!deletePassword.trim()) {
      setDeleteError('Please enter the vault password to confirm deletion');
      return;
    }

    setDeleting(true);
    setDeleteError('');

    try {
      const result = await window.electronAPI.deleteVault(vaultToDelete, deletePassword);
      if (result.success) {
        setDeleteDialogOpen(false);
        setVaultToDelete('');
        setDeletePassword('');
        if (onVaultDeleted) {
          onVaultDeleted(vaultToDelete, result.message);
        }
      } else {
        setDeleteError(result.error || 'Failed to delete vault');
      }
    } catch (error) {
      setDeleteError('Failed to delete vault. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setVaultToDelete('');
    setDeletePassword('');
    setDeleteError('');
  };

  return (
    <div className="vault-container">
      <div className="vault-header">
        <Typography variant="h3" className="vault-title">
          <SecurityIcon
            sx={{ fontSize: '3rem', mr: 2, verticalAlign: 'middle' }}
          />
          Secure Vault
        </Typography>
        <Typography variant="h6" className="vault-subtitle">
          Choose a vault or create a new one
        </Typography>
      </div>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
          Available Vaults
        </Typography>

        <div className="vault-list">
          {(vaults || []).map((vault) => (
            <Card
              key={vault}
              className="vault-item"
              sx={{
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                position: 'relative',
                overflow: 'hidden',
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                minHeight: '140px',
                display: 'flex',
                flexDirection: 'column',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: '0 12px 30px rgba(33, 150, 243, 0.4)',
                  border: '1px solid rgba(33, 150, 243, 0.3)',
                  '& .vault-delete-button': {
                    backgroundColor: 'rgba(244, 67, 54, 0.15)',
                    color: '#f44336',
                    borderColor: '#f44336',
                    transform: 'scale(1.05)',
                  }
                },
              }}
            >
              <CardContent
                onClick={() => onVaultSelect(vault)}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  p: 3,
                  flexGrow: 1,
                  position: 'relative',
                }}
              >
                {/* Header with icon and title */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, #2196f3 0%, #21cbf3 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 12px rgba(33, 150, 243, 0.3)',
                    }}
                  >
                    <FolderIcon sx={{ fontSize: '1.5rem', color: 'white' }} />
                  </Box>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography
                      variant="h6"
                      className="vault-item-name"
                      sx={{
                        fontWeight: 600,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        fontSize: '1.1rem'
                      }}
                    >
                      {vault}
                      {vault === 'default' && (
                        <Tooltip title="Default Vault">
                          <StarIcon
                            sx={{ fontSize: '1rem', color: '#ffc107' }}
                          />
                        </Tooltip>
                      )}
                    </Typography>
                  </Box>
                  <SecurityIcon sx={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '1.2rem' }} />
                </Box>

                {/* Description */}
                <Typography
                  variant="body2"
                  className="vault-item-info"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    flexGrow: 1,
                    lineHeight: 1.5,
                    fontSize: '0.875rem'
                  }}
                >
                  {vault === 'default'
                    ? 'Your default password vault with built-in security features'
                    : 'Custom vault for organizing your passwords and sensitive data'}
                </Typography>

                {/* Vault stats/info */}
                <Box sx={{
                  display: 'flex',
                  gap: 2,
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontSize: '0.75rem',
                  alignItems: 'center'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <SecurityIcon sx={{ fontSize: '0.875rem' }} />
                    <span>AES-256</span>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>•</span>
                    <span>Encrypted</span>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>•</span>
                    <span>Secure</span>
                  </Box>
                </Box>
                {/* Delete button overlay - bottom-right corner */}
                <Button
                  className="vault-delete-button"
                  onClick={(e) => handleDeleteClick(vault, e)}
                  variant="outlined"
                  size="small"
                  sx={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    minWidth: 'auto',
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    color: 'rgba(255, 255, 255, 0.4)',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    backdropFilter: 'blur(8px)',
                    transition: 'all 0.3s ease',
                    opacity: 0.7,
                    '&:hover': {
                      backgroundColor: 'rgba(244, 67, 54, 0.2)',
                      borderColor: '#f44336',
                      color: '#f44336',
                      transform: 'scale(1.1)',
                      opacity: 1,
                      boxShadow: '0 4px 12px rgba(244, 67, 54, 0.3)',
                    }
                  }}
                >
                  <DeleteIcon sx={{ fontSize: '1rem' }} />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onCreateNew}
          sx={{
            py: 1.5,
            px: 4,
            fontSize: '1.1rem',
            borderRadius: '12px',
            background: 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
            '&:hover': {
              background: 'linear-gradient(45deg, #1976d2 30%, #1cb5e0 90%)',
              transform: 'translateY(-2px)',
              boxShadow: '0 8px 25px rgba(33, 150, 243, 0.4)',
            },
          }}
        >
          Create New Vault
        </Button>
      </Box>

      <div className="security-indicator">
        <SecurityIcon sx={{ color: '#4caf50' }} />
        <Typography className="security-text">
          All vaults are encrypted with AES-256-GCM encryption
        </Typography>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        maxWidth="sm"
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
          <WarningIcon sx={{ color: '#f44336' }} />
          Delete Vault "{vaultToDelete}"
        </DialogTitle>

        <DialogContent>
          <Alert
            severity="error"
            sx={{
              mb: 2,
              backgroundColor: 'rgba(244, 67, 54, 0.1)',
              border: '1px solid rgba(244, 67, 54, 0.3)',
              '& .MuiAlert-message': { color: 'white' }
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
              Warning: This action cannot be undone!
            </Typography>
            <Typography variant="body2">
              • All passwords and data in this vault will be permanently deleted
              • A backup will be created before deletion
              • You must enter the vault password to confirm
            </Typography>
          </Alert>

          <TextField
            fullWidth
            type="password"
            label="Enter vault password to confirm deletion"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            variant="outlined"
            autoFocus
            disabled={deleting}
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
              }
            }}
            helperText="This password will be used to verify your identity before deletion"
          />

          {deleteError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button
            onClick={handleDeleteCancel}
            disabled={deleting}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            disabled={deleting || !deletePassword.trim()}
            variant="contained"
            sx={{
              backgroundColor: '#f44336',
              '&:hover': {
                backgroundColor: '#d32f2f',
              }
            }}
          >
            {deleting ? (
              <>
                <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} />
                Deleting...
              </>
            ) : (
              'Delete Vault'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default VaultSelector;
