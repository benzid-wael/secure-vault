import crypto from 'crypto';
import { CryptographyService } from './CryptographyService.js';

export class RecoveryKeyService {
  static BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  static MIN_KEY_LENGTH = 50;

  static generateRecoveryKey() {
    const recoveryKeyBytes = crypto.randomBytes(32);

    let result = '';
    let bits = 0;
    let value = 0;

    for (let i = 0; i < recoveryKeyBytes.length; i++) {
      value = (value << 8) | recoveryKeyBytes[i];
      bits += 8;

      while (bits >= 5) {
        result += this.BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      result += this.BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return result.match(/.{1,4}/g).join('-');
  }

  static validateRecoveryKeyFormat(recoveryKey) {
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();
    const base32Regex = /^[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]+$/;
    return base32Regex.test(cleanKey) && cleanKey.length >= this.MIN_KEY_LENGTH;
  }

  static deriveKeyFromRecoveryKey(recoveryKey, salt) {
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();
    return CryptographyService.deriveKey(cleanKey, salt);
  }

  static createRecoveryMetadata(recoveryKey, masterPassword, salt) {
    const masterKey = CryptographyService.deriveKey(masterPassword, salt);
    const recoveryKeyDerived = this.deriveKeyFromRecoveryKey(recoveryKey, salt);

    const encryptedRecoveryKey = CryptographyService.encrypt(
      { recoveryKey },
      masterKey
    );
    const encryptedMasterPassword = CryptographyService.encrypt(
      { masterPassword },
      recoveryKeyDerived
    );

    return {
      recoveryKey: {
        encryptedRecoveryKey,
        encryptedMasterPassword,
        createdAt: new Date().toISOString(),
        version: 1,
      },
    };
  }
}
