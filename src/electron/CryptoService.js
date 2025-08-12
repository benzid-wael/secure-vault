import crypto from 'crypto';

export class CryptoService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.iterations = 100000;
    this.keyLength = 32;
    this.digest = 'sha512';
  }

  encryptData(data, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      authTag: authTag.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  decryptData(encryptedData, key) {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }

  deriveKey(password, salt) {
    return crypto.pbkdf2Sync(
      password,
      salt,
      this.iterations,
      this.keyLength,
      this.digest
    );
  }

  generateSalt() {
    return crypto.randomBytes(32);
  }

  generateRecoveryKey() {
    // Generate a 256-bit (32 byte) recovery key
    const recoveryKeyBytes = crypto.randomBytes(32);

    // Convert to base32 for human readability (similar to Google Authenticator)
    // Using a custom base32 alphabet without confusing characters
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    let bits = 0;
    let value = 0;

    for (let i = 0; i < recoveryKeyBytes.length; i++) {
      value = (value << 8) | recoveryKeyBytes[i];
      bits += 8;

      while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      result += alphabet[(value << (5 - bits)) & 31];
    }

    // Format as groups of 4 characters for readability
    return result.match(/.{1,4}/g).join('-');
  }

  validateRecoveryKeyFormat(recoveryKey) {
    // Remove dashes and convert to uppercase
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();

    // Check if it matches expected format (base32, specific length)
    const base32Regex = /^[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]+$/;
    return base32Regex.test(cleanKey) && cleanKey.length >= 50; // Minimum length for security
  }

  deriveKeyFromRecoveryKey(recoveryKey, salt) {
    // Remove dashes and convert to uppercase
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();

    // Use PBKDF2 to derive encryption key from recovery key
    return crypto.pbkdf2Sync(
      cleanKey,
      salt,
      this.iterations,
      this.keyLength,
      this.digest
    );
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  generateRandomBytes(length) {
    return crypto.randomBytes(length);
  }
}
