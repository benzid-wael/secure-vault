import { VaultFileService } from './VaultFileService.js';
import { CryptographyService } from './CryptographyService.js';
import { Vault } from '../models/Vault.js';
import {
  openVaultPayload,
  resealVaultPayload,
} from '../utils/passwordVaultPayload.js';

/** A failure to open the payload, as a result: coded ones keep their code. */
const openFailure = (error) =>
  error.code
    ? { success: false, code: error.code, error: error.message }
    : { success: false, error: 'Invalid password' };

export class VaultSettingsService {
  /**
   * @param {string} vaultDirectory
   * @param {{deriveKey?: Function, links?: Object}} [options] see
   *   VaultService.
   */
  constructor(vaultDirectory, { deriveKey, links } = {}) {
    this.fileService = new VaultFileService(vaultDirectory, { links });
    this.deriveKey =
      deriveKey ??
      ((password, salt, iterations) =>
        CryptographyService.deriveKey(password, salt, iterations));
  }

  async updateVaultSettings(vaultName, vaultPassword, newSettings) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);

      let vaultData;
      try {
        vaultData = openVaultPayload(vaultFile, vaultPassword, this.deriveKey);
      } catch (error) {
        return openFailure(error);
      }

      const vault = Vault.fromJSON(vaultData, vaultName);
      vault.updateSettings(newSettings);

      // Same keys: the same header (and format-2 slots) go back on.
      await this.fileService.writeVaultFile(
        vaultName,
        resealVaultPayload(
          vaultFile,
          vault.toJSON(),
          vaultPassword,
          this.deriveKey
        )
      );
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

      try {
        const vaultData = openVaultPayload(
          vaultFile,
          vaultPassword,
          this.deriveKey
        );
        const vault = Vault.fromJSON(vaultData, vaultName);

        return { success: true, settings: vault.settings };
      } catch (error) {
        return openFailure(error);
      }
    } catch (error) {
      console.error('Error getting vault settings:', error);
      return { success: false, error: 'Failed to get settings' };
    }
  }
}
