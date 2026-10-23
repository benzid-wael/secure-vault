import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';

import { CryptographyService } from './CryptographyService.js';
import { EnvironmentResolver } from './EnvironmentResolver.js';
import { VaultLock } from './VaultLock.js';
import { EnvironmentVault } from '../models/EnvironmentVault.js';

/**
 * Heuristic patterns for values that look like secrets accidentally left in a
 * non-required (and likely non-sensitive) variable (SPEC §10.1). Warning-only.
 */
const SUSPICIOUS_VALUE_RE =
  /-----BEGIN |sk_live_|AKIA[0-9A-Z]{16}|[0-9a-f]{64,}/;
import { validatePasswordStrength } from '../../utils/passwordValidation.js';
import { getAppDataPath, getEnvsDir } from '../utils/appPaths.js';
import { checkVaultFormat, envVaultFeatures } from '../utils/vaultFormat.js';
import { moveWithRetry } from '../utils/moveWithRetry.js';
import { parseDotenv, toDotenv } from '../../utils/dotenv.js';

function resolvePath(...segments) {
  return process.platform === 'win32'
    ? path.win32.join(...segments)
    : path.posix.join(...segments);
}

/**
 * @typedef {Object} VaultReadResult
 * @property {boolean} success
 * @property {string} [code] - on failure: NOT_FOUND, INVALID, AUTH, REKEYED,
 *   NEWER_FORMAT (a format this build can't read), ERROR
 * @property {string} [error]
 * @property {EnvironmentVault} [vault]
 * @property {string} [revision]
 * @property {{key: Buffer, header: Object}} [keyMaterial]
 * @property {import('../utils/vaultFormat.js').FormatCheck} [format] - what
 *   this build understands of the file; `writable: false` means features
 *   it doesn't know, and every write is refused with NEWER_FORMAT (New-29)
 */

/**
 * @typedef {Object} TransactResult
 * @property {boolean} success
 * @property {string} [code] - on failure: as VaultReadResult, plus STALE, BUSY,
 *   LIMIT, CONFLICT
 * @property {string} [error]
 * @property {string} [revision] - the new one; on STALE, the current one
 * @property {{key: Buffer, header: Object}} [keyMaterial]
 * @property {*} [result] - what `mutate` returned
 * @property {*} [after] - what `afterWrite` returned
 * @property {Object} [holder] - on BUSY, the lock's current holder
 */

/** A failed result: `code` says why, for callers that branch on it. */
function fail(code, error) {
  return { success: false, code, error };
}

/** `auth` as `{ password?, keyMaterial? }`; a bare string is a password. */
function normalizeAuth(auth) {
  return typeof auth === 'string' ? { password: auth } : auth || {};
}

/**
 * The envelope's `features` (New-29), present only when the payload uses
 * one, so a vault without them keeps the shape every tool can write.
 */
function featuresField(payload) {
  const features = envVaultFeatures(payload);
  return features.length ? { features } : {};
}

/** True when a key derived for header `a` decrypts a file with header `b`. */
function sameKeyHeader(a, b) {
  return (
    a?.salt === b.salt &&
    a?.kdf?.name === b.kdf?.name &&
    a?.kdf?.iterations === b.kdf?.iterations
  );
}

export class EnvironmentVaultService {
  static getAppDataPath() {
    return getAppDataPath();
  }

  static getEnvsDir() {
    return getEnvsDir();
  }

  static getEnvVaultPath(name) {
    return resolvePath(this.getEnvsDir(), `${name}.env.vault`);
  }

  static getBackupPath(vaultPath) {
    return `${vaultPath}.bak`;
  }

  static findGitRoot(startDir) {
    let dir = startDir;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }

