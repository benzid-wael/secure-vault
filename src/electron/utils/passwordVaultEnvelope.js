import crypto from 'crypto';

import { CryptographyService } from '../services/CryptographyService.js';

/**
 * Password vault format 2 (PASSWORD-VAULT-2FA-RFC.md, GUI-ENV-BREAKDOWN
 * New-54): the payload is encrypted under a random data key (DEK), and the
 * DEK is kept twice, wrapped in two slots:
 *
 * - `main`, under HKDF(PBKDF2(password, salt) ‖ key file key);
 * - `recovery`, under PBKDF2(recovery key, slots.recovery.salt).
 *
 * Every tag covers the plaintext header it depends on, so editing it makes
 * the file refuse to open. A slot covers only the format and its own
 * settings: re-wrapping one slot (a new password, a new recovery key) never
 * needs the other slot's key. The payload covers the whole header, and is
 * re-sealed whenever the header changes; the DEK is always at hand then.
 *
 * These functions don't touch the disk and don't run PBKDF2, except
 * `recoveryKekOf`: callers derive, cache and zero keys.
 */
export const FORMAT_2 = 2;
export const KEY_FILE_FEATURE = 'keyfile';
export const KEY_LENGTH = 32;

const LABEL = 'secure-vault password vault';
const MAIN_INFO = 'secure-vault password-vault v2 main';
const CHECK_LABEL = 'secure-vault password-vault slot check';
export const KEY_FILE_TYPE = 'secure-vault-key-file';

/**
 * A failure to open: `AUTH` (wrong password), `KEY_FILE` (not this vault's
 * key file), `INVALID_KEY_FILE` (not a key file), `KEY_FILE_REQUIRED` (a
 * password alone for a vault that needs its key file too), `TAMPERED` (the
 * header was changed, or the file is damaged).
 */
export class PasswordEnvelopeError extends Error {
  /**
   * @param {'AUTH'|'KEY_FILE'|'INVALID_KEY_FILE'|'KEY_FILE_REQUIRED'|'TAMPERED'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const tampered = () =>
  new PasswordEnvelopeError(
    'TAMPERED',
    "This vault's header was changed after it was written, or the file is " +
      "damaged, so it can't be trusted. Restore it from its backup or " +
      'another copy.'
  );

// Key file -------------------------------------------------------------

/** A new key file's content, as an object to write as JSON. */
export function createKeyFile() {
  return {
    type: KEY_FILE_TYPE,
    version: 1,
    key: crypto.randomBytes(KEY_LENGTH).toString('base64'),
  };
}

/**
 * The key in a key file's text.
 * @param {string|Buffer} text
 * @returns {Buffer}
 * @throws {PasswordEnvelopeError} `INVALID_KEY_FILE`
 */
export function parseKeyFile(text) {
  let data;
  try {
    data = JSON.parse(text.toString());
  } catch {
    data = null;
  }
  const key =
    data?.type === KEY_FILE_TYPE &&
    data.version === 1 &&
    typeof data.key === 'string'
      ? Buffer.from(data.key, 'base64')
      : null;
  if (!key || key.length !== KEY_LENGTH) {
    throw new PasswordEnvelopeError(
      'INVALID_KEY_FILE',
      "This isn't a SecureVault key file."
    );
  }
  return key;
}

/** What a vault records of its key file: 8 bytes of SHA-256, hex. */
export const keyFileIdOf = (key) =>
  crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

// Keys -----------------------------------------------------------------

/** A fresh data key. */
export const newDataKey = () => crypto.randomBytes(KEY_LENGTH);

/**
 * The `main` slot's key from the password's PBKDF2 key and the key file's.
 * @param {Buffer} passwordKey PBKDF2(password, salt) at the vault's `kdf`.
 * @param {Buffer} keyFileKey
 * @param {string} salt The vault's salt, hex.
 */
export const mainKekOf = (passwordKey, keyFileKey, salt) =>
  Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.concat([passwordKey, keyFileKey]),
      Buffer.from(salt, 'hex'),
      MAIN_INFO,
      KEY_LENGTH
    )
  );

/**
 * The `recovery` slot's key. The recovery key is normalised as format 1
 * does (dashes dropped, upper case), so a key typed either way works.
 * @param {string} recoveryKey
 * @param {{salt: string, kdf: Object}} slot
 */
export const recoveryKekOf = (recoveryKey, slot) =>
  CryptographyService.deriveKeyAsync(
    recoveryKey.replace(/-/g, '').toUpperCase(),
    Buffer.from(slot.salt, 'hex'),
    CryptographyService.iterationsOf(slot)
  );

