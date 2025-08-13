const { app, BrowserWindow, ipcMain, Menu, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const isDev = require('electron-is-dev');
const { validatePasswordStrength } = require('../src/utils/passwordValidation');
const { default: installExtension, REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS } = require('electron-devtools-installer');

let mainWindow;

protocol.registerSchemesAsPrivileged([
  // According to https://github.com/electron/electron/issues/15404#issuecomment-433679148
  { scheme: 'fido', privileges: { standard: true, secure: true } },
]);

// IPC Handlers for secure vault operations
const vaultDir = path.join(app.getPath('userData'), 'vaults');

// Ensure vault directory exists
fs.ensureDirSync(vaultDir);

// Passkey data directory
const passkeyDir = path.join(app.getPath('userData'), 'passkeys');
fs.ensureDirSync(passkeyDir);

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

// Recovery key generation and validation functions
function generateRecoveryKey() {
  // Generate a 256-bit (32 byte) recovery key
  const recoveryKeyBytes = crypto.randomBytes(32);

  // Convert to base32 for human readability (similar to Google Authenticator)
  // Using a custom base32 alphabet without confusing characters
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < recoveryKeyBytes.length; i++) {
    value = (value << 8) | recoveryKeyBytes[i];
    bits += 8;

    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }

  // Format as groups of 4 characters for readability
  return result.match(/.{1,4}/g).join('-');
}

function validateRecoveryKeyFormat(recoveryKey) {
  // Remove dashes and convert to uppercase
  const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();

  // Check if it matches expected format (base32, specific length)
  const base32Regex = /^[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]+$/;
  return base32Regex.test(cleanKey) && cleanKey.length >= 50; // Minimum length for security
}

function deriveKeyFromRecoveryKey(recoveryKey, salt) {
  // Remove dashes and convert to uppercase
  const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();

  // Use PBKDF2 to derive encryption key from recovery key
  return crypto.pbkdf2Sync(cleanKey, salt, 100000, 32, 'sha512');
}

// Get available vaults
ipcMain.handle('get-vaults', async () => {
  try {
    const files = await fs.readdir(vaultDir);
    const vaults = files
      .filter(file => file.endsWith('.vault'))
      .map(file => file.replace('.vault', ''));

    // Ensure default vault exists
    if (!vaults.includes('default') && isDev) {
      await createDefaultVault();
      vaults.unshift('default');
    }

    return vaults;
  } catch (error) {
    console.error('Error getting vaults:', error);
    return ['default'];
  }
});

// Delete vault
ipcMain.handle('delete-vault', async (event, vaultName, confirmationPassword) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);

    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    // Prevent deletion of default vault without explicit confirmation
    if (vaultName === 'default' && !confirmationPassword) {
      return { success: false, error: 'Cannot delete default vault without password confirmation' };
    }

    // Verify password before deletion for security
    if (confirmationPassword) {
      const vaultFileData = await fs.readJson(vaultPath);
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = crypto.pbkdf2Sync(confirmationPassword, salt, 100000, 32, 'sha512');

      try {
        // Extract only the encrypted part for decryption
        const encryptedData = {
          encrypted: vaultFileData.encrypted,
          authTag: vaultFileData.authTag,
          iv: vaultFileData.iv
        };
        decryptData(encryptedData, key);
      } catch (error) {
        return { success: false, error: 'Invalid password. Vault not deleted.' };
      }
    }

    // Create a backup before deletion (just in case)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(vaultDir, `${vaultName}.vault.deleted.${timestamp}`);
    await fs.copy(vaultPath, backupPath);

    // Delete the main vault file
    await fs.remove(vaultPath);

    // Also clean up any related files
    const relatedFiles = [
      path.join(vaultDir, `${vaultName}.vault.backup`),
      path.join(vaultDir, `${vaultName}.vault.tmp`),
      path.join(vaultDir, `${vaultName}.recovery`) // Legacy recovery files
    ];

    for (const filePath of relatedFiles) {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
      }
    }

    return {
      success: true,
      message: `Vault "${vaultName}" has been deleted. A backup was created.`,
      backupFile: path.basename(backupPath)
    };
  } catch (error) {
    console.error('Error deleting vault:', error);
    return { success: false, error: 'Failed to delete vault' };
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

    // Generate initial recovery key
    const recoveryKey = generateRecoveryKey();

    const vaultData = {
      version: '1.0',
      created: new Date().toISOString(),
      lastPasswordChange: new Date().toISOString(),
      entries: [],
      passwordHistory: [], // Initialize empty password history
      settings: {
        enforcePasswordChange: false,
        passwordChangeWarningDays: 90,
        preventPasswordReuse: true,
        maxPasswordHistory: 3,  // We store last 3 passwords by default
      }
    };

    // Generate initial recovery key and create bidirectional encryption
    const recoveryKeyDerived = deriveKeyFromRecoveryKey(recoveryKey, salt);
    const encryptedRecoveryKey = encryptData({ recoveryKey }, key);
    const encryptedMasterPassword = encryptData({ masterPassword }, recoveryKeyDerived);

    const encryptedData = encryptData(vaultData, key);
    const finalData = {
      ...encryptedData,
      salt: salt.toString('hex'),
      // Recovery metadata stored unencrypted in vault file
      recoveryMetadata: {
        recoveryKey: {
          encryptedRecoveryKey: encryptedRecoveryKey,
          encryptedMasterPassword: encryptedMasterPassword,
          createdAt: new Date().toISOString(),
          version: 1
        }
        // previousPassword will be added when password is first changed
      }
    };

    await fs.writeJson(vaultPath, finalData);
    return {
      success: true,
      recoveryKey: recoveryKey,
      recoveryKeyCreatedAt: vaultData.recoveryKey.createdAt
    };
  } catch (error) {
    console.error('Error creating vault:', error);
    return { success: false, error: error.message };
  }
});

