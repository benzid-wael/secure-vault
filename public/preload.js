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
  // Input in the window: keeps the unlocked vault from locking (Task 13).
  vaultActivity: () => ipcRenderer.invoke('vault-activity'),
  // `info.reason` is 'idle' (with `info.minutes`) after an idle lock.
  onVaultLocked: (callback) =>
    ipcRenderer.on('vault-locked', (event, info) => {
      try {
        callback(info ?? {});
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

  // Import/Export: file paths are chosen in native dialogs by the main
  // process; the page never names one.
  exportVault: (vaultName) => ipcRenderer.invoke('export-vault', vaultName),
  importVault: (newVaultName, password) =>
    ipcRenderer.invoke('import-vault', newVaultName, password),
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

  // Feature gates, decided by main (New-4).
  getFeatures: () => ipcRenderer.invoke('get-features'),

  // App-wide settings, not secret (New-2, Task 23); main applies changes.
  appSettings: {
    get: () => ipcRenderer.invoke('app-settings:get'),
    update: (patch) => ipcRenderer.invoke('app-settings:update', patch),
  },

  // Env vaults: the page holds opaque vault ids, never file paths, and gets
  // a sensitive value only by revealing it (GUI-ENV-RFC §6.7).
  envVaults: {
    list: () => ipcRenderer.invoke('env-vaults:list'),
    open: () => ipcRenderer.invoke('env-vaults:open'),
    // The vault the CLI would use in a folder the user picks (New-22).
    openFolder: () => ipcRenderer.invoke('env-vaults:open-folder'),
    // Input on this vault's screen: keeps it from locking (New-42).
    activity: (id) => ipcRenderer.invoke('env-vaults:activity', id),
    forget: (id) => ipcRenderer.invoke('env-vaults:forget', id),
    create: (options, password) =>
      ipcRenderer.invoke('env-vaults:create', options, password),
    unlock: (id, password, options) =>
      ipcRenderer.invoke('env-vault:unlock', id, password, options),
    // A password kept on this computer (opt-in) never comes to the page.
    unlockSaved: (id) => ipcRenderer.invoke('env-vault:unlock-saved', id),
    forgetPassword: (id) => ipcRenderer.invoke('env-vault:forget-password', id),
    lock: (id) => ipcRenderer.invoke('env-vault:lock', id),
    listEnvs: (id) => ipcRenderer.invoke('env:list', id),
    createEnv: (id, name, expectedRevision) =>
      ipcRenderer.invoke('env:create', id, name, expectedRevision),
    view: (id, env) => ipcRenderer.invoke('env:view', id, env),
    refresh: (id, viewId) => ipcRenderer.invoke('env:refresh', id, viewId),
    reveal: (id, viewId, key) =>
      ipcRenderer.invoke('env:reveal', id, viewId, key),
    closeView: (id, viewId) => ipcRenderer.invoke('env:view-close', id, viewId),
    commit: (id, changeset) => ipcRenderer.invoke('env:commit', id, changeset),
    // Copy and export happen in main: no value comes back.
    copy: (id, viewId, key, format) =>
      ipcRenderer.invoke('env:copy', id, viewId, key, format),
    transfer: (id, request) => ipcRenderer.invoke('env:transfer', id, request),
    exportEnv: (id, env) => ipcRenderer.invoke('env:export', id, env),
    manageEnv: (id, request) => ipcRenderer.invoke('env:manage', id, request),
    // Envs that refer to `env` ({{env:env/KEY}}), with counts (New-30).
    references: (id, env) => ipcRenderer.invoke('env:references', id, env),
    templateEnv: (id, env) => ipcRenderer.invoke('env:template', id, env),
    diff: (id, envA, envB, options) =>
      ipcRenderer.invoke('env:diff', id, envA, envB, options),
    validate: (id, env) => ipcRenderer.invoke('env:validate', id, env),
    // Import: main reads the file; the page sees key names until applied.
    importPick: (id, viewId) =>
      ipcRenderer.invoke('env:import-pick', id, viewId),
    importApply: (id, token, options) =>
      ipcRenderer.invoke('env:import-apply', id, token, options),
    importCancel: (id, token) =>
      ipcRenderer.invoke('env:import-cancel', id, token),
    changePassword: (id, current, next) =>
      ipcRenderer.invoke('env-vault:change-password', id, current, next),
    // Bulk edit: the env's own values as .env text, asked for explicitly.
    editText: (id, viewId) => ipcRenderer.invoke('env:edit-text', id, viewId),
    history: (id, viewId) => ipcRenderer.invoke('env:history', id, viewId),
    rollback: (id, viewId, n) =>
      ipcRenderer.invoke('env:rollback', id, viewId, n),
    squash: (id, viewId, keep) =>
      ipcRenderer.invoke('env:squash', id, viewId, keep),
    // Changes made outside the app (the CLI, a sync tool).
    onChanged: (callback) => {
      const listener = (event, payload) => {
        try {
          callback(payload);
        } catch (error) {
          console.error('Error in env-vault-changed handler:', error);
        }
      };
      ipcRenderer.on('env-vault-changed', listener);
      return () => ipcRenderer.removeListener('env-vault-changed', listener);
    },
    onLocked: (callback) => {
      const listener = (event, payload) => {
        try {
          callback(payload);
        } catch (error) {
          console.error('Error in env-vault-locked handler:', error);
        }
      };
      ipcRenderer.on('env-vault-locked', listener);
      return () => ipcRenderer.removeListener('env-vault-locked', listener);
    },
  },

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
