// Refactored PasswordManager component with improved modularity
import React, { useState, useEffect } from 'react';
import {
  Typography,
  Button,
  Box,
  Fab,
  Snackbar,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';

// Custom hooks
import { useEntryManagement } from '../hooks/useEntryManagement';
import { useSearchAndFilter } from '../hooks/useSearchAndFilter';

// Modular components
import SearchAndFilter from './SearchAndFilter';
import EntryList from './EntryList';
import EntryDialog from './EntryDialog';
import Settings from './Settings';

const PasswordManager = ({ vaultName, vaultPassword, onLock }) => {
  // State management
  const [showSettings, setShowSettings] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [currentVaultPassword, setCurrentVaultPassword] = useState(vaultPassword);

  // Custom hooks for data management
  const {
    entries,
    loading,
    error,
    loadEntries,
    addEntry,
    updateEntry,
    deleteEntry
  } = useEntryManagement(vaultName, currentVaultPassword);

  const {
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    filteredEntries,
    clearFilters
  } = useSearchAndFilter(entries);

  // Load entries on component mount
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Utility functions
  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const validateEntry = (entry) => {
    const errors = {};
    if (!entry.title?.trim()) errors.title = 'Title is required';
    if (!entry.username?.trim()) errors.username = 'Username/Email is required';
    if (!entry.password?.trim()) errors.password = 'Password is required';
    return errors;
  };

  // Entry management handlers
  const handleAddEntry = async (entryData) => {
    const errors = validateEntry(entryData);
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      showSnackbar('Please fill in all required fields', 'error');
      return;
    }

    const result = await addEntry({
      ...entryData,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (result.success) {
      setShowAddDialog(false);
      setValidationErrors({});
      showSnackbar('Password entry added successfully');
    } else {
      showSnackbar(result.error || 'Failed to add entry', 'error');
    }
  };

  const handleUpdateEntry = async (entryData) => {
    const errors = validateEntry(entryData);
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      showSnackbar('Please fill in all required fields', 'error');
      return;
    }

    const result = await updateEntry(editingEntry.id, {
      ...entryData,
      id: editingEntry.id,
      createdAt: editingEntry.createdAt,
      updatedAt: new Date().toISOString()
    });

    if (result.success) {
      setEditingEntry(null);
      setValidationErrors({});
      showSnackbar('Password entry updated successfully');
    } else {
      showSnackbar(result.error || 'Failed to update entry', 'error');
    }
  };

  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this password entry?')) {
      return;
    }

    const result = await deleteEntry(entryId);
    if (result.success) {
      showSnackbar('Password entry deleted successfully');
    } else {
      showSnackbar(result.error || 'Failed to delete entry', 'error');
    }
  };

  const handleCopyPassword = async (password) => {
    try {
      await navigator.clipboard.writeText(password);
      showSnackbar('Password copied to clipboard');
    } catch (err) {
      showSnackbar('Failed to copy password', 'error');
    }
  };

  const handleEditEntry = (entry) => {
    setEditingEntry(entry);
  };

  const handlePasswordChanged = (newPassword) => {
    setCurrentVaultPassword(newPassword);
  };

  const handleDialogSave = (entryData) => {
    if (editingEntry) {
      handleUpdateEntry(entryData);
    } else {
      handleAddEntry(entryData);
    }
  };

  const handleDialogClose = () => {
    setShowAddDialog(false);
    setEditingEntry(null);
    setValidationErrors({});
  };

  // Show settings component
  if (showSettings) {
    return (
      <Settings
        vaultName={vaultName}
        vaultPassword={currentVaultPassword}
        onBack={() => setShowSettings(false)}
        onPasswordChanged={handlePasswordChanged}
      />
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#121212', color: 'white', p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
            Password Manager
          </Typography>
          <Typography variant="body1" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            Vault: {vaultName}
          </Typography>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={() => setShowSettings(true)}
            sx={{ color: 'white', borderColor: 'rgba(255, 255, 255, 0.3)' }}
          >
            Settings
          </Button>
          <Button
            variant="outlined"
            onClick={onLock}
            sx={{ color: 'white', borderColor: 'rgba(255, 255, 255, 0.3)' }}
          >
            Lock Vault
          </Button>
        </Box>
      </Box>

      {/* Loading State */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error State */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Main Content */}
      {!loading && !error && (
        <>
          {/* Search and Filter */}
          <SearchAndFilter
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            onClearFilters={clearFilters}
            entriesCount={entries.length}
            filteredCount={filteredEntries.length}
          />

          {/* Entry List */}
          <EntryList
            entries={filteredEntries}
            onEdit={handleEditEntry}
            onDelete={handleDeleteEntry}
            onCopyPassword={handleCopyPassword}
          />

          {/* Add Entry FAB */}
          <Fab
            color="primary"
            aria-label="add"
            onClick={() => setShowAddDialog(true)}
            sx={{
              position: 'fixed',
              bottom: 24,
              right: 24,
            }}
          >
            <AddIcon />
          </Fab>
        </>
      )}

      {/* Entry Dialog */}
      <EntryDialog
        open={showAddDialog || !!editingEntry}
        onClose={handleDialogClose}
        onSave={handleDialogSave}
        entry={editingEntry}
        validationErrors={validationErrors}
        onValidationErrorsChange={setValidationErrors}
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
    </Box>
  );
};

export default PasswordManager;