// Verify vault password
ipcMain.handle('verify-vault-password', async (event, vaultName, password) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    const vaultFileData = await fs.readJson(vaultPath);

    const salt = Buffer.from(vaultFileData.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');

    // Extract only the encrypted part for decryption
    const encryptedData = {
      encrypted: vaultFileData.encrypted,
      authTag: vaultFileData.authTag,
      iv: vaultFileData.iv
    };

    decryptData(encryptedData, key); // This will throw if password is wrong
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Invalid password' };
  }
});

// Load vault data
ipcMain.handle('load-vault', async (event, vaultName, password) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    const vaultFileData = await fs.readJson(vaultPath);

    const salt = Buffer.from(vaultFileData.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');

    // Extract only the encrypted part for decryption
    const encryptedData = {
      encrypted: vaultFileData.encrypted,
      authTag: vaultFileData.authTag,
      iv: vaultFileData.iv
    };

    const parsedData = decryptData(encryptedData, key);
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

    // Load existing vault file to preserve recovery metadata
    let existingRecoveryMetadata = {};
    if (await fs.pathExists(vaultPath)) {
      try {
        const existingVaultFile = await fs.readJson(vaultPath);
        existingRecoveryMetadata = existingVaultFile.recoveryMetadata || {};
      } catch (error) {
        console.warn('Could not load existing recovery metadata, starting fresh');
      }
    }

    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');

    const encryptedData = encryptData(data, key);
    const finalData = {
      ...encryptedData,
      salt: salt.toString('hex'),
      recoveryMetadata: existingRecoveryMetadata
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
    const backupPath = path.join(vaultDir, `${vaultName}.vault.backup`);
    const tempPath = path.join(vaultDir, `${vaultName}.vault.tmp`);

    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    // Validate new password strength
    const passwordErrors = validatePasswordStrength(newPassword);
    if (passwordErrors.length > 0) {
      return { success: false, error: passwordErrors[0] };
    }

    // Step 1: Load and verify current password
    const originalEncryptedData = await fs.readJson(vaultPath);
    const currentSalt = Buffer.from(originalEncryptedData.salt, 'hex');
    const currentKey = crypto.pbkdf2Sync(currentPassword, currentSalt, 100000, 32, 'sha512');

    let vaultData;
    try {
      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: originalEncryptedData.encrypted,
        authTag: originalEncryptedData.authTag,
        iv: originalEncryptedData.iv
      };
      vaultData = decryptData(encryptedData, currentKey);
    } catch (error) {
      return { success: false, error: 'Invalid current password' };
    }

    // Step 2: Get existing recovery metadata from vault file
    const existingRecoveryMetadata = originalEncryptedData.recoveryMetadata || {};

    // Step 3: Validate new password against reuse policy
    if (vaultData.settings?.preventPasswordReuse) {
      // Check if new password is same as current password
      if (newPassword === currentPassword) {
        return { success: false, error: 'New password must be different from current password' };
      }

      // Check against password history
      const newPasswordHash = crypto.createHash('sha256').update(newPassword).digest('hex');

      // Check against stored password history in vault data
      if (vaultData.passwordHistory && vaultData.passwordHistory.length > 0) {
        const isReused = vaultData.passwordHistory.some(entry =>
          entry.passwordHash === newPasswordHash
        );
        if (isReused) {
          return { success: false, error: 'This password has been used before. Please choose a different password.' };
        }
      }

      // Also check against the single previous password in recovery metadata (for backward compatibility)
      if (existingRecoveryMetadata.previousPassword) {
        const previousPasswordHash = existingRecoveryMetadata.previousPassword.passwordHash;
        if (previousPasswordHash === newPasswordHash) {
          return { success: false, error: 'This password has been used before. Please choose a different password.' };
        }
      }
    }

    // Step 4: Create backup before making any changes
    await fs.copy(vaultPath, backupPath);

    // Step 5: Update recovery metadata
    const currentPasswordHash = crypto.createHash('sha256').update(currentPassword).digest('hex');

    // Encrypt the new password using the old password (using same salt)
    const oldKey = crypto.pbkdf2Sync(currentPassword, currentSalt, 100000, 32, 'sha512');
    const encryptedNewPassword = encryptData({ newPassword }, oldKey);

    // Update recovery metadata
    const updatedRecoveryMetadata = { ...existingRecoveryMetadata };

    // Update previous password data
    updatedRecoveryMetadata.previousPassword = {
      passwordHash: currentPasswordHash,
      encryptedNewPassword: encryptedNewPassword,
      salt: currentSalt.toString('hex'), // Store the salt used for encryption
      changedAt: new Date().toISOString()
    };

    // Update recovery key data if it exists
    if (existingRecoveryMetadata.recoveryKey) {
      try {
        // Decrypt recovery key with old password
        console.log('Attempting to decrypt existing recovery key data...');
        const decryptedRecoveryKeyData = decryptData(existingRecoveryMetadata.recoveryKey.encryptedRecoveryKey, currentKey);
        const recoveryKey = decryptedRecoveryKeyData.recoveryKey;

        // Re-encrypt recovery key with new password
        const newKey = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha512');
        const newEncryptedRecoveryKey = encryptData({ recoveryKey }, newKey);

        // Re-encrypt new password with recovery key
        const recoveryKeyDerived = deriveKeyFromRecoveryKey(recoveryKey, newSalt);
        const newEncryptedMasterPassword = encryptData({ newPassword }, recoveryKeyDerived);

        updatedRecoveryMetadata.recoveryKey = {
          ...existingRecoveryMetadata.recoveryKey,
          encryptedRecoveryKey: newEncryptedRecoveryKey,
          encryptedMasterPassword: newEncryptedMasterPassword
        };
      } catch (error) {
        console.warn('Could not update recovery key data during password change:', error);
        console.warn('This may be due to corrupted recovery data or format changes. Recovery key will need to be regenerated.');
        // Remove the corrupted recovery key data instead of keeping it
        delete updatedRecoveryMetadata.recoveryKey;
      }
    }

    // Step 6: Generate new salt and key for new password
    const newSalt = crypto.randomBytes(32);
    const newKey = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha512');

    // Step 7: Update vault data with password change info
    // Note: currentPasswordHash already calculated above for recovery metadata

    // Initialize password history if it doesn't exist
    if (!vaultData.passwordHistory) {
      vaultData.passwordHistory = [];
    }

    // Add current password to history
    vaultData.passwordHistory.unshift({
      changedAt: vaultData.lastPasswordChange || vaultData.created,
      passwordHash: currentPasswordHash
    });

    // Keep only the specified number of password history entries
    const maxHistory = Math.max(1, vaultData.settings?.maxPasswordHistory || 3);
    vaultData.passwordHistory = vaultData.passwordHistory.slice(0, maxHistory);

    // Update last password change date
    vaultData.lastPasswordChange = new Date().toISOString();

    // Step 8: Re-encrypt with new password
    const newEncryptedData = encryptData(vaultData, newKey);
    const finalData = {
      ...newEncryptedData,
      salt: newSalt.toString('hex'),
      recoveryMetadata: updatedRecoveryMetadata
    };

    // Step 9: Test that we can decrypt with new password before saving
    try {
      const testKey = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha512');
      const testEncryptedData = {
        encrypted: finalData.encrypted,
        authTag: finalData.authTag,
        iv: finalData.iv
      };
      decryptData(testEncryptedData, testKey);
    } catch (error) {
      // If we can't decrypt with new password, restore backup and fail
      await fs.copy(backupPath, vaultPath);
      await fs.remove(backupPath);
      return { success: false, error: 'Failed to encrypt vault with new password' };
    }

    // Step 11: Atomically write the new vault file
    await fs.writeJson(tempPath, finalData);

    // Verify the temp file can be read and decrypted
    try {
      const testData = await fs.readJson(tempPath);
      const testKey = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha512');
      const testEncryptedData = {
        encrypted: testData.encrypted,
        authTag: testData.authTag,
        iv: testData.iv
      };
      decryptData(testEncryptedData, testKey);
    } catch (error) {
      // Clean up temp file and restore backup
      await fs.remove(tempPath);
      await fs.copy(backupPath, vaultPath);
      await fs.remove(backupPath);
      return { success: false, error: 'Failed to verify new vault file' };
    }

    // Move temp file to final location (atomic operation on most filesystems)
    await fs.move(tempPath, vaultPath, { overwrite: true });

    // Clean up backup file
    await fs.remove(backupPath);

    return { success: true };
  } catch (error) {
    console.error('Error changing master password:', error);

    // Attempt to restore from backup if it exists
    try {
      if (await fs.pathExists(backupPath)) {
        await fs.copy(backupPath, vaultPath);
        await fs.remove(backupPath);
      }
    } catch (restoreError) {
      console.error('Failed to restore backup:', restoreError);
    }

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
    const vaultFileData = await fs.readJson(vaultPath);
    const salt = Buffer.from(vaultFileData.salt, 'hex');
    const key = crypto.pbkdf2Sync(vaultPassword, salt, 100000, 32, 'sha512');

    let vaultData;
    try {
      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv
      };
      vaultData = decryptData(encryptedData, key);
    } catch (error) {
      return { success: false, error: 'Invalid password' };
    }

    // Update settings with validation
    const validatedSettings = { ...newSettings };
    if (validatedSettings.maxPasswordHistory !== undefined) {
      validatedSettings.maxPasswordHistory = Math.max(1, validatedSettings.passwordChangeWarningDays);
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

// Restore vault from backup
ipcMain.handle('restore-vault-backup', async (event, vaultName) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    const backupPath = path.join(vaultDir, `${vaultName}.vault.backup`);

    if (!(await fs.pathExists(backupPath))) {
      return { success: false, error: 'No backup found for this vault' };
    }

    // Verify backup can be read
    try {
      await fs.readJson(backupPath);
    } catch (error) {
      return { success: false, error: 'Backup file is corrupted' };
    }

    // Restore backup
    await fs.copy(backupPath, vaultPath);
    await fs.remove(backupPath);

    return { success: true };
  } catch (error) {
    console.error('Error restoring vault backup:', error);
    return { success: false, error: 'Failed to restore vault backup' };
  }
});

