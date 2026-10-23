import fs from 'fs-extra';
import path from 'path';
import { writePrivateJson } from '../utils/privateJsonFile.js';

const FORMAT = 1;

/**
 * Vault passwords the user chose to keep on this computer, for env vaults
 * (GUI-ENV-BREAKDOWN New-24, option B) and password vaults (New-52). Off by
 * default, per vault. One store holds both kinds: entries are keyed by
 * file path, so "forget all" covers every vault.
 *
 * Each password is encrypted with Electron's `safeStorage` (the macOS
 * Keychain, DPAPI on Windows, the Secret Service on Linux) and the result
 * is kept in one JSON file, mode 0600, keyed by the vault's absolute path:
 * vault ids last one run, paths don't. Without real OS encryption (Linux's
 * `basic_text` fallback, or none at all) nothing is ever stored.
 *
 * `get` asks `confirmPresence` first (Touch ID where the Mac has it), so a
 * saved password isn't used just because the app is running. Passwords
 * stay in main: none of these methods is reachable from the page except
 * through the IPC handlers, which never return one.
 */
export class VaultKeychain {
  #file;
  #safeStorage;
  #confirmPresence;
  #platform;
  /** @type {Record<string, string>|null} path → base64 ciphertext */
  #entries = null;
  /** @type {Promise<Record<string, string>>|null} one read, shared */
  #loading = null;
  #writing = Promise.resolve();

  /**
   * @param {Object} options
   * @param {string} options.file Where the encrypted entries are kept.
   * @param {any} [options.safeStorage] Electron's `safeStorage`.
   * @param {(reason: string) => Promise<boolean>} [options.confirmPresence]
   *   Resolves true when the user may use a saved password now.
   * @param {string} [options.platform]
   */
  constructor({
    file,
    safeStorage = null,
    confirmPresence = async () => true,
    platform = process.platform,
  }) {
    this.#file = file;
    this.#safeStorage = safeStorage;
    this.#confirmPresence = confirmPresence;
    this.#platform = platform;
  }

  /**
   * Whether "Remember on this computer" may be offered. On macOS and
   * Windows this doesn't touch the keychain: there, asking safeStorage
   * reads the app's keychain item, which blocks main and can prompt the
   * user. That happens only once they opt in (`remember`) or use a kept
   * password (`get`), where `#canEncrypt` asks for real.
   */
  available() {
    if (!this.#safeStorage) return false;
    return this.#platform === 'linux' ? this.#canEncrypt() : true;
  }

  /** Whether safeStorage encrypts for real, asking the OS. */
  #canEncrypt() {
    const store = this.#safeStorage;
    if (!store?.isEncryptionAvailable?.()) return false;
    // Linux only: with no keyring, safeStorage "encrypts" with a fixed key.
    if (this.#platform !== 'linux') return true;
    const backend = store.getSelectedStorageBackend?.();
    return backend !== 'basic_text' && backend !== 'unknown';
  }

  #load() {
    // Shared, so overlapping first calls all edit the same entries.
    this.#loading ??= this.#read();
    return this.#loading;
  }

  async #read() {
    let entries = {};
    try {
      const data = await fs.readJson(this.#file);
      if (data?.format === FORMAT && data.entries) entries = data.entries;
    } catch {
      // Missing is normal; a damaged file only costs the saved passwords.
    }
    this.#entries = Object.fromEntries(
      Object.entries(entries).filter(([, v]) => typeof v === 'string')
    );
    return this.#entries;
  }

  #save() {
    const data = { format: FORMAT, entries: this.#entries };
    const next = this.#writing.then(() => writePrivateJson(this.#file, data));
    this.#writing = next.catch(() => {});
    return next;
  }

  /** @param {string} vaultPath */
  async has(vaultPath) {
    return Boolean((await this.#load())[path.resolve(vaultPath)]);
  }

  /**
   * Keep `password` for `vaultPath`.
   * @returns {Promise<boolean>} false when it can't be stored safely.
   */
  async remember(vaultPath, password) {
    if (typeof password !== 'string' || !this.#canEncrypt()) return false;
    let blob;
    try {
      blob = this.#safeStorage.encryptString(password).toString('base64');
    } catch {
      return false; // e.g. keychain access denied at the OS prompt
    }
    const entries = await this.#load();
    entries[path.resolve(vaultPath)] = blob;
    await this.#save();
    return true;
  }

  /** Drop the saved password of `vaultPath`, if any. */
  async forget(vaultPath) {
    const entries = await this.#load();
    const key = path.resolve(vaultPath);
    if (!(key in entries)) return;
    delete entries[key];
    await this.#save();
  }

  /** How many passwords are kept. */
  async count() {
    return Object.keys(await this.#load()).length;
  }

  /**
   * Drop the passwords of vault files that are gone: the file is missing
   * but its folder is there (deleted, moved, renamed). A missing folder
   * keeps its password: it may be an unmounted drive or a disconnected
   * share. Only the file system is asked, never the OS keychain.
   * @returns {Promise<string[]>} The paths dropped.
   */
  async prune() {
    const entries = await this.#load();
    const gone = [];
    for (const key of Object.keys(entries)) {
      if (
        !(await fs.pathExists(key)) &&
        (await fs.pathExists(path.dirname(key)))
      ) {
        gone.push(key);
      }
    }
    if (gone.length === 0) return gone;
    for (const key of gone) delete entries[key];
    await this.#save();
    return gone;
  }

  /**
   * Forget every kept password.
   * @returns {Promise<number>} How many there were.
   */
  async forgetAll() {
    const entries = await this.#load();
    const count = Object.keys(entries).length;
    for (const key of Object.keys(entries)) delete entries[key];
    await this.#save();
    return count;
  }

  /**
   * The saved password of `vaultPath`, after the presence check.
   * @returns {Promise<{success: boolean, password?: string,
   *   code?: 'NONE'|'UNAVAILABLE'|'CANCELED'}>} `code` when not `success`.
   */
  async get(vaultPath, reason) {
    const blob = (await this.#load())[path.resolve(vaultPath)];
    if (!blob) return { success: false, code: 'NONE' };
    if (!(await this.#confirmPresence(reason))) {
      return { success: false, code: 'CANCELED' };
    }
    if (!this.#canEncrypt()) return { success: false, code: 'UNAVAILABLE' };
    try {
      const password = this.#safeStorage.decryptString(
        Buffer.from(blob, 'base64')
      );
      return { success: true, password };
    } catch {
      // Encrypted under another OS key (a restored backup, another build).
      await this.forget(vaultPath);
      return { success: false, code: 'NONE' };
    }
  }
}
