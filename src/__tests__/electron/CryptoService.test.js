import { CryptoService } from '../../electron/CryptoService.js';

describe('CryptoService', () => {
  let cryptoService;

  beforeEach(() => {
    cryptoService = new CryptoService();
  });

  describe('encryptData', () => {
    it('should encrypt data with valid key', () => {
      const testData = { test: 'data', number: 123 };
      const key = Buffer.alloc(32, 'test-key-32-bytes-long-key-here');

      const result = cryptoService.encryptData(testData, key);

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
        cryptoService.encryptData(testData, invalidKey);
      }).toThrow();
    });
  });

  describe('decryptData', () => {
    it('should decrypt data with correct key', () => {
      const testData = { test: 'data', number: 123 };
      const key = Buffer.alloc(32, 'test-key-32-bytes-long-key-here');

      const encrypted = cryptoService.encryptData(testData, key);
      const decrypted = cryptoService.decryptData(encrypted, key);

      expect(decrypted).toEqual(testData);
    });

    it('should throw error with wrong key', () => {
      const testData = { test: 'data' };
      const key1 = Buffer.alloc(32, 'test-key-32-bytes-long-key-here');
      const key2 = Buffer.alloc(32, 'wrong-key-32-bytes-long-key-here');

      const encrypted = cryptoService.encryptData(testData, key1);

      expect(() => {
        cryptoService.decryptData(encrypted, key2);
      }).toThrow();
    });
  });

  describe('generateSalt', () => {
    it('should generate a 32-byte salt', () => {
      const salt = cryptoService.generateSalt();

      expect(salt).toBeInstanceOf(Buffer);
      expect(salt.length).toBe(32);
    });

    it('should generate different salts each time', () => {
      const salt1 = cryptoService.generateSalt();
      const salt2 = cryptoService.generateSalt();

      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('deriveKey', () => {
    it('should derive key from password and salt', () => {
      const password = 'test-password';
      const salt = cryptoService.generateSalt();

      const key = cryptoService.deriveKey(password, salt);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive same key with same password and salt', () => {
      const password = 'test-password';
      const salt = cryptoService.generateSalt();

      const key1 = cryptoService.deriveKey(password, salt);
      const key2 = cryptoService.deriveKey(password, salt);

      expect(key1).toEqual(key2);
    });

    it('should derive different keys with different salts', () => {
      const password = 'test-password';
      const salt1 = cryptoService.generateSalt();
      const salt2 = cryptoService.generateSalt();

      const key1 = cryptoService.deriveKey(password, salt1);
      const key2 = cryptoService.deriveKey(password, salt2);

      expect(key1).not.toEqual(key2);
    });
  });

  describe('generateRecoveryKey', () => {
    it('should generate a recovery key in correct format', () => {
      const recoveryKey = cryptoService.generateRecoveryKey();

      expect(typeof recoveryKey).toBe('string');
      // The recovery key format is base32 with dashes every 4 characters
      expect(recoveryKey).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})*$/);
      expect(recoveryKey.length).toBeGreaterThan(20); // Should be reasonably long
    });

    it('should generate different recovery keys each time', () => {
      const key1 = cryptoService.generateRecoveryKey();
      const key2 = cryptoService.generateRecoveryKey();

      expect(key1).not.toEqual(key2);
    });
  });

  describe('deriveKeyFromRecoveryKey', () => {
    it('should derive key from recovery key and salt', () => {
      const recoveryKey = 'ABCD-1234-EFGH-5678';
      const salt = cryptoService.generateSalt();

      const key = cryptoService.deriveKeyFromRecoveryKey(recoveryKey, salt);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive same key with same recovery key and salt', () => {
      const recoveryKey = 'ABCD-1234-EFGH-5678';
      const salt = cryptoService.generateSalt();

      const key1 = cryptoService.deriveKeyFromRecoveryKey(recoveryKey, salt);
      const key2 = cryptoService.deriveKeyFromRecoveryKey(recoveryKey, salt);

      expect(key1).toEqual(key2);
    });
  });
});
