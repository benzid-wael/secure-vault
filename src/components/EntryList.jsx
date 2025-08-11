// Dedicated component for displaying password entries
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
} from '@mui/icons-material';
import { getCategoryById } from '../utils/categoryManager';

const EntryCard = ({ entry, onEdit, onDelete, onCopyPassword }) => {
  const [anchorEl, setAnchorEl] = useState(null);

  const category = getCategoryById(entry.category);
  const CategoryIcon = category.icon;

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

  const handleCopyPassword = () => {
    onCopyPassword(entry.password);
    handleMenuClose();
  };

  return (
    <Card
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
              <CategoryIcon sx={{ mr: 1, color: category.color }} />
              <Typography
                variant="h6"
                sx={{ color: 'white', fontWeight: 'bold' }}
              >
                {entry.title}
              </Typography>
            </Box>

            <Typography
              variant="body2"
              sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 1 }}
            >
              {entry.username}
            </Typography>

            {entry.url && (
              <Typography
                variant="body2"
                sx={{
                  color: '#2196f3',
                  mb: 1,
                  textDecoration: 'none',
                  cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' },
                }}
                onClick={() => window.open(entry.url, '_blank')}
              >
                {entry.url}
              </Typography>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Chip
                label={category.name}
                size="small"
                sx={{
                  backgroundColor: category.color,
                  color: 'white',
                  fontSize: '0.75rem',
                }}
              />

              <Tooltip title="Copy Password">
                <IconButton
                  size="small"
                  onClick={handleCopyPassword}
                  aria-label="Copy Password"
                  sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                >
                  <CopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
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
        PaperProps={{
          sx: {
            backgroundColor: '#2a2a2a',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }}
      >
        <MenuItem onClick={handleCopyPassword}>
          <CopyIcon sx={{ mr: 1 }} />
          Copy Password
        </MenuItem>
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
      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          onEdit={onEdit}
          onDelete={onDelete}
          onCopyPassword={onCopyPassword}
        />
      ))}
    </Box>
  );
};

export default EntryList;
