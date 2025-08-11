// Enhanced component for displaying different types of entries
import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  IconButton,
  Chip,
  Box,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { getCategoryById } from '../utils/categoryManager';
import {
  getEntryTypeDefinition,
  getDisplayFields,
  getCopyableFields,
  ENTRY_TYPES,
  getCodeAtPosition,
} from '../utils/entryTypes';

const EntryCard = ({ entry, onEdit, onDelete, onCopyPassword, testId }) => {
  const [anchorEl, setAnchorEl] = useState(null);

  const category = getCategoryById(entry.category);
  const CategoryIcon = category.icon;

  // Get entry type information
  const entryTypeDef = getEntryTypeDefinition(
    entry.entryType || ENTRY_TYPES.PASSWORD
  );
  const EntryTypeIcon = entryTypeDef.icon;
  const displayFields = getDisplayFields(
    entry.entryType || ENTRY_TYPES.PASSWORD
  );
  const copyableFields = getCopyableFields(
    entry.entryType || ENTRY_TYPES.PASSWORD
  );

  const handleMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleEdit = () => {
    onEdit(entry);
    handleMenuClose();
  };

  const handleDelete = () => {
    onDelete(entry.id);
    handleMenuClose();
  };

  const handleCopyField = (fieldName) => {
    const value = entry[fieldName];
    if (value) {
      navigator.clipboard
        .writeText(value)
        .then(() => {
          // Could show a snackbar here
        })
        .catch(() => {
          console.error('Failed to copy to clipboard');
        });
    }
    handleMenuClose();
  };

  const handleCopyPassword = () => {
    // For backward compatibility
    const passwordField = entry.password || entry.secret || entry.privateKey;
    if (passwordField) {
      navigator.clipboard
        .writeText(passwordField)
        .then(() => {
          // Could show a snackbar here
        })
        .catch(() => {
          console.error('Failed to copy to clipboard');
        });

      // Call the callback if provided
      if (onCopyPassword) {
        onCopyPassword(passwordField);
      }
    }
    handleMenuClose();
  };

  return (
    <Card
      data-testid={testId}
      data-entry-type={entry.entryType}
      sx={{
        backgroundColor: '#2a2a2a',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        '&:hover': {
          backgroundColor: '#333333',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        },
      }}
    >
      <CardContent>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <EntryTypeIcon sx={{ mr: 1, color: entryTypeDef.color }} />
              <Typography
                variant="h6"
                sx={{ color: 'white', fontWeight: 'bold' }}
              >
                {entry.title}
              </Typography>
            </Box>

            {/* Display entry type specific fields */}
            {displayFields.map((fieldName) => {
              const value = entry[fieldName];
              if (!value) return null;

              return (
                <Typography
                  key={fieldName}
                  variant="body2"
                  sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 1 }}
                >
                  {value}
                </Typography>
              );
            })}

            {/* Special handling for URLs */}
            {(entry.url || entry.onlineBankingUrl) && (
              <Typography
                variant="body2"
                sx={{
                  color: '#2196f3',
                  mb: 1,
                  textDecoration: 'none',
                  cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' },
                }}
                onClick={() =>
                  window.open(entry.url || entry.onlineBankingUrl, '_blank')
                }
              >
                {entry.url || entry.onlineBankingUrl}
              </Typography>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Chip
                label={entryTypeDef.name}
                size="small"
                sx={{
                  backgroundColor: entryTypeDef.color,
                  color: 'white',
                  fontSize: '0.75rem',
                }}
              />

              <Chip
                label={category.name}
                size="small"
                variant="outlined"
                sx={{
                  borderColor: category.color,
                  color: category.color,
                  fontSize: '0.75rem',
                }}
              />

              {/* Quick copy button for primary field */}
              {copyableFields.length > 0 && (
                <Tooltip title={`Copy ${copyableFields[0]}`}>
                  <IconButton
                    size="small"
                    onClick={() => handleCopyField(copyableFields[0])}
                    aria-label={`Copy ${copyableFields[0]}`}
                    sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                  >
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>

          <IconButton
            onClick={handleMenuOpen}
            aria-label="Open menu"
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            <MoreVertIcon />
          </IconButton>
        </Box>
      </CardContent>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: '#2a2a2a',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            },
          },
        }}
      >
        {/* Dynamic copy options based on entry type */}
        {copyableFields.map((fieldName) => {
          const value = entry[fieldName];
          if (!value) return null;

          return (
            <MenuItem
              key={fieldName}
              onClick={() => handleCopyField(fieldName)}
            >
              <CopyIcon sx={{ mr: 1 }} />
              Copy {fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}
            </MenuItem>
          );
        })}

        <MenuItem onClick={handleEdit}>
          <EditIcon sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: '#f44336' }}>
          <DeleteIcon sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Card>
  );
};

const EntryList = ({ entries, onEdit, onDelete, onCopyPassword }) => {
  if (!entries || entries.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          No password entries found
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: 'rgba(255, 255, 255, 0.5)', mt: 1 }}
        >
          Click the + button to add your first password entry
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {entries.map((entry, index) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          onEdit={onEdit}
          onDelete={onDelete}
          onCopyPassword={onCopyPassword}
          testId={`entry-${index + 1}`}
        />
      ))}
    </Box>
  );
};

export default EntryList;
