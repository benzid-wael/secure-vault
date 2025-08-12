import crypto from 'crypto';
import { IRecoveryService } from '../interfaces/IRecoveryService.js';

/**
 * Concrete implementation of recovery service
 * Follows Single Responsibility Principle - only handles recovery key operations
 */
export class RecoveryService extends IRecoveryService {
  constructor(encryptionService) {
    super();
    this.encryptionService = encryptionService;
    this.base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    this.recoveryKeyLength = 32; // 256 bits
    this.minRecoveryKeyLength = 50; // Minimum length for security
  }

  /**
   * Generate a new recovery key
   * @returns {string} Recovery key in human-readable format
   */
  generateRecoveryKey() {
    try {
      // Generate a 256-bit (32 byte) recovery key
      const recoveryKeyBytes = crypto.randomBytes(this.recoveryKeyLength);

      // Convert to base32 for human readability
      let result = '';
      let bits = 0;
      let value = 0;

      for (let i = 0; i < recoveryKeyBytes.length; i++) {
        value = (value << 8) | recoveryKeyBytes[i];
        bits += 8;

        while (bits >= 5) {
          result += this.base32Alphabet[(value >>> (bits - 5)) & 31];
          bits -= 5;
        }
      }

      if (bits > 0) {
        result += this.base32Alphabet[(value << (5 - bits)) & 31];
      }

      // Format as groups of 4 characters for readability
      return result.match(/.{1,4}/g).join('-');
    } catch (error) {
      throw new Error(`Failed to generate recovery key: ${error.message}`);
    }
  }

