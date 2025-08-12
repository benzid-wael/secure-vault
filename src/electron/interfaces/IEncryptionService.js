/**
 * Interface for encryption services
 * Defines the contract for encryption/decryption operations
 */
export class IEncryptionService {
  /**
   * Encrypt data with a given key
   * @param {any} data - Data to encrypt
   * @param {Buffer} key - Encryption key
   * @returns {Object} Encrypted data with metadata
   */
  encryptData(data, key) {
    throw new Error('Method must be implemented');
  }

  /**
   * Decrypt data with a given key
   * @param {Object} encryptedData - Encrypted data with metadata
   * @param {Buffer} key - Decryption key
   * @returns {any} Decrypted data
   */
  decryptData(encryptedData, key) {
    throw new Error('Method must be implemented');
  }

  /**
   * Derive key from password and salt
   * @param {string} password - Password
   * @param {Buffer} salt - Salt
   * @param {number} iterations - Number of iterations
   * @param {number} keyLength - Key length in bytes
   * @param {string} digest - Hash algorithm
   * @returns {Buffer} Derived key
   */
  deriveKey(
    password,
    salt,
    iterations = 100000,
    keyLength = 32,
    digest = 'sha512'
  ) {
    throw new Error('Method must be implemented');
  }

  /**
   * Generate random salt
   * @param {number} length - Salt length in bytes
   * @returns {Buffer} Random salt
   */
  generateSalt(length = 32) {
    throw new Error('Method must be implemented');
  }

  /**
   * Generate random IV
   * @param {number} length - IV length in bytes
   * @returns {Buffer} Random IV
   */
  generateIV(length = 16) {
    throw new Error('Method must be implemented');
  }

  /**
   * Hash data
   * @param {string} data - Data to hash
   * @param {string} algorithm - Hash algorithm
   * @returns {string} Hash in hex format
   */
  hash(data, algorithm = 'sha256') {
    throw new Error('Method must be implemented');
  }
}
