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

      const key = CryptographyService.deriveKey(password, salt, 1000);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive same key with same password and salt', () => {
      const password = 'test-password';
      const salt = CryptographyService.generateSalt();

      const key1 = CryptographyService.deriveKey(password, salt, 1000);
      const key2 = CryptographyService.deriveKey(password, salt, 1000);

      expect(key1).toEqual(key2);
    });

    it('should derive different keys with different salts', () => {
      const password = 'test-password';
      const salt1 = CryptographyService.generateSalt();
      const salt2 = CryptographyService.generateSalt();

      const key1 = CryptographyService.deriveKey(password, salt1, 1000);
      const key2 = CryptographyService.deriveKey(password, salt2, 1000);

      expect(key1).not.toEqual(key2);
    });
  });

  describe('deriveKeyAsync', () => {
    it('derives the same key as deriveKey', async () => {
      const salt = CryptographyService.generateSalt();

      const key = await CryptographyService.deriveKeyAsync('pw', salt, 1000);

      expect(key.length).toBe(32);
      expect(key.equals(CryptographyService.deriveKey('pw', salt, 1000))).toBe(
        true
      );
    });

    it('requires iterations explicitly', async () => {
      await expect(
        CryptographyService.deriveKeyAsync('pw', Buffer.alloc(32))
      ).rejects.toThrow('iterations is required');
    });

    it('leaves the event loop free while deriving', async () => {
      // At this count PBKDF2 takes tens of ms: a sync derivation would run the
      // whole of it before the already-queued immediate gets a turn.
      const order = [];
      setImmediate(() => order.push('immediate'));

      await CryptographyService.deriveKeyAsync(
        'pw',
        CryptographyService.generateSalt(),
        200000
      ).then(() => order.push('derived'));

      expect(order).toEqual(['immediate', 'derived']);
    });
  });

  describe('deriveKeyForAsync', () => {
    const salt = Buffer.alloc(32, 7).toString('hex');

    it("derives the same key as deriveKeyFor at the record's count", async () => {
      const record = { salt, kdf: CryptographyService.kdfHeader() };

      const key = await CryptographyService.deriveKeyForAsync('pw', record);

      expect(key.equals(CryptographyService.deriveKeyFor('pw', record))).toBe(
        true
      );
    });

    it('reads a record without a kdf header at the legacy count', async () => {
      const key = await CryptographyService.deriveKeyForAsync('pw', { salt });

      expect(
        key.equals(
          CryptographyService.deriveKey(
            'pw',
            Buffer.from(salt, 'hex'),
            CryptographyService.LEGACY_ITERATIONS
          )
        )
      ).toBe(true);
    });

    it('rejects unsupported kdf parameters', async () => {
      await expect(
        CryptographyService.deriveKeyForAsync('pw', {
          salt,
          kdf: { name: 'scrypt', iterations: 1000 },
        })
      ).rejects.toThrow('Unsupported key derivation parameters');
    });
  });
});
