import fs from 'fs-extra';
import path from 'path';

import { getAppDataPath } from '../utils/appPaths.js';
import { writePrivateJson } from '../utils/privateJsonFile.js';

/**
 * Where each password vault's key file was last used
 * (PASSWORD-VAULT-2FA-RFC.md Q1, GUI-ENV-BREAKDOWN New-54 step 4):
 * `<appdata>/key-file-locations.json`, `{ <vault path>: <key file path> }`,
 * 0600, written only by main. Locations only, never a key file's content:
 * the key file is still needed, wherever it is (a USB stick that must be
 * in). Read once, when built.
 */
export class KeyFileLocations {
  #file;
  /** @type {Record<string, string>} */
  #entries;
  #writing = Promise.resolve();

  /** @param {{file?: string}} [options] */
  constructor({
    file = path.join(getAppDataPath(), 'key-file-locations.json'),
  } = {}) {
    this.#file = file;
    this.#entries = KeyFileLocations.#read(file);
  }

  static #read(file) {
    let data;
    try {
      data = fs.readJsonSync(file);
    } catch {
      return {}; // missing, or damaged: only the locations are lost
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data).filter(
        ([vault, key]) =>
          path.isAbsolute(vault) &&
          typeof key === 'string' &&
          path.isAbsolute(key)
      )
    );
  }

  /** The key file last used for the vault at `vaultPath`, or null. */
  get(vaultPath) {
    return this.#entries[path.resolve(vaultPath)] ?? null;
  }

  /** Remember `keyFilePath` for the vault at `vaultPath`. */
  async set(vaultPath, keyFilePath) {
    const vault = path.resolve(vaultPath);
    const key = path.resolve(keyFilePath);
    if (this.#entries[vault] === key) return;
    this.#entries = { ...this.#entries, [vault]: key };
    await this.#save();
  }

  /** Forget the vault's key file location, if any. */
  async forget(vaultPath) {
    const vault = path.resolve(vaultPath);
    if (!(vault in this.#entries)) return;
    const kept = { ...this.#entries };
    delete kept[vault];
    this.#entries = kept;
    await this.#save();
  }

  #save() {
    const data = this.#entries;
    const next = this.#writing.then(() => writePrivateJson(this.#file, data));
    this.#writing = next.catch(() => {});
    return next;
  }
}
