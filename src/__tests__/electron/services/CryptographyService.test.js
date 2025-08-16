import { CryptographyService } from '../../../electron/services/CryptographyService.js';

describe('CryptographyService', () => {
  describe('encrypt', () => {
    it('should encrypt data with valid key', () => {
      const testData = { test: 'data', number: 123 };
      const key = Buffer.alloc(32, 'test-key-32-bytes-long-key-here');

      const result = CryptographyService.encrypt(testData, key);

      expect(result).toHaveProperty('encrypted');
      expect(result).toHaveProperty('authTag');
      expect(result).toHaveProperty('iv');
      expect(typeof result.encrypted).toBe('string');
      expect(typeof result.authTag).toBe('string');
      expect(typeof result.iv).toBe('string');
    });

    it('should throw error with invalid key length', () => {
      const testData = { test: 'data' };
      const invalidKey = Buffer.from('short-key', 'utf8');

      expect(() => {
        CryptographyService.encrypt(testData, invalidKey);
      }).toThrow();
    });
  });

  describe('decrypt', () => {
    it('should decrypt data with correct key', () => {
      const testData = { test: 'data', number: 123 };
      const key = Buffer.alloc(32, 'test-key-32-bytes-long-key-here');

      const encrypted = CryptographyService.encrypt(testData, key);
      const decrypted = CryptographyService.decrypt(encrypted, key);

      expect(decrypted).toEqual(testData);
    });

    it('should throw error with wrong key', () => {
      const testData = { test: 'data' };
      const key1 = Buffer.alloc(32, 'test-key-32-bytes-long-key-here');
      const key2 = Buffer.alloc(32, 'wrong-key-32-bytes-long-key-here');

      const encrypted = CryptographyService.encrypt(testData, key1);

      expect(() => {
        CryptographyService.decrypt(encrypted, key2);
      }).toThrow();
    });
  });

  describe('generateSalt', () => {
    it('should generate a 32-byte salt', () => {
      const salt = CryptographyService.generateSalt();

      expect(salt).toBeInstanceOf(Buffer);
      expect(salt.length).toBe(32);
    });

    it('should generate different salts each time', () => {
      const salt1 = CryptographyService.generateSalt();
      const salt2 = CryptographyService.generateSalt();

      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('deriveKey', () => {
    it('should derive key from password and salt', () => {
      const password = 'test-password';
      const salt = CryptographyService.generateSalt();

      const key = CryptographyService.deriveKey(password, salt);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive same key with same password and salt', () => {
      const password = 'test-password';
      const salt = CryptographyService.generateSalt();

      const key1 = CryptographyService.deriveKey(password, salt);
      const key2 = CryptographyService.deriveKey(password, salt);

      expect(key1).toEqual(key2);
    });

    it('should derive different keys with different salts', () => {
      const password = 'test-password';
      const salt1 = CryptographyService.generateSalt();
      const salt2 = CryptographyService.generateSalt();

      const key1 = CryptographyService.deriveKey(password, salt1);
      const key2 = CryptographyService.deriveKey(password, salt2);

      expect(key1).not.toEqual(key2);
    });
  });
});
