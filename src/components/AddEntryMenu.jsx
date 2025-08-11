// Add Entry Menu Component - Dropdown menu for selecting entry type
import React, { useState } from 'react';
import {
  Fab,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  Box,
} from '@mui/material';
import {
  Add as AddIcon,
  KeyboardArrowUp as ArrowUpIcon,
} from '@mui/icons-material';
import { ENTRY_TYPE_DEFINITIONS } from '../utils/entryTypes';

const AddEntryMenu = ({ onEntryTypeSelect, disabled = false }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleEntryTypeSelect = (entryType) => {
    onEntryTypeSelect(entryType);
    handleClose();
  };

  // Group entry types by category for better organization
  const entryTypeGroups = {
    'Authentication & Security': ['password', 'otp', 'level3_card'],
    'Network & Keys': ['wifi', 'ssh_key', 'gpg_key'],
    Financial: ['bank_account', 'credit_card'],
    Personal: ['secure_note'],
  };

  return (
    <>
      <Fab
        color="primary"
        aria-label="add entry"
        data-testid="add-entry-menu"
        onClick={handleClick}
        disabled={disabled}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1000,
          '&:hover': {
            transform: 'scale(1.05)',
          },
          transition: 'transform 0.2s ease-in-out',
        }}
      >
        {open ? <ArrowUpIcon /> : <AddIcon />}
      </Fab>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: '#2a2a2a',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              minWidth: 280,
              maxHeight: 400,
              overflow: 'auto',
            },
          },
        }}
      >
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography
            variant="h6"
            sx={{ color: 'white', fontWeight: 'bold', mb: 1 }}
          >
            Add New Entry
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            Choose the type of entry to create
          </Typography>
        </Box>

        <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />

        {Object.entries(entryTypeGroups).map(
          ([groupName, entryTypes], groupIndex) => (
            <Box key={groupName}>
              {groupIndex > 0 && (
                <Divider
                  sx={{ borderColor: 'rgba(255, 255, 255, 0.05)', my: 1 }}
                />
              )}

              <Box sx={{ px: 2, py: 1 }}>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                  }}
                >
                  {groupName}
                </Typography>
              </Box>

              {entryTypes.map((entryType) => {
                const definition = ENTRY_TYPE_DEFINITIONS[entryType];
                if (!definition) return null;

                const Icon = definition.icon;

                return (
                  <MenuItem
                    key={entryType}
                    data-testid={`add-${entryType}`}
                    onClick={() => handleEntryTypeSelect(entryType)}
                    sx={{
                      py: 1.5,
                      px: 2,
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Icon sx={{ color: definition.color, fontSize: 24 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography
                          variant="body1"
                          sx={{ color: 'white', fontWeight: 500 }}
                        >
                          {definition.name}
                        </Typography>
                      }
                      secondary={
                        <Typography
                          variant="body2"
                          sx={{ color: 'rgba(255, 255, 255, 0.6)', mt: 0.5 }}
                        >
                          {definition.description}
                        </Typography>
                      }
                    />
                  </MenuItem>
                );
              })}
            </Box>
          )
        )}
      </Menu>
    </>
  );
};

export default AddEntryMenu;
