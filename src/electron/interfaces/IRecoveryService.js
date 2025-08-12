/**
 * Interface for recovery key operations
 * Defines the contract for recovery key generation and validation
 */
export class IRecoveryService {
  /**
   * Generate a new recovery key
   * @returns {string} Recovery key in human-readable format
   */
  generateRecoveryKey() {
    throw new Error('Method must be implemented');
  }

  /**
   * Validate recovery key format
   * @param {string} recoveryKey - Recovery key to validate
   * @returns {boolean} True if format is valid
   */
  validateRecoveryKeyFormat(recoveryKey) {
    throw new Error('Method must be implemented');
  }

  /**
   * Derive encryption key from recovery key
   * @param {string} recoveryKey - Recovery key
   * @param {Buffer} salt - Salt for key derivation
   * @returns {Buffer} Derived encryption key
   */
  deriveKeyFromRecoveryKey(recoveryKey, salt) {
    throw new Error('Method must be implemented');
  }

  /**
   * Create bidirectional encryption between master password and recovery key
   * @param {string} masterPassword - Master password
   * @param {string} recoveryKey - Recovery key
   * @param {Buffer} salt - Salt for encryption
   * @returns {Object} Encrypted recovery metadata
   */
  createBidirectionalEncryption(masterPassword, recoveryKey, salt) {
    throw new Error('Method must be implemented');
  }

  /**
   * Verify recovery key against vault
   * @param {string} recoveryKey - Recovery key to verify
   * @param {Object} recoveryMetadata - Recovery metadata from vault
   * @param {Buffer} salt - Vault salt
   * @returns {boolean} True if recovery key is valid
   */
  verifyRecoveryKey(recoveryKey, recoveryMetadata, salt) {
    throw new Error('Method must be implemented');
  }

  /**
   * Recover master password using recovery key
   * @param {string} recoveryKey - Recovery key
   * @param {Object} recoveryMetadata - Recovery metadata from vault
   * @param {Buffer} salt - Vault salt
   * @returns {string} Recovered master password
   */
  recoverMasterPassword(recoveryKey, recoveryMetadata, salt) {
    throw new Error('Method must be implemented');
  }
}
