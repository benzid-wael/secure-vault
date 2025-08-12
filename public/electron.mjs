import electron from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const { app, BrowserWindow, ipcMain, Menu } = electron;

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || 
              (typeof process !== 'undefined' && process.type === 'renderer');

import { WindowManager } from '../src/electron/WindowManager.js';
import { VaultService } from '../src/electron/VaultService.js';
import { MenuService } from '../src/electron/MenuService.js';
import { SecurityManager } from '../src/electron/SecurityManager.js';
import { IpcHandler } from '../src/electron/IpcHandler.js';

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
    console.log('Initializing Electron app...');
    
    try {
      // Initialize services
      console.log('Initializing vault service...');
      await this.vaultService.initialize();
      
      // Set up security policies
      console.log('Setting up security policies...');
      this.securityManager.setupSecurityPolicies();
      
      // Create main window
      console.log('Creating main window...');
      this.mainWindow = this.windowManager.createMainWindow();
      
      // Set up IPC handlers
      console.log('Setting up IPC handlers...');
      this.ipcHandler.setupHandlers();
      
      // Create application menu
      console.log('Creating application menu...');
      this.menuService.createMenu(this.mainWindow);
      
      // Set up app event handlers
      console.log('Setting up app event handlers...');
      this.setupAppEventHandlers();
      
      console.log('Electron app initialization complete!');
    } catch (error) {
      console.error('Error initializing Electron app:', error);
      throw error;
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

app.whenReady().then(() => {
  console.log('This code may execute before the above import');
  electronApp.initialize();
})
