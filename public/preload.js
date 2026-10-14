const { contextBridge, ipcRenderer } = require('electron');
// Note: We're keeping require() here because this file is loaded directly by Electron
// and needs to use the CommonJS module system

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Session: the master password is sent once to unlock (or create / recover)
  // and then held by the main process; later calls name only the vault.
  getVaults: () => ipcRenderer.invoke('get-vaults'),
  createVault: (vaultName, masterPassword) =>
    ipcRenderer.invoke('create-vault', vaultName, masterPassword),
  unlockVault: (vaultName, password) =>
    ipcRenderer.invoke('unlock-vault', vaultName, password),
  lockVault: () => ipcRenderer.invoke('lock-vault'),
  onVaultLocked: (callback) =>
    ipcRenderer.on('vault-locked', () => {
      try {
        callback();
      } catch (error) {
        console.error('Error in vault-locked handler:', error);
      }
    }),

  // Vault operations (on the unlocked vault)
  loadVault: (vaultName) => ipcRenderer.invoke('load-vault', vaultName),
  saveVault: (vaultName, data) =>
    ipcRenderer.invoke('save-vault', vaultName, data),
  deleteVault: (vaultName, confirmationPassword) =>
    ipcRenderer.invoke('delete-vault', vaultName, confirmationPassword),

  // Master password management
  changeMasterPassword: (vaultName, currentPassword, newPassword) =>
    ipcRenderer.invoke(
      'change-master-password',
      vaultName,
      currentPassword,
      newPassword
    ),
  updateVaultSettings: (vaultName, settings) =>
    ipcRenderer.invoke('update-vault-settings', vaultName, settings),

  // Backup and recovery
  restoreVaultBackup: (vaultName) =>
    ipcRenderer.invoke('restore-vault-backup', vaultName),
  hasVaultBackup: (vaultName) =>
    ipcRenderer.invoke('has-vault-backup', vaultName),

  // Recovery key management
  generateRecoveryKey: (vaultName) =>
    ipcRenderer.invoke('generate-recovery-key', vaultName),
  verifyVaultRecoveryKey: (vaultName, recoveryKey) =>
    ipcRenderer.invoke('verify-vault-recovery-key', vaultName, recoveryKey),
  loadVaultWithRecoveryKey: (vaultName, recoveryKey) =>
    ipcRenderer.invoke('load-vault-with-recovery-key', vaultName, recoveryKey),

  // Vault recovery with older passwords
  recoverVaultWithOldPassword: (vaultName, oldPassword) =>
    ipcRenderer.invoke(
      'recover-vault-with-old-password',
      vaultName,
      oldPassword
    ),

  // Import/Export
  exportVault: (vaultName, exportPath) =>
    ipcRenderer.invoke('export-vault', vaultName, exportPath),
  importVault: (importPath, newVaultName, password) =>
    ipcRenderer.invoke('import-vault', importPath, newVaultName, password),
  selectImportFile: () => ipcRenderer.invoke('select-import-file'),
  getVaultDirectory: () => ipcRenderer.invoke('get-vault-directory'),

  // Menu actions
  menuNewVault: () => ipcRenderer.invoke('menu-new-vault'),
  menuOpenVault: () => ipcRenderer.invoke('menu-open-vault'),
  menuImportVault: () => ipcRenderer.invoke('menu-import-vault'),
  menuLockVault: () => ipcRenderer.invoke('menu-lock-vault'),
  menuConfiguration: () => ipcRenderer.invoke('menu-configuration'),

  // Menu event listeners
  onMenuNewVault: (callback) =>
    ipcRenderer.on('menu-new-vault', (event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('Error in menu-new-vault handler:', error);
      }
    }),
  onMenuOpenVault: (callback) =>
    ipcRenderer.on('menu-open-vault', (event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('Error in menu-open-vault handler:', error);
      }
    }),
  onMenuImportVault: (callback) =>
    ipcRenderer.on('menu-import-vault', (event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('Error in menu-import-vault handler:', error);
      }
    }),
  onMenuLockVault: (callback) =>
    ipcRenderer.on('menu-lock-vault', (event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('Error in menu-lock-vault handler:', error);
      }
    }),
  onMenuConfiguration: (callback) =>
    ipcRenderer.on('menu-configuration', (event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('Error in menu-configuration handler:', error);
      }
    }),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
