import crypto from 'crypto';
import path from 'path';

import { CryptographyService } from '../services/CryptographyService.js';

/**
 * An env vault file's envelope (GUI-ENV-BREAKDOWN New-37): the plaintext
 * header and the encrypted payload.
 *
 * Format 1 trusts its header. Format 2 binds it: the header's fields are
 * GCM additional data, so changing `version`, `features`, `salt`, `kdf` or
 * `keyCheck` makes decryption fail. `keyCheck`, an HMAC of the derived key,
 * tells a wrong password from a changed header; it reveals nothing the tag
 * doesn't already let anyone test a password guess against.
 *
 * Every tool from this release reads both formats. A format-2 file stays
 * format 2 when rewritten; new and format-1 files are written as format 1
 * until `WRITE_BOUND` is turned on, once this release has been out as
 * `latest` long enough (rollout plan, New-37): a tool released before it
 * can't open a format-2 file at all.
 */
export const BOUND_FORMAT = 2;

/** Whether new and format-1 vaults are written bound. Off: read now, write later. */
export const WRITE_BOUND = false;

const KEY_CHECK_LABEL = 'secure-vault env-vault key check';

/** 128 bits of HMAC-SHA256(key, label), hex. */
export const keyCheckOf = (key) =>
  crypto
    .createHmac('sha256', key)
    .update(KEY_CHECK_LABEL)
    .digest('hex')
    .slice(0, 32);

/** Whether `file` claims the bound format. */
export const isBound = (file) =>
  Number.isInteger(file?.version) && file.version >= BOUND_FORMAT;

/** The header bytes a format-2 tag covers, in a fixed order. */
const headerAad = (file, keyCheck = file.keyCheck) =>
  Buffer.from(
    JSON.stringify([
      file.type,
      file.version,
      file.features ?? [],
      file.salt,
      file.kdf ?? null,
      keyCheck ?? null,
    ]),
    'utf8'
  );

/**
 * A complete vault file for `payload` under `key`.
 *
 * @param {Object} payload
 * @param {Buffer} key
 * @param {{salt: string, kdf?: Object}} keyHeader
 * @param {{bound?: boolean, features?: string[]}} [options]
 */
export function sealEnvVault(
  payload,
  key,
  { salt, kdf },
  { bound = WRITE_BOUND, features = [] } = {}
) {
  const header = {
    type: 'environment-vault',
    version: bound ? BOUND_FORMAT : 1,
    ...(features.length > 0 && { features }),
    salt,
    ...(kdf && { kdf }),
    ...(bound && { keyCheck: keyCheckOf(key) }),
  };
  return {
    ...header,
    ...CryptographyService.encrypt(
      payload,
      key,
      bound ? { aad: headerAad(header) } : {}
    ),
  };
}

/** A failure to open an envelope: `code` is `AUTH` or `TAMPERED`. */
export class EnvelopeError extends Error {
  /** @param {'AUTH'|'TAMPERED'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const WRONG_PASSWORD =
  'Failed to decrypt: wrong password or corrupted file';

/**
 * The payload of `file`, decrypted with `key`.
 * @param {Object} file The parsed vault file.
 * @param {Buffer} key
 * @param {string} [name] For the message: a path or a name.
 * @throws {EnvelopeError}
 */
export function openEnvVault(file, key, name = 'This vault') {
  const sealed = {
    encrypted: file.encrypted,
    authTag: file.authTag,
    iv: file.iv,
  };
  if (!isBound(file)) {
    try {
      return CryptographyService.decrypt(sealed, key);
    } catch {
      throw new EnvelopeError('AUTH', WRONG_PASSWORD);
    }
  }
  const expected = keyCheckOf(key);
  const tryWith = (keyCheck) => {
    try {
      return {
        payload: CryptographyService.decrypt(sealed, key, {
          aad: headerAad(file, keyCheck),
        }),
      };
    } catch {
      return null;
    }
  };
  // `/` too: Windows takes it as a separator, and paths can be written so.
  const isPath = name.includes(path.sep) || name.includes('/');
  const label = isPath ? path.basename(name) : name;
  const changed = new EnvelopeError(
    'TAMPERED',
    `${label}'s header was changed after it was written, or the file is ` +
      "damaged, so it can't be trusted. Restore it from " +
      (isPath ? `${label}.bak or another copy.` : 'a backup.')
  );
  if (file.keyCheck === expected) {
    const opened = tryWith(expected);
    if (opened) return opened.payload;
    throw changed; // the right key, but the tag no longer matches
  }
  // A wrong password, or an edited key check: the payload says which.
  if (tryWith(expected)) throw changed;
  throw new EnvelopeError('AUTH', WRONG_PASSWORD);
}
