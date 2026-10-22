import { Vault } from '../models/Vault.js';
import { CryptographyService } from './CryptographyService.js';
import { VaultFileService } from './VaultFileService.js';
import { validatePasswordStrength } from '../../utils/passwordValidation.js';
import { KeyRecoveryService } from './recovery/KeyRecoveryService.js';
import { PasswordRecoveryService } from './recovery/PasswordRecoveryService.js';
import { RecoveryData } from './recovery/IRecoveryMethod.js';
import { checkVaultFormat } from '../utils/vaultFormat.js';

/**
 * The password earlier versions gave the `default` vault they created on
 * first launch. Nothing creates it any more; it is only recognised so a vault
 * still using it can be flagged on unlock.
 */
export const LEGACY_DEFAULT_PASSWORD = 'changeme123';

export class VaultService {
  /**
   * @param {string} vaultDirectory
   * @param {{deriveKey?: Function}} [options] `deriveKey(password, salt,
   *   iterations)`; the desktop main process passes its session's caching
   *   version so loads and saves don't re-run PBKDF2 each time.
   */
  constructor(vaultDirectory, { deriveKey } = {}) {
    this.fileService = new VaultFileService(vaultDirectory);
    this.deriveKey =
      deriveKey ??
      ((password, salt, iterations) =>
        CryptographyService.deriveKey(password, salt, iterations));
  }

