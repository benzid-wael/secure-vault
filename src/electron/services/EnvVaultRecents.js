import fs from 'fs-extra';
import path from 'path';

import { getAppDataPath } from '../utils/appPaths.js';
import { readJsonFile, writePrivateJson } from '../utils/privateJsonFile.js';

/** Oldest entries beyond this are dropped. */
export const MAX_RECENTS = 50;

/**
 * Env vaults opened from a file or a folder, remembered across app runs
 * (GUI-ENV-RFC §6.6, Task 14): `<appdata>/gui-env-recents.json`,
 * `[{ path, lastOpened }]`, newest first. Paths only, `0600`, written only
 * by main. Whether to remember at all is the registry's call (D5).
 */
export class EnvVaultRecents {
  #file;
  /** @type {{path: string, lastOpened: string}[] | null} */
  #entries = null;
  #loading = null;
  #writing = Promise.resolve();

  /** @param {{file?: string}} [options] */
  constructor({
    file = path.join(getAppDataPath(), 'gui-env-recents.json'),
  } = {}) {
    this.#file = file;
  }

  /** @returns {Promise<{path: string, lastOpened: string}[]>} */
  async list() {
    this.#loading ??= this.#read();
    await this.#loading;
    return this.#entries.map((e) => ({ ...e }));
  }

  async #read() {
    const { data } = await readJsonFile(this.#file);
    // A damaged file only costs the list; it's rewritten on the next open.
    const seen = new Set();
    this.#entries = (Array.isArray(data) ? data : [])
      .filter(
        (e) =>
          typeof e?.path === 'string' &&
          path.isAbsolute(e.path) &&
          typeof e.lastOpened === 'string' &&
          !seen.has(e.path) &&
          seen.add(e.path)
      )
      .map((e) => ({ path: e.path, lastOpened: e.lastOpened }))
      .slice(0, MAX_RECENTS);
  }

  /** Record that `filePath` was opened now. */
  async add(filePath, now = new Date()) {
    await this.list();
    this.#entries = [
      { path: filePath, lastOpened: now.toISOString() },
      ...this.#entries.filter((e) => e.path !== filePath),
    ].slice(0, MAX_RECENTS);
    return this.#save();
  }

  async remove(filePath) {
    await this.list();
    const kept = this.#entries.filter((e) => e.path !== filePath);
    if (kept.length === this.#entries.length) return;
    this.#entries = kept;
    return this.#save();
  }

  /** Forget everything and delete the file (the D5 toggle turned off). */
  async clear() {
    this.#loading = Promise.resolve();
    this.#entries = [];
    const next = this.#writing.then(() => fs.remove(this.#file));
    this.#writing = next.catch(() => {});
    return next;
  }

  #save() {
    const data = this.#entries;
    const next = this.#writing.then(() => writePrivateJson(this.#file, data));
    this.#writing = next.catch(() => {});
    return next;
  }
}