/** 128 bits of HMAC-SHA256(kek, label), hex: tells a wrong key from a changed file. */
export const slotCheckOf = (kek) =>
  crypto
    .createHmac('sha256', kek)
    .update(CHECK_LABEL)
    .digest('hex')
    .slice(0, 32);

// Header and tags ------------------------------------------------------

const json = (value) => Buffer.from(JSON.stringify(value), 'utf8');
const common = (file) => [LABEL, file.version, file.features ?? []];
const mainParams = (file) => [
  'main',
  file.salt,
  file.kdf ?? null,
  file.keyFile?.id ?? null,
];
const recoveryParams = (file) => [
  'recovery',
  file.slots?.recovery?.salt ?? null,
  file.slots?.recovery?.kdf ?? null,
];
const SLOT_PARAMS = { main: mainParams, recovery: recoveryParams };

const slotAad = (file, name) =>
  json([...common(file), ...SLOT_PARAMS[name](file)]);
const payloadAad = (file) =>
  json([...common(file), ...mainParams(file), ...recoveryParams(file)]);

/**
 * A format-2 file's header, without slots' ciphertext or payload.
 * @param {{salt: string, kdf: Object, keyFileId: string,
 *   recovery: {salt: string, kdf: Object}}} params
 */
export function newHeader({ salt, kdf, keyFileId, recovery }) {
  return {
    version: FORMAT_2,
    features: [KEY_FILE_FEATURE],
    salt,
    kdf,
    keyFile: { id: keyFileId },
    slots: {
      main: {},
      recovery: { salt: recovery.salt, kdf: recovery.kdf },
    },
  };
}

/** Whether `file` is password vault format 2. */
export const isFormat2 = (file) =>
  Number.isInteger(file?.version) && file.version >= FORMAT_2;

const gcm = (key, aad, plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const wrapped = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    wrapped: wrapped.toString('hex'),
  };
};

const ungcm = (key, aad, { iv, authTag, wrapped }) => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(wrapped, 'hex')),
    decipher.final(),
  ]);
};

/**
 * `file` with slot `name` holding `dek` under `kek`. The slot's settings
 * (`salt`, `kdf` for recovery) must already be in the header.
 * @param {Object} file
 * @param {'main'|'recovery'} name
 * @param {Buffer} dek
 * @param {Buffer} kek
 */
export function wrapSlot(file, name, dek, kek) {
  const settings =
    name === 'recovery'
      ? { salt: file.slots.recovery.salt, kdf: file.slots.recovery.kdf }
      : {};
  return {
    ...file,
    slots: {
      ...file.slots,
      [name]: {
        ...settings,
        check: slotCheckOf(kek),
        ...gcm(kek, slotAad(file, name), dek),
      },
    },
  };
}

/**
 * The DEK in slot `name`, unwrapped with `kek`.
 * @throws {PasswordEnvelopeError} `AUTH` for the wrong key, `TAMPERED` for
 *   the right key on a changed file.
 */
export function unwrapSlot(file, name, kek) {
  const slot = file.slots?.[name];
  if (!slot?.wrapped) throw tampered();
  if (slot.check !== slotCheckOf(kek)) {
    throw new PasswordEnvelopeError(
      'AUTH',
      name === 'recovery' ? 'Invalid recovery key' : 'Invalid master password'
    );
  }
  try {
    const dek = ungcm(kek, slotAad(file, name), slot);
    if (dek.length !== KEY_LENGTH) throw new Error('bad length');
    return dek;
  } catch {
    throw tampered();
  }
}

/**
 * Throws `KEY_FILE` unless `keyFileKey` is the key file `file` records.
 * Checked before deriving anything, so a wrong key file isn't reported as
 * a wrong password.
 */
export function checkKeyFile(file, keyFileKey) {
  if (file.keyFile?.id !== keyFileIdOf(keyFileKey)) {
    throw new PasswordEnvelopeError(
      'KEY_FILE',
      "This key file isn't the one this vault uses."
    );
  }
}

/** `file` with `payload` encrypted under `dek`, covering the whole header. */
export function sealPayload(file, payload, dek) {
  return {
    ...file,
    ...CryptographyService.encrypt(payload, dek, { aad: payloadAad(file) }),
  };
}

/**
 * The payload of `file`, decrypted with `dek` (from a slot).
 * @throws {PasswordEnvelopeError} `TAMPERED`
 */
export function openPayload(file, dek) {
  try {
    return CryptographyService.decrypt(
      { encrypted: file.encrypted, authTag: file.authTag, iv: file.iv },
      dek,
      { aad: payloadAad(file) }
    );
  } catch {
    throw tampered();
  }
}