  /** The key for an existing vault file, at the iterations it records. */
  #keyFor(password, record) {
    return this.deriveKey(
      password,
      Buffer.from(record.salt, 'hex'),
      CryptographyService.iterationsOf(record)
    );
  }

  /** A fresh salt and key at the current iterations, plus its header. */
  #freshKey(password) {
    const salt = CryptographyService.generateSalt();
    return {
      key: this.deriveKey(password, salt, CryptographyService.ITERATIONS),
      header: {
        salt: salt.toString('hex'),
        kdf: CryptographyService.kdfHeader(),
      },
    };
  }

  async getAvailableVaults() {
    return this.fileService.listVaults();
  }

  async verifyVaultPassword(vaultName, password) {
    try {
      // Try to load the vault with the provided password
      const result = await this.loadVault(vaultName, password);
      return {
        success: result.success,
        valid: result.success && !!result.data,
        error: result.error,
      };
    } catch (error) {
      console.error(`Error verifying password for vault ${vaultName}:`, error);
      return {
        success: false,
        valid: false,
        error: error.message,
      };
    }
  }

  async createVault(vaultName, masterPassword) {
    if (await this.fileService.vaultExists(vaultName)) {
      throw new Error('Vault already exists');
    }

    const vault = new Vault({ name: vaultName });
    const { key, header } = this.#freshKey(masterPassword);

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
      ...header,
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
    if (!vaultPath) {
      vaultPath = this.fileService.getVaultPath(vaultName);
    }
    try {
      const vaultFile = await this.fileService.readVaultPath(vaultPath);
      // Before the password: a wrong-password message would mislead (New-29).
      const format = checkVaultFormat(vaultFile, 'password', vaultName);
      if (!format.readable) {
        return { success: false, code: 'NEWER_FORMAT', error: format.message };
      }
      const key = this.#keyFor(password, vaultFile);

      const encryptedData = {
        encrypted: vaultFile.encrypted,
        authTag: vaultFile.authTag,
        iv: vaultFile.iv,
      };

      CryptographyService.decrypt(encryptedData, key);
      return format.writable
        ? { success: true }
        : { success: true, readOnly: true, formatMessage: format.message };
    } catch (error) {
      return { success: false, error: 'Invalid master password' };
    }
  }

  async loadVault(vaultName, password) {
    try {
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const format = checkVaultFormat(vaultFile, 'password', vaultName);
      if (!format.readable) {
        return { success: false, code: 'NEWER_FORMAT', error: format.message };
      }
      const key = this.#keyFor(password, vaultFile);

      const encryptedData = {
        encrypted: vaultFile.encrypted,
        authTag: vaultFile.authTag,
        iv: vaultFile.iv,
      };

      const vaultData = CryptographyService.decrypt(encryptedData, key);

      const vault = Vault.fromJSON(vaultData, vaultName);
      const vaultJson = vault.toJSON();
      // Saves are refused by the file service; the page says why up front.
      return format.writable
        ? { success: true, data: vaultJson }
        : {
            success: true,
            data: vaultJson,
            readOnly: true,
            formatMessage: format.message,
          };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async saveVault(vaultName, password, vaultData) {
    try {
      // Load existing recovery metadata
      let existingFile = null;
      let existingRecoveryMetadata = {};
      if (await this.fileService.vaultExists(vaultName)) {
        try {
          existingFile = await this.fileService.readVaultFile(vaultName);
          existingRecoveryMetadata = existingFile.recoveryMetadata || {};
        } catch (error) {
          console.warn('Could not load existing recovery metadata');
        }
      }

      const vault = Vault.fromJSON(vaultData, vaultName);
      // A vault already at the current work factor keeps its salt (each
      // encryption still gets a fresh random IV), so the session's cached key
      // is reused instead of paying for PBKDF2 on every save.
      let key;
      let header;
      if (existingFile && !CryptographyService.needsKdfUpgrade(existingFile)) {
        key = this.#keyFor(password, existingFile);
        header = CryptographyService.keyHeaderOf(existingFile);
      } else {
        ({ key, header } = this.#freshKey(password));
      }

      const encryptedData = CryptographyService.encrypt(vault.toJSON(), key);
      const vaultFile = {
        ...encryptedData,
        ...header,
        recoveryMetadata: existingRecoveryMetadata,
      };

      await this.fileService.writeVaultFile(vaultName, vaultFile);
      return { success: true };
    } catch (error) {
      return { success: false, code: error.code, error: error.message };
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
        const currentKey = this.#keyFor(currentPassword, vaultFile);

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
        const { key: newKey, header } = this.#freshKey(newPassword);
        const newEncryptedData = CryptographyService.encrypt(
          vault.toJSON(),
          newKey
        );

        const finalVaultFile = {
          ...newEncryptedData,
          ...header,
          recoveryMetadata: updatedRecoveryMetadata,
        };

        // Test decryption before saving
        const testKey = newKey;
        const testEncryptedData = {
          encrypted: finalVaultFile.encrypted,
          authTag: finalVaultFile.authTag,
          iv: finalVaultFile.iv,
        };
        CryptographyService.decrypt(testEncryptedData, testKey);

        // Atomically write the new vault file
        await this.fileService.atomicWriteVaultFile(vaultName, finalVaultFile);

        // The backup exists only to roll back a failed change. Kept after a
        // successful one, it would still open with the retired password, and
        // "restore backup" would silently undo the change.
        await this.fileService.removeBackup(vaultName);

        return { success: true };
      } catch (error) {
        // Restore from backup on error
        await this.fileService.restoreFromBackup(vaultName);
        throw error;
      }
    } catch (error) {
      console.error('Error changing password:', error);
      if (error.code === 'NEWER_FORMAT') {
        return { success: false, code: error.code, error: error.message };
      }
      return { success: false, error: 'Failed to change master password' };
    }
  }

  /**
   * Re-key a vault written with fewer than the current PBKDF2 iterations
   * (M2). Call after a successful unlock, with the master password.
   *
   * - The vault is re-encrypted under a fresh salt at the current count.
   * - Recovery-key metadata is rebuilt around the *same* recovery key, so the
   *   key the user saved keeps working.
   * - Legacy previous-password metadata is dropped: it wraps the current
   *   master password under the previous password, which we don't have, so
   *   it can't be re-keyed and would stay a cheaper path to the master
   *   password. It is recreated (at the current count) on the next password
   *   change; the recovery key still works meanwhile.
   *
   * Copies left by earlier deletes (`*.vault.deleted.*`) are not touched.
   *
   * @returns {Promise<{success: boolean, upgraded?: boolean, error?: string}>}
   */
  async upgradeKdf(vaultName, password) {
    try {
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const keyRecovery = new KeyRecoveryService();
      const passwordRecovery = new PasswordRecoveryService();
      const keyId = keyRecovery.getRecoveryMethodId();
      const passwordId = passwordRecovery.getRecoveryMethodId();
      const metadata = { ...(vaultFile.recoveryMetadata || {}) };

      const legacy = (record) =>
        !!record && CryptographyService.needsKdfUpgrade(record);
      if (
        !legacy(vaultFile) &&
        !legacy(metadata[keyId]) &&
        !legacy(metadata[passwordId])
      ) {
        return { success: true, upgraded: false };
      }

      const vaultData = CryptographyService.decrypt(
        {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        },
        this.#keyFor(password, vaultFile)
      );

      if (legacy(metadata[keyId])) {
        const rekeyed = keyRecovery.onPasswordChange(
          vaultName,
          metadata[keyId],
          password,
          password
        );
        if (rekeyed.success) metadata[keyId] = rekeyed.metadata;
      }
      if (legacy(metadata[passwordId])) delete metadata[passwordId];

      const { key, header } = this.#freshKey(password);
      const upgradedFile = {
        ...CryptographyService.encrypt(vaultData, key),
        ...header,
        recoveryMetadata: metadata,
      };

      // No backup copy: the write is atomic, and a backup would keep the
      // weaker legacy file on disk. An existing legacy backup goes for the
      // same reason.
      await this.fileService.atomicWriteVaultFile(vaultName, upgradedFile);
      await this.fileService.removeLegacyBackup(vaultName);
      return { success: true, upgraded: true };
    } catch (error) {
      console.error('Failed to upgrade vault key derivation:', error.message);
      return { success: false, error: 'Failed to upgrade vault encryption' };
    }
  }

  async deleteVault(vaultName, confirmationPassword = null) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Every vault needs its password to be deleted.
      if (!confirmationPassword) {
        return {
          success: false,
          error: 'Enter the vault password to delete it',
        };
      }
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
      if (error.code === 'NEWER_FORMAT') {
        return { success: false, code: error.code, error: error.message };
      }
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
