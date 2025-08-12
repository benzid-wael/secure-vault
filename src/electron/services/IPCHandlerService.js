import { ipcMain } from 'electron';

/**
 * Service to handle IPC communication between main and renderer processes
 * Follows Single Responsibility Principle - only handles IPC registration and error handling
 */
export class IPCHandlerService {
  constructor(vaultManager) {
    this.vaultManager = vaultManager;
  }

  /**
   * Register all IPC handlers
   */
  registerHandlers() {
    // Vault operations
    ipcMain.handle('get-vaults', this.handleGetVaults.bind(this));
    ipcMain.handle('create-vault', this.handleCreateVault.bind(this));
    ipcMain.handle(
      'verify-vault-password',
      this.handleVerifyVaultPassword.bind(this)
    );
    ipcMain.handle('load-vault', this.handleLoadVault.bind(this));
    ipcMain.handle('save-vault', this.handleSaveVault.bind(this));
    ipcMain.handle('delete-vault', this.handleDeleteVault.bind(this));

    // Master password management
    ipcMain.handle(
      'change-master-password',
      this.handleChangeMasterPassword.bind(this)
    );
    ipcMain.handle(
      'update-vault-settings',
      this.handleUpdateVaultSettings.bind(this)
    );

    // Backup and recovery
    ipcMain.handle(
      'restore-vault-backup',
      this.handleRestoreVaultBackup.bind(this)
    );
    ipcMain.handle('has-vault-backup', this.handleHasVaultBackup.bind(this));

    // Recovery key management
    ipcMain.handle(
      'generate-recovery-key',
      this.handleGenerateRecoveryKey.bind(this)
    );
    ipcMain.handle(
      'verify-vault-recovery-key',
      this.handleVerifyVaultRecoveryKey.bind(this)
    );
    ipcMain.handle(
      'load-vault-with-recovery-key',
      this.handleLoadVaultWithRecoveryKey.bind(this)
    );

    // Vault recovery with older passwords
    ipcMain.handle(
      'recover-vault-with-old-password',
      this.handleRecoverVaultWithOldPassword.bind(this)
    );

    // Import/Export
    ipcMain.handle('export-vault', this.handleExportVault.bind(this));
    ipcMain.handle('import-vault', this.handleImportVault.bind(this));
    ipcMain.handle(
      'get-vault-directory',
      this.handleGetVaultDirectory.bind(this)
    );
  }

  /**
   * Unregister all IPC handlers
   */
  unregisterHandlers() {
    const handlers = [
      'get-vaults',
      'create-vault',
      'verify-vault-password',
      'load-vault',
      'save-vault',
      'delete-vault',
      'change-master-password',
      'update-vault-settings',
      'restore-vault-backup',
      'has-vault-backup',
      'generate-recovery-key',
      'verify-vault-recovery-key',
      'load-vault-with-recovery-key',
      'recover-vault-with-old-password',
      'export-vault',
      'import-vault',
      'get-vault-directory',
    ];

    handlers.forEach((handler) => {
      ipcMain.removeHandler(handler);
    });
  }

  /**
   * Wrap handler with error handling
   * @param {Function} handler - Handler function
   * @returns {Function} Wrapped handler
   */
  wrapHandler(handler) {
    return async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        console.error('IPC Handler Error:', error);
        return { success: false, error: error.message };
      }
    };
  }

  // Vault operations handlers
  async handleGetVaults() {
    return await this.vaultManager.getVaults();
  }

  async handleCreateVault(event, vaultName, masterPassword) {
    return await this.vaultManager.createVault(vaultName, masterPassword);
  }

  async handleVerifyVaultPassword(event, vaultName, password) {
    const isValid = await this.vaultManager.verifyVaultPassword(
      vaultName,
      password
    );
    return { success: isValid };
  }

  async handleLoadVault(event, vaultName, password) {
    return await this.vaultManager.loadVault(vaultName, password);
  }

  async handleSaveVault(event, vaultName, password, data) {
    return await this.vaultManager.saveVault(vaultName, password, data);
  }

  async handleDeleteVault(event, vaultName, confirmationPassword) {
    return await this.vaultManager.deleteVault(vaultName, confirmationPassword);
  }

  // Master password management handlers
  async handleChangeMasterPassword(
    event,
    vaultName,
    currentPassword,
    newPassword
  ) {
    return await this.vaultManager.changeMasterPassword(
      vaultName,
      currentPassword,
      newPassword
    );
  }

  async handleUpdateVaultSettings(event, vaultName, vaultPassword, settings) {
    return await this.vaultManager.updateVaultSettings(
      vaultName,
      vaultPassword,
      settings
    );
  }

  // Backup and recovery handlers
  async handleRestoreVaultBackup(event, vaultName) {
    return await this.vaultManager.restoreVaultBackup(vaultName);
  }

  async handleHasVaultBackup(event, vaultName) {
    const hasBackup = await this.vaultManager.hasVaultBackup(vaultName);
    return { success: true, hasBackup };
  }

  // Recovery key management handlers
  async handleGenerateRecoveryKey(event, vaultName, masterPassword) {
    return await this.vaultManager.generateRecoveryKey(
      vaultName,
      masterPassword
    );
  }

  async handleVerifyVaultRecoveryKey(event, vaultName, recoveryKey) {
    const isValid = await this.vaultManager.verifyRecoveryKey(
      vaultName,
      recoveryKey
    );
    return { success: isValid };
  }

  async handleLoadVaultWithRecoveryKey(event, vaultName, recoveryKey) {
    return await this.vaultManager.loadVaultWithRecoveryKey(
      vaultName,
      recoveryKey
    );
  }

  // Vault recovery with older passwords handlers
  async handleRecoverVaultWithOldPassword(event, vaultName, oldPassword) {
    return await this.vaultManager.recoverVaultWithOldPassword(
      vaultName,
      oldPassword
    );
  }

  // Import/Export handlers
  async handleExportVault(event, vaultName, password, exportPath) {
    return await this.vaultManager.exportVault(vaultName, password, exportPath);
  }

  async handleImportVault(event, importPath, newVaultName, password) {
    return await this.vaultManager.importVault(
      importPath,
      newVaultName,
      password
    );
  }

  async handleGetVaultDirectory() {
    const path = this.vaultManager.getVaultDirectory();
    return { success: true, path };
  }
}
