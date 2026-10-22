import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { getEnvsDir } from '../utils/appPaths.js';
import { EnvironmentVaultService } from './EnvironmentVaultService.js';

const SUFFIX = '.env.vault';
// Same names the CLI's `--name` turns into `<envs>/<name>.env.vault`.
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @typedef {Object} EnvVaultEntry
 * @property {string} id      Opaque, random, valid for this app run only.
 * @property {string} label
 * @property {string} location The file's path, for display.
 * @property {'appdata'|'opened'} source
 * @property {boolean} exists
 */

/**
 * The only place that maps env vault ids to file paths (GUI-ENV-RFC §6.6).
 * The renderer only ever holds ids, so it can't point an operation at a file
 * the user didn't pick.
 *
 * MVP: vaults opened from the dialog are remembered for this run only;
 * persisted recents wait on the app settings store (New-2) and the
 * single-instance lock (Task 11).
 */
export class EnvVaultRegistry {
  #envsDir;
  #dialog;
  #newId;
  /** @type {Map<string, string>} id → path */
  #paths = new Map();
  /** @type {Map<string, string>} path → id, so a path keeps one id per run */
  #ids = new Map();
  /** @type {Set<string>} paths opened from the dialog this run */
  #opened = new Set();

  /**
   * @param {Object} [options]
   * @param {string} [options.envsDir]
   * @param {{showOpenDialog: Function}} [options.dialog] Electron's `dialog`.
   * @param {() => string} [options.newId]
   */
  constructor({
    envsDir = getEnvsDir(),
    dialog = null,
    newId = () => crypto.randomBytes(16).toString('hex'),
  } = {}) {
    this.#envsDir = envsDir;
    this.#dialog = dialog;
    this.#newId = newId;
  }

  #idFor(filePath) {
    let id = this.#ids.get(filePath);
    if (!id) {
      id = this.#newId();
      this.#ids.set(filePath, id);
      this.#paths.set(id, filePath);
    }
    return id;
  }

  /** @returns {Promise<EnvVaultEntry[]>} App-data vaults, then opened ones. */
  async list() {
    let names = [];
    try {
      names = (await fs.readdir(this.#envsDir))
        .filter((f) => f.endsWith(SUFFIX) && f !== SUFFIX)
        .sort();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    /** @type {EnvVaultEntry[]} */
    const entries = names.map((file) => {
      const filePath = path.join(this.#envsDir, file);
      return {
        id: this.#idFor(filePath),
        label: file.slice(0, -SUFFIX.length),
        location: filePath,
        source: 'appdata',
        exists: true,
      };
    });
    for (const filePath of this.#opened) {
      if (path.dirname(filePath) === this.#envsDir) continue; // listed above
      entries.push({
        id: this.#idFor(filePath),
        label: `${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`,
        location: filePath,
        source: 'opened',
        exists: await fs.pathExists(filePath),
      });
    }
    return entries;
  }

  /**
   * Let the user pick an env vault in the native dialog.
   * @returns {Promise<{success: boolean, id?: string, canceled?: boolean,
   *   code?: string, error?: string}>}
   */
  async openFromDialog(win) {
    const picked = await this.#dialog.showOpenDialog(win, {
      title: 'Open Environment Vault',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: 'Environment vault', extensions: ['vault'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return this.#openFile(path.resolve(picked.filePaths[0]));
  }

  /**
   * Let the user pick a project folder, and open the vault the CLI would use
   * there (New-22): `.env.vault` in it or a parent up to the git root,
   * `config/.env.vault`, then `<envs>/<folder name>.env.vault`.
   * @returns {Promise<{success: boolean, id?: string, canceled?: boolean,
   *   code?: string, error?: string}>}
   */
  async openFolderFromDialog(win) {
    const picked = await this.#dialog.showOpenDialog(win, {
      title: 'Open Project Folder',
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const folder = path.resolve(picked.filePaths[0]);
    const filePath = EnvironmentVaultService.resolveVaultPath({
      cwd: folder,
      envsDir: this.#envsDir,
    });
    if (!filePath) {
      const top = EnvironmentVaultService.findGitRoot(folder) ?? folder;
      return {
        success: false,
        code: 'NOT_FOUND',
        error:
          `No environment vault found for ${folder}. Looked for .env.vault ` +
          (top === folder ? 'in it' : `in it and its parents up to ${top}`) +
          `, config/.env.vault, and ${path.basename(
            EnvironmentVaultService.defaultVaultPath(folder, this.#envsDir)
          )} in the app folder.`,
      };
    }
    return this.#openFile(filePath);
  }

  async #openFile(filePath) {
    if (!(await isEnvVaultFile(filePath))) {
      return {
        success: false,
        code: 'INVALID',
        error: 'That file is not an environment vault',
      };
    }
    this.#opened.add(filePath);
    return { success: true, id: this.#idFor(filePath) };
  }

  /**
   * Reserve `<envs>/<name>.env.vault` for a new vault (the caller creates it).
   * @returns {Promise<{success: boolean, id?: string, path?: string,
   *   code?: string, error?: string}>}
   */
  async createInAppData(name) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      return {
        success: false,
        code: 'INVALID',
        error: 'Use 1–64 letters, digits, "-" or "_"',
      };
    }
    const filePath = path.join(this.#envsDir, `${name}${SUFFIX}`);
    if (await fs.pathExists(filePath)) {
      return {
        success: false,
        code: 'INVALID',
        error: `A vault named "${name}" already exists`,
      };
    }
    return { success: true, id: this.#idFor(filePath), path: filePath };
  }

  /** The path for `id`, or null: unknown and forged ids resolve to nothing. */
  resolve(id) {
    return (typeof id === 'string' && this.#paths.get(id)) || null;
  }
}

/** True for a JSON file whose `type` is `environment-vault`. */
async function isEnvVaultFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    // Vault files are small; don't parse something huge the user mis-picked.
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return false;
    const file = await fs.readJSON(filePath);
    return file?.type === 'environment-vault';
  } catch {
    return false;
  }
}
