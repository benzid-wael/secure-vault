import fs from 'fs-extra';
import os from 'os';

import { VaultFileService } from './VaultFileService.js';
import { CryptographyService } from './CryptographyService.js';
import path from 'path';

export class ImportExportService {
  constructor(vaultDirectory) {
    this.fileService = new VaultFileService(vaultDirectory);
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
      const salt = Buffer.from(vaultFile.salt, 'hex');
      const key = CryptographyService.deriveKey(password, salt);

      try {
        const encryptedData = {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        };
        const decryptedData = CryptographyService.decrypt(encryptedData, key);

        const exportData = {
          exportVersion: '1.0',
          exportedAt: new Date().toISOString(),
          vaultName: vaultName,
          originalVaultData: vaultFile,
          metadata: {
            version: decryptedData.version,
            created: decryptedData.created,
            entryCount: decryptedData.entries?.length || 0,
            hasSettings: !!decryptedData.settings,
          },
        };

        exportPath = this._resolvePath(exportPath);
        console.log(`export to ${exportPath}`);
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

  async importVault(importPath, newVaultName, password) {
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
      const originalSalt = Buffer.from(originalVaultData.salt, 'hex');

      try {
        const originalKey = CryptographyService.deriveKey(
          password,
          originalSalt
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
        const newKey = CryptographyService.deriveKey(password, newSalt);
        const newEncryptedData = CryptographyService.encrypt(
          decryptedData,
          newKey
        );

        const finalData = {
          ...newEncryptedData,
          salt: newSalt.toString('hex'),
          recoveryMetadata: {}, // Imported vaults start without recovery metadata
        };

        await this.fileService.writeVaultFile(newVaultName, finalData);
        return {
          success: true,
          metadata: importData.metadata,
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
}
