import React, { useState, useEffect } from 'react';
import {
  Typography,
  Button,
  Box,
  Card,
  CardContent,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  Chip,
  Fab,
  Alert,
  Snackbar,
  Menu,
  MenuItem,
  Tooltip
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
  Refresh as RefreshIcon
} from '@mui/icons-material';

const PasswordManager = ({ vaultName, vaultPassword, onLock }) => {
  const [entries, setEntries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showPasswords, setShowPasswords] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [loading, setLoading] = useState(true);

  // New entry form state
  const [newEntry, setNewEntry] = useState({
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    category: 'general'
  });

  useEffect(() => {
    loadVaultData();
  }, []);

  const loadVaultData = async () => {
    if (window.electronAPI && vaultName && vaultPassword) {
      try {
        const result = await window.electronAPI.loadVault(vaultName, vaultPassword);
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
          entries: updatedEntries
        };
        
        const result = await window.electronAPI.saveVault(vaultName, vaultPassword, vaultData);
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

  const generatePassword = () => {
    const length = 16;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  };

  const handleAddEntry = async () => {
    if (!newEntry.title || !newEntry.username || !newEntry.password) {
      showSnackbar('Please fill in all required fields', 'error');
      return;
    }

    const entry = {
      id: Date.now().toString(),
      ...newEntry,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const updatedEntries = [...entries, entry];
    const success = await saveVaultData(updatedEntries);
    
    if (success) {
      setShowAddDialog(false);
      setNewEntry({ title: '', username: '', password: '', url: '', notes: '', category: 'general' });
      showSnackbar('Password entry added successfully');
    }
  };

  const handleEditEntry = async () => {
    if (!editingEntry.title || !editingEntry.username || !editingEntry.password) {
      showSnackbar('Please fill in all required fields', 'error');
      return;
    }

    const updatedEntries = entries.map(entry =>
      entry.id === editingEntry.id
        ? { ...editingEntry, updatedAt: new Date().toISOString() }
        : entry
    );

    const success = await saveVaultData(updatedEntries);
    
    if (success) {
      setEditingEntry(null);
      showSnackbar('Password entry updated successfully');
    }
  };

  const handleDeleteEntry = async (entryId) => {
    const updatedEntries = entries.filter(entry => entry.id !== entryId);
    const success = await saveVaultData(updatedEntries);
    
    if (success) {
      showSnackbar('Password entry deleted successfully');
    }
    setAnchorEl(null);
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      showSnackbar(`${label} copied to clipboard`);
    }).catch(() => {
      showSnackbar('Failed to copy to clipboard', 'error');
    });
  };

  const togglePasswordVisibility = (entryId) => {
    setShowPasswords(prev => ({
      ...prev,
      [entryId]: !prev[entryId]
    }));
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'website': return <WebIcon />;
      case 'email': return <EmailIcon />;
      case 'business': return <BusinessIcon />;
      default: return <SecurityIcon />;
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'website': return '#2196f3';
      case 'email': return '#4caf50';
      case 'business': return '#ff9800';
      default: return '#9c27b0';
    }
  };

  const filteredEntries = entries.filter(entry =>
    entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.url.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="manager-container">
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography variant="h6" sx={{ color: 'white' }}>Loading vault...</Typography>
        </Box>
      </div>
    );
  }

  return (
    <div className="manager-container">
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <SecurityIcon sx={{ color: '#2196f3', mr: 2, fontSize: '2rem' }} />
          <Box>
            <Typography variant="h4" sx={{ color: 'white', fontWeight: 300 }}>
              {vaultName}
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              {entries.length} password{entries.length !== 1 ? 's' : ''} stored
            </Typography>
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={<LockIcon />}
          onClick={onLock}
          sx={{ color: 'white', borderColor: 'rgba(255, 255, 255, 0.3)' }}
        >
          Lock Vault
        </Button>
      </Box>

      {/* Search Bar */}
      <TextField
        fullWidth
        placeholder="Search passwords..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />
            </InputAdornment>
          ),
        }}
        sx={{
          mb: 3,
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
          }
        }}
      />

      {/* Password Entries */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', mb: 2 }}>
        {filteredEntries.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <SecurityIcon sx={{ fontSize: '4rem', color: 'rgba(255, 255, 255, 0.3)', mb: 2 }} />
            <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 1 }}>
              {searchTerm ? 'No passwords found' : 'No passwords stored yet'}
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              {searchTerm ? 'Try a different search term' : 'Add your first password to get started'}
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
                  }
                }}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Chip
                          icon={getCategoryIcon(entry.category)}
                          label={entry.category}
                          size="small"
                          sx={{
                            backgroundColor: getCategoryColor(entry.category),
                            color: 'white',
                            mr: 2
                          }}
                        />
                        <Typography variant="h6" sx={{ color: 'white' }}>
                          {entry.title}
                        </Typography>
                      </Box>
                      
                      <Box sx={{ display: 'grid', gap: 1, mt: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', minWidth: 80 }}>
                            Username:
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'white', mr: 1 }}>
                            {entry.username}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => copyToClipboard(entry.username, 'Username')}
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Box>
                        
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', minWidth: 80 }}>
                            Password:
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'white', mr: 1 }}>
                            {showPasswords[entry.id] ? entry.password : '••••••••'}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => togglePasswordVisibility(entry.id)}
                          >
                            {showPasswords[entry.id] ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => copyToClipboard(entry.password, 'Password')}
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Box>
                        
                        {entry.url && (
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', minWidth: 80 }}>
                              URL:
                            </Typography>
                            <Typography variant="body2" sx={{ color: '#2196f3', mr: 1 }}>
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

      {/* Floating Action Button */}
      <Fab
        color="primary"
        onClick={() => setShowAddDialog(true)}
        sx={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          background: 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
        }}
      >
        <AddIcon />
      </Fab>

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
      <Dialog
        open={showAddDialog || editingEntry !== null}
        onClose={() => {
          setShowAddDialog(false);
          setEditingEntry(null);
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#1e1e1e',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }
        }}
      >
        <DialogTitle sx={{ color: 'white' }}>
          {editingEntry ? 'Edit Password Entry' : 'Add New Password Entry'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              label="Title"
              value={editingEntry ? editingEntry.title : newEntry.title}
              onChange={(e) => {
                if (editingEntry) {
                  setEditingEntry({ ...editingEntry, title: e.target.value });
                } else {
                  setNewEntry({ ...newEntry, title: e.target.value });
                }
              }}
              fullWidth
            />
            <TextField
              label="Username/Email"
              value={editingEntry ? editingEntry.username : newEntry.username}
              onChange={(e) => {
                if (editingEntry) {
                  setEditingEntry({ ...editingEntry, username: e.target.value });
                } else {
                  setNewEntry({ ...newEntry, username: e.target.value });
                }
              }}
              fullWidth
            />
            <TextField
              label="Password"
              value={editingEntry ? editingEntry.password : newEntry.password}
              onChange={(e) => {
                if (editingEntry) {
                  setEditingEntry({ ...editingEntry, password: e.target.value });
                } else {
                  setNewEntry({ ...newEntry, password: e.target.value });
                }
              }}
              fullWidth
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Generate Password">
                      <IconButton
                        onClick={() => {
                          const password = generatePassword();
                          if (editingEntry) {
                            setEditingEntry({ ...editingEntry, password });
                          } else {
                            setNewEntry({ ...newEntry, password });
                          }
                        }}
                      >
                        <RefreshIcon />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              label="URL (optional)"
              value={editingEntry ? editingEntry.url : newEntry.url}
              onChange={(e) => {
                if (editingEntry) {
                  setEditingEntry({ ...editingEntry, url: e.target.value });
                } else {
                  setNewEntry({ ...newEntry, url: e.target.value });
                }
              }}
              fullWidth
            />
            <TextField
              label="Notes (optional)"
              value={editingEntry ? editingEntry.notes : newEntry.notes}
              onChange={(e) => {
                if (editingEntry) {
                  setEditingEntry({ ...editingEntry, notes: e.target.value });
                } else {
                  setNewEntry({ ...newEntry, notes: e.target.value });
                }
              }}
              fullWidth
              multiline
              rows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setShowAddDialog(false);
              setEditingEntry(null);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={editingEntry ? handleEditEntry : handleAddEntry}
            variant="contained"
          >
            {editingEntry ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

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
