import crypto from 'crypto';
import { IEncryptionService } from '../interfaces/IEncryptionService.js';

/**
 * Concrete implementation of encryption service using Node.js crypto
 * Follows Single Responsibility Principle - only handles encryption/decryption
 */
export class EncryptionService extends IEncryptionService {
  constructor() {
    super();
    this.algorithm = 'aes-256-gcm';
    this.keyDerivationAlgorithm = 'pbkdf2';
  }

  /**
   * Encrypt data with a given key
   * @param {any} data - Data to encrypt
   * @param {Buffer} key - Encryption key
   * @returns {Object} Encrypted data with metadata
   */
  encryptData(data, key) {
    try {
      const iv = this.generateIV();
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return {
        encrypted,
        authTag: authTag.toString('hex'),
        iv: iv.toString('hex'),
        algorithm: this.algorithm,
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data with a given key
   * @param {Object} encryptedData - Encrypted data with metadata
   * @param {Buffer} key - Decryption key
   * @returns {any} Decrypted data
   */
  decryptData(encryptedData, key) {
    try {
      const {
        encrypted,
        authTag,
        iv,
        algorithm = this.algorithm,
      } = encryptedData;

      const ivBuffer = Buffer.from(iv, 'hex');
      const decipher = crypto.createDecipheriv(algorithm, key, ivBuffer);
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
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
    try {
      return crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
    } catch (error) {
      throw new Error(`Key derivation failed: ${error.message}`);
    }
  }

  /**
   * Generate random salt
   * @param {number} length - Salt length in bytes
   * @returns {Buffer} Random salt
   */
  generateSalt(length = 32) {
    return crypto.randomBytes(length);
  }

  /**
   * Generate random IV
   * @param {number} length - IV length in bytes
   * @returns {Buffer} Random IV
   */
  generateIV(length = 16) {
    return crypto.randomBytes(length);
  }

  /**
   * Hash data
   * @param {string} data - Data to hash
   * @param {string} algorithm - Hash algorithm
   * @returns {string} Hash in hex format
   */
  hash(data, algorithm = 'sha256') {
    try {
      return crypto.createHash(algorithm).update(data).digest('hex');
    } catch (error) {
      throw new Error(`Hashing failed: ${error.message}`);
    }
  }

  /**
   * Validate encryption parameters
   * @param {Buffer} key - Encryption key
   * @param {Object} data - Data to validate
   * @throws {Error} If parameters are invalid
   */
  validateEncryptionParams(key, data) {
    if (!Buffer.isBuffer(key)) {
      throw new Error('Key must be a Buffer');
    }

    if (key.length !== 32) {
      throw new Error('Key must be 32 bytes for AES-256');
    }

    if (data === undefined || data === null) {
      throw new Error('Data cannot be null or undefined');
    }
  }

  /**
   * Validate decryption parameters
   * @param {Object} encryptedData - Encrypted data to validate
   * @param {Buffer} key - Decryption key
   * @throws {Error} If parameters are invalid
   */
  validateDecryptionParams(encryptedData, key) {
    if (!encryptedData || typeof encryptedData !== 'object') {
      throw new Error('Encrypted data must be an object');
    }

    const requiredFields = ['encrypted', 'authTag', 'iv'];
    for (const field of requiredFields) {
      if (!encryptedData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    this.validateEncryptionParams(key, {});
  }
}
