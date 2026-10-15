// List of vault entries. Every card is driven by its entry type's definition
// (icon, colour, schema labels, display/copyable fields), so a WiFi network,
// an SSH key or a card shows its own fields instead of a password layout.
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
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { getCategoryById } from '../utils/categoryManager';
import {
  getEntryTypeDefinition,
  getDisplayFields,
  getCopyableFields,
  ENTRY_TYPES,
  FIELD_TYPES,
} from '../utils/entryTypes';

const humanize = (fieldName) =>
  fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

/** The schema label for a field, falling back to its name. */
export const fieldLabel = (schema, fieldName) =>
  schema[fieldName]?.label || humanize(fieldName);

/** What to show for a field: a select's option label rather than its value. */
const displayValue = (schema, fieldName, value) => {
  const option = schema[fieldName]?.options?.find((o) => o.value === value);
  return option ? option.label : String(value);
};

/**
 * The field shown masked on the card, with reveal and copy: the first
 * copyable field typed as a password, else the first multi-line one
 * (private keys, note content). Null for types with no secret to show.
 */
export const primarySecretField = (schema, copyableFields) =>
  copyableFields.find((f) => schema[f]?.type === FIELD_TYPES.PASSWORD) ||
  copyableFields.find((f) => schema[f]?.type === FIELD_TYPES.MULTILINE) ||
  null;

// Rows sit in a two-column grid (label | value + actions) so values line up
// whatever the label length; each row wrapper is `display: contents`.
const rowLabelSx = { color: 'rgba(255, 255, 255, 0.7)' };
const rowValueSx = { display: 'flex', alignItems: 'center', minWidth: 0 };

const EntryCard = ({ entry, onEdit, onDelete, onCopy }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const entryType = entry.entryType || ENTRY_TYPES.PASSWORD;
  const typeDef = getEntryTypeDefinition(entryType);
  const schema = typeDef.schema;
  const TypeIcon = typeDef.icon;
  const category = getCategoryById(entry.category);
  const displayFields = getDisplayFields(entryType);
  const copyableFields = getCopyableFields(entryType);
  const secretField = primarySecretField(schema, copyableFields);
  const secretValue = secretField ? entry[secretField] : null;
  const secretIsMultiline = schema[secretField]?.type === FIELD_TYPES.MULTILINE;

  const copy = (fieldName) => {
    const value = entry[fieldName];
    if (value) onCopy(String(value), fieldLabel(schema, fieldName));
    setAnchorEl(null);
  };

  return (
    <Card
      data-testid={`entry-${entry.id}`}
      data-entry-type={entryType}
      sx={{
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderLeft: `3px solid ${typeDef.color}`,
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(33, 150, 243, 0.3)',
          borderLeft: `3px solid ${typeDef.color}`,
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
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
              <TypeIcon sx={{ color: typeDef.color }} />
              <Typography variant="h6" sx={{ color: 'white' }}>
                {entry.title}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
              <Chip
                label={typeDef.name}
                size="small"
                sx={{ backgroundColor: typeDef.color, color: 'white' }}
              />
              <Chip
                label={category.name}
                size="small"
                variant="outlined"
                sx={{ borderColor: category.color, color: category.color }}
              />
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'max-content minmax(0, 1fr)',
                columnGap: 2,
                rowGap: 1,
                alignItems: 'center',
                mt: 2,
              }}
            >
              {displayFields.map((fieldName) => {
                const value = entry[fieldName];
                if (value === undefined || value === null || value === '')
                  return null;
                const isUrl = schema[fieldName]?.type === FIELD_TYPES.URL;
                const label = fieldLabel(schema, fieldName);
                return (
                  <Box
                    key={fieldName}
                    sx={{ display: 'contents' }}
                    data-testid={`field-${fieldName}`}
                  >
                    <Typography variant="body2" sx={rowLabelSx}>
                      {label}:
                    </Typography>
                    <Box sx={rowValueSx}>
                      <Typography
                        variant="body2"
                        sx={{
                          color: isUrl ? '#2196f3' : 'white',
                          mr: 1,
                          wordBreak: 'break-all',
                        }}
                      >
                        {displayValue(schema, fieldName, value)}
                      </Typography>
                      {copyableFields.includes(fieldName) && (
                        <IconButton
                          size="small"
                          aria-label={`Copy ${label}`}
                          onClick={() => copy(fieldName)}
                        >
                          <CopyIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  </Box>
                );
              })}

              {secretField && secretValue && (
                <Box
                  sx={{ display: 'contents' }}
                  data-testid={`secret-${secretField}`}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      ...rowLabelSx,
                      alignSelf:
                        secretIsMultiline && revealed ? 'flex-start' : 'center',
                    }}
                  >
                    {fieldLabel(schema, secretField)}:
                  </Typography>
                  <Box
                    sx={{
                      ...rowValueSx,
                      alignItems:
                        secretIsMultiline && revealed ? 'flex-start' : 'center',
                    }}
                  >
                    {revealed && secretIsMultiline ? (
                      <Box
                        component="pre"
                        sx={{
                          color: 'white',
                          m: 0,
                          mr: 1,
                          flexGrow: 1,
                          maxHeight: 160,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          fontSize: '0.8rem',
                        }}
                      >
                        {secretValue}
                      </Box>
                    ) : (
                      <Typography
                        variant="body2"
                        sx={{ color: 'white', mr: 1, wordBreak: 'break-all' }}
                      >
                        {revealed ? secretValue : '••••••••'}
                      </Typography>
                    )}
                    <Tooltip title={revealed ? 'Hide' : 'Show'}>
                      <IconButton
                        size="small"
                        aria-label={revealed ? 'Hide' : 'Show'}
                        onClick={() => setRevealed((r) => !r)}
                      >
                        {revealed ? (
                          <VisibilityOff fontSize="small" />
                        ) : (
                          <Visibility fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    <IconButton
                      size="small"
                      aria-label={`Copy ${fieldLabel(schema, secretField)}`}
                      onClick={() => copy(secretField)}
                    >
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              )}
            </Box>
          </Box>

          <IconButton
            onClick={(e) => setAnchorEl(e.currentTarget)}
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
        onClose={() => setAnchorEl(null)}
      >
        {copyableFields.map((fieldName) =>
          entry[fieldName] ? (
            <MenuItem key={fieldName} onClick={() => copy(fieldName)}>
              <CopyIcon sx={{ mr: 1 }} />
              Copy {fieldLabel(schema, fieldName)}
            </MenuItem>
          ) : null
        )}
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onEdit(entry);
          }}
        >
          <EditIcon sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onDelete(entry.id);
          }}
          sx={{ color: '#f44336' }}
        >
          <DeleteIcon sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Card>
  );
};

const EntryList = ({ entries, onEdit, onDelete, onCopy }) => {
  if (!entries || entries.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          No entries found
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
          onCopy={onCopy}
        />
      ))}
    </Box>
  );
};

export default EntryList;
