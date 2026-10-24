import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  Tabs,
  Tab,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  FileUpload as ImportIcon,
  FileDownload as ExportIcon,
  Security as SecurityIcon,
  FolderOpen as BrowseIcon,
} from '@mui/icons-material';

const ImportExportDialog = ({
  open,
  onClose,
  vaultName,
  availableVaults,
  onImportSuccess,
  importOnly = false,
}) => {
  const initialTab = importOnly ? 1 : 0;
  const [activeTab, setActiveTab] = useState(initialTab);

  React.useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', severity: 'info' });

  // Import state
  const [importPath, setImportPath] = useState('');
  const [newVaultName, setNewVaultName] = useState('');
  const [importPassword, setImportPassword] = useState('');
  // An export of a vault with a key file (New-55): main asks for the key
  // file after the password, or the recovery key opens it alone.
  const [importNeedsKeyFile, setImportNeedsKeyFile] = useState(false);
  const [useRecoveryKey, setUseRecoveryKey] = useState(false);

  const showMessage = (text, severity = 'info') => {
    setMessage({ text, severity });
    setTimeout(() => setMessage({ text: '', severity: 'info' }), 5000);
  };

  // The destination is chosen in a native save dialog opened by the main
  // process, so the page never supplies a file path.
  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.exportVault(vaultName);

      if (result.canceled) return;
      if (result.success) {
        showMessage(
          result.exportPath
            ? `Vault exported to ${result.exportPath}`
            : 'Vault exported successfully!',
          'success'
        );
      } else {
        showMessage(result.error || 'Failed to export vault', 'error');
      }
    } catch (error) {
      showMessage('Error exporting vault', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseImportFile = async () => {
    if (!window.electronAPI?.selectImportFile) {
      showMessage('File picker is not available in this environment', 'error');
      return;
    }
    try {
      const result = await window.electronAPI.selectImportFile();
      if (result.canceled) return;
      if (!result.success) {
        showMessage(result.error || 'Could not select file', 'error');
        return;
      }
      setImportPath(result.filePath);
      setImportNeedsKeyFile(Boolean(result.keyFile));
      setUseRecoveryKey(false);
      if (!newVaultName.trim()) {
        const base = result.filePath.split(/[\\/]/).pop() || '';
        const suggested = base.replace(/\.vault\.json$/i, '');
        if (suggested) setNewVaultName(suggested);
      }
    } catch (error) {
      showMessage('Error opening file picker', 'error');
    }
  };

  const handleImport = async () => {
    if (!importPath.trim()) {
      showMessage('Choose a vault export file with Browse…', 'error');
      return;
    }

    if (!newVaultName.trim()) {
      showMessage('Please specify a name for the imported vault', 'error');
      return;
    }

    if (!importPassword.trim()) {
      showMessage(
        useRecoveryKey
          ? 'Please enter the recovery key of the vault'
          : 'Please enter the password for the import file',
        'error'
      );
      return;
    }

    if ((availableVaults || []).includes(newVaultName)) {
      showMessage('A vault with this name already exists', 'error');
      return;
    }

    setLoading(true);
    try {
      // The main process imports the file picked in its open dialog.
      const result = await window.electronAPI.importVault(
        newVaultName,
        importPassword,
        useRecoveryKey ? { recoveryKey: true } : {}
      );

      if (result.success) {
        const count = result.metadata?.entryCount || 0;
        showMessage(
          [
            `Vault imported successfully! ${count} ${count === 1 ? 'entry' : 'entries'} imported.`,
            result.keyFile &&
              (useRecoveryKey
                ? 'It still needs its password and key file: if you no longer have them, unlock it with Forgot your password? and the recovery key to set new ones.'
                : 'It needs the same key file as the original.'),
          ]
            .filter(Boolean)
            .join(' '),
          'success'
        );
        setImportPath('');
        setNewVaultName('');
        setImportPassword('');
        setImportNeedsKeyFile(false);
        setUseRecoveryKey(false);

        if (onImportSuccess) {
          onImportSuccess(newVaultName);
        }
      } else if (result.canceled) {
        // The key file dialog was closed: nothing changed.
      } else {
        showMessage(result.error || 'Failed to import vault', 'error');
      }
    } catch (error) {
      showMessage('Error importing vault', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setMessage({ text: '', severity: 'info' });
      setImportPath('');
      setNewVaultName('');
      setImportPassword('');
      setImportNeedsKeyFile(false);
      setUseRecoveryKey(false);
      setActiveTab(initialTab);
      onClose();
    }
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
          <SecurityIcon />
          <Typography variant="h6">Import/Export Vault</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {message.text && (
          <Alert severity={message.severity} sx={{ mb: 2 }}>
            {message.text}
          </Alert>
        )}

        {!importOnly && (
          <Tabs
            value={activeTab}
            onChange={(e, newValue) => setActiveTab(newValue)}
            sx={{
              mb: 3,
              '& .MuiTab-root': { color: 'rgba(255, 255, 255, 0.7)' },
              '& .Mui-selected': { color: 'white' },
              '& .MuiTabs-indicator': { backgroundColor: '#2196f3' },
            }}
          >
            <Tab
              icon={<ExportIcon />}
              label="Export Vault"
              iconPosition="start"
            />
            <Tab
              icon={<ImportIcon />}
              label="Import Vault"
              iconPosition="start"
            />
          </Tabs>
        )}

        {activeTab === 0 && (
          <Box sx={{ display: 'grid', gap: 3 }}>
            <Alert severity="info">
              Export your vault to a secure, encrypted file that can be imported
              later or on another device.
            </Alert>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1, color: 'white' }}>
                Current Vault: <strong>{vaultName}</strong>
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
              >
                This vault will be exported with all its entries and settings.
              </Typography>
            </Box>

            <Typography
              variant="body2"
              sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              You will choose where to save the .vault.json file.
            </Typography>
          </Box>
        )}

        {activeTab === 1 && (
          <Box sx={{ display: 'grid', gap: 3 }}>
            <Alert severity="warning">
              Import a vault from an encrypted export file. The imported vault
              will be created as a new vault.
            </Alert>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                label="Import File"
                value={importPath}
                placeholder="Choose a .vault.json export"
                fullWidth
                InputProps={{ readOnly: true }}
                helperText="Use Browse… to pick the vault export file"
                sx={{
                  '& .MuiInputBase-input': { color: 'white' },
                  '& .MuiInputLabel-root': {
                    color: 'rgba(255, 255, 255, 0.7)',
                  },
                  '& .MuiFormHelperText-root': {
                    color: 'rgba(255, 255, 255, 0.5)',
                  },
                }}
              />
              <Button
                onClick={handleBrowseImportFile}
                disabled={loading}
                variant="outlined"
                startIcon={<BrowseIcon />}
                sx={{
                  mt: '8px',
                  whiteSpace: 'nowrap',
                  color: 'white',
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  '&:hover': { borderColor: 'rgba(255, 255, 255, 0.6)' },
                }}
              >
                Browse…
              </Button>
            </Box>

            <TextField
              label="New Vault Name"
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              placeholder="imported-vault"
              fullWidth
              helperText="Name for the imported vault (must be unique)"
              sx={{
                '& .MuiInputBase-input': { color: 'white' },
                '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' },
                '& .MuiFormHelperText-root': {
                  color: 'rgba(255, 255, 255, 0.5)',
                },
              }}
            />

            {importNeedsKeyFile && (
              <Alert severity="info">
                This vault requires a key file: after its password you’ll choose
                the key file. Without it, its recovery key opens it alone.
                <FormControlLabel
                  sx={{ display: 'flex', mt: 1 }}
                  control={
                    <Checkbox
                      checked={useRecoveryKey}
                      onChange={(e) => {
                        setUseRecoveryKey(e.target.checked);
                        setImportPassword('');
                      }}
                    />
                  }
                  label="I don’t have the key file: use the recovery key"
                />
              </Alert>
            )}

            <TextField
              label={useRecoveryKey ? 'Recovery Key' : 'Import Password'}
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              placeholder={
                useRecoveryKey
                  ? 'XXXX-XXXX-XXXX-…'
                  : 'Password for the import file'
              }
              fullWidth
              helperText={
                useRecoveryKey
                  ? 'The recovery key of the vault that was exported'
                  : 'The master password that was used when the vault was exported'
              }
              sx={{
                '& .MuiInputBase-input': { color: 'white' },
                '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' },
                '& .MuiFormHelperText-root': {
                  color: 'rgba(255, 255, 255, 0.5)',
                },
              }}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 1 }}>
        <Button
          onClick={handleClose}
          disabled={loading}
          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
        >
          Cancel
        </Button>
        <Button
          onClick={activeTab === 0 ? handleExport : handleImport}
          variant="contained"
          disabled={loading}
          startIcon={
            loading ? (
              <CircularProgress size={20} />
            ) : activeTab === 0 ? (
              <ExportIcon />
            ) : (
              <ImportIcon />
            )
          }
          sx={{
            background: 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
            '&:hover': {
              background: 'linear-gradient(45deg, #1976d2 30%, #1cb5e0 90%)',
            },
          }}
        >
          {loading
            ? 'Processing...'
            : activeTab === 0
              ? 'Export Vault'
              : 'Import Vault'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImportExportDialog;
