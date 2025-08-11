// Dedicated component for search and filter functionality
import React from 'react';
import {
  Box,
  TextField,
  Select,
  FormControl,
  InputLabel,
  MenuItem,
  InputAdornment,
  IconButton,
  Chip,
} from '@mui/material';
import { Search as SearchIcon, Clear as ClearIcon } from '@mui/icons-material';
import { CATEGORIES } from '../utils/categoryManager';
import { ENTRY_TYPE_DEFINITIONS } from '../utils/entryTypes';

const SearchAndFilter = ({
  searchTerm,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  selectedEntryType,
  onEntryTypeChange,
  onClearFilters,
  entriesCount = 0,
  filteredCount = 0,
}) => {
  const hasActiveFilters = searchTerm || selectedCategory || selectedEntryType;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        {/* Search Field */}
        <TextField
          placeholder="Search entries..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          sx={{
            flex: 1,
            minWidth: 250,
            '& .MuiInputBase-input': { color: 'white' },
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: 'rgba(255, 255, 255, 0.3)' },
              '&:hover fieldset': { borderColor: 'rgba(255, 255, 255, 0.5)' },
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'rgba(255, 255, 255, 0.7)' }} />
              </InputAdornment>
            ),
            endAdornment: searchTerm && (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => onSearchChange('')}
                  size="small"
                  sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                >
                  <ClearIcon />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />

        {/* Entry Type Filter */}
        <FormControl sx={{ minWidth: 180 }}>
          <InputLabel
            id="entry-type-select-label"
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            Entry Type
          </InputLabel>
          <Select
            labelId="entry-type-select-label"
            id="entry-type-select"
            value={selectedEntryType || ''}
            onChange={(e) => onEntryTypeChange(e.target.value)}
            label="Entry Type"
            sx={{
              color: 'white',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255, 255, 255, 0.3)',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255, 255, 255, 0.5)',
              },
            }}
          >
            <MenuItem value="">All Types</MenuItem>
            {Object.entries(ENTRY_TYPE_DEFINITIONS).map(
              ([type, definition]) => {
                const Icon = definition.icon;
                return (
                  <MenuItem key={type} value={type}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Icon sx={{ mr: 1, color: definition.color }} />
                      {definition.name}
                    </Box>
                  </MenuItem>
                );
              }
            )}
          </Select>
        </FormControl>

        {/* Category Filter */}
        <FormControl sx={{ minWidth: 180 }}>
          <InputLabel
            id="category-select-label"
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            Category
          </InputLabel>
          <Select
            labelId="category-select-label"
            id="category-select"
            value={selectedCategory || ''}
            onChange={(e) => onCategoryChange(e.target.value)}
            label="Category"
            sx={{
              color: 'white',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255, 255, 255, 0.3)',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255, 255, 255, 0.5)',
              },
            }}
          >
            <MenuItem value="">All Categories</MenuItem>
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
      </Box>

      {/* Filter Status and Clear Button */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasActiveFilters && (
            <>
              <Chip
                label={`${filteredCount} of ${entriesCount} entries`}
                size="small"
                sx={{
                  backgroundColor: 'rgba(33, 150, 243, 0.2)',
                  color: '#2196f3',
                  border: '1px solid rgba(33, 150, 243, 0.3)',
                }}
              />

              {searchTerm && (
                <Chip
                  label={`Search: "${searchTerm}"`}
                  size="small"
                  onDelete={() => onSearchChange('')}
                  sx={{
                    backgroundColor: 'rgba(76, 175, 80, 0.2)',
                    color: '#4caf50',
                    border: '1px solid rgba(76, 175, 80, 0.3)',
                  }}
                />
              )}

              {selectedEntryType && (
                <Chip
                  label={`Type: ${ENTRY_TYPE_DEFINITIONS[selectedEntryType]?.name}`}
                  size="small"
                  onDelete={() => onEntryTypeChange('')}
                  sx={{
                    backgroundColor: 'rgba(255, 152, 0, 0.2)',
                    color: '#ff9800',
                    border: '1px solid rgba(255, 152, 0, 0.3)',
                  }}
                />
              )}

              {selectedCategory && (
                <Chip
                  label={`Category: ${CATEGORIES.find((c) => c.id === selectedCategory)?.name}`}
                  size="small"
                  onDelete={() => onCategoryChange('')}
                  sx={{
                    backgroundColor: 'rgba(156, 39, 176, 0.2)',
                    color: '#9c27b0',
                    border: '1px solid rgba(156, 39, 176, 0.3)',
                  }}
                />
              )}
            </>
          )}
        </Box>

        {hasActiveFilters && (
          <IconButton
            onClick={onClearFilters}
            size="small"
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              '&:hover': { color: 'white' },
            }}
            title="Clear all filters"
          >
            <ClearIcon />
          </IconButton>
        )}
      </Box>
    </Box>
  );
};

export default SearchAndFilter;