  /**
   * Validate recovery key format
   * @param {string} recoveryKey - Recovery key to validate
   * @returns {boolean} True if format is valid
   */
  validateRecoveryKeyFormat(recoveryKey) {
    try {
      if (!recoveryKey || typeof recoveryKey !== 'string') {
        return false;
      }

      // Remove dashes and convert to uppercase
      const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();

      // Check if it matches expected format (base32, specific length)
      const base32Regex = new RegExp(`^[${this.base32Alphabet}]+$`);
      return (
        base32Regex.test(cleanKey) &&
        cleanKey.length >= this.minRecoveryKeyLength
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Derive encryption key from recovery key
   * @param {string} recoveryKey - Recovery key
   * @param {Buffer} salt - Salt for key derivation
   * @returns {Buffer} Derived encryption key
   */
  deriveKeyFromRecoveryKey(recoveryKey, salt) {
    try {
      if (!this.validateRecoveryKeyFormat(recoveryKey)) {
        throw new Error('Invalid recovery key format');
      }

      // Remove dashes and convert to uppercase
      const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();

      // Use PBKDF2 to derive encryption key from recovery key
      return this.encryptionService.deriveKey(
        cleanKey,
        salt,
        100000,
        32,
        'sha512'
      );
    } catch (error) {
      throw new Error(
        `Failed to derive key from recovery key: ${error.message}`
      );
    }
  }

  /**
   * Create bidirectional encryption between master password and recovery key
   * @param {string} masterPassword - Master password
   * @param {string} recoveryKey - Recovery key
   * @param {Buffer} salt - Salt for encryption
   * @returns {Object} Encrypted recovery metadata
   */
  createBidirectionalEncryption(masterPassword, recoveryKey, salt) {
    try {
      if (!this.validateRecoveryKeyFormat(recoveryKey)) {
        throw new Error('Invalid recovery key format');
      }

      // Derive keys
      const masterKey = this.encryptionService.deriveKey(masterPassword, salt);
      const recoveryKeyDerived = this.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      // Encrypt recovery key with master password
      const encryptedRecoveryKey = this.encryptionService.encryptData(
        { recoveryKey },
        masterKey
      );

      // Encrypt master password with recovery key
      const encryptedMasterPassword = this.encryptionService.encryptData(
        { masterPassword },
        recoveryKeyDerived
      );

      return {
        encryptedRecoveryKey,
        encryptedMasterPassword,
        createdAt: new Date().toISOString(),
        version: 1,
      };
    } catch (error) {
      throw new Error(
        `Failed to create bidirectional encryption: ${error.message}`
      );
    }
  }

  /**
   * Verify recovery key against vault
   * @param {string} recoveryKey - Recovery key to verify
   * @param {Object} recoveryMetadata - Recovery metadata from vault
   * @param {Buffer} salt - Vault salt
   * @returns {boolean} True if recovery key is valid
   */
  verifyRecoveryKey(recoveryKey, recoveryMetadata, salt) {
    try {
      if (!this.validateRecoveryKeyFormat(recoveryKey)) {
        return false;
      }

      if (!recoveryMetadata?.recoveryKey?.encryptedMasterPassword) {
        return false;
      }

      // Try to decrypt master password with recovery key
      const recoveryKeyDerived = this.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );
      this.encryptionService.decryptData(
        recoveryMetadata.recoveryKey.encryptedMasterPassword,
        recoveryKeyDerived
      );

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Recover master password using recovery key
   * @param {string} recoveryKey - Recovery key
   * @param {Object} recoveryMetadata - Recovery metadata from vault
   * @param {Buffer} salt - Vault salt
   * @returns {string} Recovered master password
   */
  recoverMasterPassword(recoveryKey, recoveryMetadata, salt) {
    try {
      if (!this.validateRecoveryKeyFormat(recoveryKey)) {
        throw new Error('Invalid recovery key format');
      }

      if (!recoveryMetadata?.recoveryKey?.encryptedMasterPassword) {
        throw new Error('No recovery data found');
      }

      // Decrypt master password using recovery key
      const recoveryKeyDerived = this.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );
      const decryptedData = this.encryptionService.decryptData(
        recoveryMetadata.recoveryKey.encryptedMasterPassword,
        recoveryKeyDerived
      );

      if (!decryptedData.masterPassword) {
        throw new Error('Invalid recovery data structure');
      }

      return decryptedData.masterPassword;
    } catch (error) {
      throw new Error(`Failed to recover master password: ${error.message}`);
    }
  }

  /**
   * Update recovery metadata for password change
   * @param {Object} existingMetadata - Existing recovery metadata
   * @param {string} newMasterPassword - New master password
   * @param {Buffer} newSalt - New salt
   * @param {string} currentMasterPassword - Current master password
   * @param {Buffer} currentSalt - Current salt
   * @returns {Object} Updated recovery metadata
   */
  updateRecoveryMetadataForPasswordChange(
    existingMetadata,
    newMasterPassword,
    newSalt,
    currentMasterPassword,
    currentSalt
  ) {
    try {
      const updatedMetadata = { ...existingMetadata };

      // Update recovery key data if it exists
      if (existingMetadata.recoveryKey) {
        // Decrypt recovery key with current password
        const currentKey = this.encryptionService.deriveKey(
          currentMasterPassword,
          currentSalt
        );
        const decryptedRecoveryKeyData = this.encryptionService.decryptData(
          existingMetadata.recoveryKey.encryptedRecoveryKey,
          currentKey
        );
        const recoveryKey = decryptedRecoveryKeyData.recoveryKey;

        // Re-encrypt recovery key with new password
        const newKey = this.encryptionService.deriveKey(
          newMasterPassword,
          newSalt
        );
        const newEncryptedRecoveryKey = this.encryptionService.encryptData(
          { recoveryKey },
          newKey
        );

        // Re-encrypt new password with recovery key
        const recoveryKeyDerived = this.deriveKeyFromRecoveryKey(
          recoveryKey,
          newSalt
        );
        const newEncryptedMasterPassword = this.encryptionService.encryptData(
          { masterPassword: newMasterPassword },
          recoveryKeyDerived
        );

        updatedMetadata.recoveryKey = {
          ...existingMetadata.recoveryKey,
          encryptedRecoveryKey: newEncryptedRecoveryKey,
          encryptedMasterPassword: newEncryptedMasterPassword,
        };
      }

      return updatedMetadata;
    } catch (error) {
      throw new Error(`Failed to update recovery metadata: ${error.message}`);
    }
  }

  /**
   * Clean recovery key string for processing
   * @param {string} recoveryKey - Recovery key to clean
   * @returns {string} Cleaned recovery key
   */
  cleanRecoveryKey(recoveryKey) {
    if (!recoveryKey || typeof recoveryKey !== 'string') {
      throw new Error('Recovery key must be a string');
    }

    return recoveryKey.replace(/-/g, '').toUpperCase();
  }
}
