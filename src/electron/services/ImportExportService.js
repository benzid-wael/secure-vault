import fs from 'fs-extra';
import os from 'os';

import { VaultFileService } from './VaultFileService.js';
import { CryptographyService } from './CryptographyService.js';
import { openVaultPayload } from '../utils/passwordVaultPayload.js';
import {
  PasswordEnvelopeError,
  checkKeyFile,
  isFormat2,
  mainKekOf,
  openPayload,
  recoveryKekOf,
  tampered,
  unwrapSlot,
} from '../utils/passwordVaultEnvelope.js';
import { checkVaultFormat } from '../utils/vaultFormat.js';
import path from 'path';

export class ImportExportService {
  /**
   * @param {string} vaultDirectory
   * @param {{links?: Object}} [options] As VaultFileService's (New-53).
   */
  constructor(vaultDirectory, { links } = {}) {
    this.fileService = new VaultFileService(vaultDirectory, { links });
  }

  _resolvePath(inputPath) {
    if (inputPath.startsWith('~')) {
      return path.join(os.homedir(), inputPath.slice(1));
    }
    return path.resolve(inputPath);
  }

  async exportVault(vaultName, password, exportPath) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);

      try {
        // `password`: the session's credential, the data key for format 2.
        const decryptedData = openVaultPayload(
          vaultFile,
          password,
          (pw, salt, iterations) =>
            CryptographyService.deriveKey(pw, salt, iterations)
        );

        const exportData = {
          exportVersion: '1.0',
          exportedAt: new Date().toISOString(),
          vaultName: vaultName,
          originalVaultData: vaultFile,
          metadata: {
            version: decryptedData.version,
            created: decryptedData.created,
            entryCount: entryCountOf(decryptedData),
            hasSettings: !!decryptedData.settings,
          },
        };

        exportPath = this._resolvePath(exportPath);
        await fs.writeJSON(exportPath, exportData, { spaces: 2 });
        return { success: true };
      } catch (decryptError) {
        return { success: false, error: `Invalid password: ${decryptError}` };
      }
    } catch (error) {
      console.error('Error exporting vault:', error);
      return { success: false, error: 'Failed to export vault' };
    }
  }

  /**
   * @param {string} importPath
   * @param {string} newVaultName
   * @param {string|null} password
   * @param {{keyFileKey?: Buffer|null, recoveryKey?: string|null}} [options]
   *   For an export of a vault that uses a key file (New-55): its key file
   *   with the password, or its recovery key alone.
   */
  async importVault(
    importPath,
    newVaultName,
    password,
    { keyFileKey = null, recoveryKey = null } = {}
  ) {
    try {
      if (await this.fileService.vaultExists(newVaultName)) {
        return { success: false, error: 'Vault with this name already exists' };
      }

      importPath = this._resolvePath(importPath);
      if (!(await fs.pathExists(importPath))) {
        return { success: false, error: 'Import file not found' };
      }

      const importData = await fs.readJSON(importPath);

      if (!importData.exportVersion || !importData.originalVaultData) {
        return { success: false, error: 'Invalid import file format' };
      }

      const originalVaultData = importData.originalVaultData;
      if (isFormat2(originalVaultData)) {
        return await this.#importFormat2(importData, newVaultName, password, {
          keyFileKey,
          recoveryKey,
        });
      }

      try {
        // The export carries the original file, `kdf` header included.
        const originalKey = CryptographyService.deriveKeyFor(
          password,
          originalVaultData
        );
        const originalEncryptedData = {
          encrypted: originalVaultData.encrypted,
          authTag: originalVaultData.authTag,
          iv: originalVaultData.iv,
        };
        const decryptedData = CryptographyService.decrypt(
          originalEncryptedData,
          originalKey
        );

        // Re-encrypt with new salt for the imported vault
        const newSalt = CryptographyService.generateSalt();
        const newKey = CryptographyService.deriveKey(
          password,
          newSalt,
          CryptographyService.ITERATIONS
        );
        const newEncryptedData = CryptographyService.encrypt(
          decryptedData,
          newKey
        );

        const finalData = {
          ...newEncryptedData,
          salt: newSalt.toString('hex'),
          kdf: CryptographyService.kdfHeader(),
          recoveryMetadata: {}, // Imported vaults start without recovery metadata
        };

        await this.fileService.writeVaultFile(newVaultName, finalData);
        return {
          success: true,
          metadata: {
            ...importData.metadata,
            entryCount: entryCountOf(decryptedData),
          },
          importedAt: new Date().toISOString(),
        };
      } catch (decryptError) {
        return { success: false, error: 'Invalid password for import file' };
      }
    } catch (error) {
      console.error('Error importing vault:', error);
      return { success: false, error: 'Failed to import vault' };
    }
  }

  /**
   * An export of a vault that uses a key file (New-55): opened with the
   * password and key file, or the recovery key alone, then written as it
   * was exported, so its key file, password and recovery key still open
   * the imported copy.
   */
  async #importFormat2(importData, newVaultName, password, options) {
    const file = importData.originalVaultData;
    const format = checkVaultFormat(file, 'password', newVaultName);
    if (!format.readable) {
      return { success: false, code: 'NEWER_FORMAT', error: format.message };
    }
    const { keyFileKey, recoveryKey } = options;
    if (!keyFileKey && !recoveryKey) {
      return {
        success: false,
        code: 'KEY_FILE_REQUIRED',
        error:
          'This vault needs its key file as well as its password, or its recovery key.',
      };
    }
    let payload;
    try {
      let kek;
      let slot;
      if (keyFileKey) {
        // The key file first: a wrong one isn't reported as a wrong password.
        checkKeyFile(file, keyFileKey);
        kek = mainKekOf(
          CryptographyService.deriveKeyFor(password, file),
          keyFileKey,
          file.salt
        );
        slot = 'main';
      } else {
        if (!file.slots?.recovery?.salt) throw tampered();
        kek = await recoveryKekOf(recoveryKey.trim(), file.slots.recovery);
        slot = 'recovery';
      }
      let dek;
      try {
        dek = unwrapSlot(file, slot, kek);
      } finally {
        kek.fill(0);
      }
      try {
        payload = openPayload(file, dek);
      } finally {
        dek.fill(0);
      }
    } catch (error) {
      if (error instanceof PasswordEnvelopeError) {
        return { success: false, code: error.code, error: error.message };
      }
      return { success: false, error: 'Invalid password for import file' };
    }
    await this.fileService.writeVaultFile(newVaultName, file);
    return {
      success: true,
      keyFile: true,
      metadata: { ...importData.metadata, entryCount: entryCountOf(payload) },
      importedAt: new Date().toISOString(),
    };
  }
}

/** How many entries a vault's payload holds (an object keyed by id). */
const entryCountOf = (data) => Object.keys(data?.entries ?? {}).length;
