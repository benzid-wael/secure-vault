import { CryptographyService } from '../services/CryptographyService.js';
import {
  PasswordEnvelopeError,
  isFormat2,
  openPayload,
  sealPayload,
} from './passwordVaultEnvelope.js';

/**
 * Reading and re-writing a password vault's payload with what an unlocked
 * session holds (GUI-ENV-BREAKDOWN New-54): the master password for format
 * 1, `{dek}` (the data key) for format 2. Shared by the services that edit
 * a vault in place, so each handles both formats the same way.
 *
 * @typedef {string | {dek: Buffer}} VaultCredential
 */

/** The data key in `credential`, or null for a password. */
const dekOf = (credential) =>
  typeof credential === 'object' &&
  credential !== null &&
  Buffer.isBuffer(credential.dek)
    ? credential.dek
    : null;

/** A format-2 vault reached with only a password. */
export const keyFileRequired = () =>
  new PasswordEnvelopeError(
    'KEY_FILE_REQUIRED',
    'This vault needs its key file as well as its password.'
  );

const formatOneKey = (file, credential, deriveKey) => {
  if (typeof credential !== 'string') {
    throw new Error('A format-1 vault is opened with its password');
  }
  return deriveKey(
    credential,
    Buffer.from(file.salt, 'hex'),
    CryptographyService.iterationsOf(file)
  );
};

/**
 * The decrypted payload of `file`.
 * @param {Object} file
 * @param {VaultCredential} credential
 * @param {Function} deriveKey PBKDF2, the session's caching one where there is one.
 * @throws {PasswordEnvelopeError} `KEY_FILE_REQUIRED` or `TAMPERED` for
 *   format 2; a decryption error for a wrong format-1 password.
 */
export function openVaultPayload(file, credential, deriveKey) {
  if (isFormat2(file)) {
    const dek = dekOf(credential);
    if (!dek) throw keyFileRequired();
    return openPayload(file, dek);
  }
  return CryptographyService.decrypt(
    { encrypted: file.encrypted, authTag: file.authTag, iv: file.iv },
    formatOneKey(file, credential, deriveKey)
  );
}

/**
 * `file` with `payload` encrypted again under the keys it already uses:
 * format 2 keeps its header and slots; format 1 its salt, `kdf` and
 * recovery metadata.
 * @param {Object} file
 * @param {Object} payload
 * @param {VaultCredential} credential
 * @param {Function} deriveKey PBKDF2, the session's caching one where there is one.
 */
export function resealVaultPayload(file, payload, credential, deriveKey) {
  if (isFormat2(file)) {
    const dek = dekOf(credential);
    if (!dek) throw keyFileRequired();
    return sealPayload(file, payload, dek);
  }
  return {
    ...CryptographyService.encrypt(
      payload,
      formatOneKey(file, credential, deriveKey)
    ),
    ...CryptographyService.keyHeaderOf(file),
    recoveryMetadata: file.recoveryMetadata || {},
  };
}
