import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

// Import services
import { VaultService } from '../src/electron/services/VaultService.js';
import { ImportExportService } from '../src/electron/services/ImportExportService.js';
import { VaultSettingsService } from '../src/electron/services/VaultSettingsService.js';
import { WindowManager } from '../src/electron/services/WindowManager.js';
import { MenuService } from '../src/electron/services/MenuService.js';
import { SecurityManager } from '../src/electron/services/SecurityManager.js';

class ElectronApp {
  constructor() {
    this.windowManager = new WindowManager();
    this.menuService = new MenuService();
    this.securityManager = new SecurityManager();

    const vaultDir = path.join(app.getPath('userData'), 'vaults');
    this.vaultService = new VaultService(vaultDir);
    this.importExportService = new ImportExportService(vaultDir);
    this.vaultSettingsService = new VaultSettingsService(vaultDir);

    this.mainWindow = null;
  }

  initialize() {
    // Set up security policies
    console.log('Setting up security policies...');
    this.securityManager.setupSecurityPolicies();

    // Create main window
    console.log('Creating main window...');
    this.mainWindow = this.windowManager.createMainWindow();

    // Create application menu
    console.log('Creating application menu...');
    this.menuService.createMenu(this.mainWindow);

    // Set up app event handlers
    console.log('Setting up app event handlers...');
    this.setupAppEventHandlers();

    this.setupHandlers();
  }

  setupAppEventHandlers() {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.mainWindow = this.windowManager.createMainWindow();
      }
    });

    // Security: Prevent new window creation
    app.on('web-contents-created', (event, contents) => {
      this.securityManager.handleWebContentsCreated(contents);
    });
  }

  setupHandlers() {
    // IPC Handlers using the new VaultService
    ipcMain.handle('get-vaults', () => this.vaultService.getAvailableVaults());
    ipcMain.handle('create-vault', (event, vaultName, masterPassword) =>
      this.vaultService.createVault(vaultName, masterPassword)
    );
    ipcMain.handle('verify-vault-password', (event, vaultName, password) =>
      this.vaultService.verifyPassword(vaultName, password)
    );
    ipcMain.handle('load-vault', (event, vaultName, password) =>
      this.vaultService.loadVault(vaultName, password)
    );
    ipcMain.handle('save-vault', (event, vaultName, password, data) =>
      this.vaultService.saveVault(vaultName, password, data)
    );
    ipcMain.handle(
      'change-master-password',
      (event, vaultName, currentPassword, newPassword) =>
        this.vaultService.changePassword(
          vaultName,
          currentPassword,
          newPassword
        )
    );
    ipcMain.handle('delete-vault', (event, vaultName, confirmationPassword) =>
      this.vaultService.deleteVault(vaultName, confirmationPassword)
    );
    ipcMain.handle(
      'generate-recovery-key',
      (event, vaultName, masterPassword) =>
        this.vaultService.generateRecoveryKey(vaultName, masterPassword)
    );
    ipcMain.handle(
      'verify-vault-recovery-key',
      (event, vaultName, recoveryKey) =>
        this.vaultService.verifyRecoveryKey(vaultName, recoveryKey)
    );
    ipcMain.handle(
      'load-vault-with-recovery-key',
      (event, vaultName, recoveryKey) =>
        this.vaultService.loadVaultWithRecoveryKey(vaultName, recoveryKey)
    );
    ipcMain.handle('has-vault-backup', (event, vaultName) =>
      this.vaultService.fileService
        .hasBackup(vaultName)
        .then((hasBackup) => ({ success: true, hasBackup }))
    );
    ipcMain.handle('restore-vault-backup', (event, vaultName) =>
      this.vaultService.fileService
        .restoreFromBackup(vaultName)
        .then((success) =>
          success
            ? { success: true }
            : { success: false, error: 'No backup found for this vault' }
        )
    );

    ipcMain.handle(
      'update-vault-settings',
      (event, vaultName, vaultPassword, newSettings) =>
        this.vaultSettingsService.updateVaultSettings(
          vaultName,
          vaultPassword,
          newSettings
        )
    );

    ipcMain.handle('get-vault-settings', (event, vaultName, vaultPassword) =>
      this.vaultSettingsService.getVaultSettings(vaultName, vaultPassword)
    );

    ipcMain.handle('export-vault', (event, vaultName, password, exportPath) =>
      this.importExportService.exportVault(vaultName, password, exportPath)
    );

    ipcMain.handle(
      'import-vault',
      (event, importPath, newVaultName, password) =>
        this.importExportService.importVault(importPath, newVaultName, password)
    );

    ipcMain.handle(
      'recover-vault-with-old-password',
      (event, vaultName, oldPassword) =>
        this.vaultService.loadVaultWithPassword(vaultName, oldPassword)
    );

    ipcMain.handle('get-vault-directory', async () => {
      try {
        const vaultDir = path.join(app.getPath('userData'), 'vaults');
        return { success: true, path: vaultDir };
      } catch (error) {
        console.error('Error getting vault directory:', error);
        return { success: false, error: 'Failed to get vault directory' };
      }
    });
  }
}

// Initialize the application
const electronApp = new ElectronApp();

app.whenReady().then(() => {
  console.log('This code may execute before the above import');
  electronApp.initialize();
});
