import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';

import { WindowManager } from './modules/WindowManager.js';
import { VaultService } from './modules/VaultService.js';
import { MenuService } from './modules/MenuService.js';
import { SecurityManager } from './modules/SecurityManager.js';
import { IpcHandler } from './modules/IpcHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ElectronApp {
  constructor() {
    this.windowManager = new WindowManager();
    this.vaultService = new VaultService();
    this.menuService = new MenuService();
    this.securityManager = new SecurityManager();
    this.ipcHandler = new IpcHandler(this.vaultService);
    
    this.mainWindow = null;
  }

  async initialize() {
    // Initialize services
    await this.vaultService.initialize();
    
    // Set up security policies
    this.securityManager.setupSecurityPolicies();
    
    // Create main window
    this.mainWindow = this.windowManager.createMainWindow();
    
    // Set up IPC handlers
    this.ipcHandler.setupHandlers();
    
    // Create application menu
    this.menuService.createMenu(this.mainWindow);
    
    // Set up app event handlers
    this.setupAppEventHandlers();
  }

  setupAppEventHandlers() {
    app.whenReady().then(() => this.initialize());

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
}

// Initialize the application
const electronApp = new ElectronApp();

// For debugging purposes in development
if (isDev) {
  // DevTools will be opened by WindowManager
}
