import { Vault } from '../models/Vault.js';
import { CryptographyService } from './CryptographyService.js';
import { RecoveryKeyService } from './RecoveryKeyService.js';
import { VaultFileService } from './VaultFileService.js';
import { validatePasswordStrength } from '../utils/passwordValidation.js';

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

  async createVault(vaultName, masterPassword) {
    if (await this.fileService.vaultExists(vaultName)) {
      throw new Error('Vault already exists');
    }

    const vault = new Vault({ name: vaultName });
    const salt = CryptographyService.generateSalt();
    const key = CryptographyService.deriveKey(masterPassword, salt);

    // Generate recovery key
    const recoveryKey = RecoveryKeyService.generateRecoveryKey();
    const recoveryMetadata = RecoveryKeyService.createRecoveryMetadata(
      recoveryKey,
      masterPassword,
      salt
    );

    const encryptedData = CryptographyService.encrypt(vault.toJSON(), key);
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

  async verifyPassword(vaultName, password) {
    try {
      const vaultFile = await this.fileService.readVaultFile(vaultName);
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
      return { success: false, error: 'Invalid password' };
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
          await this._updateRecoveryMetadataForPasswordChange(
            vaultFile.recoveryMetadata || {},
            currentPassword,
            newPassword,
            currentSalt,
            currentPasswordHash
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

  async _updateRecoveryMetadataForPasswordChange(
    existingMetadata,
    currentPassword,
    newPassword,
    currentSalt,
    currentPasswordHash
  ) {
    const updatedMetadata = { ...existingMetadata };

    // Update previous password data
    const currentKey = CryptographyService.deriveKey(
      currentPassword,
      currentSalt
    );
    const encryptedNewPassword = CryptographyService.encrypt(
      { newPassword },
      currentKey
    );

    updatedMetadata.previousPassword = {
      passwordHash: currentPasswordHash,
      encryptedNewPassword,
      salt: currentSalt.toString('hex'),
      changedAt: new Date().toISOString(),
    };

    // Update recovery key data if it exists
    if (existingMetadata.recoveryKey) {
      try {
        const decryptedRecoveryKeyData = CryptographyService.decrypt(
          existingMetadata.recoveryKey.encryptedRecoveryKey,
          currentKey
        );

        const recoveryKey = decryptedRecoveryKeyData.recoveryKey;
        const newSalt = CryptographyService.generateSalt();
        const newKey = CryptographyService.deriveKey(newPassword, newSalt);

        const newRecoveryMetadata = RecoveryKeyService.createRecoveryMetadata(
          recoveryKey,
          newPassword,
          newSalt
        );
        updatedMetadata.recoveryKey = {
          ...existingMetadata.recoveryKey,
          ...newRecoveryMetadata.recoveryKey,
        };
      } catch (error) {
        console.warn('Could not update recovery key data:', error);
        delete updatedMetadata.recoveryKey;
      }
    }

    return updatedMetadata;
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
      const salt = Buffer.from(vaultFile.salt, 'hex');

      const recoveryKey = RecoveryKeyService.generateRecoveryKey();
      const recoveryMetadata = RecoveryKeyService.createRecoveryMetadata(
        recoveryKey,
        masterPassword,
        salt
      );

      // Update vault file
      const updatedVaultFile = {
        ...vaultFile,
        recoveryMetadata: {
          ...vaultFile.recoveryMetadata,
          ...recoveryMetadata,
        },
      };

      await this.fileService.writeVaultFile(vaultName, updatedVaultFile);

      return {
        success: true,
        recoveryKey,
        createdAt: recoveryMetadata.recoveryKey.createdAt,
      };
    } catch (error) {
      return { success: false, error: 'Failed to generate recovery key' };
    }
  }

  async verifyRecoveryKey(vaultName, recoveryKey) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      if (!RecoveryKeyService.validateRecoveryKeyFormat(recoveryKey)) {
        return { success: false, error: 'Invalid recovery key format' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);

      if (!vaultFile.recoveryMetadata?.recoveryKey) {
        return {
          success: false,
          error: 'No recovery key found for this vault',
        };
      }

      const salt = Buffer.from(vaultFile.salt, 'hex');
      const recoveryKeyDerived = RecoveryKeyService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      try {
        CryptographyService.decrypt(
          vaultFile.recoveryMetadata.recoveryKey.encryptedMasterPassword,
          recoveryKeyDerived
        );
        return { success: true };
      } catch (error) {
        return { success: false, error: 'Invalid recovery key' };
      }
    } catch (error) {
      return { success: false, error: 'Failed to verify recovery key' };
    }
  }

  async loadVaultWithRecoveryKey(vaultName, recoveryKey) {
    try {
      const verification = await this.verifyRecoveryKey(vaultName, recoveryKey);
      if (!verification.success) {
        return verification;
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const salt = Buffer.from(vaultFile.salt, 'hex');
      const recoveryKeyDerived = RecoveryKeyService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      const decryptedPasswordData = CryptographyService.decrypt(
        vaultFile.recoveryMetadata.recoveryKey.encryptedMasterPassword,
        recoveryKeyDerived
      );

      const masterPassword = decryptedPasswordData.masterPassword;
      const loadResult = await this.loadVault(vaultName, masterPassword);

      if (loadResult.success) {
        loadResult.password = masterPassword;
      }

      return loadResult;
    } catch (error) {
      return {
        success: false,
        error: 'Failed to load vault with recovery key',
      };
    }
  }
}
