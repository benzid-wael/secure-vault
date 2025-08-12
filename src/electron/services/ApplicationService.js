import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Service to handle application lifecycle and window management
 * Follows Single Responsibility Principle - only handles app and window operations
 */
export class ApplicationService {
  constructor() {
    this.mainWindow = null;
    this.isQuitting = false;
  }

  /**
   * Initialize the application
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.setupAppEventHandlers();
    await this.createWindow();
    this.createMenu();
  }

  /**
   * Setup application event handlers
   * @returns {Promise<void>}
   */
  async setupAppEventHandlers() {
    // App ready handler
    app.whenReady().then(() => {
      this.createWindow();
    });

    // Window all closed handler
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // Activate handler (macOS)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });

    // Before quit handler
    app.on('before-quit', () => {
      this.isQuitting = true;
    });

    // Security: Prevent new window creation
    app.on('web-contents-created', (event, contents) => {
      contents.on('new-window', (event, navigationUrl) => {
        event.preventDefault();
      });
    });
  }

  /**
   * Create the main application window
   * @returns {BrowserWindow} The created window
   */
  createWindow() {
    // Don't create multiple windows
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus();
      return this.mainWindow;
    }

    // Create the browser window with security settings
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, '../../../public/preload.js'),
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
      icon: path.join(__dirname, '../../../public/assets/icon.png'), // Add icon later
      show: false,
      titleBarStyle: 'default',
    });

    // Load the app
    const startUrl = isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../../../build/index.html')}`;

    this.mainWindow.loadURL(startUrl);

    // Show window when ready to prevent visual flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Open DevTools in development
    if (isDev) {
      this.mainWindow.webContents.openDevTools();
    }

    // Handle window closed
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // Security: Prevent new window creation
    this.mainWindow.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });

    // Security: Prevent navigation to external URLs
    this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);
      if (parsedUrl.origin !== startUrl && !isDev) {
        event.preventDefault();
      }
    });

    return this.mainWindow;
  }

  /**
   * Create application menu
   */
  createMenu() {
    const template = [
      {
        label: 'File',
        submenu: [
          {
            label: 'New Vault',
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              this.sendMenuEvent('menu-new-vault');
            },
          },
          {
            label: 'Open Vault',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              this.sendMenuEvent('menu-open-vault');
            },
          },
          { type: 'separator' },
          {
            label: 'Lock Vault',
            accelerator: 'CmdOrCtrl+L',
            click: () => {
              this.sendMenuEvent('menu-lock-vault');
            },
          },
          { type: 'separator' },
          {
            label: 'Configuration',
            accelerator: 'CmdOrCtrl+S',
            click: () => {
              this.sendMenuEvent('menu-configuration');
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'close' }],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  /**
   * Send menu event to renderer process
   * @param {string} eventName - Event name to send
   */
  sendMenuEvent(eventName) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(eventName);
    }
  }

  /**
   * Get the main window
   * @returns {BrowserWindow|null} Main window instance
   */
  getMainWindow() {
    return this.mainWindow;
  }

  /**
   * Focus the main window
   */
  focusMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus();
    }
  }

  /**
   * Close the application
   */
  quit() {
    this.isQuitting = true;
    app.quit();
  }

  /**
   * Check if application is quitting
   * @returns {boolean} True if quitting
   */
  isAppQuitting() {
    return this.isQuitting;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.close();
    }
    this.mainWindow = null;
  }
}
