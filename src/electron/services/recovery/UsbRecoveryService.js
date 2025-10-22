import crypto from 'crypto';

import { IRecoveryMethod, RecoveryData } from './IRecoveryMethod.js';
import { CryptographyService } from '../CryptographyService.js';

export class UsbRecoveryService extends IRecoveryMethod {
  #version = '1.0';

  constructor() {
    super();
    this.methodId = 'usbDrive';
  }

  /**
   * Get the unique identifier for this recovery method
   * @returns {string} Unique identifier
   */
  getRecoveryMethodId() {
    return this.methodId;
  }

  /**
   * Check if the metadata is valid
   * @param {string} vaultName
   * @param {Object} metadata
   * @returns {Promise<boolean>}
   */
  isValid(vaultName, metadata) {
    if (
      !!!metadata ||
      !metadata?.salt ||
      !metadata?.encryptedMasterPassword ||
      !metadata?.encryptedRecoveryKey
    ) {
      return false;
    }
    return true;
  }

  /**
   * Generate new recovery method
   * @param {string} vaultName
   * @returns {Promise<RecoveryData>} RecoveryData
   */
  async generate(vaultName) {
    // This is not useful for this method, return dummy result
    return new RecoveryData({ data: { usbDrives: [] } });
  }

  /**
   * Create and returns metadata for the recovery option
   * @param {string} vaultName
   * @param {str} masterPassword
   * @param {Object} recoveryData
   * @returns {Promise<Object>} - metadata object
   */
  createMetadata(vaultName, masterPassword, recoveryData = {}) {
    const salt = CryptographyService.generateSalt();
    const recoveryKey = recoveryData.data.key;
    const masterKey = CryptographyService.deriveKey(masterPassword, salt);
    const recoveryKeyDerived = KeyRecoveryService.deriveKeyFromRecoveryKey(
      recoveryKey,
      salt
    );

    const encryptedRecoveryKey = CryptographyService.encrypt(
      { recoveryKey },
      masterKey
    );
    const encryptedMasterPassword = CryptographyService.encrypt(
      { masterPassword },
      recoveryKeyDerived
    );

    return {
      salt: salt.toString('hex'),
      encryptedRecoveryKey,
      encryptedMasterPassword,
      createdAt: new Date().toISOString(),
      version: this.#version,
    };
  }

  /**
   * Verify recovery data
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {Object} recoveryData
   * @returns {Promise<object>} - Result
   */
  async verify(vaultName, metadata, recoveryData) {
    const result = await this.recoverMasterPassword(
      vaultName,
      metadata,
      recoveryData
    );
    if (result.success) {
      return { success: true };
    } else {
      return result;
    }
  }

  /**
   * recover master password
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {Object} recoveryData
   * @returns {Promise<str>} - Master password
   */
  async recoverMasterPassword(vaultName, metadata, recoveryData) {
    // TODO: validate metadata/recoveryData
    try {
      const recoveryKey = recoveryData.data.key;
      if (!this.#validateRecoveryKeyFormat(recoveryKey)) {
        return { success: false, error: 'Invalid recovery key format' };
      }

      const salt = Buffer.from(metadata.salt, 'hex');
      const recoveryKeyDerived = KeyRecoveryService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      try {
        const masterPassword = CryptographyService.decrypt(
          metadata.encryptedMasterPassword,
          recoveryKeyDerived
        );
        return { success: true, ...masterPassword };
      } catch (error) {
        console.error('Invalid recovery key:', error);
        return { success: false, error: `Invalid recovery key: ${error}` };
      }
    } catch (error) {
      console.error('Failed to recover vault using given recovery key:', error);
      return {
        success: false,
        error: 'Failed to recover vault using given recovery key!',
      };
    }
  }

  /**
   * Recreate metadata when password change
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {str} oldPassword
   * @param {str} newPassword
   * @returns {Promise<Object>} - new metadata object
   */
  onPasswordChange(vaultName, metadata, oldPassword, newPassword) {
    const result = this.#loadRecoveryKey(vaultName, metadata, oldPassword);
    if (!result.success) {
      console.warn(`Unable to load recovery key for vault: ${vaultName}.`);
      console.log(
        'Looks like the recovery key does not exist or already corrupted!'
      );
      return { success: false, metadata };
    }

    try {
      const recoveryData = new RecoveryData({
        data: { key: result.recoveryKey },
      });
      const newMetadata = this.createMetadata(
        vaultName,
        newPassword,
        recoveryData
      );
      return { success: true, metadata: newMetadata };
    } catch (error) {
      console.error('Failed to create metadata:', error);
      return { success: false, error: 'Failed to create metadata' };
    }
  }

  #loadRecoveryKey(vaultName, metadata, masterPassword) {
    // TODO: validate metadata
    try {
      const salt = Buffer.from(metadata.salt, 'hex');
      const key = CryptographyService.deriveKey(masterPassword, salt);

      try {
        const recoveryKey = CryptographyService.decrypt(
          metadata.encryptedRecoveryKey,
          key
        );
        return { success: true, ...recoveryKey };
      } catch (error) {
        console.error('Invalid recovery key:', error);
        return { success: false, error: `Invalid recovery key: ${error}` };
      }
    } catch (error) {
      console.error(
        'Internal error: Look like the recovery key is corrupted:',
        error
      );
      return {
        success: false,
        error: 'Internal error: Look like the recovery key is corrupted.',
      };
    }
  }

  #generateRecoveryKey() {
    const recoveryKeyBytes = crypto.randomBytes(32);

    let result = '';
    let bits = 0;
    let value = 0;

    for (let i = 0; i < recoveryKeyBytes.length; i++) {
      value = (value << 8) | recoveryKeyBytes[i];
      bits += 8;

      while (bits >= 5) {
        result +=
          KeyRecoveryService.BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      result += KeyRecoveryService.BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return result.match(/.{1,4}/g).join('-');
  }

  #validateRecoveryKeyFormat(recoveryKey) {
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();
    const base32Regex = /^[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]+$/;
    return (
      base32Regex.test(cleanKey) &&
      cleanKey.length >= KeyRecoveryService.MIN_KEY_LENGTH
    );
  }

  static deriveKeyFromRecoveryKey(recoveryKey, salt) {
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();
    return CryptographyService.deriveKey(cleanKey, salt);
  }
}
