import electron from 'electron';

const { Menu, BrowserWindow } = electron;

export class MenuService {
  constructor() {
    this.mainWindow = null;
  }

  createMenu(mainWindow) {
    this.mainWindow = mainWindow;

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
          {
            label: 'Import Vault…',
            accelerator: 'CmdOrCtrl+I',
            click: () => {
              this.sendMenuEvent('menu-import-vault');
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

  sendMenuEvent(eventName) {
    // The tracked window can become stale/destroyed when the window is closed
    // and later reopened (e.g. via the macOS dock), so fall back to whatever
    // live window currently exists. Without this, menu items silently stop
    // working after the first reopen.
    let targetWindow = this.mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      targetWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    }

    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send(eventName);
    }
  }

  updateMenu(menuItems) {
    // Method to dynamically update menu items
    // This can be used to enable/disable menu items based on application state
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // Implementation for dynamic menu updates
    }
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }
}
