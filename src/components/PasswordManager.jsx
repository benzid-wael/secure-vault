import React, { useState, useEffect } from 'react';
import { Typography, Button, Box, Alert, Snackbar } from '@mui/material';
import {
  Lock as LockIcon,
  Security as SecurityIcon,
  Settings as SettingsIcon,
  ImportExport as ImportExportIcon,
} from '@mui/icons-material';

import Settings from './Settings';
import EnhancedEntryDialog from './EnhancedEntryDialog';
import SearchAndFilter from './SearchAndFilter';
import AddEntryMenu from './AddEntryMenu';
import ImportExportDialog from './ImportExportDialog';
import EntryList from './EntryList';
import {
  validateEntryByType,
  getSearchFields,
  ENTRY_TYPE_DEFINITIONS,
} from '../utils/entryTypes';

const PasswordManager = ({
  vaultName,
  onLock,
  usesDefaultPassword = false,
  onPasswordChanged = () => {},
}) => {
  const [entries, setEntries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
  });
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedEntryTypeFilter, setSelectedEntryTypeFilter] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [selectedEntryType, setSelectedEntryType] = useState('password');
  // A vault from a newer SecureVault (New-29): saves are refused in main.
  const [readOnlyMessage, setReadOnlyMessage] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);
  const [availableVaults, setAvailableVaults] = useState([]);

  useEffect(() => {
    loadVaultData();
    loadAvailableVaults();
  }, []);

  const loadAvailableVaults = async () => {
    console.log(
      'loadAvailableVaults called, window.electronAPI:',
      !!window.electronAPI
    );
    if (window.electronAPI) {
      try {
        console.log('Calling getVaults...');
        const vaults = await window.electronAPI.getVaults();
        console.log('Received vaults:', vaults);
        setAvailableVaults(vaults || []);
      } catch (error) {
        console.error('Error loading available vaults:', error);
      }
    } else {
      console.error('window.electronAPI is not available!');
    }
  };

  const loadVaultData = async () => {
    if (window.electronAPI && vaultName) {
      try {
        const result = await window.electronAPI.loadVault(vaultName);

        if (result.success) {
          // Handle both array and object formats for entries
          let entries = result.data.entries || {};

          let entriesArray = [];

          // If entries is an array, ensure each entry has an id
          if (Array.isArray(entries)) {
            entriesArray = entries.map((entry) => ({
              ...entry,
              id: entry.id || `temp-${Math.random().toString(36).substr(2, 9)}`,
            }));
          }
          // If entries is an object, convert to array with id as key
          else if (typeof entries === 'object' && entries !== null) {
            entriesArray = Object.entries(entries).map(([id, entry]) => ({
              ...entry,
              id: entry.id || id, // Use existing id or the object key as id
            }));
          }

          setEntries(entriesArray);
          setReadOnlyMessage(result.readOnly ? result.formatMessage : '');
        } else {
          console.error('Failed to load vault data:', result.error);
          showSnackbar(`Failed to load vault data: ${result.error}`, 'error');
        }
      } catch (error) {
        showSnackbar('Error loading vault', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  const saveVaultData = async (updatedEntries) => {
    if (window.electronAPI && vaultName) {
      try {
        // Convert array of entries to an object with IDs as keys
        const entriesObject = updatedEntries.reduce((acc, entry) => {
          acc[entry.id] = entry;
          return acc;
        }, {});

        const vaultData = {
          version: '1.0',
          created: new Date().toISOString(),
          entries: entriesObject, // Now sending an object with IDs as keys
        };

        const result = await window.electronAPI.saveVault(vaultName, vaultData);
        if (result.success) {
          setEntries(updatedEntries);
          return true;
        } else {
          showSnackbar(
            result.code === 'NEWER_FORMAT'
              ? result.error
              : 'Failed to save vault',
            'error'
          );
          return false;
        }
      } catch (error) {
        showSnackbar('Error saving vault', 'error');
        return false;
      }
    }
    return false;
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const validateEntry = (entry) => {
    return validateEntryByType(entry, entry.entryType || 'password');
  };

  const handleAddEntryType = (entryType) => {
    setSelectedEntryType(entryType);
    setShowAddDialog(true);
  };

  const handleImportSuccess = (importedVaultName) => {
    showSnackbar(`Vault "${importedVaultName}" imported successfully!`);
    loadAvailableVaults(); // Refresh the available vaults list
  };

  const handleAddEntry = async (formData) => {
    const errors = validateEntry(formData);
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      showSnackbar('Please fill in all required fields', 'error');
      return;
    }

    const entry = {
      id: Date.now().toString(),
      ...formData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedEntries = [...entries, entry];
    const success = await saveVaultData(updatedEntries);

    if (success) {
      setShowAddDialog(false);
      setValidationErrors({});
      const entryTypeName =
        ENTRY_TYPE_DEFINITIONS[formData.entryType]?.name || 'Entry';
      showSnackbar(`${entryTypeName} added successfully`);
    }
  };

  const handleEditEntry = async (formData) => {
    const errors = validateEntry(formData);
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      showSnackbar('Please fill in all required fields', 'error');
      return;
    }

    const updatedEntries = entries.map((entry) =>
      entry.id === editingEntry.id
        ? {
            ...formData,
            id: editingEntry.id,
            updatedAt: new Date().toISOString(),
          }
        : entry
    );

    const success = await saveVaultData(updatedEntries);

    if (success) {
      setEditingEntry(null);
      setValidationErrors({});
      showSnackbar('Entry updated successfully');
    }
  };

  const handleDeleteEntry = async (entryId) => {
    const updatedEntries = entries.filter((entry) => entry.id !== entryId);
    const success = await saveVaultData(updatedEntries);

    if (success) {
      showSnackbar('Entry deleted successfully');
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showSnackbar(`${label} copied to clipboard`);
      })
      .catch(() => {
        showSnackbar('Failed to copy to clipboard', 'error');
      });
  };

  const filteredEntries = entries.filter((entry) => {
    // Enhanced search that works with different entry types
    const searchFields = getSearchFields(entry.entryType || 'password');
    const matchesSearch =
      searchTerm === '' ||
      searchFields.some((fieldName) => {
        const value = entry[fieldName];
        return (
          value &&
          value.toString().toLowerCase().includes(searchTerm.toLowerCase())
        );
      });

    const matchesCategory =
      selectedCategory === '' ||
      selectedCategory === 'all' ||
      entry.category === selectedCategory;

    const matchesEntryType =
      selectedEntryTypeFilter === '' ||
      (entry.entryType || 'password') === selectedEntryTypeFilter;

    return matchesSearch && matchesCategory && matchesEntryType;
  });

  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedCategory('');
    setSelectedEntryTypeFilter('');
  };

  if (loading) {
    return (
      <div className="manager-container">
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
          }}
        >
          <Typography variant="h6" sx={{ color: 'white' }}>
            Loading vault...
          </Typography>
        </Box>
      </div>
    );
  }

  if (showSettings) {
    return (
      <Settings
        vaultName={vaultName}
        onBack={() => setShowSettings(false)}
        onPasswordChanged={onPasswordChanged}
      />
    );
  }

  return (
    <div className="manager-container">
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <SecurityIcon sx={{ color: '#2196f3', mr: 2, fontSize: '2rem' }} />
          <Box>
            <Typography variant="h4" sx={{ color: 'white', fontWeight: 300 }}>
              {vaultName}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}{' '}
              stored
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<ImportExportIcon />}
            onClick={() => setShowImportExport(true)}
            sx={{ color: 'white', borderColor: 'white' }}
          >
            Import/Export
          </Button>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={() => setShowSettings(true)}
            sx={{ color: 'white', borderColor: 'white' }}
          >
            Settings
          </Button>
          <Button
            variant="outlined"
            startIcon={<LockIcon />}
            onClick={onLock}
            sx={{ color: 'white', borderColor: 'white' }}
          >
            Lock Vault
          </Button>
        </Box>
      </Box>

      {usesDefaultPassword && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setShowSettings(true)}
            >
              Change password
            </Button>
          }
        >
          This vault still uses the built-in password from an earlier version,
          which anyone can look up. Change it now.
        </Alert>
      )}

      {readOnlyMessage && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>Read-only.</strong> {readOnlyMessage}
        </Alert>
      )}

      {/* Search and Filter */}
      <SearchAndFilter
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        selectedEntryType={selectedEntryTypeFilter}
        onEntryTypeChange={setSelectedEntryTypeFilter}
        onClearFilters={handleClearFilters}
        entriesCount={entries.length}
        filteredCount={filteredEntries.length}
      />

      {/* Password Entries */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', mb: 2 }}>
        {filteredEntries.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <SecurityIcon
              sx={{
                fontSize: '4rem',
                color: 'rgba(255, 255, 255, 0.3)',
                mb: 2,
              }}
            />
            <Typography
              variant="h6"
              sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 1 }}
            >
              {searchTerm ? 'No entries found' : 'No entries stored yet'}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: 'rgba(255, 255, 255, 0.5)' }}
            >
              {searchTerm
                ? 'Try a different search term'
                : 'Add your first entry to get started'}
            </Typography>
          </Box>
        ) : (
          <EntryList
            entries={filteredEntries}
            onEdit={setEditingEntry}
            onDelete={handleDeleteEntry}
            onCopy={copyToClipboard}
          />
        )}
      </Box>

      {/* Add Entry Menu */}
      <AddEntryMenu onEntryTypeSelect={handleAddEntryType} disabled={loading} />

      {/* Add/Edit Dialog */}
      <EnhancedEntryDialog
        open={showAddDialog || editingEntry !== null}
        onClose={() => {
          setShowAddDialog(false);
          setEditingEntry(null);
          setValidationErrors({});
        }}
        onSave={editingEntry ? handleEditEntry : handleAddEntry}
        entry={editingEntry}
        entryType={selectedEntryType}
        validationErrors={validationErrors}
        onValidationErrorsChange={setValidationErrors}
      />

      {/* Import/Export Dialog */}
      <ImportExportDialog
        open={showImportExport}
        onClose={() => setShowImportExport(false)}
        vaultName={vaultName}
        availableVaults={availableVaults}
        onImportSuccess={handleImportSuccess}
      />

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
    </div>
  );
};

export default PasswordManager;
