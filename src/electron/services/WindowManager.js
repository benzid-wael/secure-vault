import { BrowserWindow, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WindowManager {
  constructor() {
    this.mainWindow = null;
    // Check if we're in development mode at runtime
    // Use ELECTRON_IS_DEV or NODE_ENV (ELECTRON_IS_DEV takes precedence)
    this.isDev =
      process.env.ELECTRON_IS_DEV === '1' ||
      process.env.NODE_ENV === 'development';
    console.log(
      'WindowManager initialized with ELECTRON_IS_DEV:',
      process.env.ELECTRON_IS_DEV,
      'NODE_ENV:',
      process.env.NODE_ENV,
      'isDev:',
      this.isDev
    );
  }

  createMainWindow() {
    try {
      console.log('Creating main browser window...');

      // Determine the correct preload path based on whether we're bundled or not
      // When bundled, preload.cjs is in the same directory as main.cjs (build/electron/)
      // When in development source, it's in public/
      let preloadPath;
      const bundledPreloadPath = path.join(__dirname, 'preload.cjs');
      const devPreloadPath = path.join(__dirname, '../../../public/preload.js');

      if (fs.existsSync(bundledPreloadPath)) {
        preloadPath = bundledPreloadPath;
      } else if (fs.existsSync(devPreloadPath)) {
        preloadPath = devPreloadPath;
      } else {
        throw new Error(
          `Preload script not found. Tried: ${bundledPreloadPath}, ${devPreloadPath}`
        );
      }

      // Check if icon exists (try multiple locations)
      let iconPath;
      const bundledIconPath = path.join(__dirname, '../icon.png');
      const devIconPath = path.join(__dirname, '../../../public/icon.png');

      if (fs.existsSync(bundledIconPath)) {
        iconPath = bundledIconPath;
      } else if (fs.existsSync(devIconPath)) {
        iconPath = devIconPath;
      } else {
        console.warn(
          `Icon not found. Tried: ${bundledIconPath}, ${devIconPath}`
        );
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
          preload: preloadPath,
          webSecurity: true,
          allowRunningInsecureContent: false,
          experimentalFeatures: false,
          devTools: this.isDev,
          webviewTag: false,
        },
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        show: false,
        titleBarStyle: 'default',
      });

      // Handle window events
      this.setupWindowEvents();

      // Set up security handlers
      this.setupSecurityHandlers();

      // Load the app
      this.loadApp();

      return this.mainWindow;
    } catch (error) {
      console.error('Failed to create main window:', error);
      dialog.showErrorBox(
        'Window Creation Error',
        `Failed to create main window: ${error.message}`
      );
      throw error;
    }
  }

  async loadApp() {
    try {
      let startUrl;

      if (this.isDev) {
        startUrl = 'http://localhost:3000';
        console.log(
          'Development mode: Loading from development server at',
          startUrl
        );
      } else {
        // When bundled, the build is in the parent directory
        const indexPath = path.join(__dirname, '../index.html');
        if (!fs.existsSync(indexPath)) {
          throw new Error(
            `Production build not found at: ${indexPath}. Please run 'npm run build' first.`
          );
        }
        startUrl = `file://${indexPath}`;
        console.log(
          'Production mode: Loading from build directory at',
          startUrl
        );
      }

      console.log('Loading URL:', startUrl);

      // Set up error handling for the window
      this.mainWindow.webContents.on(
        'did-fail-load',
        (event, errorCode, errorDescription) => {
          console.error('Failed to load URL:', {
            startUrl,
            errorCode,
            errorDescription,
          });
          this.showErrorPage(`Failed to load application: ${errorDescription}`);
        }
      );

      // Load the URL
      await this.mainWindow.loadURL(startUrl);

      // Show the window once content is loaded
      this.mainWindow.once('ready-to-show', () => {
        console.log('Window is ready to show');
        this.mainWindow.show();

        // Focus on the window
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.focus();
      });
    } catch (error) {
      console.error('Error in loadApp:', error);
      this.showErrorPage(`Failed to load application: ${error.message}`);
    }
  }

  showErrorPage(errorMessage) {
    const errorHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Application Error</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background-color: #f8f9fa;
              color: #212529;
            }
            .error-container {
              max-width: 600px;
              padding: 2rem;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              text-align: center;
            }
            h1 { color: #dc3545; margin-top: 0; }
            pre {
              background: #f8f9fa;
              padding: 1rem;
              border-radius: 4px;
              text-align: left;
              max-height: 200px;
              overflow-y: auto;
            }
          </style>
        </head>
        <body>
          <div class="error-container">
            <h1>Application Error</h1>
            <p>An error occurred while starting the application:</p>
            <pre>${errorMessage}</pre>
            <p>Please check the console for more details and try again.</p>
          </div>
        </body>
      </html>
    `;

    this.mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`
    );
  }

  setupWindowEvents() {
    // Show window when ready to prevent visual flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Open DevTools in development
    if (this.isDev) {
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
      if (this.isDev) {
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
