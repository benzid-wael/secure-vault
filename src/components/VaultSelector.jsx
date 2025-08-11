import React from 'react';
import {
  Typography,
  Button,
  Box,
  Card,
  CardContent,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Security as SecurityIcon,
  FolderOpen as FolderIcon,
  Star as StarIcon,
} from '@mui/icons-material';

const VaultSelector = ({ vaults, onVaultSelect, onCreateNew }) => {
  return (
    <div className="vault-container">
      <div className="vault-header">
        <Typography variant="h3" className="vault-title">
          <SecurityIcon
            sx={{ fontSize: '3rem', mr: 2, verticalAlign: 'middle' }}
          />
          Secure Vault
        </Typography>
        <Typography variant="h6" className="vault-subtitle">
          Choose a vault or create a new one
        </Typography>
      </div>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
          Available Vaults
        </Typography>

        <div className="vault-list">
          {(vaults || []).map((vault) => (
            <Card
              key={vault}
              className="vault-item"
              onClick={() => onVaultSelect(vault)}
              sx={{
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: '0 8px 25px rgba(33, 150, 243, 0.3)',
                },
              }}
            >
              <CardContent
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  p: 2,
                  '&:last-child': { pb: 2 },
                }}
              >
                <FolderIcon sx={{ mr: 2, color: '#2196f3' }} />
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="h6" className="vault-item-name">
                    {vault}
                    {vault === 'default' && (
                      <Tooltip title="Default Vault">
                        <StarIcon
                          sx={{ ml: 1, fontSize: '1rem', color: '#ffc107' }}
                        />
                      </Tooltip>
                    )}
                  </Typography>
                  <Typography variant="body2" className="vault-item-info">
                    {vault === 'default'
                      ? 'Your default password vault'
                      : 'Custom vault'}
                  </Typography>
                </Box>
                <SecurityIcon sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />
              </CardContent>
            </Card>
          ))}
        </div>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onCreateNew}
          sx={{
            py: 1.5,
            px: 4,
            fontSize: '1.1rem',
            borderRadius: '12px',
            background: 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
            '&:hover': {
              background: 'linear-gradient(45deg, #1976d2 30%, #1cb5e0 90%)',
              transform: 'translateY(-2px)',
              boxShadow: '0 8px 25px rgba(33, 150, 243, 0.4)',
            },
          }}
        >
          Create New Vault
        </Button>
      </Box>

      <div className="security-indicator">
        <SecurityIcon sx={{ color: '#4caf50' }} />
        <Typography className="security-text">
          All vaults are encrypted with AES-256-GCM encryption
        </Typography>
      </div>
    </div>
  );
};

export default VaultSelector;
