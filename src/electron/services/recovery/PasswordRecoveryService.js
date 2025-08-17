import { IRecoveryMethod, RecoveryData } from './IRecoveryMethod.js';
import { CryptographyService } from '../CryptographyService.js';

export class PasswordRecoveryService extends IRecoveryMethod {
  #version = '1.0';

  constructor() {
    super();
    this.methodId = 'lastUsedPassword';
  }

  /**
   * Get the unique identifier for this recovery method
   * @returns {string} Unique identifier
   */
  getRecoveryMethodId() {
    return this.methodId;
  }

  /**
   * Generate new recovery method
   * @param {string} vaultName
   * @returns {Promise<RecoveryData>} RecoveryData
   */
  async generate(vaultName) {
    // This is not useful for this method, return dummy result
    return new RecoveryData({ data: { password: '' } });
  }

  /**
   * Create and returns metadata for the recovery option
   * @param {string} vaultName
   * @param {str} masterPassword
   * @param {Object} recoveryData
   * @returns {Promise<Object>} - metadata object
   */
  createMetadata(vaultName, masterPassword, recoveryData = {}) {
    // We just need to handle onPasswordChange event for this method
    return {};
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
    try {
      const salt = CryptographyService.generateSalt();
      const oldPasswordKey = CryptographyService.deriveKey(oldPassword, salt);
      const encryptedMasterPassword = CryptographyService.encrypt(
        { masterPassword: newPassword },
        oldPasswordKey
      );

      const newMetadata = {
        salt: salt.toString('hex'),
        encryptedMasterPassword,
        createdAt: new Date().toISOString(),
        version: this.#version,
      };
      return { success: true, metadata: newMetadata };
    } catch (error) {
      console.error('Failed to generate recovery metadata:', error);
      return { success: false, error: 'Failed to generate recovery metadata!' };
    }
  }

  /**
   * Verify recovery data
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {Object} recoveryData
   * @returns {Promise<Object>} - Boolean indicating whether key is valid or not!
   */
  async verify(vaultName, metadata = {}, recoveryData = {}) {
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
   * @returns {Promise<Object>} - Master password
   */
  async recoverMasterPassword(vaultName, metadata, recoveryData = {}) {
    try {
      const salt = Buffer.from(metadata.salt, 'hex');
      const oldPassword = recoveryData.data.password;
      const oldPasswordKey = CryptographyService.deriveKey(oldPassword, salt);
      const masterPassword = CryptographyService.decrypt(
        metadata.encryptedMasterPassword,
        oldPasswordKey
      );

      return { success: true, ...masterPassword };
    } catch (error) {
      console.error('Invalid master password: ', error);
      return { success: false, error: 'Invalid master password' };
    }
  }
}
