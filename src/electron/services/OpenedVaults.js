import fs from 'fs-extra';
import path from 'path';

import { getAppDataPath } from '../utils/appPaths.js';
import { writePrivateJson } from '../utils/privateJsonFile.js';

/** The vault name rules main enforces (SecurityManager.validateVaultName). */
const MAX_NAME = 50;
const INVALID_NAME_CHARS = /[<>:"/\\|?*\0]/g;

/**
 * Password vaults opened from a folder other than the app's
 * (GUI-ENV-BREAKDOWN New-53): `<appdata>/gui-opened-vaults.json`,
 * `[{ name, path }]`, 0600, written only by main. Each gets a name, unique
 * among every listed vault, that the rest of the app uses as it does an
 * app-folder vault's; `VaultFileService` maps it to the file.
 *
 * Read once, synchronously, when built: path lookups happen on every file
 * operation and stay synchronous.
 */
export class OpenedVaults {
  #file;
  /** @type {{name: string, path: string}[]} */
  #entries;
  #writing = Promise.resolve();

  /** @param {{file?: string}} [options] */
  constructor({
    file = path.join(getAppDataPath(), 'gui-opened-vaults.json'),
  } = {}) {
    this.#file = file;
    this.#entries = OpenedVaults.#read(file);
  }

  static #read(file) {
    let data;
    try {
      data = fs.readJsonSync(file);
    } catch {
      return []; // missing, or damaged: only the list is lost
    }
    const names = new Set();
    const paths = new Set();
    return (Array.isArray(data) ? data : []).filter(
      (e) =>
        typeof e?.name === 'string' &&
        e.name.length > 0 &&
        e.name.length <= MAX_NAME &&
        !new RegExp(INVALID_NAME_CHARS.source).test(e.name) &&
        typeof e.path === 'string' &&
        path.isAbsolute(e.path) &&
        !names.has(e.name) &&
        !paths.has(e.path) &&
        names.add(e.name) &&
        paths.add(e.path)
    );
  }

  /** @returns {{name: string, path: string}[]} */
  list() {
    return this.#entries.map((e) => ({ ...e }));
  }

  /** @returns {string[]} */
  names() {
    return this.#entries.map((e) => e.name);
  }

  /** The file listed as `name`, or null. */
  pathOf(name) {
    return this.#entries.find((e) => e.name === name)?.path ?? null;
  }

  /** The name `filePath` is listed under, or null. */
  nameOf(filePath) {
    const resolved = path.resolve(filePath);
    return this.#entries.find((e) => e.path === resolved)?.name ?? null;
  }

  /**
   * List `filePath`, named after the file and kept clear of `taken` and of
   * every name already listed: `team.vault` → `team`, then `team (2)`.
   * @param {string} filePath
   * @param {string[]} taken Names in use elsewhere (the app's folder).
   * @returns {Promise<string>} The name it's listed under.
   */
  async add(filePath, taken = []) {
    const resolved = path.resolve(filePath);
    const existing = this.nameOf(resolved);
    if (existing) return existing;
    const used = new Set([...taken, ...this.names()]);
    const base =
      path
        .basename(resolved)
        .replace(/\.vault$/, '')
        .replace(INVALID_NAME_CHARS, '-')
        .trim()
        .slice(0, MAX_NAME) || 'vault';
    let name = base;
    for (let n = 2; used.has(name); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    }
    this.#entries = [...this.#entries, { name, path: resolved }];
    await this.#save();
    return name;
  }

  /** Take `name` off the list; the file isn't touched. */
  async remove(name) {
    const kept = this.#entries.filter((e) => e.name !== name);
    if (kept.length === this.#entries.length) return false;
    this.#entries = kept;
    await this.#save();
    return true;
  }

  #save() {
    const data = this.#entries;
    const next = this.#writing.then(() => writePrivateJson(this.#file, data));
    this.#writing = next.catch(() => {});
    return next;
  }
}
