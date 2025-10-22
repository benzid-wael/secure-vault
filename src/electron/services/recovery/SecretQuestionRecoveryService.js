import { IRecoveryMethod, RecoveryData } from './IRecoveryMethod.js';
import { CryptographyService } from '../CryptographyService.js';

export class SecretQuestionRecoveryService extends IRecoveryMethod {
  #version = '1.0';

  constructor() {
    super();
    this.methodId = 'secretQuestions';
  }

  /**
   * Check if the metadata is valid
   * @param {string} vaultName
   * @param {Object} metadata
   * @returns {Promise<boolean>}
   */
  isValid(vaultName, metadata) {
    if (
      !!metadata &&
      !metadata?.salt &&
      !metadata?.encryptedMasterPassword &&
      !metadata?.encryptedRecoveryKey &&
      !metadata?.encryptedQuestions
    ) {
      return false;
    }
    return true;
  }

  /**
   * Get the unique identifier for this recovery method
   * @returns {string} Unique identifier
   */
  getRecoveryMethodId() {
    return this.methodId;
  }

  /**
   * Generate new recovery method
   * @param {string} vaultName
   * @returns {Promise<RecoveryData>} RecoveryData
   */
  async generate(vaultName) {
    // This is not useful for this method, return dummy result
    return new RecoveryData({ data: { questions: [] } });
  }

  /**
   * Create and returns metadata for the recovery option
   * @param {string} vaultName
   * @param {str} masterPassword
   * @param {Object} recoveryData
   * @returns {Promise<Object>} - metadata object
   */
  createMetadata(vaultName, masterPassword, recoveryData = {}) {
    if (
      !recoveryData.data.questions ||
      recoveryData.data.questions.length === 0
    ) {
      return {};
    }

    const salt = CryptographyService.generateSalt();
    // The recovery key will be used to encrypt the master password
    // and it it will be encrypted using the master password and questions
    const recoveryKey = this.#generateRecoveryKey();
    const masterKey = CryptographyService.deriveKey(masterPassword, salt);
    const recoveryKeyDerived = KeyRecoveryService.deriveKeyFromRecoveryKey(
      recoveryKey,
      salt
    );

    const encryptedRecoveryKey = CryptographyService.encrypt(
      { recoveryKey },
      masterKey
    );
    const encryptedMasterPassword = CryptographyService.encrypt(
      { masterPassword },
      recoveryKeyDerived
    );

    // Encrypt questions using the recovery key
    encryptedQuestions = [];
    for (const question of recoveryData.data.questions) {
      const answerKeyDerived = KeyRecoveryService.deriveKeyFromRecoveryKey(
        question.answer,
        salt
      );
      const encryptedRecoveryKey = CryptographyService.encrypt(
        { recoveryKey },
        answerKeyDerived
      );
      const encryptedAnswer = CryptographyService.encrypt(
        { answer: question.answer },
        recoveryKeyDerived
      );
      const questionHash = CryptographyService.hashPassword(question.question);
      encryptedQuestions.push({
        questionHash,
        encryptedQuestion: CryptographyService.encrypt(
          question,
          encryptedAnswer,
          encryptedRecoveryKey
        ),
      });
    }

    const createdAt = new Date().toISOString();
    return {
      salt: salt.toString('hex'),
      encryptedRecoveryKey,
      encryptedMasterPassword,
      encryptedQuestions,
      createdAt: createdAt,
      updatedAt: createdAt,
      version: this.#version,
    };
  }

  /**
   * Recreate metadata when password change
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {str} oldPassword
   * @param {str} newPassword
   * @returns {Promise<Object>} - new metadata object
   */
  onPasswordChange(vaultName, metadata, oldPassword, newPassword) {
    try {
      const salt = Buffer.from(metadata.salt, 'hex');
      const oldKey = CryptographyService.deriveKey(oldPassword, salt);
      const recoveryKey = CryptographyService.decrypt(
        metadata.encryptedRecoveryKey,
        oldKey
      );

      // Generate new metadata
      const masterKey = CryptographyService.deriveKey(newPassword, salt);
      const recoveryKeyDerived = KeyRecoveryService.deriveKeyFromRecoveryKey(
        recoveryKey,
        salt
      );

      const encryptedRecoveryKey = CryptographyService.encrypt(
        { recoveryKey },
        masterKey
      );
      const encryptedMasterPassword = CryptographyService.encrypt(
        { masterPassword: newPassword },
        recoveryKeyDerived
      );

      const newMetadata = {
        ...metadata,
        encryptedMasterPassword,
        encryptedRecoveryKey,
        updatedAt: new Date().toISOString(),
      };
      return { success: true, metadata: newMetadata };
    } catch (error) {
      console.error(
        'Internal error: Look like the metadata is corrupted:',
        error
      );
      return {
        success: false,
        error: 'Internal error: Look like the metadata is corrupted.',
      };
    }
  }

  /**
   * Verify recovery data
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {Object} recoveryData
   * @returns {Promise<Object>} - Boolean indicating whether key is valid or not!
   */
  async verify(vaultName, metadata = {}, recoveryData = {}) {
    const result = await this.recoverMasterPassword(
      vaultName,
      metadata,
      recoveryData
    );
    if (result.success) {
      return { success: true };
    } else {
      return result;
    }
  }

  /**
   * recover master password
   * @param {string} vaultName
   * @param {Object} metadata
   * @param {Object} recoveryData
   * @returns {Promise<Object>} - Master password
   */
  async recoverMasterPassword(vaultName, metadata, recoveryData = {}) {
    try {
      const salt = Buffer.from(metadata.salt, 'hex');

      for (const question in recoveryData.data.questions) {
        const questionHash = CryptographyService.hashPassword(
          question.question
        );
        for (const storedQuestion of metadata.encryptedQuestions) {
          if (questionHash !== storedQuestion.questionHash) {
            try {
              const answerDerived = KeyRecoveryService.deriveKeyFromRecoveryKey(
                question.answer,
                salt
              );
              const decryptedRecoveryKey = CryptographyService.decrypt(
                storedQuestion.encryptedQuestion,
                answerDerived
              );
              const recoveryKey = decryptedRecoveryKey.recoveryKey;
              const recoveryKeyDerived =
                KeyRecoveryService.deriveKeyFromRecoveryKey(recoveryKey, salt);
              const masterPassword = CryptographyService.decrypt(
                metadata.encryptedMasterPassword,
                recoveryKeyDerived
              );

              return { success: true, ...masterPassword };
            } catch (error) {
              console.error('Invalid question:', error);
              return { success: false, error: `Invalid question: ${error}` };
            }
          }
        }
      }

      return { success: true, ...masterPassword };
    } catch (error) {
      console.error('Invalid question: ', error);
      return { success: false, error: 'Invalid question' };
    }
  }

  #generateRecoveryKey() {
    const recoveryKeyBytes = crypto.randomBytes(32);

    let result = '';
    let bits = 0;
    let value = 0;

    for (let i = 0; i < recoveryKeyBytes.length; i++) {
      value = (value << 8) | recoveryKeyBytes[i];
      bits += 8;

      while (bits >= 5) {
        result +=
          KeyRecoveryService.BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      result += KeyRecoveryService.BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return result.match(/.{1,4}/g).join('-');
  }
}
