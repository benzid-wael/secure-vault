import electron from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { CryptoService } from './CryptoService.js';
import { SecurityManager } from './SecurityManager.js';

const { app } = electron;

export class VaultService {
  constructor() {
    this.cryptoService = new CryptoService();
    this.securityManager = new SecurityManager();

    // Handle case where app is not available (e.g., during testing)
    try {
      this.vaultDir = path.join(app.getPath('userData'), 'vaults');
    } catch (error) {
      // Fallback for testing or when app is not available
      this.vaultDir = path.join(process.cwd(), 'test-vaults');
    }
  }

  // Helper method to check if file exists
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async initialize() {
    console.log('VaultService: Initializing...');
    console.log('VaultService: Vault directory:', this.vaultDir);

    try {
      // Ensure vault directory exists
      try {
        await fs.mkdir(this.vaultDir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
      console.log('VaultService: Vault directory ensured');

      // Create default vault if it doesn't exist
      await this.createDefaultVault();
      console.log('VaultService: Default vault created/verified');
    } catch (error) {
      console.error('VaultService: Error during initialization:', error);
      throw error;
    }
  }

  async getVaults() {
    try {
      const files = await fs.readdir(this.vaultDir);

      const vaults = files
        .filter((file) => file.endsWith('.vault'))
        .map((file) => file.replace('.vault', ''));

      // Ensure default vault exists
      if (!vaults.includes('default')) {
        await this.createDefaultVault();
        vaults.unshift('default');
      }

      return vaults;
    } catch (error) {
      return ['default'];
    }
  }

  async createVault(vaultName, masterPassword) {
    try {
      // Validate inputs
      const vaultNameValidation = this.securityManager.validateInput(
        vaultName,
        'vaultName'
      );
      if (!vaultNameValidation.isValid) {
        throw new Error(vaultNameValidation.error);
      }

      const passwordValidation = this.securityManager.validateInput(
        masterPassword,
        'password'
      );
      if (!passwordValidation.isValid) {
        throw new Error(passwordValidation.error);
      }

      const vaultPath = path.join(this.vaultDir, `${vaultName}.vault`);

      // Check if vault already exists
      if (await this.fileExists(vaultPath)) {
        throw new Error('Vault already exists');
      }

      // Create encrypted vault structure
      const salt = this.cryptoService.generateSalt();
      const key = this.cryptoService.deriveKey(masterPassword, salt);

      // Generate initial recovery key
      const recoveryKey = this.cryptoService.generateRecoveryKey();

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

      // Generate initial recovery key and create bidirectional encryption
      const recoveryKeyDerived = this.cryptoService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );
      const encryptedRecoveryKey = this.cryptoService.encryptData(
        { recoveryKey },
        key
      );
      const encryptedMasterPassword = this.cryptoService.encryptData(
        { masterPassword },
        recoveryKeyDerived
      );

      const encryptedData = this.cryptoService.encryptData(vaultData, key);
      const finalData = {
        ...encryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: {
          recoveryKey: {
            encryptedRecoveryKey: encryptedRecoveryKey,
            encryptedMasterPassword: encryptedMasterPassword,
            createdAt: new Date().toISOString(),
            version: 1,
          },
        },
      };

      await fs.writeFile(vaultPath, JSON.stringify(finalData, null, 2));
      return {
        success: true,
        recoveryKey: recoveryKey,
        recoveryKeyCreatedAt: vaultData.recoveryKey?.createdAt,
      };
    } catch (error) {
      console.error('Error creating vault:', error);
      return { success: false, error: error.message };
    }
  }

  async verifyVaultPassword(vaultName, password) {
    try {
      const vaultPath = path.join(this.vaultDir, `${vaultName}.vault`);
      const vaultFileData = JSON.parse(await fs.readFile(vaultPath, 'utf8'));

      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = this.cryptoService.deriveKey(password, salt);

      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv,
      };

      this.cryptoService.decryptData(encryptedData, key); // This will throw if password is wrong
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Invalid password' };
    }
  }

  async loadVault(vaultName, password) {
    try {
      const vaultPath = path.join(this.vaultDir, `${vaultName}.vault`);
      const vaultFileData = JSON.parse(await fs.readFile(vaultPath, 'utf8'));

      const salt = Buffer.from(vaultFileData.salt, 'hex');
      const key = this.cryptoService.deriveKey(password, salt);

      // Extract only the encrypted part for decryption
      const encryptedData = {
        encrypted: vaultFileData.encrypted,
        authTag: vaultFileData.authTag,
        iv: vaultFileData.iv,
      };

      const parsedData = this.cryptoService.decryptData(encryptedData, key);
      return { success: true, data: parsedData };
    } catch (error) {
      console.error('Error loading vault:', error);
      return { success: false, error: error.message };
    }
  }

