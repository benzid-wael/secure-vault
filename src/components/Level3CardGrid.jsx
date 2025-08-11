// Level 3 Card Grid Component for managing authentication grid codes
import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Typography,
  Button,
  Paper,
  Grid,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Alert,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import {
  generateGridPosition,
  parseGridPosition,
  getCodeAtPosition,
} from '../utils/entryTypes';

const Level3CardGrid = ({
  gridData = {},
  onChange,
  rows = 10,
  columns = 10,
  readOnly = false,
}) => {
  const [editMode, setEditMode] = useState(false);
  const [lookupPosition, setLookupPosition] = useState('');
  const [lookupResult, setLookupResult] = useState('');
  const [showLookupDialog, setShowLookupDialog] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [cellValue, setCellValue] = useState('');

  // Generate row labels (A, B, C, ...)
  const getRowLabel = (rowIndex) => String.fromCharCode(65 + rowIndex);

  // Handle cell edit
  const handleCellEdit = (row, col) => {
    if (readOnly) return;

    const position = generateGridPosition(row, col);
    setEditingCell({ row, col, position });
    setCellValue(gridData[position] || '');
  };

  const handleCellSave = () => {
    if (!editingCell) return;

    const newGridData = { ...gridData };
    if (cellValue.trim()) {
      newGridData[editingCell.position] = cellValue.trim();
    } else {
      delete newGridData[editingCell.position];
    }

    onChange(newGridData);
    setEditingCell(null);
    setCellValue('');
  };

  const handleCellCancel = () => {
    setEditingCell(null);
    setCellValue('');
  };

  // Handle lookup
  const handleLookup = () => {
    if (!lookupPosition.trim()) return;

    const code = getCodeAtPosition(gridData, lookupPosition.trim());
    if (code) {
      setLookupResult(code);
      // Copy to clipboard automatically
      navigator.clipboard.writeText(code).catch(() => {
        console.error('Failed to copy to clipboard');
      });
    } else {
      setLookupResult('');
    }
  };

  const handleLookupKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleLookup();
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        // Could show a snackbar here
      })
      .catch(() => {
        console.error('Failed to copy to clipboard');
      });
  };

  const clearGrid = () => {
    if (readOnly) return;
    onChange({});
  };

  const fillSampleData = () => {
    if (readOnly) return;

    const sampleData = {};
    for (let row = 0; row < Math.min(rows, 5); row++) {
      for (let col = 0; col < Math.min(columns, 5); col++) {
        const position = generateGridPosition(row, col);
        sampleData[position] = Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();
      }
    }
    onChange(sampleData);
  };

  return (
    <Box>
      {/* Lookup Section */}
      <Paper sx={{ p: 2, mb: 2, backgroundColor: '#2a2a2a' }}>
        <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
          Code Lookup
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
          <TextField
            label="Position (e.g., A2, B5)"
            value={lookupPosition}
            onChange={(e) => setLookupPosition(e.target.value.toUpperCase())}
            onKeyPress={handleLookupKeyPress}
            size="small"
            sx={{ '& .MuiInputBase-input': { color: 'white' } }}
          />
          <Button
            variant="contained"
            onClick={handleLookup}
            startIcon={<SearchIcon />}
            disabled={!lookupPosition.trim()}
          >
            Lookup
          </Button>
        </Box>

        {lookupResult && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={`${lookupPosition}: ${lookupResult}`}
              color="primary"
              sx={{ fontSize: '1rem', fontFamily: 'monospace' }}
            />
            <IconButton
              size="small"
              onClick={() => copyToClipboard(lookupResult)}
              sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              <CopyIcon />
            </IconButton>
          </Box>
        )}

        {lookupPosition && !lookupResult && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            No code found at position {lookupPosition}
          </Alert>
        )}
      </Paper>

      {/* Grid Management */}
      {!readOnly && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button
            variant="outlined"
            onClick={() => setEditMode(!editMode)}
            startIcon={<EditIcon />}
          >
            {editMode ? 'View Mode' : 'Edit Mode'}
          </Button>
          <Button variant="outlined" onClick={fillSampleData} color="secondary">
            Fill Sample
          </Button>
          <Button
            variant="outlined"
            onClick={clearGrid}
            startIcon={<ClearIcon />}
            color="error"
          >
            Clear All
          </Button>
        </Box>
      )}

      {/* Grid Display */}
      <Paper sx={{ p: 2, backgroundColor: '#2a2a2a', overflow: 'auto' }}>
        <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
          Authentication Grid
        </Typography>

        <Box sx={{ display: 'inline-block', minWidth: 'fit-content' }}>
          {/* Column headers */}
          <Box sx={{ display: 'flex', mb: 1 }}>
            <Box sx={{ width: 40, height: 40 }} /> {/* Empty corner */}
            {Array.from({ length: columns }, (_, col) => (
              <Box
                key={col}
                sx={{
                  width: 60,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontWeight: 'bold',
                }}
              >
                {col + 1}
              </Box>
            ))}
          </Box>

          {/* Grid rows */}
          {Array.from({ length: rows }, (_, row) => (
            <Box key={row} sx={{ display: 'flex', mb: 1 }}>
              {/* Row header */}
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontWeight: 'bold',
                }}
              >
                {getRowLabel(row)}
              </Box>

              {/* Grid cells */}
              {Array.from({ length: columns }, (_, col) => {
                const position = generateGridPosition(row, col);
                const value = gridData[position] || '';
                const isEditing =
                  editingCell?.row === row && editingCell?.col === col;

                return (
                  <Box
                    key={col}
                    sx={{
                      width: 60,
                      height: 40,
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      backgroundColor: value ? '#333' : '#1e1e1e',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: !readOnly && editMode ? 'pointer' : 'default',
                      '&:hover':
                        !readOnly && editMode
                          ? {
                              backgroundColor: '#444',
                            }
                          : {},
                    }}
                    onClick={() => editMode && handleCellEdit(row, col)}
                  >
                    {isEditing ? (
                      <TextField
                        value={cellValue}
                        onChange={(e) => setCellValue(e.target.value)}
                        onBlur={handleCellSave}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') handleCellSave();
                          if (e.key === 'Escape') handleCellCancel();
                        }}
                        autoFocus
                        size="small"
                        sx={{
                          width: '100%',
                          '& .MuiInputBase-input': {
                            color: 'white',
                            textAlign: 'center',
                            fontSize: '0.75rem',
                            padding: '2px',
                          },
                        }}
                      />
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'white',
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          textAlign: 'center',
                        }}
                      >
                        {value}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Paper>

      {/* Grid Statistics */}
      <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
        <Chip
          label={`${Object.keys(gridData).length} codes entered`}
          variant="outlined"
          sx={{ color: 'white' }}
        />
        <Chip
          label={`${rows}×${columns} grid`}
          variant="outlined"
          sx={{ color: 'white' }}
        />
      </Box>
    </Box>
  );
};

export default Level3CardGrid;