// Generate recovery key for vault
ipcMain.handle('generate-recovery-key', async (event, vaultName, masterPassword) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);

    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    // Load and verify master password
    const vaultFileData = await fs.readJson(vaultPath);
    const salt = Buffer.from(vaultFileData.salt, 'hex');
    const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha512');

    try {
      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv
      };
      decryptData(encryptedData, key);
    } catch (error) {
      return { success: false, error: 'Invalid master password' };
    }

    // Generate new recovery key
    const recoveryKey = generateRecoveryKey();

    // Create bidirectional encryption
    const recoveryKeyDerived = deriveKeyFromRecoveryKey(recoveryKey, salt);
    const encryptedRecoveryKey = encryptData({ recoveryKey }, key);
    const encryptedMasterPassword = encryptData({ masterPassword }, recoveryKeyDerived);

    // Update recovery metadata in vault file (start fresh to avoid corruption)
    const updatedRecoveryMetadata = {
      // Preserve previous password data if it exists and is valid
      ...(vaultFileData.recoveryMetadata?.previousPassword ? { previousPassword: vaultFileData.recoveryMetadata.previousPassword } : {}),
      recoveryKey: {
        encryptedRecoveryKey: encryptedRecoveryKey,
        encryptedMasterPassword: encryptedMasterPassword,
        createdAt: new Date().toISOString(),
        version: 1
      }
    };

    // Save updated vault file with new recovery metadata
    const updatedVaultFile = {
      ...vaultFileData,
      recoveryMetadata: updatedRecoveryMetadata
    };

    await fs.writeJson(vaultPath, updatedVaultFile);

    console.log('Recovery key generated successfully for vault:', vaultName);
    return {
      success: true,
      recoveryKey: recoveryKey,
      createdAt: updatedRecoveryMetadata.recoveryKey.createdAt
    };
  } catch (error) {
    console.error('Error generating recovery key:', error);
    return { success: false, error: 'Failed to generate recovery key' };
  }
});

