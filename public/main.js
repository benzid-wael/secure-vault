import { app, BrowserWindow, ipcMain, dialog, powerMonitor } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (error.stack) console.error(error.stack);
  if (dialog && dialog.showErrorBox) {
    dialog.showErrorBox(
      'Application Error',
      error.message || 'An unexpected error occurred'
    );
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (dialog && dialog.showErrorBox) {
    dialog.showErrorBox('Unhandled Rejection', String(reason));
  }
});

// Import services
import { VaultService } from '../src/electron/services/VaultService.js';
import { ImportExportService } from '../src/electron/services/ImportExportService.js';
import { VaultSettingsService } from '../src/electron/services/VaultSettingsService.js';
import { VaultSession } from '../src/electron/services/VaultSession.js';
import { WindowManager } from '../src/electron/services/WindowManager.js';
import { MenuService } from '../src/electron/services/MenuService.js';
import { SecurityManager } from '../src/electron/services/SecurityManager.js';
import { getVaultsDir } from '../src/electron/utils/appPaths.js';

class ElectronApp {
  constructor() {
    try {
      console.log('Initializing ElectronApp...');

      // Ensure vault directory exists
      const vaultDir = getVaultsDir();
      if (!fs.existsSync(vaultDir)) {
        console.log('Creating vault directory:', vaultDir);
        fs.mkdirSync(vaultDir, { recursive: true });
      }

      console.log('Initializing services...');
      this.windowManager = new WindowManager();
      this.menuService = new MenuService();
      this.securityManager = new SecurityManager();

      console.log('Initializing vault services...');
      this.vaultService = new VaultService(vaultDir);
      this.importExportService = new ImportExportService(vaultDir);
      this.vaultSettingsService = new VaultSettingsService(vaultDir);
      // The master password lives here, never in the renderer (see VaultSession).
      this.session = new VaultSession();

      this.mainWindow = null;
      console.log('ElectronApp initialized successfully');
    } catch (error) {
      console.error('Failed to initialize ElectronApp:', error);
      throw error;
    }
  }

