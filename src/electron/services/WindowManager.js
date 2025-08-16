import electron from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const { BrowserWindow } = electron;

// Check if we're in development mode
const isDev =
  process.env.NODE_ENV === 'development' ||
  (typeof process !== 'undefined' && process.type === 'renderer');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WindowManager {
  constructor() {
    this.mainWindow = null;
  }

  createMainWindow() {
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
      icon: path.join(__dirname, '../../public/icon.png'),
      show: false,
      titleBarStyle: 'default',
    });

    this.loadApp();
    this.setupWindowEvents();
    this.setupSecurityHandlers();

    return this.mainWindow;
  }

  loadApp() {
    const startUrl = isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../../build/index.html')}`;

    console.log('Loading URL:', startUrl);
    this.mainWindow.loadURL(startUrl);
  }

  setupWindowEvents() {
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
  }

  setupSecurityHandlers() {
    // Security: Prevent new window creation
    this.mainWindow.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });

    // Security: Prevent navigation to external URLs
    this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      if (isDev) {
        const parsedUrl = new URL(navigationUrl);
        if (parsedUrl.origin !== 'http://localhost:3000') {
          event.preventDefault();
        }
      } else {
        // In production, only allow file:// protocol
        const parsedUrl = new URL(navigationUrl);
        if (parsedUrl.protocol !== 'file:') {
          event.preventDefault();
        }
      }
    });
  }

  getMainWindow() {
    return this.mainWindow;
  }

  sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}
