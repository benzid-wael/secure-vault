// Enhanced entry dialog component supporting multiple entry types
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
import {
  ENTRY_TYPES,
  ENTRY_TYPE_DEFINITIONS,
  FIELD_TYPES,
  getEntryTypeDefinition,
  createEmptyEntry,
  getOrderedFields,
} from '../utils/entryTypes';
import Level3CardGrid from './Level3CardGrid';

const EnhancedEntryDialog = ({
  open,
  onClose,
  onSave,
  entry = null,
  entryType = 'password', // Pre-selected entry type for new entries
  validationErrors = {},
  onValidationErrorsChange,
}) => {
  const [selectedEntryType, setSelectedEntryType] = useState(
    ENTRY_TYPES.PASSWORD
  );
  const [formData, setFormData] = useState({});
  const [showPasswords, setShowPasswords] = useState({});
  const [isEditing, setIsEditing] = useState(false);

  // Initialize form data when dialog opens or entry changes
  useEffect(() => {
    if (open) {
      setShowPasswords({});

      if (entry) {
        setIsEditing(true);
        setSelectedEntryType(entry.entryType || ENTRY_TYPES.PASSWORD);
        setFormData(entry);
      } else {
        setIsEditing(false);
        setSelectedEntryType(entryType);
        setFormData(createEmptyEntry(entryType));
      }
    }
  }, [entry, open, entryType]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Clear validation error for this field
    if (validationErrors[field] && onValidationErrorsChange) {
      onValidationErrorsChange((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleGeneratePassword = (fieldName = 'password') => {
    const newPassword = generatePassword(16, {
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: true,
      excludeSimilar: true,
    });
    handleInputChange(fieldName, newPassword);
  };

  const togglePasswordVisibility = (fieldName) => {
    setShowPasswords((prev) => ({
      ...prev,
      [fieldName]: !prev[fieldName],
    }));
  };

  const handleSave = () => {
    const entryData = {
      ...formData,
      entryType: selectedEntryType,
      id: isEditing ? entry.id : Date.now().toString(),
      createdAt: isEditing ? entry.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onSave(entryData);
  };

  const handleClose = () => {
    setFormData({});
    setShowPasswords({});
    setSelectedEntryType(ENTRY_TYPES.PASSWORD);
    setIsEditing(false);
    if (onValidationErrorsChange) {
      onValidationErrorsChange({});
    }
    onClose();
  };

  // Get current entry type definition
  const entryTypeDef = getEntryTypeDefinition(selectedEntryType);

  // Render field based on type
  const renderField = (fieldName, fieldConfig) => {
    if (fieldConfig.generated) return null;

    const value = formData[fieldName] || '';
    const isPassword = fieldConfig.type === FIELD_TYPES.PASSWORD;
    const showPassword = showPasswords[fieldName] || false;

    switch (fieldConfig.type) {
      case FIELD_TYPES.SELECT:
        return (
          <FormControl fullWidth key={fieldName}>
            <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              {fieldConfig.label}
            </InputLabel>
            <Select
              value={value}
              onChange={(e) => handleInputChange(fieldName, e.target.value)}
              label={fieldConfig.label}
              sx={{
                color: 'white',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255, 255, 255, 0.23)',
                },
                '& .MuiSvgIcon-root': {
                  color: 'rgba(255, 255, 255, 0.7)',
                },
              }}
            >
              {fieldConfig.options?.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );

      case FIELD_TYPES.TEXTAREA:
      case FIELD_TYPES.MULTILINE:
        return (
          <TextField
            key={fieldName}
            label={fieldConfig.label}
            value={value}
            onChange={(e) => handleInputChange(fieldName, e.target.value)}
            fullWidth
            multiline
            rows={fieldConfig.type === FIELD_TYPES.MULTILINE ? 6 : 3}
            error={!!validationErrors[fieldName]}
            helperText={validationErrors[fieldName]}
            required={fieldConfig.required}
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
          />
        );

      case FIELD_TYPES.GRID:
        return (
          <Box key={fieldName}>
            <Level3CardGrid
              gridData={value}
              onChange={(newGridData) =>
                handleInputChange(fieldName, newGridData)
              }
              rows={formData.rows || 10}
              columns={formData.columns || 10}
            />
          </Box>
        );

      default:
        return (
          <TextField
            key={fieldName}
            label={fieldConfig.label}
            type={isPassword && !showPassword ? 'password' : 'text'}
            value={value}
            onChange={(e) => handleInputChange(fieldName, e.target.value)}
            fullWidth
            error={!!validationErrors[fieldName]}
            helperText={validationErrors[fieldName]}
            required={fieldConfig.required}
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
            InputProps={
              isPassword
                ? {
                    endAdornment: (
                      <InputAdornment position="end" sx={{ gap: 1 }}>
                        <IconButton
                          onClick={() => togglePasswordVisibility(fieldName)}
                          size="small"
                          sx={{
                            color: 'rgba(255, 255, 255, 0.7)',
                            '&:hover': {
                              color: 'white',
                              backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            },
                          }}
                        >
                          {showPassword ? (
                            <VisibilityOff fontSize="small" />
                          ) : (
                            <Visibility fontSize="small" />
                          )}
                        </IconButton>
                        {fieldConfig.canGenerate && (
                          <IconButton
                            onClick={() => handleGeneratePassword(fieldName)}
                            size="small"
                            sx={{
                              color: 'rgba(255, 255, 255, 0.7)',
                              '&:hover': {
                                color: 'white',
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                              },
                            }}
                          >
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        )}
                      </InputAdornment>
                    ),
                  }
                : undefined
            }
          />
        );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
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
        {isEditing
          ? `Edit ${entryTypeDef.name}`
          : `Add New ${entryTypeDef.name}`}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          {/* Dynamic Fields in Proper Order */}
          {getOrderedFields(selectedEntryType).map(
            ({ fieldName, fieldConfig }) => {
              // Handle category field specially
              if (fieldName === 'category') {
                return (
                  <FormControl fullWidth key={fieldName}>
                    <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                      Category
                    </InputLabel>
                    <Select
                      value={formData.category || 'general'}
                      onChange={(e) =>
                        handleInputChange('category', e.target.value)
                      }
                      label="Category"
                      sx={{
                        color: 'white',
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'rgba(255, 255, 255, 0.23)',
                        },
                        '& .MuiSvgIcon-root': {
                          color: 'rgba(255, 255, 255, 0.7)',
                        },
                      }}
                    >
                      {CATEGORIES.map((category) => (
                        <MenuItem key={category.id} value={category.id}>
                          {category.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                );
              }

              // Render other fields normally
              return renderField(fieldName, fieldConfig);
            }
          )}
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

export default EnhancedEntryDialog;
