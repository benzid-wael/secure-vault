import path from 'path';

/**
 * What this build understands of each vault kind's file format
 * (GUI-ENV-BREAKDOWN New-29). Shared by the CLI and the desktop app.
 *
 * A vault's plaintext envelope may list `features`: the optional parts of
 * the format it actually uses (written only when used, so a vault without
 * them keeps the original shape and stays writable by every tool). A tool
 * that meets a feature it doesn't know can still read the vault, but must
 * not write it: it would silently drop that feature's data. A `version`
 * above the one it knows means it can't even read the vault correctly.
 *
 * Adding a feature: name it here with a short description, mark it in
 * `envVaultFeatures` (or the password vault's equivalent), and ship this
 * check before, never after, the release that writes it.
 */
export const VAULT_FORMATS = {
  // Format 2 binds the header to the payload (New-37).
  env: { version: 2, features: { comments: 'key comments' } },
  // Format 2: a key file as second factor, the payload under a data key
  // (New-54).
  password: { version: 2, features: { keyfile: 'a key file' } },
};

export const UPGRADE_HINT =
  'Upgrade the CLI with `npm install -g @benzid.wael/secure-vault@latest` ' +
  'and the desktop app from ' +
  'https://github.com/benzid-wael/secure-vault/releases/latest.';

/**
 * @typedef {Object} FormatCheck
 * @property {boolean} readable  False: the vault's format is newer than this
 *   build reads (`version` too high).
 * @property {boolean} writable  False: writing would lose data this build
 *   doesn't understand. Implies nothing about reading.
 * @property {number} version
 * @property {string[]} features  What the file says it uses.
 * @property {string[]} unknown   Of those, what this build doesn't know.
 * @property {string} [message]   For the user, when not writable.
 */

/**
 * Check a vault file's plaintext envelope against what this build knows.
 * `name` is used in the message (a file path or a vault name).
 *
 * @param {Object} envelope The parsed file, before decryption.
 * @param {'env'|'password'} kind
 * @param {string} [name]
 * @returns {FormatCheck}
 */
export function checkVaultFormat(envelope, kind, name = 'This vault') {
  const known = VAULT_FORMATS[kind];
  const label = name.includes(path.sep) ? path.basename(name) : name;
  const version = Number.isInteger(envelope?.version) ? envelope.version : 1;
  const features = Array.isArray(envelope?.features)
    ? envelope.features.filter((f) => typeof f === 'string')
    : [];
  const unknown = features.filter((f) => !(f in known.features));

  if (version > known.version) {
    return {
      readable: false,
      writable: false,
      version,
      features,
      unknown,
      message:
        `${label} uses vault format ${version}; this version of SecureVault ` +
        `reads format ${known.version} only, so it can't open it safely. ` +
        UPGRADE_HINT,
    };
  }
  if (unknown.length > 0) {
    return {
      readable: true,
      writable: false,
      version,
      features,
      unknown,
      message:
        `${label} uses features this version of SecureVault doesn't ` +
        `support (${unknown.join(', ')}). You can read it, but changes are ` +
        `refused: saving here would drop that data. ${UPGRADE_HINT}`,
    };
  }
  return { readable: true, writable: true, version, features, unknown };
}

/** An error carrying `code: 'NEWER_FORMAT'`, for callers to recognise. */
export function newerFormatError(check) {
  const error = new Error(check.message);
  /** @type {any} */ (error).code = 'NEWER_FORMAT';
  return error;
}

/**
 * The features an env vault payload uses, for its envelope: `comments`
 * when any version of any environment has one.
 *
 * @param {{environments?: Object}} payload `EnvironmentVault#toJSON()`
 * @returns {string[]}
 */
export function envVaultFeatures(payload) {
  const used = Object.values(payload?.environments ?? {}).some((env) =>
    (env.versions ?? []).some(
      (v) => v.comments && Object.keys(v.comments).length > 0
    )
  );
  return used ? ['comments'] : [];
}
