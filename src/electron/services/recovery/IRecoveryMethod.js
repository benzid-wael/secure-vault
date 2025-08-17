export class RecoveryData {
  constructor({ data, isEncrypted = false, hint = '' } = {}) {
    this.data = data;
    this.isEncrypted = isEncrypted;
    this.hint = hint;
  }

  toJSON() {
    return {
      data: this.data,
      isEncrypted: this.isEncrypted,
      hint: this.hint,
    };
  }
}

export class IRecoveryMethod {
  /**
   * Get the unique identifier for this recovery method
   * @returns {string} Unique identifier
   */
  getRecoveryMethodId() {
    throw new Error('getRecoveryMethodId() must be implemented by subclass');
  }

  /**
   * Check if the metadata is valid
   * @param {string} vaultName
   * @param {Object} metadata
   * @returns {Promise<boolean>}
   */
  isValid(vaultName, metadata) {
    throw new Error('isValid() must be implemented by subclass');
  }

  /**
   * Generate new recovery method
   * @param {string} vaultName
   * @returns {Promise<RecoveryData>} RecoveryData
   */
  async generate(vaultName) {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Create and returns metadata for the recovery option
   * @param {string} vaultName
   * @param {str} masterPassword
   * @param {Object} recoveryData
   * @returns {Promise<Object>} - metadata object
   */
  createMetadata(vaultName, masterPassword, recoveryData = {}) {
    throw new Error('createMetadata() must be implemented by subclass');
  }

  /**
   * Verify recovery data
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {Object} recoveryData
   * @returns {Promise<boolean>} - Boolean indicating whether key is valid or not!
   */
  async verify(vaultName, metadata = {}, recoveryData = {}) {
    throw new Error('verify() must be implemented by subclass');
  }

  /**
   * recover master password
   * @param {string} vaultName
   * @param {Object} recoveryData
   * @returns {Promise<str>} - Master password
   */
  async recoverMasterPassword(vaultName, recoveryData = {}) {
    throw new Error('recoverMasterPassword() must be implemented by subclass');
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
    throw new Error('onPasswordChange() must be implemented by subclass');
  }
}
