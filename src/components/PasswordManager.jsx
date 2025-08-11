import React, { useState, useEffect } from 'react';
import {
  Typography,
  Button,
  Box,
  Card,
  CardContent,
  IconButton,
  TextField,
  Chip,
  Fab,
  Alert,
  Snackbar,
  Menu,
  MenuItem,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Visibility,
  VisibilityOff,
  ContentCopy as CopyIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Lock as LockIcon,
  Language as WebIcon,
  Email as EmailIcon,
  Business as BusinessIcon,
  MoreVert as MoreVertIcon,
  Security as SecurityIcon,
  Work as WorkIcon,
  School as SchoolIcon,
  CreditCard as CreditCardIcon,
  Games as GamesIcon,
  Cloud as CloudIcon,
  Smartphone as SmartphoneIcon,
  Settings as SettingsIcon,
  ImportExport as ImportExportIcon,
} from '@mui/icons-material';

import Settings from './Settings';
import EnhancedEntryDialog from './EnhancedEntryDialog';
import SearchAndFilter from './SearchAndFilter';
import AddEntryMenu from './AddEntryMenu';
import ImportExportDialog from './ImportExportDialog';
import {
  validateEntryByType,
  getSearchFields,
  ENTRY_TYPE_DEFINITIONS,
} from '../utils/entryTypes';

