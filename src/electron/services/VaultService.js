import { Vault } from '../models/Vault.js';
import { CryptographyService } from './CryptographyService.js';
import { VaultFileService } from './VaultFileService.js';
import { validatePasswordStrength } from '../utils/passwordValidation.js';
import { KeyRecoveryService } from './recovery/KeyRecoveryService.js';
import { PasswordRecoveryService } from './recovery/PasswordRecoveryService.js';
import { RecoveryData } from './recovery/IRecoveryMethod.js';

export class VaultService {
  constructor(vaultDirectory) {
    this.fileService = new VaultFileService(vaultDirectory);
  }

  async getAvailableVaults() {
    const vaults = await this.fileService.listVaults();

    // Ensure default vault exists
    if (!vaults.includes('default')) {
      await this.createDefaultVault();
      vaults.unshift('default');
    }

    return vaults;
  }

  async encryptVault(data, masterPassword, recoveryKey, oldPassword) {
    const salt = CryptographyService.generateSalt();
    const key = CryptographyService.deriveKey(masterPassword, salt);

    // Generate recovery key
    let recoveryMetadata = RecoveryKeyService.createRecoveryMetadata(
      recoveryKey,
      masterPassword,
      salt
    );

    if (oldPassword) {
      const currentKey = CryptographyService.deriveKey(oldPassword, salt);
      const recoveryPassword = CryptographyService.encrypt(
        { masterPassword },
        currentKey
      );
      recoveryMetadata = {
        ...recoveryMetadata,
        recoveryPassword,
      };
    }

    const encryptedData = CryptographyService.encrypt(vault.toJSON(), key);
    return {
      ...encryptedData,
      salt: salt.toString('hex'),
      recoveryMetadata,
    };
  }

  async createVault(vaultName, masterPassword) {
    if (await this.fileService.vaultExists(vaultName)) {
      throw new Error('Vault already exists');
    }

    const vault = new Vault({ name: vaultName });
    const salt = CryptographyService.generateSalt();
    const key = CryptographyService.deriveKey(masterPassword, salt);

    // Generate recovery key
    const keyRecoveryService = new KeyRecoveryService();
    const recoveryKey = await keyRecoveryService.generate();
    const recoveryKeyMetadata = keyRecoveryService.createMetadata(
      vaultName,
      masterPassword,
      recoveryKey
    );

    const encryptedData = CryptographyService.encrypt(vault.toJSON(), key);
    let recoveryMetadata = {};
    recoveryMetadata[keyRecoveryService.getRecoveryMethodId()] =
      recoveryKeyMetadata;
    const vaultFile = {
      ...encryptedData,
      salt: salt.toString('hex'),
      recoveryMetadata,
    };

    await this.fileService.writeVaultFile(vaultName, vaultFile);

    return {
      success: true,
      recoveryKey,
      recoveryKeyCreatedAt: recoveryMetadata.recoveryKey.createdAt,
    };
  }

  async verifyPassword(vaultName, password, vaultPath = null) {
    if (!!!vaultPath) {
      vaultPath = this.fileService.getVaultPath(vaultName);
    }
    try {
      const vaultFile = await this.fileService.readVaultPath(vaultPath);
      const salt = Buffer.from(vaultFile.salt, 'hex');
      const key = CryptographyService.deriveKey(password, salt);

      const encryptedData = {
        encrypted: vaultFile.encrypted,
        authTag: vaultFile.authTag,
        iv: vaultFile.iv,
      };

      CryptographyService.decrypt(encryptedData, key);
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Invalid master password' };
    }
  }

