import { VaultFileService } from './VaultFileService.js';
import { CryptographyService } from './CryptographyService.js';
import { Vault } from '../models/Vault.js';

export class VaultSettingsService {
  constructor(vaultDirectory) {
    this.fileService = new VaultFileService(vaultDirectory);
  }

  async updateVaultSettings(vaultName, vaultPassword, newSettings) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const salt = Buffer.from(vaultFile.salt, 'hex');
      const key = CryptographyService.deriveKey(vaultPassword, salt);

      let vaultData;
      try {
        const encryptedData = {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        };
        vaultData = CryptographyService.decrypt(encryptedData, key);
      } catch (error) {
        return { success: false, error: 'Invalid password' };
      }

      const vault = Vault.fromJSON(vaultData, vaultName);
      vault.updateSettings(newSettings);

      const newEncryptedData = CryptographyService.encrypt(vault.toJSON(), key);
      const finalData = {
        ...newEncryptedData,
        salt: salt.toString('hex'),
        recoveryMetadata: vaultFile.recoveryMetadata || {},
      };

      await this.fileService.writeVaultFile(vaultName, finalData);
      return { success: true };
    } catch (error) {
      console.error('Error updating vault settings:', error);
      return { success: false, error: 'Failed to update settings' };
    }
  }

  async getVaultSettings(vaultName, vaultPassword) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const salt = Buffer.from(vaultFile.salt, 'hex');
      const key = CryptographyService.deriveKey(vaultPassword, salt);

      try {
        const encryptedData = {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        };
        const vaultData = CryptographyService.decrypt(encryptedData, key);
        const vault = Vault.fromJSON(vaultData, vaultName);

        return { success: true, settings: vault.settings };
      } catch (error) {
        return { success: false, error: 'Invalid password' };
      }
    } catch (error) {
      console.error('Error getting vault settings:', error);
      return { success: false, error: 'Failed to get settings' };
    }
  }
}