  async initialize() {
    try {
      // Set up security policies
      this.securityManager.setupSecurityPolicies();

      // Create main window
      this.mainWindow = this.windowManager.createMainWindow();

      // Log window creation
      this.mainWindow.webContents.on('did-finish-load', () => {
        console.log('Window finished loading');
      });

      this.mainWindow.webContents.on(
        'did-fail-load',
        (event, errorCode, errorDescription) => {
          console.error('Window failed to load:', {
            errorCode,
            errorDescription,
          });
          dialog.showErrorBox(
            'Load Failed',
            `Failed to load application: ${errorDescription}`
          );
        }
      );

      // Create application menu
      this.menuService.createMenu(this.mainWindow);

      // Set up app event handlers
      this.setupAppEventHandlers();

      this.setupHandlers();
      this.setupAutoLock();
    } catch (error) {
      console.error('Failed to initialize application:', error);
      dialog.showErrorBox(
        'Initialization Error',
        `Failed to initialize application: ${error.message}`
      );
      app.quit();
    }
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
        // Re-point the application menu at the new window; otherwise its
        // click handlers keep sending to the old, destroyed window and every
        // menu item silently stops working after a reopen.
        this.menuService.createMenu(this.mainWindow);
      }
    });

    // Security: Prevent new window creation
    app.on('web-contents-created', (event, contents) => {
      this.securityManager.handleWebContentsCreated(contents);
    });
  }

  /**
   * A successful recovery yields the master password: open the session with it
   * and strip it from the result so it never reaches the renderer.
   */
  openRecoveredSession(vaultName, result) {
    if (!result?.success) return result;
    const { password, ...rest } = result;
    if (typeof password === 'string') this.session.open(vaultName, password);
    return rest;
  }

  /** Close the session and tell the renderer to drop back to the selector. */
  lockSession() {
    const wasUnlocked = this.session.vaultName !== null;
    this.session.close();
    if (wasUnlocked && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('vault-locked');
    }
  }

  setupAutoLock() {
    // Lock whenever the user steps away from the machine.
    powerMonitor.on('suspend', () => this.lockSession());
    powerMonitor.on('lock-screen', () => this.lockSession());
    app.on('before-quit', () => this.session.close());
  }

  setupHandlers() {
    // IPC Handlers using the new VaultService
    ipcMain.handle('get-vaults', async () => {
      try {
        const vaults = await this.vaultService.getAvailableVaults();
        return { success: true, data: vaults };
      } catch (error) {
        console.error('Error getting vaults:', error);
        return { success: false, error: error.message };
      }
    });
    // Session lifecycle: these are the only handlers that receive the master
    // password from the renderer, and none of them sends it back.
    ipcMain.handle('create-vault', async (event, vaultName, masterPassword) => {
      const result = await this.vaultService.createVault(
        vaultName,
        masterPassword
      );
      if (result.success) this.session.open(vaultName, masterPassword);
      return result;
    });
    ipcMain.handle('unlock-vault', async (event, vaultName, password) => {
      const result = await this.vaultService.verifyPassword(
        vaultName,
        password
      );
      if (result.success) this.session.open(vaultName, password);
      return result;
    });
    ipcMain.handle('lock-vault', () => {
      this.session.close();
      return { success: true };
    });

    // Session-bound: act on the unlocked vault, refuse while locked.
    ipcMain.handle('load-vault', (event, vaultName) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultService.loadVault(vaultName, password)
      )
    );
    ipcMain.handle('save-vault', (event, vaultName, data) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultService.saveVault(vaultName, password, data)
      )
    );
    ipcMain.handle(
      'change-master-password',
      // The current password is still re-entered and checked here: holding a
      // session must not be enough to take over the vault.
      (event, vaultName, currentPassword, newPassword) =>
        this.session.withPassword(vaultName, async () => {
          const result = await this.vaultService.changePassword(
            vaultName,
            currentPassword,
            newPassword
          );
          if (result.success) this.session.open(vaultName, newPassword);
          return result;
        })
    );
    ipcMain.handle(
      'delete-vault',
      async (event, vaultName, confirmationPassword) => {
        const result = await this.vaultService.deleteVault(
          vaultName,
          confirmationPassword
        );
        if (result.success && this.session.isUnlocked(vaultName)) {
          this.session.close();
        }
        return result;
      }
    );
    ipcMain.handle('generate-recovery-key', (event, vaultName) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultService.generateRecoveryKey(vaultName, password)
      )
    );
    ipcMain.handle(
      'verify-vault-recovery-key',
      (event, vaultName, recoveryKey) =>
        this.vaultService.verifyRecoveryKey(vaultName, recoveryKey)
    );
    ipcMain.handle(
      'load-vault-with-recovery-key',
      async (event, vaultName, recoveryKey) =>
        this.openRecoveredSession(
          vaultName,
          await this.vaultService.loadVaultWithRecoveryKey(
            vaultName,
            recoveryKey
          )
        )
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

    ipcMain.handle('update-vault-settings', (event, vaultName, newSettings) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultSettingsService.updateVaultSettings(
          vaultName,
          password,
          newSettings
        )
      )
    );

    ipcMain.handle('get-vault-settings', (event, vaultName) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultSettingsService.getVaultSettings(vaultName, password)
      )
    );

    ipcMain.handle('export-vault', (event, vaultName, exportPath) =>
      this.session.withPassword(vaultName, (password) =>
        this.importExportService.exportVault(vaultName, password, exportPath)
      )
    );

    ipcMain.handle(
      'import-vault',
      (event, importPath, newVaultName, password) =>
        this.importExportService.importVault(importPath, newVaultName, password)
    );

    ipcMain.handle(
      'recover-vault-with-old-password',
      async (event, vaultName, oldPassword) =>
        this.openRecoveredSession(
          vaultName,
          await this.vaultService.loadVaultWithPassword(vaultName, oldPassword)
        )
    );

    ipcMain.handle('get-vault-directory', async () => {
      try {
        const vaultDir = getVaultsDir();
        return { success: true, path: vaultDir };
      } catch (error) {
        console.error('Error getting vault directory:', error);
        return { success: false, error: 'Failed to get vault directory' };
      }
    });

    ipcMain.handle('select-import-file', async () => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(window, {
        title: 'Select Vault Export File',
        properties: ['openFile'],
        filters: [{ name: 'Vault Export', extensions: ['vault.json', 'json'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = result.filePaths[0];
      if (!filePath.endsWith('.vault.json')) {
        return {
          success: false,
          error: 'Selected file is not a .vault.json export',
        };
      }

      return { success: true, filePath };
    });
  }
}

// Initialize the application
console.log('Starting application initialization...');
const electronApp = new ElectronApp();

app
  .whenReady()
  .then(() => {
    console.log('Electron is ready, initializing app...');
    electronApp.initialize();
  })
  .catch((error) => {
    console.error('Error in app.whenReady():', error);
    if (dialog && dialog.showErrorBox) {
      dialog.showErrorBox(
        'App Initialization Error',
        `Failed to start application: ${error.message}`
      );
    }
    app.quit();
  });