  async loadVault(vaultName, password) {
    try {
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const salt = Buffer.from(vaultFile.salt, 'hex');
      const key = CryptographyService.deriveKey(password, salt);

      const encryptedData = {
        encrypted: vaultFile.encrypted,
        authTag: vaultFile.authTag,
        iv: vaultFile.iv,
      };

      const vaultData = CryptographyService.decrypt(encryptedData, key);
      const vault = Vault.fromJSON(vaultData, vaultName);

      return { success: true, data: vault.toJSON() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async saveVault(vaultName, password, vaultData) {
    try {
      // Load existing recovery metadata
      let existingRecoveryMetadata = {};
      if (await this.fileService.vaultExists(vaultName)) {
        try {
          const existingFile = await this.fileService.readVaultFile(vaultName);
          existingRecoveryMetadata = existingFile.recoveryMetadata || {};
        } catch (error) {
          console.warn('Could not load existing recovery metadata');
        }
      }

      const vault = Vault.fromJSON(vaultData, vaultName);
      const salt = CryptographyService.generateSalt();
      const key = CryptographyService.deriveKey(password, salt);

      const encryptedData = CryptographyService.encrypt(vault.toJSON(), key);
      const vaultFile = {
        ...encryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: existingRecoveryMetadata,
      };

      await this.fileService.writeVaultFile(vaultName, vaultFile);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async changePassword(vaultName, currentPassword, newPassword) {
    try {
      // Validate new password
      const passwordErrors = validatePasswordStrength(newPassword);
      if (passwordErrors.length > 0) {
        return { success: false, error: passwordErrors[0] };
      }

      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Create backup
      await this.fileService.createBackup(vaultName);

      try {
        // Load and verify current password
        const vaultFile = await this.fileService.readVaultFile(vaultName);
        const currentSalt = Buffer.from(vaultFile.salt, 'hex');
        const currentKey = CryptographyService.deriveKey(
          currentPassword,
          currentSalt
        );

        const encryptedData = {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        };

        const vaultData = CryptographyService.decrypt(
          encryptedData,
          currentKey
        );
        const vault = Vault.fromJSON(vaultData, vaultName);

        // Check password reuse
        const newPasswordHash = CryptographyService.hashPassword(newPassword);
        if (newPassword === currentPassword) {
          return {
            success: false,
            error: 'New password must be different from current password',
          };
        }

        if (vault.checkPasswordReuse(newPasswordHash)) {
          return {
            success: false,
            error:
              'This password has been used before. Please choose a different password.',
          };
        }

        // Update vault with password history
        const currentPasswordHash =
          CryptographyService.hashPassword(currentPassword);
        vault.addPasswordToHistory(currentPasswordHash);
        vault.updateLastPasswordChange();

        // Update recovery metadata
        const updatedRecoveryMetadata =
          await this.#updateRecoveryMetadataForPasswordChange(
            vaultName,
            vaultFile.recoveryMetadata || {},
            currentPassword,
            newPassword
          );

        // Re-encrypt with new password
        const newSalt = CryptographyService.generateSalt();
        const newKey = CryptographyService.deriveKey(newPassword, newSalt);
        const newEncryptedData = CryptographyService.encrypt(
          vault.toJSON(),
          newKey
        );

        const finalVaultFile = {
          ...newEncryptedData,
          salt: newSalt.toString('hex'),
          recoveryMetadata: updatedRecoveryMetadata,
        };

        // Test decryption before saving
        const testKey = CryptographyService.deriveKey(newPassword, newSalt);
        const testEncryptedData = {
          encrypted: finalVaultFile.encrypted,
          authTag: finalVaultFile.authTag,
          iv: finalVaultFile.iv,
        };
        CryptographyService.decrypt(testEncryptedData, testKey);

        // Atomically write the new vault file
        await this.fileService.atomicWriteVaultFile(vaultName, finalVaultFile);

        return { success: true };
      } catch (error) {
        // Restore from backup on error
        await this.fileService.restoreFromBackup(vaultName);
        throw error;
      }
    } catch (error) {
      console.error('Error changing password:', error);
      return { success: false, error: 'Failed to change master password' };
    }
  }

  async deleteVault(vaultName, confirmationPassword = null) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      if (vaultName === 'default' && !confirmationPassword) {
        return {
          success: false,
          error: 'Cannot delete default vault without password confirmation',
        };
      }

      // Verify password if provided
      if (confirmationPassword) {
        const verification = await this.verifyPassword(
          vaultName,
          confirmationPassword
        );
        if (!verification.success) {
          return {
            success: false,
            error: 'Invalid password. Vault not deleted.',
          };
        }
      }

      const backupFile = await this.fileService.deleteVault(vaultName);

      return {
        success: true,
        message: `Vault "${vaultName}" has been deleted. A backup was created.`,
        backupFile,
      };
    } catch (error) {
      return { success: false, error: 'Failed to delete vault' };
    }
  }

  async createDefaultVault() {
    const defaultPassword = 'changeme123';
    const result = await this.createVault('default', defaultPassword);

    if (result.success) {
      console.log(
        'Default vault created with recovery key:',
        result.recoveryKey
      );
    }

    return result;
  }

  // Recovery methods
  async generateRecoveryKey(vaultName, masterPassword) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Verify password
      const verification = await this.verifyPassword(vaultName, masterPassword);
      if (!verification.success) {
        return { success: false, error: 'Invalid master password' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);

      const keyRecoveryService = new KeyRecoveryService();
      const recoveryKey = await keyRecoveryService.generate();
      const recoveryMetadata = keyRecoveryService.createMetadata(
        vaultName,
        masterPassword,
        recoveryKey
      );
      let newRecoveryMetadata = vaultFile.recoveryMetadata;
      newRecoveryMetadata[keyRecoveryService.getRecoveryMethodId()] =
        recoveryMetadata;

      // Update vault file
      const updatedVaultFile = {
        ...vaultFile,
        recoveryMetadata: newRecoveryMetadata,
      };

      await this.fileService.writeVaultFile(vaultName, updatedVaultFile);

      return {
        success: true,
        recoveryKey: recoveryKey.data.key,
        createdAt: recoveryMetadata.createdAt,
      };
    } catch (error) {
      console.error('Failed to generate recovery key: ', error);
      return { success: false, error: 'Failed to generate recovery key' };
    }
  }

  async verifyRecoveryKey(vaultName, recoveryKey) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const keyRecoveryService = new KeyRecoveryService();
      const methodId = keyRecoveryService.getRecoveryMethodId();
      const vaultFile = await this.fileService.readVaultFile(vaultName);

      if (
        !vaultFile.recoveryMetadata ||
        !vaultFile.recoveryMetadata[methodId]
      ) {
        return {
          success: false,
          error: 'No recovery key found for this vault',
        };
      }

      const recoveryData = new RecoveryData({ data: { key: recoveryKey } });
      return await keyRecoveryService.verify(
        vaultName,
        vaultFile.recoveryMetadata[methodId],
        recoveryData
      );
    } catch (error) {
      console.error(`Failed to verify recovery key: ${error}`);
      return { success: false, error: 'Failed to verify recovery key' };
    }
  }

  async loadVaultWithPassword(vaultName, oldPassword) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);

      // First, try if the old password is actually the current password
      try {
        const loadResult = await this.loadVault(vaultName, oldPassword);

        if (loadResult.success) {
          loadResult.password = oldPassword;
          return loadResult;
        }
      } catch (error) {
        // Not the current password, try recovery
      }

      const passwordRecoveryService = new PasswordRecoveryService();
      const methodId = passwordRecoveryService.getRecoveryMethodId();
      // Check if we have previous password recovery data
      if (
        !vaultFile.recoveryMetadata ||
        !vaultFile.recoveryMetadata[methodId]
      ) {
        return {
          success: false,
          error:
            'No recovery data available for this vault. You need to change your password at least once to enable previous password recovery.',
        };
      }

      try {
        const recoveryData = new RecoveryData({
          data: { password: oldPassword },
        });
        const result = await passwordRecoveryService.recoverMasterPassword(
          vaultName,
          vaultFile.recoveryMetadata[methodId],
          recoveryData
        );
        if (!result.success) {
          return result;
        }

        const masterPassword = result.masterPassword;
        const loadResult = await this.loadVault(vaultName, masterPassword);

        if (loadResult.success) {
          loadResult.password = masterPassword;
        }

        return loadResult;
      } catch (error) {
        const message =
          'Failed to recover vault using recovered master password';
        console.error(`${message}: ${error}`);
        return { success: false, error: message };
      }
    } catch (error) {
      const message = 'Failed to recover vault with old password';
      console.error(message, ': ', error);
      return { success: false, error: message };
    }
  }

  async loadVaultWithRecoveryKey(vaultName, recoveryKey) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const keyRecoveryService = new KeyRecoveryService();
      const methodId = keyRecoveryService.getRecoveryMethodId();
      const vaultFile = await this.fileService.readVaultFile(vaultName);

      if (
        !vaultFile.recoveryMetadata ||
        !vaultFile.recoveryMetadata[methodId]
      ) {
        return {
          success: false,
          error: 'No recovery key found for this vault',
        };
      }

      const recoveryData = new RecoveryData({ data: { key: recoveryKey } });
      const result = await keyRecoveryService.recoverMasterPassword(
        vaultName,
        vaultFile.recoveryMetadata[methodId],
        recoveryData
      );

      if (!result.success) {
        return result;
      }

      const masterPassword = result.masterPassword;
      const loadResult = await this.loadVault(vaultName, masterPassword);

      if (loadResult.success) {
        loadResult.password = masterPassword;
      }

      return loadResult;
    } catch (error) {
      console.error(`Failed to load vault with recovery key: ${error}`);
      return {
        success: false,
        error: 'Failed to load vault with recovery key',
      };
    }
  }

  async #updateRecoveryMetadataForPasswordChange(
    vaultName,
    existingMetadata,
    currentPassword,
    newPassword
  ) {
    const keyRecoveryService = new KeyRecoveryService();
    const passwordRecoveryService = new PasswordRecoveryService();

    const metadata = [keyRecoveryService, passwordRecoveryService]
      .flatMap((recoveryMethod) => {
        const methodId = recoveryMethod.getRecoveryMethodId();
        const recoveryMetadata = existingMetadata[methodId] || {};
        const result = recoveryMethod.onPasswordChange(
          vaultName,
          recoveryMetadata,
          currentPassword,
          newPassword
        );
        // By default let's return old data, so that we could recover it later if possible
        return {
          methodId,
          data: result.success ? result.metadata : recoveryMetadata,
        };
      })
      .reduce((obj, item) => {
        obj[item.methodId] = item.data;
        return obj;
      }, {});

    return metadata;
  }
}