// Verify vault with recovery key
ipcMain.handle('verify-vault-recovery-key', async (event, vaultName, recoveryKey) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);

    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    if (!validateRecoveryKeyFormat(recoveryKey)) {
      return { success: false, error: 'Invalid recovery key format' };
    }

    // Load vault file and check for recovery metadata
    const vaultFileData = await fs.readJson(vaultPath);

    if (!vaultFileData.recoveryMetadata?.recoveryKey) {
      return { success: false, error: 'No recovery key found for this vault' };
    }

    // Try to decrypt master password with recovery key
    try {
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const recoveryKeyDerived = deriveKeyFromRecoveryKey(recoveryKey, salt);
      console.log('Attempting to verify recovery key...');
      const decryptedData = decryptData(vaultFileData.recoveryMetadata.recoveryKey.encryptedMasterPassword, recoveryKeyDerived);

      // If we can decrypt it, the recovery key is valid
      console.log('Recovery key verification successful');
      return { success: true };
    } catch (error) {
      console.error('Recovery key verification failed:', error.message);
      return { success: false, error: 'Invalid recovery key' };
    }
  } catch (error) {
    console.error('Error verifying recovery key:', error);
    return { success: false, error: 'Failed to verify recovery key' };
  }
});

// Recover vault with older password
ipcMain.handle('recover-vault-with-old-password', async (event, vaultName, oldPassword) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);

    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    // Load vault file
    const vaultFileData = await fs.readJson(vaultPath);
    const currentSalt = Buffer.from(vaultFileData.salt, 'hex');
    const currentKey = crypto.pbkdf2Sync(oldPassword, currentSalt, 100000, 32, 'sha512');

    // First, try if the old password is actually the current password
    try {
      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv
      };
      decryptData(encryptedData, currentKey);
      return { success: true, message: 'This is actually the current password' };
    } catch (error) {
      // Not the current password, try recovery
    }

    // Check if we have previous password recovery data
    if (!vaultFileData.recoveryMetadata?.previousPassword) {
      return { success: false, error: 'No recovery data available for this vault. You need to change your password at least once to enable previous password recovery.' };
    }

    const previousPasswordData = vaultFileData.recoveryMetadata.previousPassword;

    // Verify the old password matches the stored hash
    const oldPasswordHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
    if (previousPasswordData.passwordHash !== oldPasswordHash) {
      return { success: false, error: 'This password is not in the recovery history. Only the previous password can be used for recovery.' };
    }

    // Decrypt the current password using the old password
    try {
      // Use the salt that was stored when the recovery data was encrypted
      const recoverySalt = previousPasswordData.salt ?
        Buffer.from(previousPasswordData.salt, 'hex') :
        currentSalt; // Fallback for older vaults without stored salt

      const oldKey = crypto.pbkdf2Sync(oldPassword, recoverySalt, 100000, 32, 'sha512');
      const decryptedData = decryptData(previousPasswordData.encryptedNewPassword, oldKey);
      const currentPassword = decryptedData.newPassword;

      // Verify the recovered password works with the current vault
      const currentVaultKey = crypto.pbkdf2Sync(currentPassword, currentSalt, 100000, 32, 'sha512');
      const verifyEncryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv
      };
      decryptData(verifyEncryptedData, currentVaultKey);

      return {
        success: true,
        message: 'Vault recovered with previous password',
        currentPassword: currentPassword
      };
    } catch (error) {
      return { success: false, error: 'Failed to recover current password from old password' };
    }
  } catch (error) {
    console.error('Error recovering vault with old password:', error);
    return { success: false, error: 'Failed to recover vault' };
  }
});

