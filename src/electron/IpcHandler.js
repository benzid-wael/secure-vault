import electron from 'electron';

const { ipcMain } = electron;
// Simple password validation function
const validatePasswordStrength = (password) => {
  const errors = [];
  if (!password) {
    errors.push('Password is required');
    return errors;
  }
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  return errors;
};

export class IpcHandler {
  constructor(vaultService) {
    this.vaultService = vaultService;
  }

  setupHandlers() {
    // Vault operations
    this.setupVaultHandlers();

    // Recovery operations
    this.setupRecoveryHandlers();

    // Export/Import operations
    this.setupExportImportHandlers();

    // Settings operations
    this.setupSettingsHandlers();
  }

  setupVaultHandlers() {
    // Get available vaults
    ipcMain.handle('get-vaults', async () => {
      try {
        const vaults = await this.vaultService.getVaults();
        return vaults;
      } catch (error) {
        return ['default'];
      }
    });

    // Create new vault
    ipcMain.handle('create-vault', async (event, vaultName, masterPassword) => {
      return await this.vaultService.createVault(vaultName, masterPassword);
    });

    // Verify vault password
    ipcMain.handle(
      'verify-vault-password',
      async (event, vaultName, password) => {
        return await this.vaultService.verifyVaultPassword(vaultName, password);
      }
    );

    // Load vault data
    ipcMain.handle('load-vault', async (event, vaultName, password) => {
      return await this.vaultService.loadVault(vaultName, password);
    });

    // Save vault data
    ipcMain.handle('save-vault', async (event, vaultName, password, data) => {
      return await this.vaultService.saveVault(vaultName, password, data);
    });

    // Delete vault
    ipcMain.handle(
      'delete-vault',
      async (event, vaultName, confirmationPassword) => {
        return await this.vaultService.deleteVault(
          vaultName,
          confirmationPassword
        );
      }
    );
  }

  setupRecoveryHandlers() {
    // Generate recovery key for vault
    ipcMain.handle(
      'generate-recovery-key',
      async (event, vaultName, masterPassword) => {
        return await this.vaultService.generateRecoveryKey(
          vaultName,
          masterPassword
        );
      }
    );

    // Verify vault with recovery key
    ipcMain.handle(
      'verify-vault-recovery-key',
      async (event, vaultName, recoveryKey) => {
        return await this.vaultService.verifyVaultRecoveryKey(
          vaultName,
          recoveryKey
        );
      }
    );

    // Load vault with recovery key
    ipcMain.handle(
      'load-vault-with-recovery-key',
      async (event, vaultName, recoveryKey) => {
        return await this.vaultService.loadVaultWithRecoveryKey(
          vaultName,
          recoveryKey
        );
      }
    );

    // Recover vault with older password
    ipcMain.handle(
      'recover-vault-with-old-password',
      async (event, vaultName, oldPassword) => {
        return await this.vaultService.recoverVaultWithOldPassword(
          vaultName,
          oldPassword
        );
      }
    );
  }

  setupExportImportHandlers() {
    // Export vault to file
    ipcMain.handle(
      'export-vault',
      async (event, vaultName, password, exportPath) => {
        try {
          const result = await this.vaultService.loadVault(vaultName, password);
          if (!result.success) {
            return { success: false, error: 'Invalid password' };
          }

          // Implementation for export functionality
          // This would need to be implemented in VaultService
          return {
            success: false,
            error: 'Export functionality not implemented yet',
          };
        } catch (error) {
          console.error('Error exporting vault:', error);
          return { success: false, error: 'Failed to export vault' };
        }
      }
    );

    // Import vault from file
    ipcMain.handle(
      'import-vault',
      async (event, importPath, newVaultName, password) => {
        try {
          // Implementation for import functionality
          // This would need to be implemented in VaultService
          return {
            success: false,
            error: 'Import functionality not implemented yet',
          };
        } catch (error) {
          console.error('Error importing vault:', error);
          return { success: false, error: 'Failed to import vault' };
        }
      }
    );
  }

  setupSettingsHandlers() {
    // Change master password
    ipcMain.handle(
      'change-master-password',
      async (event, vaultName, currentPassword, newPassword) => {
        try {
          // Validate new password strength
          const passwordErrors = validatePasswordStrength(newPassword);
          if (passwordErrors.length > 0) {
            return { success: false, error: passwordErrors[0] };
          }

          return await this.vaultService.changeMasterPassword(
            vaultName,
            currentPassword,
            newPassword
          );
        } catch (error) {
          console.error('Error changing master password:', error);
          return { success: false, error: 'Failed to change master password' };
        }
      }
    );

    // Update vault settings
    ipcMain.handle(
      'update-vault-settings',
      async (event, vaultName, vaultPassword, newSettings) => {
        try {
          // Implementation for updating vault settings
          // This would need to be implemented in VaultService
          return {
            success: false,
            error: 'Settings update not implemented yet',
          };
        } catch (error) {
          console.error('Error updating vault settings:', error);
          return { success: false, error: 'Failed to update settings' };
        }
      }
    );

    // Restore vault from backup
    ipcMain.handle('restore-vault-backup', async (event, vaultName) => {
      try {
        // Implementation for restoring vault backup
        // This would need to be implemented in VaultService
        return { success: false, error: 'Backup restore not implemented yet' };
      } catch (error) {
        console.error('Error restoring vault backup:', error);
        return { success: false, error: 'Failed to restore vault backup' };
      }
    });

    // Check if vault has backup
    ipcMain.handle('has-vault-backup', async (event, vaultName) => {
      try {
        // Implementation for checking vault backup
        // This would need to be implemented in VaultService
        return { success: true, hasBackup: false };
      } catch (error) {
        console.error('Error checking vault backup:', error);
        return { success: false, hasBackup: false };
      }
    });

    // Get vault storage directory path
    ipcMain.handle('get-vault-directory', async () => {
      try {
        // This would need to be implemented in VaultService
        return { success: false, error: 'Not implemented yet' };
      } catch (error) {
        console.error('Error getting vault directory:', error);
        return { success: false, error: 'Failed to get vault directory' };
      }
    });
  }

  // Method to remove all handlers (useful for cleanup)
  removeHandlers() {
    ipcMain.removeHandler('get-vaults');
    ipcMain.removeHandler('create-vault');
    ipcMain.removeHandler('verify-vault-password');
    ipcMain.removeHandler('load-vault');
    ipcMain.removeHandler('save-vault');
    ipcMain.removeHandler('delete-vault');
    ipcMain.removeHandler('generate-recovery-key');
    ipcMain.removeHandler('verify-vault-recovery-key');
    ipcMain.removeHandler('load-vault-with-recovery-key');
    ipcMain.removeHandler('recover-vault-with-old-password');
    ipcMain.removeHandler('export-vault');
    ipcMain.removeHandler('import-vault');
    ipcMain.removeHandler('change-master-password');
    ipcMain.removeHandler('update-vault-settings');
    ipcMain.removeHandler('restore-vault-backup');
    ipcMain.removeHandler('has-vault-backup');
    ipcMain.removeHandler('get-vault-directory');
  }
}
