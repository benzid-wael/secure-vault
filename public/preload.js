const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Vault operations
  getVaults: () => ipcRenderer.invoke('get-vaults'),
  createVault: (vaultName, masterPassword) =>
    ipcRenderer.invoke('create-vault', vaultName, masterPassword),
  verifyVaultPassword: (vaultName, password) =>
    ipcRenderer.invoke('verify-vault-password', vaultName, password),
  loadVault: (vaultName, password) =>
    ipcRenderer.invoke('load-vault', vaultName, password),
  saveVault: (vaultName, password, data) =>
    ipcRenderer.invoke('save-vault', vaultName, password, data),

  // Master password management
  changeMasterPassword: (vaultName, currentPassword, newPassword) =>
    ipcRenderer.invoke(
      'change-master-password',
      vaultName,
      currentPassword,
      newPassword
    ),
  updateVaultSettings: (vaultName, vaultPassword, settings) =>
    ipcRenderer.invoke(
      'update-vault-settings',
      vaultName,
      vaultPassword,
      settings
    ),

  // Backup and recovery
  restoreVaultBackup: (vaultName) =>
    ipcRenderer.invoke('restore-vault-backup', vaultName),
  hasVaultBackup: (vaultName) =>
    ipcRenderer.invoke('has-vault-backup', vaultName),

  // Import/Export
  exportVault: (vaultName, password, exportPath) =>
    ipcRenderer.invoke('export-vault', vaultName, password, exportPath),
  importVault: (importPath, newVaultName, password) =>
    ipcRenderer.invoke('import-vault', importPath, newVaultName, password),
  getVaultDirectory: () => ipcRenderer.invoke('get-vault-directory'),

  // Menu event listeners
  onMenuNewVault: (callback) => ipcRenderer.on('menu-new-vault', callback),
  onMenuOpenVault: (callback) => ipcRenderer.on('menu-open-vault', callback),
  onMenuLockVault: (callback) => ipcRenderer.on('menu-lock-vault', callback),
  onMenuConfiguration: (callback) =>
    ipcRenderer.on('menu-configuration', callback),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
