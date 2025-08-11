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
} from '@mui/material';
import {
  FileUpload as ImportIcon,
  FileDownload as ExportIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';

const ImportExportDialog = ({ 
  open, 
  onClose, 
  vaultName, 
  vaultPassword, 
  availableVaults,
  onImportSuccess 
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', severity: 'info' });
  
  // Export state
  const [exportPath, setExportPath] = useState('');
  
  // Import state
  const [importPath, setImportPath] = useState('');
  const [newVaultName, setNewVaultName] = useState('');
  const [importPassword, setImportPassword] = useState('');

  const showMessage = (text, severity = 'info') => {
    setMessage({ text, severity });
    setTimeout(() => setMessage({ text: '', severity: 'info' }), 5000);
  };

  const handleExport = async () => {
    if (!exportPath.trim()) {
      showMessage('Please specify an export file path', 'error');
      return;
    }

    if (!exportPath.endsWith('.vault.json')) {
      showMessage('Export file must have .vault.json extension', 'error');
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.exportVault(
        vaultName,
        vaultPassword,
        exportPath
      );

      if (result.success) {
        showMessage('Vault exported successfully!', 'success');
        setExportPath('');
      } else {
        showMessage(result.error || 'Failed to export vault', 'error');
      }
    } catch (error) {
      showMessage('Error exporting vault', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importPath.trim()) {
      showMessage('Please specify an import file path', 'error');
      return;
    }

    if (!newVaultName.trim()) {
      showMessage('Please specify a name for the imported vault', 'error');
      return;
    }

    if (!importPassword.trim()) {
      showMessage('Please enter the password for the import file', 'error');
      return;
    }

    if (availableVaults.includes(newVaultName)) {
      showMessage('A vault with this name already exists', 'error');
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.importVault(
        importPath,
        newVaultName,
        importPassword
      );

      if (result.success) {
        showMessage(
          `Vault imported successfully! ${result.metadata?.entryCount || 0} entries imported.`,
          'success'
        );
        setImportPath('');
        setNewVaultName('');
        setImportPassword('');
        
        if (onImportSuccess) {
          onImportSuccess(newVaultName);
        }
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
      setExportPath('');
      setImportPath('');
      setNewVaultName('');
      setImportPassword('');
      setActiveTab(0);
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

        {activeTab === 0 && (
          <Box sx={{ display: 'grid', gap: 3 }}>
            <Alert severity="info">
              Export your vault to a secure, encrypted file that can be imported later or on another device.
            </Alert>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1, color: 'white' }}>
                Current Vault: <strong>{vaultName}</strong>
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                This vault will be exported with all its entries and settings.
              </Typography>
            </Box>

            <TextField
              label="Export File Path"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              placeholder="/path/to/export/my-vault.vault.json"
              fullWidth
              helperText="Specify the full path where the vault should be exported (must end with .vault.json)"
              sx={{
                '& .MuiInputBase-input': { color: 'white' },
                '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' },
                '& .MuiFormHelperText-root': { color: 'rgba(255, 255, 255, 0.5)' },
              }}
            />
          </Box>
        )}

        {activeTab === 1 && (
          <Box sx={{ display: 'grid', gap: 3 }}>
            <Alert severity="warning">
              Import a vault from an encrypted export file. The imported vault will be created as a new vault.
            </Alert>

            <TextField
              label="Import File Path"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="/path/to/import/vault-export.vault.json"
              fullWidth
              helperText="Path to the vault export file (.vault.json)"
              sx={{
                '& .MuiInputBase-input': { color: 'white' },
                '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' },
                '& .MuiFormHelperText-root': { color: 'rgba(255, 255, 255, 0.5)' },
              }}
            />

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
                '& .MuiFormHelperText-root': { color: 'rgba(255, 255, 255, 0.5)' },
              }}
            />

            <TextField
              label="Import Password"
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              placeholder="Password for the import file"
              fullWidth
              helperText="The master password that was used when the vault was exported"
              sx={{
                '& .MuiInputBase-input': { color: 'white' },
                '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' },
                '& .MuiFormHelperText-root': { color: 'rgba(255, 255, 255, 0.5)' },
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