// Load vault with recovery key
ipcMain.handle('load-vault-with-recovery-key', async (event, vaultName, recoveryKey) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);

    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    if (!validateRecoveryKeyFormat(recoveryKey)) {
      return { success: false, error: 'Invalid recovery key format' };
    }

    // Load vault file
    const vaultFileData = await fs.readJson(vaultPath);

    if (!vaultFileData.recoveryMetadata?.recoveryKey) {
      return { success: false, error: 'No recovery key found for this vault' };
    }

    // Decrypt master password using recovery key
    try {
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const recoveryKeyDerived = deriveKeyFromRecoveryKey(recoveryKey, salt);
      const decryptedPasswordData = decryptData(vaultFileData.recoveryMetadata.recoveryKey.encryptedMasterPassword, recoveryKeyDerived);
      const masterPassword = decryptedPasswordData.masterPassword;

      // Use recovered master password to decrypt vault
      const masterKey = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha512');
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv
      };
      const vaultData = decryptData(encryptedData, masterKey);

      return { success: true, data: vaultData, password : masterPassword };
    } catch (error) {
      return { success: false, error: 'Invalid recovery key' };
    }
  } catch (error) {
    console.error('Error loading vault with recovery key:', error);
    return { success: false, error: 'Failed to load vault with recovery key' };
  }
});

