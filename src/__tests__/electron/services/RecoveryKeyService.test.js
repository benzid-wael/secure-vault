import { RecoveryKeyService } from '../../../electron/services/RecoveryKeyService.js';
import { CryptographyService } from '../../../electron/services/CryptographyService.js';

describe('RecoveryKeyService', () => {
  describe('generateRecoveryKey', () => {
    it('should generate a recovery key in correct format', () => {
      const recoveryKey = RecoveryKeyService.generateRecoveryKey();

      expect(typeof recoveryKey).toBe('string');
      // The recovery key format is base32 with dashes every 4 characters
      expect(recoveryKey).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})*$/);
      expect(recoveryKey.length).toBeGreaterThan(20); // Should be reasonably long
    });

    it('should generate different recovery keys each time', () => {
      const key1 = RecoveryKeyService.generateRecoveryKey();
      const key2 = RecoveryKeyService.generateRecoveryKey();

      expect(key1).not.toEqual(key2);
    });
  });

  describe('deriveKeyFromRecoveryKey', () => {
    it('should derive key from recovery key and salt', () => {
      const recoveryKey = 'ABCD-1234-EFGH-5678';
      const salt = CryptographyService.generateSalt();

      const key = RecoveryKeyService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive same key with same recovery key and salt', () => {
      const recoveryKey = 'ABCD-1234-EFGH-5678';
      const salt = CryptographyService.generateSalt();

      const key1 = RecoveryKeyService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );
      const key2 = RecoveryKeyService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      expect(key1).toEqual(key2);
    });
  });
});
