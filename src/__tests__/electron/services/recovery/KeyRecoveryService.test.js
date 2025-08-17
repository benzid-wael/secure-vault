import { KeyRecoveryService } from '../../../../electron/services/recovery/KeyRecoveryService.js';
import { CryptographyService } from '../../../../electron/services/CryptographyService.js';
import { beforeEach } from 'vitest';

describe('KeyRecoveryService', () => {
  let keyRecoveryService = null;

  beforeEach(() => {
    keyRecoveryService = new KeyRecoveryService();
  });

  describe('generate', () => {
    it('should generate a recovery key in correct format', async () => {
      const recoveryData = await keyRecoveryService.generate();
      const recoveryKey = recoveryData.data.key;

      console.log('recoveryKey: ', recoveryKey);
      expect(typeof recoveryKey).toBe('string');
      // The recovery key format is base32 with dashes every 4 characters
      expect(recoveryKey).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})*$/);
      expect(recoveryKey.length).toBeGreaterThan(20); // Should be reasonably long
    });

    it('should generate different recovery keys each time', async () => {
      const key1 = (await keyRecoveryService.generate()).data.key;
      const key2 = (await keyRecoveryService.generate()).data.key;

      expect(key1).not.toEqual(key2);
    });
  });

  describe('deriveKeyFromRecoveryKey', () => {
    it('should derive key from recovery key and salt', () => {
      const recoveryKey = 'ABCD-1234-EFGH-5678';
      const salt = CryptographyService.generateSalt();

      const key = KeyRecoveryService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      console.log(key);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive same key with same recovery key and salt', () => {
      const recoveryKey = 'ABCD-1234-EFGH-5678';
      const salt = CryptographyService.generateSalt();

      const key1 = KeyRecoveryService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );
      const key2 = KeyRecoveryService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      expect(key1).toEqual(key2);
    });
  });
});
