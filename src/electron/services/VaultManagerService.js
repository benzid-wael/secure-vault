import { IVaultManager } from '../interfaces/IVaultManager.js';
import { validatePasswordStrength } from '../../utils/passwordValidation.js';

/**
 * Concrete implementation of vault manager
 * Orchestrates encryption, storage, and recovery services
 * Follows Single Responsibility Principle - only handles vault business logic
 */
export class VaultManagerService extends IVaultManager {
  constructor(encryptionService, storageService, recoveryService) {
    super();
    this.encryptionService = encryptionService;
    this.storageService = storageService;
    this.recoveryService = recoveryService;
  }

  /**
   * Initialize the vault manager
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.storageService.initialize();
    await this.ensureDefaultVault();
  }

  /**
   * Get list of available vaults
   * @returns {Promise<string[]>} Array of vault names
   */
  async getVaults() {
    try {
      const vaults = await this.storageService.getVaults();

      // Ensure default vault exists
      if (!vaults.includes('default')) {
        await this.createDefaultVault();
        vaults.unshift('default');
      }

      return vaults;
    } catch (error) {
      console.error('Error getting vaults:', error);
      return ['default'];
    }
  }

  /**
   * Create a new vault
   * @param {string} vaultName - Name of the vault
   * @param {string} masterPassword - Master password
   * @returns {Promise<Object>} Creation result with recovery key
   */
  async createVault(vaultName, masterPassword) {
    try {
      // Check if vault already exists
      if (await this.storageService.vaultExists(vaultName)) {
        throw new Error('Vault already exists');
      }

      // Validate password strength
      const passwordErrors = validatePasswordStrength(masterPassword);
      if (passwordErrors.length > 0) {
        throw new Error(passwordErrors[0]);
      }

      // Create encrypted vault structure
      const salt = this.encryptionService.generateSalt();
      const key = this.encryptionService.deriveKey(masterPassword, salt);

      // Generate initial recovery key
      const recoveryKey = this.recoveryService.generateRecoveryKey();

      const vaultData = {
        version: '1.0',
        created: new Date().toISOString(),
        lastPasswordChange: new Date().toISOString(),
        entries: [],
        passwordHistory: [],
        settings: {
          enforcePasswordChange: false,
          passwordChangeWarningDays: 90,
          preventPasswordReuse: true,
          maxPasswordHistory: 3,
        },
      };

      // Create bidirectional encryption
      const recoveryMetadata =
        this.recoveryService.createBidirectionalEncryption(
          masterPassword,
          recoveryKey,
          salt
        );

      const encryptedData = this.encryptionService.encryptData(vaultData, key);
      const finalData = {
        ...encryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: {
          recoveryKey: recoveryMetadata,
        },
      };

      await this.storageService.writeVault(vaultName, finalData);

      return {
        success: true,
        recoveryKey: recoveryKey,
        recoveryKeyCreatedAt: recoveryMetadata.createdAt,
      };
    } catch (error) {
      console.error('Error creating vault:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify vault password
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Password to verify
   * @returns {Promise<boolean>} True if password is correct
   */
  async verifyVaultPassword(vaultName, password) {
    try {
      const vaultFileData = await this.storageService.readVault(vaultName);
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = this.encryptionService.deriveKey(password, salt);

      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv,
      };

      this.encryptionService.decryptData(encryptedData, key);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load vault data
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @returns {Promise<Object>} Decrypted vault data
   */
  async loadVault(vaultName, password) {
    try {
      const vaultFileData = await this.storageService.readVault(vaultName);
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = this.encryptionService.deriveKey(password, salt);

      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv,
      };

      const parsedData = this.encryptionService.decryptData(encryptedData, key);
      return { success: true, data: parsedData };
    } catch (error) {
      console.error('Error loading vault:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save vault data
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @param {Object} data - Data to save
   * @returns {Promise<void>}
   */
  async saveVault(vaultName, password, data) {
    try {
      // Load existing vault file to preserve recovery metadata
      let existingRecoveryMetadata = {};
      if (await this.storageService.vaultExists(vaultName)) {
        try {
          const existingVaultFile =
            await this.storageService.readVault(vaultName);
          existingRecoveryMetadata = existingVaultFile.recoveryMetadata || {};
        } catch (error) {
          console.warn(
            'Could not load existing recovery metadata, starting fresh'
          );
        }
      }

      const salt = this.encryptionService.generateSalt();
      const key = this.encryptionService.deriveKey(password, salt);

      const encryptedData = this.encryptionService.encryptData(data, key);
      const finalData = {
        ...encryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: existingRecoveryMetadata,
      };

      await this.storageService.writeVault(vaultName, finalData);
      return { success: true };
    } catch (error) {
      console.error('Error saving vault:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete vault
   * @param {string} vaultName - Name of the vault
   * @param {string} confirmationPassword - Password for confirmation
   * @returns {Promise<Object>} Deletion result
   */
  async deleteVault(vaultName, confirmationPassword) {
    try {
      if (!(await this.storageService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Prevent deletion of default vault without explicit confirmation
      if (vaultName === 'default' && !confirmationPassword) {
        return {
          success: false,
          error: 'Cannot delete default vault without password confirmation',
        };
      }

      // Verify password before deletion for security
      if (confirmationPassword) {
        const isValidPassword = await this.verifyVaultPassword(
          vaultName,
          confirmationPassword
        );
        if (!isValidPassword) {
          return {
            success: false,
            error: 'Invalid password. Vault not deleted.',
          };
        }
      }

      const backupFile = await this.storageService.deleteVault(vaultName);

      return {
        success: true,
        message: `Vault "${vaultName}" has been deleted. A backup was created.`,
        backupFile: backupFile,
      };
    } catch (error) {
      console.error('Error deleting vault:', error);
      return { success: false, error: 'Failed to delete vault' };
    }
  }

  /**
   * Ensure default vault exists
   * @returns {Promise<void>}
   */
  async ensureDefaultVault() {
    if (!(await this.storageService.vaultExists('default'))) {
      await this.createDefaultVault();
    }
  }

  /**
   * Create default vault
   * @returns {Promise<void>}
   */
  async createDefaultVault() {
    const defaultPassword = 'changeme123'; // User will be prompted to change this
    const result = await this.createVault('default', defaultPassword);

    if (result.success) {
      console.log(
        'Default vault created with recovery key:',
        result.recoveryKey
      );
    }
  }

  /**
   * Change master password
   * @param {string} vaultName - Name of the vault
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<Object>} Change result
   */
  async changeMasterPassword(vaultName, currentPassword, newPassword) {
    try {
      if (!(await this.storageService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Validate new password strength
      const passwordErrors = validatePasswordStrength(newPassword);
      if (passwordErrors.length > 0) {
        return { success: false, error: passwordErrors[0] };
      }

      // Load and verify current password
      const originalEncryptedData =
        await this.storageService.readVault(vaultName);
      const currentSalt = Buffer.from(originalEncryptedData.salt, 'hex');
      const currentKey = this.encryptionService.deriveKey(
        currentPassword,
        currentSalt
      );

      let vaultData;
      try {
        const encryptedData = {
          encrypted: originalEncryptedData.encrypted,
          authTag: originalEncryptedData.authTag,
          iv: originalEncryptedData.iv,
        };
        vaultData = this.encryptionService.decryptData(
          encryptedData,
          currentKey
        );
      } catch (error) {
        return { success: false, error: 'Invalid current password' };
      }

      // Get existing recovery metadata from vault file
      const existingRecoveryMetadata =
        originalEncryptedData.recoveryMetadata || {};

      // Validate new password against reuse policy
      if (vaultData.settings?.preventPasswordReuse) {
        if (newPassword === currentPassword) {
          return {
            success: false,
            error: 'New password must be different from current password',
          };
        }

        // Check against password history
        const newPasswordHash = this.encryptionService.hash(newPassword);

        if (vaultData.passwordHistory && vaultData.passwordHistory.length > 0) {
          const isReused = vaultData.passwordHistory.some(
            (entry) => entry.passwordHash === newPasswordHash
          );
          if (isReused) {
            return {
              success: false,
              error:
                'This password has been used before. Please choose a different password.',
            };
          }
        }

        // Also check against the single previous password in recovery metadata
        if (existingRecoveryMetadata.previousPassword) {
          const previousPasswordHash =
            existingRecoveryMetadata.previousPassword.passwordHash;
          if (previousPasswordHash === newPasswordHash) {
            return {
              success: false,
              error:
                'This password has been used before. Please choose a different password.',
            };
          }
        }
      }

      // Create backup before making any changes
      await this.storageService.createBackup(vaultName);

      // Update recovery metadata
      const currentPasswordHash = this.encryptionService.hash(currentPassword);

      // Encrypt the new password using the old password (using same salt)
      const oldKey = this.encryptionService.deriveKey(
        currentPassword,
        currentSalt
      );
      const encryptedNewPassword = this.encryptionService.encryptData(
        { newPassword },
        oldKey
      );

      // Update recovery metadata
      const updatedRecoveryMetadata = { ...existingRecoveryMetadata };

      // Update previous password data
      updatedRecoveryMetadata.previousPassword = {
        passwordHash: currentPasswordHash,
        encryptedNewPassword: encryptedNewPassword,
        salt: currentSalt.toString('hex'),
        changedAt: new Date().toISOString(),
      };

      // Update recovery key data if it exists
      if (existingRecoveryMetadata.recoveryKey) {
        try {
          const newSalt = this.encryptionService.generateSalt();
          updatedRecoveryMetadata.recoveryKey =
            this.recoveryService.updateRecoveryMetadataForPasswordChange(
              existingRecoveryMetadata,
              newPassword,
              newSalt,
              currentPassword,
              currentSalt
            ).recoveryKey;
        } catch (error) {
          console.warn(
            'Could not update recovery key data during password change:',
            error
          );
          delete updatedRecoveryMetadata.recoveryKey;
        }
      }

      // Generate new salt and key for new password
      const newSalt = this.encryptionService.generateSalt();
      const newKey = this.encryptionService.deriveKey(newPassword, newSalt);

      // Update vault data with password change info
      if (!vaultData.passwordHistory) {
        vaultData.passwordHistory = [];
      }

      // Add current password to history
      vaultData.passwordHistory.unshift({
        changedAt: vaultData.lastPasswordChange || vaultData.created,
        passwordHash: currentPasswordHash,
      });

      // Keep only the specified number of password history entries
      const maxHistory = Math.max(
        1,
        vaultData.settings?.maxPasswordHistory || 3
      );
      vaultData.passwordHistory = vaultData.passwordHistory.slice(
        0,
        maxHistory
      );

      // Update last password change date
      vaultData.lastPasswordChange = new Date().toISOString();

      // Re-encrypt with new password
      const newEncryptedData = this.encryptionService.encryptData(
        vaultData,
        newKey
      );
      const finalData = {
        ...newEncryptedData,
        salt: newSalt.toString('hex'),
        recoveryMetadata: updatedRecoveryMetadata,
      };

      // Test that we can decrypt with new password before saving
      try {
        const testKey = this.encryptionService.deriveKey(newPassword, newSalt);
        const testEncryptedData = {
          encrypted: finalData.encrypted,
          authTag: finalData.authTag,
          iv: finalData.iv,
        };
        this.encryptionService.decryptData(testEncryptedData, testKey);
      } catch (error) {
        // If we can't decrypt with new password, restore backup and fail
        await this.storageService.restoreBackup(vaultName);
        return {
          success: false,
          error: 'Failed to encrypt vault with new password',
        };
      }

      // Save the new vault file
      await this.storageService.writeVault(vaultName, finalData);

      return { success: true };
    } catch (error) {
      console.error('Error changing master password:', error);

      // Attempt to restore from backup if it exists
      try {
        if (await this.storageService.hasBackup(vaultName)) {
          await this.storageService.restoreBackup(vaultName);
        }
      } catch (restoreError) {
        console.error('Failed to restore backup:', restoreError);
      }

      return { success: false, error: 'Failed to change master password' };
    }
  }

  /**
   * Update vault settings
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @param {Object} settings - New settings
   * @returns {Promise<Object>} Update result
   */
  async updateVaultSettings(vaultName, password, settings) {
    try {
      if (!(await this.storageService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Load and decrypt vault
      const vaultFileData = await this.storageService.readVault(vaultName);
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = this.encryptionService.deriveKey(password, salt);

      let vaultData;
      try {
        const encryptedData = {
          encrypted: vaultFileData.encrypted,
          authTag: vaultFileData.authTag,
          iv: vaultFileData.iv,
        };
        vaultData = this.encryptionService.decryptData(encryptedData, key);
      } catch (error) {
        return { success: false, error: 'Invalid password' };
      }

      // Update settings with validation
      const validatedSettings = { ...settings };
      if (validatedSettings.maxPasswordHistory !== undefined) {
        validatedSettings.maxPasswordHistory = Math.max(
          1,
          validatedSettings.maxPasswordHistory
        );
      }
      if (validatedSettings.passwordChangeWarningDays !== undefined) {
        validatedSettings.passwordChangeWarningDays = Math.max(
          1,
          validatedSettings.passwordChangeWarningDays
        );
      }

      vaultData.settings = { ...vaultData.settings, ...validatedSettings };

      // Re-encrypt and save
      const newEncryptedData = this.encryptionService.encryptData(
        vaultData,
        key
      );
      const finalData = {
        ...newEncryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: vaultFileData.recoveryMetadata || {},
      };

      await this.storageService.writeVault(vaultName, finalData);
      return { success: true };
    } catch (error) {
      console.error('Error updating vault settings:', error);
      return { success: false, error: 'Failed to update settings' };
    }
  }

  /**
   * Generate recovery key for vault
   * @param {string} vaultName - Name of the vault
   * @param {string} masterPassword - Master password
   * @returns {Promise<Object>} Recovery key generation result
   */
  async generateRecoveryKey(vaultName, masterPassword) {
    try {
      if (!(await this.storageService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Load and verify master password
      const vaultFileData = await this.storageService.readVault(vaultName);
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = this.encryptionService.deriveKey(masterPassword, salt);

      try {
        const encryptedData = {
          encrypted: vaultFileData.encrypted,
          authTag: vaultFileData.authTag,
          iv: vaultFileData.iv,
        };
        this.encryptionService.decryptData(encryptedData, key);
      } catch (error) {
        return { success: false, error: 'Invalid master password' };
      }

      // Generate new recovery key
      const recoveryKey = this.recoveryService.generateRecoveryKey();

      // Create bidirectional encryption
      const recoveryMetadata =
        this.recoveryService.createBidirectionalEncryption(
          masterPassword,
          recoveryKey,
          salt
        );

      // Update recovery metadata in vault file
      const updatedRecoveryMetadata = {
        ...(vaultFileData.recoveryMetadata?.previousPassword
          ? {
              previousPassword: vaultFileData.recoveryMetadata.previousPassword,
            }
          : {}),
        recoveryKey: recoveryMetadata,
      };

      // Save updated vault file with new recovery metadata
      const updatedVaultFile = {
        ...vaultFileData,
        recoveryMetadata: updatedRecoveryMetadata,
      };

      await this.storageService.writeVault(vaultName, updatedVaultFile);

      console.log('Recovery key generated successfully for vault:', vaultName);
      return {
        success: true,
        recoveryKey: recoveryKey,
        createdAt: recoveryMetadata.createdAt,
      };
    } catch (error) {
      console.error('Error generating recovery key:', error);
      return { success: false, error: 'Failed to generate recovery key' };
    }
  }

  /**
   * Verify recovery key
   * @param {string} vaultName - Name of the vault
   * @param {string} recoveryKey - Recovery key to verify
   * @returns {Promise<boolean>} True if recovery key is valid
   */
  async verifyRecoveryKey(vaultName, recoveryKey) {
    try {
      if (!(await this.storageService.vaultExists(vaultName))) {
        return false;
      }

      if (!this.recoveryService.validateRecoveryKeyFormat(recoveryKey)) {
        return false;
      }

      // Load vault file and check for recovery metadata
      const vaultFileData = await this.storageService.readVault(vaultName);

      if (!vaultFileData.recoveryMetadata?.recoveryKey) {
        return false;
      }

      const salt = Buffer.from(vaultFileData.salt, 'hex');
      return this.recoveryService.verifyRecoveryKey(
        recoveryKey,
        vaultFileData.recoveryMetadata,
        salt
      );
    } catch (error) {
      console.error('Error verifying recovery key:', error);
      return false;
    }
  }

  /**
   * Load vault with recovery key
   * @param {string} vaultName - Name of the vault
   * @param {string} recoveryKey - Recovery key
   * @returns {Promise<Object>} Vault data and recovered password
   */
  async loadVaultWithRecoveryKey(vaultName, recoveryKey) {
    try {
      if (!(await this.storageService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      if (!this.recoveryService.validateRecoveryKeyFormat(recoveryKey)) {
        return { success: false, error: 'Invalid recovery key format' };
      }

      // Load vault file
      const vaultFileData = await this.storageService.readVault(vaultName);

      if (!vaultFileData.recoveryMetadata?.recoveryKey) {
        return {
          success: false,
          error: 'No recovery key found for this vault',
        };
      }

      // Recover master password using recovery key
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const masterPassword = this.recoveryService.recoverMasterPassword(
        recoveryKey,
        vaultFileData.recoveryMetadata,
        salt
      );

      // Use recovered master password to decrypt vault
      const masterKey = this.encryptionService.deriveKey(masterPassword, salt);
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv,
      };
      const vaultData = this.encryptionService.decryptData(
        encryptedData,
        masterKey
      );

      return { success: true, data: vaultData, password: masterPassword };
    } catch (error) {
      console.error('Error loading vault with recovery key:', error);
      return {
        success: false,
        error: 'Failed to load vault with recovery key',
      };
    }
  }

  /**
   * Recover vault with old password
   * @param {string} vaultName - Name of the vault
   * @param {string} oldPassword - Old password
   * @returns {Promise<Object>} Recovery result with current password
   */
  async recoverVaultWithOldPassword(vaultName, oldPassword) {
    try {
      if (!(await this.storageService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Load vault file
      const vaultFileData = await this.storageService.readVault(vaultName);
      const currentSalt = Buffer.from(vaultFileData.salt, 'hex');
      const currentKey = this.encryptionService.deriveKey(
        oldPassword,
        currentSalt
      );

      // First, try if the old password is actually the current password
      try {
        const encryptedData = {
          encrypted: vaultFileData.encrypted,
          authTag: vaultFileData.authTag,
          iv: vaultFileData.iv,
        };
        this.encryptionService.decryptData(encryptedData, currentKey);
        return {
          success: true,
          message: 'This is actually the current password',
        };
      } catch (error) {
        // Not the current password, try recovery
      }

      // Check if we have previous password recovery data
      if (!vaultFileData.recoveryMetadata?.previousPassword) {
        return {
          success: false,
          error:
            'No recovery data available for this vault. You need to change your password at least once to enable previous password recovery.',
        };
      }

      const previousPasswordData =
        vaultFileData.recoveryMetadata.previousPassword;

      // Verify the old password matches the stored hash
      const oldPasswordHash = this.encryptionService.hash(oldPassword);
      if (previousPasswordData.passwordHash !== oldPasswordHash) {
        return {
          success: false,
          error:
            'This password is not in the recovery history. Only the previous password can be used for recovery.',
        };
      }

      // Decrypt the current password using the old password
      const recoverySalt = previousPasswordData.salt
        ? Buffer.from(previousPasswordData.salt, 'hex')
        : currentSalt; // Fallback for older vaults without stored salt

      const oldKey = this.encryptionService.deriveKey(
        oldPassword,
        recoverySalt
      );
      const decryptedData = this.encryptionService.decryptData(
        previousPasswordData.encryptedNewPassword,
        oldKey
      );
      const currentPassword = decryptedData.newPassword;

      // Verify the recovered password works with the current vault
      const currentVaultKey = this.encryptionService.deriveKey(
        currentPassword,
        currentSalt
      );
      const verifyEncryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv,
      };
      this.encryptionService.decryptData(verifyEncryptedData, currentVaultKey);

      return {
        success: true,
        message: 'Vault recovered with previous password',
        currentPassword: currentPassword,
      };
    } catch (error) {
      console.error('Error recovering vault with old password:', error);
      return { success: false, error: 'Failed to recover vault' };
    }
  }

  /**
   * Export vault to file
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @param {string} exportPath - Export file path
   * @returns {Promise<Object>} Export result
   */
  async exportVault(vaultName, password, exportPath) {
    try {
      // Verify vault exists and password is correct
      if (!(await this.storageService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFileData = await this.storageService.readVault(vaultName);
      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = this.encryptionService.deriveKey(password, salt);

      try {
        const encryptedData = {
          encrypted: vaultFileData.encrypted,
          authTag: vaultFileData.authTag,
          iv: vaultFileData.iv,
        };
        const decryptedData = this.encryptionService.decryptData(
          encryptedData,
          key
        );

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
            hasSettings: !!decryptedData.settings,
          },
        };

        // Write export file using storage service
        await this.storageService.writeVault(
          exportPath.replace('.vault', ''),
          exportData
        );
        return { success: true };
      } catch (decryptError) {
        return { success: false, error: 'Invalid password' };
      }
    } catch (error) {
      console.error('Error exporting vault:', error);
      return { success: false, error: 'Failed to export vault' };
    }
  }

  /**
   * Import vault from file
   * @param {string} importPath - Import file path
   * @param {string} newVaultName - New vault name
   * @param {string} password - Password for imported vault
   * @returns {Promise<Object>} Import result
   */
  async importVault(importPath, newVaultName, password) {
    try {
      // Check if target vault already exists
      if (await this.storageService.vaultExists(newVaultName)) {
        return { success: false, error: 'Vault with this name already exists' };
      }

      // Read and validate import file
      const importData = await this.storageService.readVault(
        importPath.replace('.vault', '')
      );

      // Validate import file structure
      if (!importData.exportVersion || !importData.originalVaultData) {
        return { success: false, error: 'Invalid import file format' };
      }

      // Verify we can decrypt the original vault data
      const originalVaultData = importData.originalVaultData;
      const originalSalt = Buffer.from(originalVaultData.salt, 'hex');

      // Try to decrypt with the original password to validate the import file
      const originalKey = this.encryptionService.deriveKey(
        password,
        originalSalt
      );

      const originalEncryptedData = {
        encrypted: originalVaultData.encrypted,
        authTag: originalVaultData.authTag,
        iv: originalVaultData.iv,
      };
      const decryptedData = this.encryptionService.decryptData(
        originalEncryptedData,
        originalKey
      );

      // Re-encrypt with new salt for the imported vault
      const newSalt = this.encryptionService.generateSalt();
      const newKey = this.encryptionService.deriveKey(password, newSalt);

      const newEncryptedData = this.encryptionService.encryptData(
        decryptedData,
        newKey
      );
      const finalData = {
        ...newEncryptedData,
        salt: newSalt.toString('hex'),
        // Imported vaults start without recovery metadata (will be created when needed)
        recoveryMetadata: {},
      };

      await this.storageService.writeVault(newVaultName, finalData);
      return {
        success: true,
        metadata: importData.metadata,
        importedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error importing vault:', error);
      return { success: false, error: 'Failed to import vault' };
    }
  }

  /**
   * Restore vault from backup
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Object>} Restore result
   */
  async restoreVaultBackup(vaultName) {
    try {
      if (!(await this.storageService.hasBackup(vaultName))) {
        return { success: false, error: 'No backup found for this vault' };
      }

      await this.storageService.restoreBackup(vaultName);
      return { success: true };
    } catch (error) {
      console.error('Error restoring vault backup:', error);
      return { success: false, error: 'Failed to restore vault backup' };
    }
  }

  /**
   * Check if vault has backup
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if backup exists
   */
  async hasVaultBackup(vaultName) {
    try {
      return await this.storageService.hasBackup(vaultName);
    } catch (error) {
      console.error('Error checking vault backup:', error);
      return false;
    }
  }

  /**
   * Get vault storage directory
   * @returns {string} Storage directory path
   */
  getVaultDirectory() {
    return this.storageService.getStorageDirectory();
  }
}