// Check if vault has backup
ipcMain.handle('has-vault-backup', async (event, vaultName) => {
  try {
    const backupPath = path.join(vaultDir, `${vaultName}.vault.backup`);
    const hasBackup = await fs.pathExists(backupPath);
    return { success: true, hasBackup };
  } catch (error) {
    console.error('Error checking vault backup:', error);
    return { success: false, hasBackup: false };
  }
});

// Export vault to file
ipcMain.handle('export-vault', async (event, vaultName, password, exportPath) => {
  try {
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);

    // Verify vault exists and password is correct
    if (!(await fs.pathExists(vaultPath))) {
      return { success: false, error: 'Vault not found' };
    }

    const vaultFileData = await fs.readJson(vaultPath);
    const salt = Buffer.from(vaultFileData.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');

    try {
      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv
      };
      const decryptedData = decryptData(encryptedData, key);

      // Create export data with metadata
      const exportData = {
        exportVersion: '1.0',
        exportedAt: new Date().toISOString(),
        vaultName: vaultName,
        originalVaultData: vaultFileData, // Keep original encrypted format
        metadata: {
          version: decryptedData.version,
          created: decryptedData.created,
          entryCount: decryptedData.entries?.length || 0,
          hasSettings: !!decryptedData.settings
        }
      };

      await fs.writeJson(exportPath, exportData, { spaces: 2 });
      return { success: true };
    } catch (decryptError) {
      return { success: false, error: 'Invalid password' };
    }
  } catch (error) {
    console.error('Error exporting vault:', error);
    return { success: false, error: 'Failed to export vault' };
  }
});

// Import vault from file
ipcMain.handle('import-vault', async (event, importPath, newVaultName, password) => {
  try {
    // Check if target vault already exists
    const targetVaultPath = path.join(vaultDir, `${newVaultName}.vault`);
    if (await fs.pathExists(targetVaultPath)) {
      return { success: false, error: 'Vault with this name already exists' };
    }

    // Read and validate import file
    if (!(await fs.pathExists(importPath))) {
      return { success: false, error: 'Import file not found' };
    }

    const importData = await fs.readJson(importPath);

    // Validate import file structure
    if (!importData.exportVersion || !importData.originalVaultData) {
      return { success: false, error: 'Invalid import file format' };
    }

    // Verify we can decrypt the original vault data
    const originalVaultData = importData.originalVaultData;
    const originalSalt = Buffer.from(originalVaultData.salt, 'hex');

    // Try to decrypt with the original password to validate the import file
    try {
      const originalKey = crypto.pbkdf2Sync(password, originalSalt, 100000, 32, 'sha512');

      // Extract only the encrypted part for decryption
      const originalEncryptedData = {
        encrypted: originalVaultData.encrypted,
        authTag: originalVaultData.authTag,
        iv: originalVaultData.iv
      };
      const decryptedData = decryptData(originalEncryptedData, originalKey);

      // Re-encrypt with new salt for the imported vault
      const newSalt = crypto.randomBytes(32);
      const newKey = crypto.pbkdf2Sync(password, newSalt, 100000, 32, 'sha512');

      const newEncryptedData = encryptData(decryptedData, newKey);
      const finalData = {
        ...newEncryptedData,
        salt: newSalt.toString('hex'),
        // Imported vaults start without recovery metadata (will be created when needed)
        recoveryMetadata: {}
      };

      await fs.writeJson(targetVaultPath, finalData);
      return {
        success: true,
        metadata: importData.metadata,
        importedAt: new Date().toISOString()
      };
    } catch (decryptError) {
      return { success: false, error: 'Invalid password for import file' };
    }
  } catch (error) {
    console.error('Error importing vault:', error);
    return { success: false, error: 'Failed to import vault' };
  }
});