  async saveVault(vaultName, password, data) {
    try {
      const vaultPath = path.join(this.vaultDir, `${vaultName}.vault`);

      // Load existing vault file to preserve recovery metadata
      let existingRecoveryMetadata = {};
      if (await this.fileExists(vaultPath)) {
        try {
          const existingVaultFile = JSON.parse(
            await fs.readFile(vaultPath, 'utf8')
          );
          existingRecoveryMetadata = existingVaultFile.recoveryMetadata || {};
        } catch (error) {
          console.warn(
            'Could not load existing recovery metadata, starting fresh'
          );
        }
      }

      const salt = this.cryptoService.generateSalt();
      const key = this.cryptoService.deriveKey(password, salt);

      const encryptedData = this.cryptoService.encryptData(data, key);
      const finalData = {
        ...encryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: existingRecoveryMetadata,
      };

      await fs.writeFile(vaultPath, JSON.stringify(finalData, null, 2));
      return { success: true };
    } catch (error) {
      console.error('Error saving vault:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteVault(vaultName, confirmationPassword) {
    try {
      const vaultPath = path.join(this.vaultDir, `${vaultName}.vault`);

      if (!(await this.fileExists(vaultPath))) {
        return { success: false, error: 'Vault not found' };
      }

      // Verify password before deletion
      const passwordCheck = await this.verifyVaultPassword(
        vaultName,
        confirmationPassword
      );
      if (!passwordCheck.success) {
        return { success: false, error: 'Invalid password' };
      }

      // Create backup before deletion
      const backupPath = path.join(
        this.vaultDir,
        `${vaultName}.vault.backup.${Date.now()}`
      );
      await fs.copyFile(vaultPath, backupPath);

      // Delete the vault file
      await fs.unlink(vaultPath);

      // Clean up related files
      const relatedFiles = [
        path.join(this.vaultDir, `${vaultName}.vault.backup`),
        path.join(this.vaultDir, `${vaultName}.vault.tmp`),
        path.join(this.vaultDir, `${vaultName}.recovery`),
      ];

      for (const filePath of relatedFiles) {
        if (await this.fileExists(filePath)) {
          await fs.unlink(filePath);
        }
      }

      return {
        success: true,
        message: `Vault "${vaultName}" has been deleted. A backup was created.`,
        backupFile: path.basename(backupPath),
      };
    } catch (error) {
      console.error('Error deleting vault:', error);
      return { success: false, error: 'Failed to delete vault' };
    }
  }

  async createDefaultVault() {
    const defaultVaultPath = path.join(this.vaultDir, 'default.vault');

    if (!(await this.fileExists(defaultVaultPath))) {
      const defaultPassword = 'changeme123';
      const salt = this.cryptoService.generateSalt();
      const key = this.cryptoService.deriveKey(defaultPassword, salt);

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
          maxPasswordHistory: 3,
        },
      };

      // Generate initial recovery key for default vault
      const recoveryKey = this.cryptoService.generateRecoveryKey();
      const recoveryKeyDerived = this.cryptoService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );
      const encryptedRecoveryKey = this.cryptoService.encryptData(
        { recoveryKey },
        key
      );
      const encryptedMasterPassword = this.cryptoService.encryptData(
        { masterPassword: defaultPassword },
        recoveryKeyDerived
      );

      const encryptedData = this.cryptoService.encryptData(vaultData, key);
      const finalData = {
        ...encryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: {
          recoveryKey: {
            encryptedRecoveryKey: encryptedRecoveryKey,
            encryptedMasterPassword: encryptedMasterPassword,
            createdAt: new Date().toISOString(),
            version: 1,
          },
        },
      };

      await fs.writeFile(defaultVaultPath, JSON.stringify(finalData, null, 2));
      console.log('Default vault created with recovery key:', recoveryKey);
    }
  }

  // Additional vault operations can be added here...
  async changeMasterPassword(vaultName, currentPassword, newPassword) {
    // Implementation for changing master password
    // This is a complex operation that would need to be implemented
    // following the same pattern as the original code
    throw new Error('Not implemented yet');
  }

  async generateRecoveryKey(vaultName, masterPassword) {
    // Implementation for generating recovery key
    throw new Error('Not implemented yet');
  }

  async verifyVaultRecoveryKey(vaultName, recoveryKey) {
    // Implementation for verifying recovery key
    throw new Error('Not implemented yet');
  }

  async loadVaultWithRecoveryKey(vaultName, recoveryKey) {
    // Implementation for loading vault with recovery key
    throw new Error('Not implemented yet');
  }

  async recoverVaultWithOldPassword(vaultName, oldPassword) {
    // Implementation for recovering vault with old password
    throw new Error('Not implemented yet');
  }
}