  static findVaultUpward(startDir, stopDir) {
    let dir = startDir;
    while (true) {
      const candidate = path.join(dir, '.env.vault');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      // Stop once we have processed the boundary directory.
      if (dir === stopDir) {
        return null;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }

  /**
   * The vault a CLI command run in `cwd` uses: `vault` (a path), `name`
   * (the app folder), else `.env.vault` in `cwd` or a parent up to the git
   * root, `config/.env.vault`, then `<envs>/<folder name>.env.vault`. Null
   * when none exists. The app passes a folder the user picked, and its own
   * `envsDir` (New-22).
   *
   * @param {{vault?: string, name?: string, cwd?: string, envsDir?: string}}
   *   [options]
   * @returns {string|null}
   */
  static resolveVaultPath({
    vault,
    name,
    cwd = process.cwd(),
    envsDir = this.getEnvsDir(),
  } = {}) {
    if (vault) {
      return path.resolve(cwd, vault);
    }

    if (name) {
      return this.getEnvVaultPath(name);
    }

    // Walk up from cwd toward ancestors looking for `.env.vault`, bounded by
    // the git root. If no git root is found, only cwd itself is checked.
    const gitRoot = this.findGitRoot(cwd);
    const stopDir = gitRoot || cwd;
    const upwardVault = this.findVaultUpward(cwd, stopDir);
    if (upwardVault) {
      return path.resolve(upwardVault);
    }

    const configVault = path.resolve(cwd, 'config', '.env.vault');
    if (fs.existsSync(configVault)) {
      return configVault;
    }

    const appDataVault = this.defaultVaultPath(cwd, envsDir);
    if (fs.existsSync(appDataVault)) {
      return appDataVault;
    }

    return null;
  }

  /** `<envs>/<folder name>.env.vault`, the app-folder vault for `cwd`. */
  static defaultVaultPath(cwd = process.cwd(), envsDir = this.getEnvsDir()) {
    const cwdName = path
      .basename(cwd)
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    return resolvePath(envsDir, `${cwdName}.env.vault`);
  }

  static async vaultExists(path) {
    try {
      return await fs.pathExists(path);
    } catch {
      return false;
    }
  }

  static async createVault(vaultPath, password, data = null) {
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      return { success: false, error: passwordErrors[0] };
    }

    try {
      if (await this.vaultExists(vaultPath)) {
        return {
          success: false,
          error: `Vault already exists at ${vaultPath}`,
        };
      }

      const payload = data || new EnvironmentVault().toJSON();
      const salt = CryptographyService.generateSalt();
      const key = await CryptographyService.deriveKeyAsync(
        password,
        salt,
        CryptographyService.ITERATIONS
      );
      const encrypted = CryptographyService.encrypt(payload, key);

      const vaultFile = {
        type: 'environment-vault',
        version: 1,
        ...featuresField(payload),
        salt: salt.toString('hex'),
        kdf: CryptographyService.kdfHeader(),
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encrypted: encrypted.encrypted,
      };

      await fs.ensureDir(path.dirname(vaultPath));
      await fs.writeJSON(vaultPath, vaultFile, { spaces: 2 });

      return { success: true, path: vaultPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async loadVault(vaultPath, password) {
    try {
      if (!(await this.vaultExists(vaultPath))) {
        return {
          success: false,
          error: `Environment vault not found at ${vaultPath}`,
        };
      }

      const vaultFile = await fs.readJSON(vaultPath);

      if (vaultFile.type !== 'environment-vault') {
        return { success: false, error: 'Invalid environment vault file' };
      }
      const format = checkVaultFormat(vaultFile, 'env', vaultPath);
      if (!format.readable) {
        return { success: false, code: 'NEWER_FORMAT', error: format.message };
      }

      const key = await CryptographyService.deriveKeyForAsync(
        password,
        vaultFile
      );
      const encryptedData = {
        encrypted: vaultFile.encrypted,
        authTag: vaultFile.authTag,
        iv: vaultFile.iv,
      };

      const payload = CryptographyService.decrypt(encryptedData, key);
      const vault = EnvironmentVault.fromJSON(payload);

      // The derived key and its salt header, for handing straight to
      // saveVault: a load-modify-save then runs PBKDF2 once, not twice.
      const keyMaterial = {
        key,
        header: CryptographyService.keyHeaderOf(vaultFile),
      };
      return { success: true, data: vault, keyMaterial, format };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to decrypt: wrong password or corrupted file',
      };
    }
  }

  /**
   * @param {string} vaultPath
   * @param {string} password
   * @param {EnvironmentVault} vault
   * @param {{key: Buffer, header: {salt: string, kdf?: Object}}} [keyMaterial]
   *   From the loadVault this save follows. When it is at the current work
   *   factor, its key and salt are reused (each encryption still gets a fresh
   *   random IV); otherwise, or when absent, a fresh salt is derived at the
   *   current work factor — which is also how a legacy vault gets upgraded.
   *   Never pass it when `password` differs from the one it was derived from.
   */
  static async saveVault(vaultPath, password, vault, keyMaterial = null) {
    try {
      const payload = vault.toJSON();
      let key;
      let header;
      // A write under a new key (new password, or the 600k upgrade) must not
      // leave the previous key's copy behind in `.bak`; see below.
      let rekeyed = false;
      if (
        keyMaterial &&
        !CryptographyService.needsKdfUpgrade(keyMaterial.header)
      ) {
        ({ key, header } = keyMaterial);
      } else {
        rekeyed = true;
        const salt = CryptographyService.generateSalt();
        key = await CryptographyService.deriveKeyAsync(
          password,
          salt,
          CryptographyService.ITERATIONS
        );
        header = {
          salt: salt.toString('hex'),
          kdf: CryptographyService.kdfHeader(),
        };
      }
      await this.#writeEncrypted(vaultPath, payload, key, header, rekeyed);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Encrypt `payload` under `key` and write it over `vaultPath` atomically,
   * keeping `.bak` in step.
   */
  static async #writeEncrypted(vaultPath, payload, key, header, rekeyed) {
    const encrypted = CryptographyService.encrypt(payload, key);

    const vaultFile = {
      type: 'environment-vault',
      version: 1,
      ...featuresField(payload),
      ...header,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      encrypted: encrypted.encrypted,
    };
    await fs.ensureDir(path.dirname(vaultPath));

    // Preserve the previous good state, then write atomically: the new
    // content lands in a temp file and is renamed over the target only once
    // fully written, so a crash mid-write can never corrupt the vault, and
    // `<path>.bak` always holds the last good copy for manual recovery.
    const backupPath = this.getBackupPath(vaultPath);
    if (await fs.pathExists(vaultPath)) {
      await fs.copy(vaultPath, backupPath, { overwrite: true });
    }

    const tmpPath = `${vaultPath}.tmp`;
    await fs.writeJSON(tmpPath, vaultFile, { spaces: 2 });
    try {
      await moveWithRetry(tmpPath, vaultPath);
    } catch (error) {
      // The vault is untouched; don't leave the unrenamed copy beside it.
      try {
        await fs.remove(tmpPath);
      } catch {
        // Best effort: the original error is the one to report.
      }
      throw error;
    }

    // After a re-key the "previous good state" is encrypted under the old
    // key: it would still open with a password the user just retired (maybe
    // because it leaked), or at the weaker legacy work factor. Once the new
    // file is safely in place, the backup becomes a copy of it instead.
    if (rekeyed && (await fs.pathExists(backupPath))) {
      await fs.copy(vaultPath, backupPath, { overwrite: true });
    }
  }

  /**
   * A vault file's revision: `sha256:<hex>` of its bytes. Every write uses a
   * fresh IV, so every write changes it (GUI-ENV-RFC §6.2).
   */
  static revisionOf(bytes) {
    return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  }

  /**
   * Read and decrypt a vault without locking it (writes are atomic renames,
   * so a reader always sees a whole file).
   *
   * @param {string | {password?: string, keyMaterial?: Object}} auth
   *   A password, or the `keyMaterial` of an earlier read/transact (no PBKDF2),
   *   or both: then a re-keyed file is opened with the password instead.   * @returns {Promise<VaultReadResult>}
   */
  static async read(vaultPath, auth) {
    let bytes;
    try {
      bytes = await fs.readFile(vaultPath);
    } catch (error) {
      return error.code === 'ENOENT'
        ? fail('NOT_FOUND', `Environment vault not found at ${vaultPath}`)
        : fail('ERROR', error.message);
    }
    const opened = await this.#open(bytes, normalizeAuth(auth), vaultPath);
    if (!opened.success) return opened;
    return {
      success: true,
      vault: opened.vault,
      revision: this.revisionOf(bytes),
      keyMaterial: opened.keyMaterial,
      format: opened.format,
    };
  }

  /**
   * The one write path for env vaults (GUI-ENV-RFC §6.2): lock, read once,
   * check the revision, decrypt, `mutate`, write atomically, unlock.
   *
   * @param {string} vaultPath
   * @param {string | {password?: string, keyMaterial?: Object}} auth  As `read`.
   * @param {(vault: EnvironmentVault, ctx: {revision: string|null}) => any} mutate
   *   Changes `vault` in place; its return value comes back as `result`.
   *   Throwing aborts the transaction and nothing is written.
   * @param {Object} [options]
   * @param {string|null} [options.expectedRevision] Refuse with `STALE` unless
   *   the file is still at this revision. null: no check (each CLI command
   *   reads fresh under the lock, so it can't be stale).
   * @param {boolean} [options.create] Allow a missing file: `mutate` gets an
   *   empty vault, and `auth` must carry a password.
   * @param {number} [options.lockTimeoutMs]
   * @param {'cli'|'gui'} [options.tool] Recorded in the lock, for messages.
   * @param {string} [options.rekeyWith] Write under a fresh key derived from
   *   this password instead (a password change).
   * @param {() => Promise<any>} [options.afterWrite] Runs after a successful
   *   write, still under the lock (re-keying snapshots must not race another
   *   writer). Its return value comes back as `after`. It must not throw: the
   *   write is already committed.   * @returns {Promise<TransactResult>} On success, `keyMaterial` is what the
   *   file now uses: a legacy vault written with a
   *   password is re-salted, and callers caching keys must keep the new one.
   */
  static async transact(
    vaultPath,
    auth,
    mutate,
    {
      expectedRevision = null,
      create = false,
      lockTimeoutMs = 3000,
      tool = 'cli',
      rekeyWith = null,
      afterWrite = null,
    } = {}
  ) {
    const { password, keyMaterial: givenKey } = normalizeAuth(auth);
    try {
      // VaultLock needs the directory: make it for a new vault; without
      // `create`, a missing directory means a missing vault.
      if (create) await fs.ensureDir(path.dirname(vaultPath));
      else if (!(await fs.pathExists(path.dirname(vaultPath)))) {
        return fail('NOT_FOUND', `Environment vault not found at ${vaultPath}`);
      }
    } catch (error) {
      return fail('ERROR', error.message);
    }

    const lock = new VaultLock(vaultPath, { tool, timeoutMs: lockTimeoutMs });
    const acquired = await lock.acquire();
    if (!acquired.success) return acquired;

    try {
      let bytes = null;
      try {
        bytes = await fs.readFile(vaultPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!create) {
          return fail(
            'NOT_FOUND',
            `Environment vault not found at ${vaultPath}`
          );
        }
      }

      const revision = bytes ? this.revisionOf(bytes) : null;
      if (expectedRevision !== null && expectedRevision !== revision) {
        return {
          ...fail('STALE', 'The vault changed since it was read'),
          revision,
        };
      }

      let vault = new EnvironmentVault();
      let keyMaterial = null;
      if (bytes) {
        const opened = await this.#open(
          bytes,
          { password, keyMaterial: givenKey },
          vaultPath
        );
        if (!opened.success) return opened;
        // A newer tool's vault: writing would drop what we don't know.
        if (!opened.format.writable) {
          return fail('NEWER_FORMAT', opened.format.message);
        }
        ({ vault, keyMaterial } = opened);
      }

      let result;
      try {
        result = await mutate(vault, { revision });
      } catch (error) {
        // Refusals a caller can act on keep their code: LIMIT (the version
        // cap), CONFLICT (the change would overwrite something).
        const code = ['LIMIT', 'CONFLICT'].includes(error.code)
          ? error.code
          : 'ERROR';
        return fail(code, error.message);
      }

      // Reuse the key unless it's due for the work-factor upgrade and we hold
      // the password to do it (a key-only caller can't, and keeps the old one).
      let key;
      let header;
      let rekeyed = false;
      const writePassword = rekeyWith ?? password;
      if (
        keyMaterial &&
        !rekeyWith &&
        !(password && CryptographyService.needsKdfUpgrade(keyMaterial.header))
      ) {
        ({ key, header } = keyMaterial);
      } else {
        if (typeof writePassword !== 'string') {
          return fail('AUTH', 'A password is required to create a vault');
        }
        const salt = CryptographyService.generateSalt();
        key = await CryptographyService.deriveKeyAsync(
          writePassword,
          salt,
          CryptographyService.ITERATIONS
        );
        header = {
          salt: salt.toString('hex'),
          kdf: CryptographyService.kdfHeader(),
        };
        rekeyed = true;
      }

      // The heartbeat found our lock gone: another writer may be inside.
      if (lock.lost) {
        return fail('ERROR', 'Lost the vault lock; nothing was written');
      }

      await this.#writeEncrypted(
        vaultPath,
        vault.toJSON(),
        key,
        header,
        rekeyed
      );
      // Still under the lock: nobody else can have written since.
      const written = await fs.readFile(vaultPath);
      const after = afterWrite ? await afterWrite() : undefined;
      return {
        success: true,
        revision: this.revisionOf(written),
        keyMaterial: { key, header },
        result,
        after,
      };
    } catch (error) {
      return fail('ERROR', error.message);
    } finally {
      await lock.release();
    }
  }

  /** Parse and decrypt one read's `bytes` → `{ vault, keyMaterial }`. */
  static async #open(bytes, { password, keyMaterial }, name = undefined) {
    let file;
    try {
      file = JSON.parse(bytes.toString('utf8'));
    } catch {
      file = null;
    }
    if (file?.type !== 'environment-vault') {
      return fail('INVALID', 'Invalid environment vault file');
    }
    const format = checkVaultFormat(file, 'env', name);
    if (!format.readable) return fail('NEWER_FORMAT', format.message);
    const header = CryptographyService.keyHeaderOf(file);

    let key = null;
    if (keyMaterial) {
      if (sameKeyHeader(keyMaterial.header, header)) {
        key = keyMaterial.key;
      } else if (typeof password !== 'string') {
        // Someone changed the password, or ran the KDF upgrade, since.
        return fail('REKEYED', 'The vault was re-keyed since it was opened');
      }
    }
    if (!key) {
      if (typeof password !== 'string') {
        return fail('AUTH', 'A password is required');
      }
      try {
        key = await CryptographyService.deriveKeyForAsync(password, file);
      } catch (error) {
        return fail('INVALID', error.message);
      }
    }

    try {
      const payload = CryptographyService.decrypt(
        { encrypted: file.encrypted, authTag: file.authTag, iv: file.iv },
        key
      );
      return {
        success: true,
        vault: EnvironmentVault.fromJSON(payload),
        keyMaterial: { key, header },
        format,
      };
    } catch {
      return fail(
        'AUTH',
        'Failed to decrypt: wrong password or corrupted file'
      );
    }
  }

  static async changePassword(vaultPath, currentPassword, newPassword) {
    const passwordErrors = validatePasswordStrength(newPassword);
    if (passwordErrors.length > 0) {
      return { success: false, error: passwordErrors[0] };
    }

    // A new password needs a fresh salt and key; the snapshots are re-keyed
    // after the vault itself is safely written, under the same lock.
    const result = await this.#mutate(vaultPath, currentPassword, () => {}, {
      rekeyWith: newPassword,
      afterWrite: () =>
        this.#rekeySnapshots(vaultPath, currentPassword, newPassword),
    });
    if (!result.success) return result;
    const { after, ...rest } = result;
    return { ...rest, ...after };
  }

  /**
   * Re-encrypt the vault's `.deleted.<ts>` and `.squashed.<ts>` snapshots
   * under the new password. Each one is a full copy of the vault taken before
   * history was discarded; left alone, it would keep opening with the retired
   * password.
   * A snapshot that doesn't open with the current password predates an
   * earlier password change and can't be re-keyed here, so it is left
   * untouched and reported for the user to handle.
   *
   * @returns {Promise<{rekeyedSnapshots: string[], skippedSnapshots: string[]}>}
   *   File names (not paths).
   */
  static async #rekeySnapshots(vaultPath, currentPassword, newPassword) {
    const dir = path.dirname(vaultPath);
    const prefixes = this.SNAPSHOT_KINDS.map(
      (kind) => `${path.basename(vaultPath)}.${kind}.`
    );
    const rekeyedSnapshots = [];
    const skippedSnapshots = [];

    // The password change is already saved: failing to list the directory
    // must not turn it into a reported failure.
    let names = [];
    try {
      names = ((await fs.readdir(dir)) || [])
        .filter(
          (name) =>
            prefixes.some((prefix) => name.startsWith(prefix)) &&
            !name.endsWith('.tmp')
        )
        .sort();
    } catch {
      return { rekeyedSnapshots, skippedSnapshots };
    }
    for (const name of names) {
      const snapshotPath = path.join(dir, name);
      try {
        const file = await fs.readJSON(snapshotPath);
        if (file.type !== 'environment-vault') throw new Error('not a vault');
        const payload = CryptographyService.decrypt(
          { encrypted: file.encrypted, authTag: file.authTag, iv: file.iv },
          await CryptographyService.deriveKeyForAsync(currentPassword, file)
        );

        const salt = CryptographyService.generateSalt();
        const key = await CryptographyService.deriveKeyAsync(
          newPassword,
          salt,
          CryptographyService.ITERATIONS
        );
        const rekeyed = {
          ...file,
          salt: salt.toString('hex'),
          kdf: CryptographyService.kdfHeader(),
          ...CryptographyService.encrypt(payload, key),
        };

        const tmpPath = `${snapshotPath}.tmp`;
        await fs.writeJSON(tmpPath, rekeyed, { spaces: 2 });
        await moveWithRetry(tmpPath, snapshotPath);
        rekeyedSnapshots.push(name);
      } catch {
        skippedSnapshots.push(name);
      }
    }
    return { rekeyedSnapshots, skippedSnapshots };
  }

  static async init({ name, vault, password, environments = {} }) {
    const vaultPath = vault
      ? path.resolve(vault)
      : name
        ? this.getEnvVaultPath(name)
        : this.defaultVaultPath();

    if (!password) {
      return { success: false, error: 'Password is required' };
    }

    const vaultModel = new EnvironmentVault();

    for (const [envName, envFile] of Object.entries(environments)) {
      try {
        const content = await fs.readFile(envFile, 'utf-8');
        vaultModel.importFromEnvFile(envName, content, {
          message: 'Initial import',
        });
      } catch (error) {
        return {
          success: false,
          error: `Failed to import ${envName} from ${envFile}: ${error.message}`,
        };
      }
    }

    return this.createVault(vaultPath, password, vaultModel.toJSON());
  }

  static async setEnv(
    vaultPath,
    password,
    envName,
    key,
    value,
    {
      isPublic = undefined,
      isRequired = false,
      message = null,
      comment = undefined,
    } = {}
  ) {
    return this.#mutate(vaultPath, password, (vault) => {
      if (!vault.listEnvironmentNames().includes(envName)) {
        vault.addEnvironment(envName); // throws on a reserved name
      }

      const activeVersion = vault.getActiveVersion(envName);

      const nonSensitive = activeVersion ? [...activeVersion.nonSensitive] : [];
      const required = activeVersion ? [...activeVersion.required] : [];

      // `isPublic` left out keeps the key's flag; a new key is secret.
      if (isPublic === true && !nonSensitive.includes(key)) {
        nonSensitive.push(key);
      } else if (isPublic === false) {
        const idx = nonSensitive.indexOf(key);
        if (idx !== -1) nonSensitive.splice(idx, 1);
      }

      // --required is additive: marking a key required persists it, and updating
      // the value later (without the flag) does not silently un-require it.
      if (isRequired && !required.includes(key)) {
        required.push(key);
      }

      const currentVars = activeVersion ? { ...activeVersion.vars } : {};
      currentVars[key] = value;

      // No `comment` keeps the key's comment; '' removes it.
      const comments = { ...(activeVersion?.comments || {}) };
      if (comment !== undefined) comments[key] = String(comment).trim();

      vault.addVersion(envName, currentVars, {
        nonSensitive,
        required,
        comments,
        message,
      });
    });
  }

  static async getEnv(vaultPath, password, envName, key) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const resolver = new EnvironmentResolver(vault);
      // Resolves layering + template refs; throws if the key is absent (after
      // inheritance) or a reference cannot be resolved.
      const value = resolver.resolveValue(envName, key);

      return { success: true, data: { key, value } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async showEnv(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const env = vault.environments[envName];
      if (!env) {
        return {
          success: false,
          error: `Environment '${envName}' not found`,
        };
      }

      const activeVersion = vault.getActiveVersion(envName);

      const keys = activeVersion
        ? Object.entries(activeVersion.vars).map(([key, value]) => ({
            key,
            value,
            sensitive: !activeVersion.nonSensitive.includes(key),
            ...(activeVersion.comments?.[key] && {
              comment: activeVersion.comments[key],
            }),
          }))
        : [];

      return {
        success: true,
        data: {
          name: envName,
          description: env.description || '(none)',
          created: vault.created,
          updated: vault.updated,
          extends: env.extends || '(none)',
          activeVersion: activeVersion ? activeVersion.n : null,
          totalVersions: vault.getHistory(envName).length,
          keyCount: keys.length,
          keys,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async listEnvs(vaultPath, password) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    const vault = loadResult.data;
    const names = vault.listEnvironmentNames();

    const envs = names.map((name) => {
      const history = vault.getHistory(name);
      const activeVersion = vault.getActiveVersion(name);
      return {
        name,
        versionCount: history.length,
        activeVersion: activeVersion ? activeVersion.n : null,
        keyCount: activeVersion ? Object.keys(activeVersion.vars).length : 0,
      };
    });

    return { success: true, data: envs };
  }

  static async removeKey(vaultPath, password, envName, key) {
    return this.#mutate(vaultPath, password, (vault) => {
      const activeVersion = vault.getActiveVersion(envName);

      if (!activeVersion) {
        throw new Error(`Environment '${envName}' has no versions`);
      }

      if (!(key in activeVersion.vars)) {
        throw new Error(`Key '${key}' not found in environment '${envName}'`);
      }

      const newVars = { ...activeVersion.vars };
      delete newVars[key];

      const nonSensitive = activeVersion.nonSensitive.filter((k) => k !== key);
      const required = activeVersion.required.filter((k) => k !== key);

      vault.addVersion(envName, newVars, {
        nonSensitive,
        required,
        message: `Remove ${key}`,
      });
    });
  }

  static async deleteEnv(vaultPath, password, envName) {
    return this.#mutate(vaultPath, password, async (vault) => {
      vault.removeEnvironment(envName); // throws if the environment is missing

      // Deleting an environment discards its entire version history, so keep a
      // timestamped snapshot of the pre-delete vault alongside the rolling .bak.
      await this.snapshot(vaultPath, 'deleted');
    });
  }

  /** The kinds of snapshot kept next to a vault, re-keyed with it. */
  static SNAPSHOT_KINDS = ['deleted', 'squashed'];

  /**
   * Copy the vault file to `<vault>.<kind>.<timestamp>` before a write that
   * discards history. Call it inside `transact`'s mutate: under the lock, the
   * file on disk is the one the vault was read from.
   *
   * @param {string} vaultPath
   * @param {'deleted'|'squashed'} kind
   * @returns {Promise<string>} The snapshot's path.
   */
  static async snapshot(vaultPath, kind) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${vaultPath}.${kind}.${stamp}`;
    await fs.copy(vaultPath, target, { overwrite: true });
    return target;
  }

  static async setExtends(vaultPath, password, envName, parent) {
    return this.#mutate(vaultPath, password, (vault) => {
      vault.setExtends(envName, parent);
    });
  }

  static async setEnvDescription(vaultPath, password, envName, description) {
    return this.#mutate(vaultPath, password, (vault) => {
      if (!vault.environments[envName]) {
        throw new Error(`Environment '${envName}' not found`);
      }
      vault.environments[envName].description = description || '';
    });
  }

  /**
   * Rename an env. Envs that extend it follow; `{{env:OLD/KEY}}` references
   * are pointed at the new name too unless `updateReferences` is false
   * (New-44), in the same write.
   *
   * @param {Object} [options]
   * @param {boolean} [options.updateReferences]
   * @param {string|null} [options.message] For the versions the reference
   *   update adds.
   * @returns {Promise<{success: boolean, revision?: string, error?: string,
   *   updated?: {env: string, count: number}[]}>} `updated`: the envs whose
   *   references were rewritten, with counts.
   */
  static async renameEnv(
    vaultPath,
    password,
    oldName,
    newName,
    { updateReferences = true, message = null } = {}
  ) {
    let updated = [];
    const result = await this.#mutate(vaultPath, password, (vault) => {
      vault.renameEnvironment(oldName, newName);
      updated = updateReferences
        ? vault.renameReferences(oldName, newName, {
            message:
              message ?? `References to ${oldName} renamed to ${newName}`,
          })
        : [];
    });
    return result.success ? { ...result, updated } : result;
  }

  static async copyEnv(vaultPath, password, sourceName, destName) {
    return this.#mutate(vaultPath, password, (vault) => {
      // Reading the source first validates it exists before we mutate anything.
      const activeVersion = vault.getActiveVersion(sourceName);
      vault.addEnvironment(destName);

      if (activeVersion) {
        vault.addVersion(
          destName,
          { ...activeVersion.vars },
          {
            required: [...activeVersion.required],
            nonSensitive: [...activeVersion.nonSensitive],
            comments: { ...(activeVersion.comments || {}) },
            message: `Copied from '${sourceName}'`,
          }
        );
      }
    });
  }

  /**
   * @param {Object} [options]
   * @param {boolean} [options.comments] Write key comments as `#` lines
   *   (dotenv only).
   */
  static async exportEnv(
    vaultPath,
    password,
    envName,
    format = 'dotenv',
    { comments = false } = {}
  ) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const activeVersion = vault.getActiveVersion(envName);
      const resolver = new EnvironmentResolver(vault);
      // Resolve layering + template refs; a broken reference throws and is
      // surfaced as an error below (also covers `run`, which calls this).
      const vars = resolver.resolveEnvironment(envName);

      if (!activeVersion && Object.keys(vars).length === 0) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      if (format === 'json') {
        return { success: true, data: vars };
      }

      return {
        success: true,
        data: toDotenv(vars, {
          comments: comments ? vault.commentsOf(envName) : {},
        }),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async templateEnv(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const activeVersion = vault.getActiveVersion(envName);

      if (!activeVersion) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      const lines = Object.keys(activeVersion.vars).map((key) => {
        if (activeVersion.required.includes(key)) {
          return `${key}=<required>`;
        }
        return `${key}=`;
      });

      return { success: true, data: lines.join('\n') + '\n' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Replace an env's variables with a .env file's. The result carries the
   * parser's `warnings` (skipped lines, repeated keys), which hold no value.
   *
   * @param {Object} [options]
   * @param {boolean} [options.comments] Take the file's `#` comments above a
   *   key as its comment.
   * @returns {Promise<{success: boolean, error?: string, code?: string,
   *   revision?: string, warnings?: Array<{line: number, message: string}>}>}
   */
  static async importEnvFile(
    vaultPath,
    password,
    envName,
    filePath,
    { comments = false } = {}
  ) {
    let content;
    try {
      // Read the .env before taking the lock: it's not part of the vault.
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      return { success: false, error: error.message };
    }
    const { warnings } = parseDotenv(content);
    const result = await this.#mutate(vaultPath, password, (vault) => {
      vault.importFromEnvFile(envName, content, {
        message: `Imported from ${path.basename(filePath)}`,
        comments,
      });
    });
    return result.success ? { ...result, warnings } : result;
  }

  /** Squash `envName`'s history, keeping a snapshot of the vault first. */
  static async squashEnv(vaultPath, password, envName, keep = 1) {
    return this.#mutate(vaultPath, password, async (vault) => {
      vault.getHistory(envName); // throws before any snapshot if it's missing
      await this.snapshot(vaultPath, 'squashed');
      vault.squash(envName, { keep: Math.max(1, keep) });
    });
  }

  static async rollbackEnv(vaultPath, password, envName, versionN) {
    return this.#mutate(vaultPath, password, (vault) => {
      vault.rollback(envName, versionN);
    });
  }

  /**
   * Run one write through `transact`, in the `{ success, error }` shape the
   * CLI reads, plus `code` (and `holder` on BUSY) and the new `revision`.
   */
  static async #mutate(vaultPath, auth, mutate, options = {}) {
    const result = await this.transact(vaultPath, auth, mutate, options);
    if (!result.success) return result;
    return {
      success: true,
      revision: result.revision,
      ...(result.after !== undefined && { after: result.after }),
    };
  }

  static async getHistory(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const history = vault.getHistory(envName);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async diffEnvs(vaultPath, password, envA, envB) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;
    return this.diffVaultEnvs(loadResult.data, envA, envB);
  }

  /**
   * `diffEnvs` on an open vault (the desktop app reads through its session).
   *
   * @param {EnvironmentVault} vault
   * @param {string} envA
   * @param {string} envB
   * @returns {any}
   */
  static diffVaultEnvs(vault, envA, envB) {
    try {
      const versionA = vault.getActiveVersion(envA);
      const versionB = vault.getActiveVersion(envB);

      if (!versionA) {
        return {
          success: false,
          error: `Environment '${envA}' has no versions`,
        };
      }
      if (!versionB) {
        return {
          success: false,
          error: `Environment '${envB}' has no versions`,
        };
      }

      // Compare the resolved (layered + template-resolved) views (SPEC §6.3).
      const resolver = new EnvironmentResolver(vault);
      const varsA = resolver.resolveEnvironment(envA);
      const varsB = resolver.resolveEnvironment(envB);

      const keysA = new Set(Object.keys(varsA));
      const keysB = new Set(Object.keys(varsB));

      const added = [...keysB].filter((k) => !keysA.has(k));
      const removed = [...keysA].filter((k) => !keysB.has(k));
      const changed = [...keysA].filter(
        (k) => keysB.has(k) && varsA[k] !== varsB[k]
      );
      const unchanged = [...keysA].filter(
        (k) => keysB.has(k) && varsA[k] === varsB[k]
      );
      const changedDetails = changed.map((k) => ({
        key: k,
        valueA: varsA[k],
        valueB: varsB[k],
        sensitiveA: !versionA.nonSensitive?.includes(k),
        sensitiveB: !versionB.nonSensitive?.includes(k),
      }));

      return {
        success: true,
        data: { added, removed, changed, unchanged, changedDetails },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async validateEnv(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;
    return this.validateVaultEnv(loadResult.data, envName);
  }

  /**
   * `validateEnv` on an open vault.
   *
   * @param {EnvironmentVault} vault
   * @param {string} envName
   * @returns {any}
   */
  static validateVaultEnv(vault, envName) {
    try {
      // Throws if the environment does not exist.
      const activeVersion = vault.getActiveVersion(envName);

      const errors = [];
      const warnings = [];

      // Resolve layering + template refs first. Any resolution failure
      // (missing ref, cycle, depth overflow, broken extends) is recorded as a
      // validation error instead of crashing the command.
      const resolver = new EnvironmentResolver(vault);
      let vars = activeVersion ? activeVersion.vars : {};
      let required = [];
      let resolved = false;
      try {
        vars = resolver.resolveEnvironment(envName);
        required = resolver.aggregateRequired(envName);
        resolved = true;
      } catch (err) {
        errors.push(err.message);
      }

      if (resolved) {
        for (const key of required) {
          if (!(key in vars)) {
            errors.push(`Missing required key: ${key}`);
          } else if (vars[key] === '' || vars[key] == null) {
            errors.push(`Required key is empty: ${key}`);
          }
        }
      }

      for (const [key, value] of Object.entries(vars)) {
        if (typeof value !== 'string') {
          errors.push(`Value for ${key} is not a string`);
        }
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
          warnings.push(
            `Non-standard key name: "${key}" (expected UPPER_CASE)`
          );
        }
        if (
          typeof value === 'string' &&
          !required.includes(key) &&
          SUSPICIOUS_VALUE_RE.test(value)
        ) {
          warnings.push(
            `Possible secret in non-required key "${key}" (looks like a private key or live token)`
          );
        }
      }

      return {
        success: true,
        data: {
          envName,
          varCount: Object.keys(vars).length,
          requiredCount: required.length,
          errors,
          warnings,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
