import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  powerMonitor,
  clipboard,
  safeStorage,
  systemPreferences,
} from 'electron';
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
import {
  WindowManager,
  isLoadFailure,
} from '../src/electron/services/WindowManager.js';
import { MenuService } from '../src/electron/services/MenuService.js';
import { SecurityManager } from '../src/electron/services/SecurityManager.js';
import { getVaultsDir } from '../src/electron/utils/appPaths.js';
import { readFeatures } from '../src/electron/utils/features.js';
import { EnvVaultRegistry } from '../src/electron/services/EnvVaultRegistry.js';
import { EnvVaultSession } from '../src/electron/services/EnvVaultSession.js';
import { ClipboardService } from '../src/electron/services/ClipboardService.js';
import { createClipboardHandlers } from '../src/electron/services/ClipboardIpc.js';
import { createEnvVaultHandlers } from '../src/electron/services/EnvVaultIpc.js';
import { EnvVaultWatcher } from '../src/electron/services/EnvVaultWatcher.js';
import { VaultKeychain } from '../src/electron/services/VaultKeychain.js';
import { createPasswordVaultHandlers } from '../src/electron/services/PasswordVaultIpc.js';
import { OpenedVaults } from '../src/electron/services/OpenedVaults.js';
import { KeyFileLocations } from '../src/electron/services/KeyFileLocations.js';
import { isFormat2 } from '../src/electron/utils/passwordVaultEnvelope.js';
import { EnvVaultRecents } from '../src/electron/services/EnvVaultRecents.js';
import { AppSettingsStore } from '../src/electron/services/AppSettingsStore.js';
import {
  createAppSettingsHandlers,
  applyAppSettings,
} from '../src/electron/services/AppSettingsIpc.js';
import { claimSingleInstance } from '../src/electron/utils/singleInstance.js';
import {
  readAllowDebugPort,
  refusedDebugSwitch,
} from '../src/electron/utils/debugSwitches.js';

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
      // File → Lock Vault locks every env vault in main (New-46); the page
      // locks the password vault.
      this.menuService = new MenuService({
        onLock: () => this.envSession?.lockAll('user'),
      });
      this.securityManager = new SecurityManager();

      console.log('Initializing vault services...');
      // The master password lives here, never in the renderer (see VaultSession).
      // It locks itself after the idle time (Task 13); the page says why.
      this.session = new VaultSession({
        onIdle: (vaultName, idleMs) =>
          this.sendToWindow('vault-locked', {
            reason: 'idle',
            minutes: Math.round(idleMs / 60000),
          }),
      });
      // Services derive keys through the session so they're reused while
      // the vault is unlocked instead of re-running PBKDF2 per call.
      const deriveKey = (password, salt, iterations) =>
        this.session.deriveKey(password, salt, iterations);
      // Password vaults opened from other folders (New-53): one list, so
      // every service maps their names to the same files.
      this.openedVaults = new OpenedVaults();
      const links = this.openedVaults;
      this.vaultService = new VaultService(vaultDir, { deriveKey, links });
      this.importExportService = new ImportExportService(vaultDir, { links });
      this.vaultSettingsService = new VaultSettingsService(vaultDir, {
        deriveKey,
        links,
      });
      // Set only by the native open dialog (`select-import-file`).
      this.selectedImportPath = null;

      this.features = readFeatures();
      // Non-secret app settings, readable while every vault is locked (New-2).
      this.settings = new AppSettingsStore();
      // Env vaults (GUI-ENV-RFC §6.6): main maps ids to paths and holds keys.
      // Opened ones are remembered across runs unless turned off (D5).
      this.envRegistry = new EnvVaultRegistry({
        dialog,
        recents: new EnvVaultRecents(),
        remember: async () => (await this.settings.get()).rememberRecents,
        extensions: async () => (await this.settings.get()).envVaultExtensions,
      });
      // Tells the page about changes made outside the app (Task 16).
      this.envWatcher = new EnvVaultWatcher({
        onChange: (id, change) =>
          this.sendToWindow('env-vault-changed', { id, ...change }),
      });
      this.envSession = new EnvVaultSession({
        // `info` says why (New-47); the page tells the user.
        onLocked: (id, info) => {
          this.envWatcher.stop(id);
          this.sendToWindow('env-vault-locked', { id, ...info });
        },
      });

      // The saved idle timeout, once read (Tasks 13, 23).
      this.applySettings = (next, previous) =>
        applyAppSettings(
          {
            vaultSession: this.session,
            envSession: this.envSession,
            registry: this.envRegistry,
          },
          next,
          previous
        );
      this.settings
        .get()
        .then((saved) => this.applySettings(saved))
        .catch((error) => console.error('Could not apply settings:', error));

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
        (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
          if (!isLoadFailure(errorCode, validatedURL, isMainFrame)) return;
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

  /** Bring the window up: a second launch (Task 11) or a dock click. */
  showWindow() {
    if (!app.isReady()) return;
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      this.mainWindow = this.windowManager.createMainWindow();
      // Re-point the application menu at the new window; otherwise its
      // click handlers keep sending to the old, destroyed window and every
      // menu item silently stops working after a reopen.
      this.menuService.createMenu(this.mainWindow);
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  setupAppEventHandlers() {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) this.showWindow();
    });

    // Security: Prevent new window creation
    app.on('web-contents-created', (event, contents) => {
      this.securityManager.handleWebContentsCreated(contents);
    });
  }

  /**
   * Open the session and bring a legacy vault up to the current PBKDF2 work
   * factor while the password is at hand (M2). A failed upgrade leaves the
   * vault as it was and doesn't block the unlock.
   */
  async openSession(vaultName, password) {
    this.session.open(vaultName, password);
    const upgrade = await this.vaultService.upgradeKdf(vaultName, password);
    if (!upgrade.success) {
      console.error(`Vault "${vaultName}" stays on its old key derivation`);
    }
  }

  /**
   * A successful recovery yields the master password: open the session with it
   * and strip it from the result so it never reaches the renderer.
   */
  async openRecoveredSession(vaultName, result) {
    if (!result?.success) return result;
    const { password, ...rest } = result;
    if (typeof password === 'string') {
      await this.openSession(vaultName, password);
    }
    return rest;
  }

  sendToWindow(channel, payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
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
    const lockAll = (reason) => {
      this.lockSession();
      this.envSession.lockAll(reason);
    };
    powerMonitor.on('suspend', () => lockAll('sleep'));
    powerMonitor.on('lock-screen', () => lockAll('screen-lock'));
    app.on('before-quit', () => {
      this.session.close();
      this.envSession.lockAll('quit');
      this.envWatcher.stopAll();
    });
  }

  setupHandlers() {
    // Every channel goes through `handle`: a call from anything but the main
    // window's top frame (an injected iframe, another webContents) is refused.
    const handle = (channel, fn) =>
      ipcMain.handle(channel, (event, ...args) =>
        this.securityManager.isTrustedSender(event, this.mainWindow)
          ? fn(event, ...args)
          : { success: false, error: 'Untrusted IPC sender' }
      );
    // For channels whose first argument is a vault name: it becomes a file
    // path, so it is validated before any service sees it.
    const handleVault = (channel, fn) =>
      handle(channel, (event, vaultName, ...args) => {
        const check = this.securityManager.validateVaultName(vaultName);
        return check.isValid
          ? fn(event, vaultName, ...args)
          : { success: false, error: check.error };
      });

    handle('get-features', () => ({ success: true, ...this.features }));
    // One clipboard service for every copy (New-3, Task 22): a new copy
    // replaces a pending clear, whichever screen made either.
    const clipboardService = new ClipboardService({ clipboard });
    for (const [channel, fn] of Object.entries(
      createClipboardHandlers({ clipboard: clipboardService })
    )) {
      handle(channel, fn);
    }
    // Saved passwords, opt-in per vault, for both vault kinds (New-24,
    // New-52). The file sits in userData: safeStorage's key belongs to this
    // app build, so other builds couldn't read it.
    const keychain = new VaultKeychain({
      file: path.join(app.getPath('userData'), 'vault-passwords.json'),
      safeStorage,
      confirmPresence: async (reason) => {
        if (
          process.platform !== 'darwin' ||
          !systemPreferences.canPromptTouchID()
        ) {
          return true;
        }
        try {
          await systemPreferences.promptTouchID(reason);
          return true;
        } catch {
          return false;
        }
      },
    });
    // Behind the New-4 gate: with it off, none of these channels exist.
    if (this.features.envVaults) {
      const envHandlers = createEnvVaultHandlers({
        registry: this.envRegistry,
        session: this.envSession,
        getWindow: () => this.mainWindow,
        dialog,
        clipboard: clipboardService,
        watcher: this.envWatcher,
        keychain,
      });
      for (const [channel, fn] of Object.entries(envHandlers)) {
        handle(channel, fn);
      }
    }
    // App settings (Tasks 13, 23): the idle timeout covers password vaults
    // too, so these exist with the env gate off.
    const settingsHandlers = createAppSettingsHandlers({
      settings: this.settings,
      apply: this.applySettings,
    });
    for (const [channel, fn] of Object.entries(settingsHandlers)) {
      handle(channel, fn);
    }
    // Input in the window (keys, clicks, scrolling), reported by the page:
    // the only thing that keeps the password vault unlocked (Task 13).
    handle('vault-activity', () => {
      this.session.touch();
      return { success: true };
    });

    // Session lifecycle: these are the only handlers that receive the master
    // password from the renderer, and none of them sends it back.
    const passwordVaultHandlers = createPasswordVaultHandlers({
      vaultService: this.vaultService,
      session: this.session,
      openSession: (vaultName, password) =>
        this.openSession(vaultName, password),
      keychain,
      opened: this.openedVaults,
      dialog,
      getWindow: () => this.mainWindow,
      // Where each vault's key file was last used, never its content (New-54).
      keyFileLocations: new KeyFileLocations(),
      // Import reads only the file the user picked in `select-import-file`;
      // the renderer cannot name another path.
      importExportService: this.importExportService,
      importSelection: {
        get: () => this.selectedImportPath,
        clear: () => {
          this.selectedImportPath = null;
        },
      },
    });
    for (const [channel, fn] of Object.entries(passwordVaultHandlers.vault)) {
      handleVault(channel, fn);
    }
    for (const [channel, fn] of Object.entries(passwordVaultHandlers.general)) {
      handle(channel, fn);
    }
    handleVault('create-vault', async (event, vaultName, masterPassword) => {
      const result = await this.vaultService.createVault(
        vaultName,
        masterPassword
      );
      if (result.success) this.session.open(vaultName, masterPassword);
      return result;
    });
    handle('lock-vault', () => {
      this.session.close();
      return { success: true };
    });

    // Session-bound: act on the unlocked vault, refuse while locked.
    handleVault('load-vault', (event, vaultName) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultService.loadVault(vaultName, password)
      )
    );
    handleVault('save-vault', (event, vaultName, data) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultService.saveVault(vaultName, password, data)
      )
    );
    handleVault('generate-recovery-key', (event, vaultName) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultService.generateRecoveryKey(vaultName, password)
      )
    );
    handleVault('verify-vault-recovery-key', (event, vaultName, recoveryKey) =>
      this.vaultService.verifyRecoveryKey(vaultName, recoveryKey)
    );
    handleVault(
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
    handleVault('has-vault-backup', (event, vaultName) =>
      this.vaultService.fileService
        .hasBackup(vaultName)
        .then((hasBackup) => ({ success: true, hasBackup }))
    );
    // Rolling a vault back overwrites its current contents: only for the
    // vault that is unlocked.
    handleVault('restore-vault-backup', (event, vaultName) =>
      this.session.withPassword(vaultName, () =>
        this.vaultService.fileService
          .restoreFromBackup(vaultName)
          .then((success) =>
            success
              ? { success: true }
              : { success: false, error: 'No backup found for this vault' }
          )
      )
    );

    handleVault('update-vault-settings', (event, vaultName, newSettings) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultSettingsService.updateVaultSettings(
          vaultName,
          password,
          newSettings
        )
      )
    );

    handleVault('get-vault-settings', (event, vaultName) =>
      this.session.withPassword(vaultName, (password) =>
        this.vaultSettingsService.getVaultSettings(vaultName, password)
      )
    );

    // The destination is picked here, in a native dialog: the renderer never
    // names a path, so it cannot point an export at an arbitrary file.
    handleVault('export-vault', (event, vaultName) =>
      this.session.withPassword(vaultName, async (password) => {
        const result = await dialog.showSaveDialog(this.mainWindow, {
          title: 'Export Vault',
          defaultPath: `${vaultName}.vault.json`,
          filters: [{ name: 'Vault Export', extensions: ['vault.json'] }],
        });
        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }
        const exportPath = result.filePath.endsWith('.vault.json')
          ? result.filePath
          : `${result.filePath.replace(/\.json$/, '')}.vault.json`;
        const exported = await this.importExportService.exportVault(
          vaultName,
          password,
          exportPath
        );
        return exported.success ? { ...exported, exportPath } : exported;
      })
    );

    handleVault(
      'recover-vault-with-old-password',
      async (event, vaultName, oldPassword) =>
        this.openRecoveredSession(
          vaultName,
          await this.vaultService.loadVaultWithPassword(vaultName, oldPassword)
        )
    );

    handle('get-vault-directory', async () => {
      try {
        const vaultDir = getVaultsDir();
        return { success: true, path: vaultDir };
      } catch (error) {
        console.error('Error getting vault directory:', error);
        return { success: false, error: 'Failed to get vault directory' };
      }
    });

    handle('select-import-file', async () => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(window, {
        title: 'Select Vault Export File',
        properties: ['openFile'],
        filters: [{ name: 'Vault Export', extensions: ['vault.json', 'json'] }],
      });

      this.selectedImportPath = null;
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

      this.selectedImportPath = filePath;
      // Whether it's a vault that uses a key file (New-55), so the page can
      // offer its recovery key; the import itself checks again.
      let keyFile = false;
      try {
        keyFile = isFormat2(
          JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
            .originalVaultData
        );
      } catch {
        // Unreadable: the import says so.
      }
      return { success: true, filePath, keyFile };
    });
  }
}

// A packaged build started with a debugging switch quits before it opens
// any window: it would expose the pages of unlocked vaults (New-40).
const refusedSwitch = refusedDebugSwitch({
  isPackaged: app.isPackaged,
  allowDebugPort: app.isPackaged && readAllowDebugPort(app.getAppPath()),
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
});

// One process per user: a second launch shows this one's window (Task 11).
let electronApp = null;
if (refusedSwitch) {
  console.error(`--${refusedSwitch} is refused in this build; quitting.`);
  app.exit(1);
} else if (claimSingleInstance(app, () => electronApp?.showWindow())) {
  startApp();
}

function startApp() {
  // Initialize the application
  console.log('Starting application initialization...');
  electronApp = new ElectronApp();

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
}
