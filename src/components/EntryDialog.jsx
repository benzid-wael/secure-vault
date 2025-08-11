// Dedicated component for add/edit entry dialog
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  IconButton,
  InputAdornment,
  Select,
  FormControl,
  InputLabel,
  MenuItem,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { CATEGORIES } from '../utils/categoryManager';
import { generatePassword } from '../utils/passwordGenerator';

const EntryDialog = ({
  open,
  onClose,
  onSave,
  entry = null,
  validationErrors = {},
  onValidationErrorsChange,
}) => {
  const [formData, setFormData] = useState({
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    category: 'general',
  });
  const [showPassword, setShowPassword] = useState(false);

  // Initialize form data when dialog opens or entry changes
  useEffect(() => {
    if (open) {
      // Always hide password when dialog opens
      setShowPassword(false);

      if (entry) {
        setFormData({
          title: entry.title || '',
          username: entry.username || '',
          password: entry.password || '',
          url: entry.url || '',
          notes: entry.notes || '',
          category: entry.category || 'general',
        });
      } else {
        setFormData({
          title: '',
          username: '',
          password: '',
          url: '',
          notes: '',
          category: 'general',
        });
      }
    }
  }, [entry, open]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Clear validation error for this field
    if (validationErrors[field] && onValidationErrorsChange) {
      onValidationErrorsChange((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleGeneratePassword = () => {
    const newPassword = generatePassword(16, {
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: true,
      excludeSimilar: true,
    });
    handleInputChange('password', newPassword);
  };

  const handleSave = () => {
    onSave(formData);
  };

  const handleClose = () => {
    setFormData({
      title: '',
      username: '',
      password: '',
      url: '',
      notes: '',
      category: 'general',
    });
    setShowPassword(false); // Always hide password when closing
    if (onValidationErrorsChange) {
      onValidationErrorsChange({});
    }
    onClose();
  };

  const isEditing = !!entry;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="dialog"
      PaperProps={{
        sx: {
          backgroundColor: '#1e1e1e',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        },
      }}
    >
      <DialogTitle sx={{ color: 'white' }} data-testid="dialog-title">
        {isEditing ? 'Edit Password Entry' : 'Add New Password Entry'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <TextField
            label="Title"
            value={formData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            fullWidth
            error={!!validationErrors.title}
            helperText={validationErrors.title}
            required
            inputProps={{ 'data-testid': 'input-title' }}
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
          />

          <FormControl fullWidth>
            <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              Category
            </InputLabel>
            <Select
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
              label="Category"
              inputProps={{ 'data-testid': 'select' }}
              sx={{ color: 'white' }}
            >
              {CATEGORIES.map((category) => {
                const Icon = category.icon;
                return (
                  <MenuItem key={category.id} value={category.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Icon sx={{ mr: 1, color: category.color }} />
                      {category.name}
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>

          <TextField
            label="Username/Email"
            value={formData.username}
            onChange={(e) => handleInputChange('username', e.target.value)}
            fullWidth
            error={!!validationErrors.username}
            helperText={validationErrors.username}
            required
            inputProps={{ 'data-testid': 'input-username' }}
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
          />

          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => handleInputChange('password', e.target.value)}
            fullWidth
            error={!!validationErrors.password}
            helperText={validationErrors.password}
            required
            inputProps={{ 'data-testid': 'input-password' }}
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end" sx={{ gap: 1 }}>
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    size="small"
                    data-testid="icon-button"
                    sx={{
                      color: 'rgba(255, 255, 255, 0.7)',
                      '&:hover': {
                        color: 'white',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      },
                      minWidth: '40px',
                      minHeight: '40px',
                    }}
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                  >
                    {showPassword ? (
                      <VisibilityOff fontSize="small" />
                    ) : (
                      <Visibility fontSize="small" />
                    )}
                  </IconButton>
                  <IconButton
                    onClick={handleGeneratePassword}
                    size="small"
                    data-testid="icon-button"
                    sx={{
                      color: 'rgba(255, 255, 255, 0.7)',
                      '&:hover': {
                        color: 'white',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      },
                      minWidth: '40px',
                      minHeight: '40px',
                    }}
                    title="Generate Password"
                    aria-label="Generate password"
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <TextField
            label="URL (optional)"
            value={formData.url}
            onChange={(e) => handleInputChange('url', e.target.value)}
            fullWidth
            inputProps={{ 'data-testid': 'input-url' }}
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
          />

          <TextField
            label="Notes (optional)"
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            fullWidth
            multiline
            rows={3}
            inputProps={{ 'data-testid': 'input-notes' }}
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleClose}
          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained">
          {isEditing ? 'Update' : 'Add'} Entry
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EntryDialog;