// Get vault storage directory path
ipcMain.handle('get-vault-directory', async () => {
  try {
    return { success: true, path: vaultDir };
  } catch (error) {
    console.error('Error getting vault directory:', error);
    return { success: false, error: 'Failed to get vault directory' };
  }
});

// Passkey management functions
function base64ToArrayBuffer(base64) {
  const binary = Buffer.from(base64, 'base64');
  return new Uint8Array(binary);
}

function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

// Store passkey data for a vault
ipcMain.handle('store-passkey-data', async (event, vaultName, password, credentialData) => {
  try {
    console.log('Storing passkey data for vault:', vaultName);
    
    // Verify the password first
    const vaultPath = path.join(vaultDir, `${vaultName}.vault`);
    const vaultFileData = await fs.readJson(vaultPath);
    const salt = Buffer.from(vaultFileData.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');

    // Verify password is correct
    const encryptedData = {
      encrypted: vaultFileData.encrypted,
      authTag: vaultFileData.authTag,
      iv: vaultFileData.iv
    };
    decryptData(encryptedData, key);

    // Encrypt passkey data with the vault password
    const encryptedPasskeyData = encryptData(credentialData, key);
    
    // Also encrypt the password itself for recovery
    const encryptedPassword = encryptData({ password }, key);
    
    // Store encrypted passkey data
    const passkeyPath = path.join(passkeyDir, `${vaultName}.passkey`);
    const passkeyFileData = {
      vaultName,
      credential: encryptedPasskeyData,
      encryptedPassword: encryptedPassword,
      salt: salt.toString('hex'),
      createdAt: new Date().toISOString(),
      version: '1.0'
    };

    await fs.writeJson(passkeyPath, passkeyFileData);
    
    console.log('Passkey data stored successfully');
    return { success: true };
  } catch (error) {
    console.error('Error storing passkey data:', error);
    return { success: false, error: 'Failed to store passkey data' };
  }
});

// Get passkey data for a vault
ipcMain.handle('get-passkey-data', async (event, vaultName) => {
  try {
    const passkeyPath = path.join(passkeyDir, `${vaultName}.passkey`);
    
    if (!(await fs.pathExists(passkeyPath))) {
      return { success: true, data: null };
    }

    const passkeyFileData = await fs.readJson(passkeyPath);
    
    // Return the encrypted data - decryption should happen in the renderer process
    // when the user provides the vault password
    return { 
      success: true, 
      data: {
        hasPasskey: true,
        createdAt: passkeyFileData.createdAt,
        version: passkeyFileData.version
      }
    };
  } catch (error) {
    console.error('Error getting passkey data:', error);
    return { success: false, error: 'Failed to get passkey data' };
  }
});

// Verify passkey assertion and recover password
ipcMain.handle('verify-passkey-assertion', async (event, vaultName, assertion) => {
  try {
    console.log('Verifying passkey assertion for vault:', vaultName);
    
    // Get the stored passkey data
    const passkeyPath = path.join(passkeyDir, `${vaultName}.passkey`);
    if (!(await fs.pathExists(passkeyPath))) {
      return { success: false, error: 'No passkey data found for this vault' };
    }
    
    const passkeyData = await fs.readJson(passkeyPath);
    
    if (!passkeyData || !passkeyData.credential) {
      return { success: false, error: 'Invalid passkey data' };
    }

    // In a real implementation, you would:
    // 1. Verify the assertion signature using the stored public key
    // 2. Verify the challenge matches what was sent
    // 3. Verify the origin and other security parameters
    // 4. Decrypt the stored password using the verified assertion
    
    // For now, we'll implement a basic verification that checks the assertion structure
    if (!assertion || !assertion.response || !assertion.response.clientDataJSON) {
      return { success: false, error: 'Invalid assertion data' };
    }

    // Decode the client data to verify the challenge
    const clientDataJSON = base64ToArrayBuffer(assertion.response.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    
    console.log('Client data:', {
      type: clientData.type,
      challenge: clientData.challenge,
      origin: clientData.origin
    });

    // Verify this is an assertion (not a registration)
    if (clientData.type !== 'webauthn.get') {
      return { success: false, error: 'Invalid assertion type' };
    }

    // In a real implementation, you would verify the challenge matches
    // For now, we'll assume it's valid and return the stored password
    
    // Get the stored encrypted password
    const encryptedPasswordData = passkeyData.encryptedPassword;
    if (!encryptedPasswordData) {
      return { success: false, error: 'No stored password found' };
    }

    // In a real implementation, you would decrypt the password using the verified assertion
    // For now, we'll decrypt it using the vault key (this should be improved in production)
    try {
      const salt = Buffer.from(passkeyData.salt, 'hex');
      // We need the vault password to decrypt, but we don't have it here
      // In a real implementation, you would use the verified assertion to decrypt
      // For now, we'll return a placeholder
      return {
        success: true,
        password: '[PASSWORD_RECOVERED_VIA_PASSKEY]', // This should be the actual decrypted password
        message: 'Passkey verification successful'
      };
    } catch (decryptError) {
      console.error('Error decrypting password:', decryptError);
      return { success: false, error: 'Failed to decrypt stored password' };
    }
  } catch (error) {
    console.error('Error verifying passkey assertion:', error);
    return { success: false, error: 'Passkey verification failed: ' + error.message };
  }
});

// Remove passkey data for a vault
ipcMain.handle('remove-passkey-data', async (event, vaultName) => {
  try {
    const passkeyPath = path.join(passkeyDir, `${vaultName}.passkey`);
    
    if (await fs.pathExists(passkeyPath)) {
      await fs.remove(passkeyPath);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error removing passkey data:', error);
    return { success: false, error: 'Failed to remove passkey data' };
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
      entries: [],
      isDefault: true,
      passwordHistory: [],
      settings: {
        enforcePasswordChange: false,
        passwordChangeWarningDays: 90,
        preventPasswordReuse: true,
        maxPasswordHistory: 3
      }
    };

    // Generate initial recovery key for default vault
    const recoveryKey = generateRecoveryKey();
    const recoveryKeyDerived = deriveKeyFromRecoveryKey(recoveryKey, salt);
    const encryptedRecoveryKey = encryptData({ recoveryKey }, key);
    const encryptedMasterPassword = encryptData({ masterPassword: defaultPassword }, recoveryKeyDerived);

    const encryptedData = encryptData(vaultData, key);
    const finalData = {
      ...encryptedData,
      salt: salt.toString('hex'),
      // Recovery metadata stored unencrypted in vault file
      recoveryMetadata: {
        recoveryKey: {
          encryptedRecoveryKey: encryptedRecoveryKey,
          encryptedMasterPassword: encryptedMasterPassword,
          createdAt: new Date().toISOString(),
          version: 1
        }
        // previousPassword will be added when password is first changed
      }
    };

    await fs.writeJson(defaultVaultPath, finalData);
    console.log('Default vault created with recovery key:', recoveryKey);
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
        {
          label: 'Configuration',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('menu-configuration');
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


function createWindow() {

  // [REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS].map(
  //   extension_id => {
  //     installExtension(extension_id, { loadExtensionOptions: { allowFileAccess: true } })
  //     .then(extension => console.log(`Added Extensions:  ${extension.name}`))
  //     .catch((err) => console.log('An error occurred: ', err));
  //   }
  // )

  // session.extensions.getAllExtensions().map((e) => {
  //   session.extension.loadExtension(e.path)
  // });


  // Create the browser window with security settings
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      allowRunningInsecureContent: false,
      // Keep this true for WebAuthn to work
      webSecurity: true,
      // Enable experimental web platform features if needed
      experimentalFeatures: true
    },
    icon: path.join(__dirname, 'public/icon.png'), // Add icon later
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


app.commandLine.appendSwitch('enable-web-auth-api');
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
// For development only
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('reduce-security-for-testing');
app.commandLine.appendSwitch('unsafety-treat-insecure-origin-as-secure', 'http://localhost');


app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('[permission] permission request for: ', permission);
    // Allow WebAuthn-related permissions
    if (permission === 'publickey-credentials-get' || 
        permission === 'publickey-credentials-create') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Create main window
  createWindow();

  // Create menu
  createMenu();
});

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

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  
  // Prevent having error
  event.preventDefault()
  // and continue
  callback(true)

})