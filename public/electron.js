const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const fs = require('fs-extra');
const crypto = require('crypto');

// Keep a global reference of the window object
let mainWindow;

function createWindow() {
  // Create the browser window with security settings
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    },
    icon: path.join(__dirname, 'assets/icon.png'), // Add icon later
    show: false,
    titleBarStyle: 'default'
  });

  // Load the app
  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '../build/index.html')}`;
  
  mainWindow.loadURL(startUrl);

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Security: Prevent new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== startUrl && !isDev) {
      event.preventDefault();
    }
  });
}

// App event handlers
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });
});

// IPC Handlers for secure vault operations
const vaultDir = path.join(app.getPath('userData'), 'vaults');

// Ensure vault directory exists
fs.ensureDirSync(vaultDir);

// Encryption/Decryption helper functions
function encryptData(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    authTag: authTag.toString('hex'),
    iv: iv.toString('hex')
  };
}

function decryptData(encryptedData, key) {
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
}

// Get available vaults
ipcMain.handle('get-vaults', async () => {
  try {
    const files = await fs.readdir(vaultDir);
    const vaults = files
      .filter(file => file.endsWith('.vault'))
      .map(file => file.replace('.vault', ''));
    
    // Ensure default vault exists
    if (!vaults.includes('default')) {
      await createDefaultVault();
      vaults.unshift('default');
    }
    
    return vaults;
  } catch (error) {
    console.error('Error getting vaults:', error);
    return ['default'];
  }
});

// Create new vault
ipcMain.handle('create-vault', async (event, vaultName, masterPassword) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    
    // Check if vault already exists
    if (await fs.pathExists(vaultPath)) {
      throw new Error('Vault already exists');
    }

    // Create encrypted vault structure
    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha512');
    
    const vaultData = {
      version: '1.0',
      created: new Date().toISOString(),
      salt: salt.toString('hex'),
      entries: []
    };

    const encryptedData = encryptData(vaultData, key);
    const finalData = {
      ...encryptedData,
      salt: salt.toString('hex')
    };

    await fs.writeJson(vaultPath, finalData);
    return { success: true };
  } catch (error) {
    console.error('Error creating vault:', error);
    return { success: false, error: error.message };
  }
});

// Verify vault password
ipcMain.handle('verify-vault-password', async (event, vaultName, password) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    const vaultData = await fs.readJson(vaultPath);
    
    const salt = Buffer.from(vaultData.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    
    decryptData(vaultData, key); // This will throw if password is wrong
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Invalid password' };
  }
});

// Load vault data
ipcMain.handle('load-vault', async (event, vaultName, password) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    const vaultData = await fs.readJson(vaultPath);
    
    const salt = Buffer.from(vaultData.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    
    const parsedData = decryptData(vaultData, key);
    return { success: true, data: parsedData };
  } catch (error) {
    console.error('Error loading vault:', error);
    return { success: false, error: error.message };
  }
});

// Save vault data
ipcMain.handle('save-vault', async (event, vaultName, password, data) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    
    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    
    const encryptedData = encryptData(data, key);
    const finalData = {
      ...encryptedData,
      salt: salt.toString('hex')
    };

    await fs.writeJson(vaultPath, finalData);
    return { success: true };
  } catch (error) {
    console.error('Error saving vault:', error);
    return { success: false, error: error.message };
  }
});

// Change master password
ipcMain.handle('change-master-password', async (event, vaultName, currentPassword, newPassword) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    
    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    // Load and decrypt vault with current password
    const encryptedData = await fs.readJson(vaultPath);
    const currentSalt = Buffer.from(encryptedData.salt, 'hex');
    const currentKey = crypto.pbkdf2Sync(currentPassword, currentSalt, 100000, 32, 'sha512');
    
    let vaultData;
    try {
      vaultData = decryptData(encryptedData, currentKey);
    } catch (error) {
      return { success: false, error: 'Invalid current password' };
    }

    // Check for password reuse if enabled
    if (vaultData.settings?.preventPasswordReuse) {
      // Check if new password is same as current password
      if (newPassword === currentPassword) {
        return { success: false, error: 'New password must be different from current password' };
      }
      
      // Check against password history
      const newPasswordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
      const currentPasswordHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
      
      if (vaultData.passwordHistory && vaultData.passwordHistory.length > 0) {
        const isReused = vaultData.passwordHistory.some(entry => 
          entry.passwordHash === newPasswordHash
        );
        if (isReused) {
          return { success: false, error: 'This password has been used before. Please choose a different password.' };
        }
      }
    }

    // Generate new salt and key for new password
    const newSalt = crypto.randomBytes(32);
    const newKey = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha512');
    
    // Update vault data with password change info
    const currentPasswordHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
    
    if (!vaultData.passwordHistory) {
      vaultData.passwordHistory = [];
    }
    
    // Add current password to history
    vaultData.passwordHistory.unshift({
      changedAt: vaultData.lastPasswordChange || vaultData.created,
      passwordHash: currentPasswordHash
    });
    
    // Keep only the specified number of password history entries
    const maxHistory = Math.max(1, vaultData.settings?.maxPasswordHistory || 1);
    vaultData.passwordHistory = vaultData.passwordHistory.slice(0, maxHistory);
    
    // Update last password change date
    vaultData.lastPasswordChange = new Date().toISOString();
    
    // Re-encrypt with new password
    const newEncryptedData = encryptData(vaultData, newKey);
    const finalData = {
      ...newEncryptedData,
      salt: newSalt.toString('hex')
    };

    await fs.writeJson(vaultPath, finalData);
    return { success: true };
  } catch (error) {
    console.error('Error changing master password:', error);
    return { success: false, error: 'Failed to change master password' };
  }
});

// Update vault settings
ipcMain.handle('update-vault-settings', async (event, vaultName, vaultPassword, newSettings) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    
    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    // Load and decrypt vault
    const encryptedData = await fs.readJson(vaultPath);
    const salt = Buffer.from(encryptedData.salt, 'hex');
    const key = crypto.pbkdf2Sync(vaultPassword, salt, 100000, 32, 'sha512');
    
    let vaultData;
    try {
      vaultData = decryptData(encryptedData, key);
    } catch (error) {
      return { success: false, error: 'Invalid password' };
    }

    // Update settings with validation
    const validatedSettings = { ...newSettings };
    if (validatedSettings.maxPasswordHistory !== undefined) {
      validatedSettings.maxPasswordHistory = Math.max(1, validatedSettings.maxPasswordHistory);
    }
    if (validatedSettings.passwordChangeWarningDays !== undefined) {
      validatedSettings.passwordChangeWarningDays = Math.max(1, validatedSettings.passwordChangeWarningDays);
    }
    
    vaultData.settings = { ...vaultData.settings, ...validatedSettings };
    
    // Re-encrypt and save
    const newEncryptedData = encryptData(vaultData, key);
    const finalData = {
      ...newEncryptedData,
      salt: salt.toString('hex')
    };

    await fs.writeJson(vaultPath, finalData);
    return { success: true };
  } catch (error) {
    console.error('Error updating vault settings:', error);
    return { success: false, error: 'Failed to update settings' };
  }
});

async function createDefaultVault() {
  const defaultVaultPath = path.join(vaultDir, 'default.vault');
  
  if (!(await fs.pathExists(defaultVaultPath))) {
    const defaultPassword = 'changeme123'; // User will be prompted to change this
    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(defaultPassword, salt, 100000, 32, 'sha512');
    
    const vaultData = {
      version: '1.0',
      created: new Date().toISOString(),
      lastPasswordChange: new Date().toISOString(),
      salt: salt.toString('hex'),
      entries: [],
      isDefault: true,
      passwordHistory: [],
      settings: {
        enforcePasswordChange: false,
        passwordChangeWarningDays: 90,
        preventPasswordReuse: true,
        maxPasswordHistory: 1
      }
    };

    const encryptedData = encryptData(vaultData, key);
    const finalData = {
      ...encryptedData,
      salt: salt.toString('hex')
    };

    await fs.writeJson(defaultVaultPath, finalData);
  }
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Vault',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu-new-vault');
          }
        },
        {
          label: 'Open Vault',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu-open-vault');
          }
        },
        { type: 'separator' },
        {
          label: 'Lock Vault',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            mainWindow.webContents.send('menu-lock-vault');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
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
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createMenu();
});