const PasswordManager = ({ vaultName, vaultPassword, onLock }) => {
  const [entries, setEntries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showPasswords, setShowPasswords] = useState({});
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
  });
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedEntryTypeFilter, setSelectedEntryTypeFilter] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [currentVaultPassword, setCurrentVaultPassword] =
    useState(vaultPassword);
  const [selectedEntryType, setSelectedEntryType] = useState('password');
  const [showImportExport, setShowImportExport] = useState(false);
  const [availableVaults, setAvailableVaults] = useState([]);

  // Predefined categories
  const categories = [
    {
      value: 'general',
      label: 'General',
      icon: <SecurityIcon />,
      color: '#9c27b0',
    },
    { value: 'website', label: 'Website', icon: <WebIcon />, color: '#2196f3' },
    { value: 'email', label: 'Email', icon: <EmailIcon />, color: '#4caf50' },
    {
      value: 'business',
      label: 'Business',
      icon: <BusinessIcon />,
      color: '#ff9800',
    },
    { value: 'work', label: 'Work', icon: <WorkIcon />, color: '#795548' },
    {
      value: 'school',
      label: 'School',
      icon: <SchoolIcon />,
      color: '#607d8b',
    },
    {
      value: 'finance',
      label: 'Finance',
      icon: <CreditCardIcon />,
      color: '#e91e63',
    },
    { value: 'gaming', label: 'Gaming', icon: <GamesIcon />, color: '#673ab7' },
    {
      value: 'cloud',
      label: 'Cloud Service',
      icon: <CloudIcon />,
      color: '#00bcd4',
    },
    {
      value: 'mobile',
      label: 'Mobile App',
      icon: <SmartphoneIcon />,
      color: '#8bc34a',
    },
  ];

  useEffect(() => {
    loadVaultData();
    loadAvailableVaults();
  }, []);

  const loadAvailableVaults = async () => {
    if (window.electronAPI) {
      try {
        const vaults = await window.electronAPI.getVaults();
        setAvailableVaults(vaults || []);
      } catch (error) {
        console.error('Error loading available vaults:', error);
      }
    }
  };

  const loadVaultData = async () => {
    if (window.electronAPI && vaultName && vaultPassword) {
      try {
        const result = await window.electronAPI.loadVault(
          vaultName,
          vaultPassword
        );
        if (result.success) {
          setEntries(result.data.entries || []);
        } else {
          showSnackbar('Failed to load vault data', 'error');
        }
      } catch (error) {
        showSnackbar('Error loading vault', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  const saveVaultData = async (updatedEntries) => {
    if (window.electronAPI && vaultName && vaultPassword) {
      try {
        const vaultData = {
          version: '1.0',
          created: new Date().toISOString(),
          entries: updatedEntries,
        };

        const result = await window.electronAPI.saveVault(
          vaultName,
          vaultPassword,
          vaultData
        );
        if (result.success) {
          setEntries(updatedEntries);
          return true;
        } else {
          showSnackbar('Failed to save vault', 'error');
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
      showSnackbar('Password entry updated successfully');
    }
  };

  const handleDeleteEntry = async (entryId) => {
    const updatedEntries = entries.filter((entry) => entry.id !== entryId);
    const success = await saveVaultData(updatedEntries);

    if (success) {
      showSnackbar('Password entry deleted successfully');
    }
    setAnchorEl(null);
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

  const togglePasswordVisibility = (entryId) => {
    setShowPasswords((prev) => ({
      ...prev,
      [entryId]: !prev[entryId],
    }));
  };

  const getCategoryIcon = (category) => {
    const categoryData = categories.find((cat) => cat.value === category);
    return categoryData ? categoryData.icon : <SecurityIcon />;
  };

  const getCategoryColor = (category) => {
    const categoryData = categories.find((cat) => cat.value === category);
    return categoryData ? categoryData.color : '#9c27b0';
  };

  const getCategoryLabel = (category) => {
    const categoryData = categories.find((cat) => cat.value === category);
    return categoryData ? categoryData.label : 'General';
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

  const handlePasswordChanged = (newPassword) => {
    setCurrentVaultPassword(newPassword);
  };

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
        vaultPassword={currentVaultPassword}
        onBack={() => setShowSettings(false)}
        onPasswordChanged={handlePasswordChanged}
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
              {entries.length} password{entries.length !== 1 ? 's' : ''} stored
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
              {searchTerm ? 'No passwords found' : 'No passwords stored yet'}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: 'rgba(255, 255, 255, 0.5)' }}
            >
              {searchTerm
                ? 'Try a different search term'
                : 'Add your first password to get started'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 2 }}>
            {filteredEntries.map((entry) => (
              <Card
                key={entry.id}
                sx={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(33, 150, 243, 0.3)',
                  },
                }}
              >
                <CardContent>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Box sx={{ flexGrow: 1 }}>
                      <Box
                        sx={{ display: 'flex', alignItems: 'center', mb: 1 }}
                      >
                        <Chip
                          icon={getCategoryIcon(entry.category)}
                          label={getCategoryLabel(entry.category)}
                          size="small"
                          sx={{
                            backgroundColor: getCategoryColor(entry.category),
                            color: 'white',
                            mr: 2,
                          }}
                        />
                        <Typography variant="h6" sx={{ color: 'white' }}>
                          {entry.title}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'grid', gap: 1, mt: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography
                            variant="body2"
                            sx={{
                              color: 'rgba(255, 255, 255, 0.7)',
                              minWidth: 80,
                            }}
                          >
                            Username:
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ color: 'white', mr: 1 }}
                          >
                            {entry.username}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() =>
                              copyToClipboard(entry.username, 'Username')
                            }
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography
                            variant="body2"
                            sx={{
                              color: 'rgba(255, 255, 255, 0.7)',
                              minWidth: 80,
                            }}
                          >
                            Password:
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ color: 'white', mr: 1 }}
                          >
                            {showPasswords[entry.id]
                              ? entry.password
                              : '••••••••'}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => togglePasswordVisibility(entry.id)}
                          >
                            {showPasswords[entry.id] ? (
                              <VisibilityOff fontSize="small" />
                            ) : (
                              <Visibility fontSize="small" />
                            )}
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() =>
                              copyToClipboard(entry.password, 'Password')
                            }
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Box>

                        {entry.url && (
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Typography
                              variant="body2"
                              sx={{
                                color: 'rgba(255, 255, 255, 0.7)',
                                minWidth: 80,
                              }}
                            >
                              URL:
                            </Typography>
                            <Typography
                              variant="body2"
                              sx={{ color: '#2196f3', mr: 1 }}
                            >
                              {entry.url}
                            </Typography>
                            <IconButton
                              size="small"
                              onClick={() => copyToClipboard(entry.url, 'URL')}
                            >
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        )}
                      </Box>
                    </Box>

                    <IconButton
                      onClick={(e) => {
                        setAnchorEl(e.currentTarget);
                        setSelectedEntry(entry);
                      }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Box>

      {/* Add Entry Menu */}
      <AddEntryMenu onEntryTypeSelect={handleAddEntryType} disabled={loading} />

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem
          onClick={() => {
            setEditingEntry(selectedEntry);
            setAnchorEl(null);
          }}
        >
          <EditIcon sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => handleDeleteEntry(selectedEntry?.id)}
          sx={{ color: '#f44336' }}
        >
          <DeleteIcon sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>

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
        vaultPassword={vaultPassword}
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
