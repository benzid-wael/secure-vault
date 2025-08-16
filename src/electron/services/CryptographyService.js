import crypto from 'crypto';

export class CryptographyService {
  static ITERATIONS = 100000;
  static KEY_LENGTH = 32;
  static IV_LENGTH = 16;
  static ALGORITHM = 'aes-256-gcm';
  static HASH_ALGORITHM = 'sha512';

  static generateSalt(length = 32) {
    return crypto.randomBytes(length);
  }

  static deriveKey(password, salt, iterations = this.ITERATIONS) {
    return crypto.pbkdf2Sync(
      password,
      salt,
      iterations,
      this.KEY_LENGTH,
      this.HASH_ALGORITHM
    );
  }

  static encrypt(data, key) {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      authTag: authTag.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  static decrypt(encryptedData, key) {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }

  static hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }
}
