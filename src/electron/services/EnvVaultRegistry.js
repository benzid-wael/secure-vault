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
 * Vaults opened from a file or a folder are listed for the run and, while
 * `remember()` says so (the D5 setting), kept in `recents` across runs.
 */
export class EnvVaultRegistry {
  #envsDir;
  #dialog;
  #newId;
  /** @type {Map<string, string>} id → path */
  #paths = new Map();
  /** @type {Map<string, string>} path → id, so a path keeps one id per run */
  #ids = new Map();
  /** @type {Map<string, string>} path → lastOpened (ISO), opened or recent */
  #opened = new Map();
  /** @type {import('./EnvVaultRecents.js').EnvVaultRecents | null} */
  #recents;
  #remember;
  #extensions;
  #recentsLoaded = null;

  /**
   * @param {Object} [options]
   * @param {string} [options.envsDir]
   * @param {{showOpenDialog: Function}} [options.dialog] Electron's `dialog`.
   * @param {() => string} [options.newId]
   * @param {import('./EnvVaultRecents.js').EnvVaultRecents} [options.recents]
   *   Where opened vaults are kept across runs; none: this run only.
   * @param {() => Promise<boolean>} [options.remember] Whether to keep them
   *   (the D5 setting), asked at each use.
   * @param {() => Promise<string[]>} [options.extensions] The file
   *   extensions the Open… dialog offers first (a setting), asked each time.
   */
  constructor({
    envsDir = getEnvsDir(),
    dialog = null,
    newId = () => crypto.randomBytes(16).toString('hex'),
    recents = null,
    remember = async () => true,
    extensions = async () => ['vault'],
  } = {}) {
    this.#envsDir = envsDir;
    this.#dialog = dialog;
    this.#newId = newId;
    this.#recents = recents;
    this.#remember = remember;
    this.#extensions = extensions;
  }

  /** Once per run: add the remembered vaults to this run's list. */
  #loadRecents() {
    this.#recentsLoaded ??= (async () => {
      if (!this.#recents || !(await this.#remember())) return;
      for (const { path: filePath, lastOpened } of await this.#recents.list()) {
        if (!this.#opened.has(filePath)) {
          this.#opened.set(filePath, lastOpened);
        }
      }
    })().catch((error) => {
      console.error('Could not read the recent env vaults:', error.message);
    });
    return this.#recentsLoaded;
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

  /**
   * @returns {Promise<EnvVaultEntry[]>} App-data vaults, then opened and
   *   remembered ones, most recently opened first.
   */
  async list() {
    await this.#loadRecents();
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
    const opened = [...this.#opened].sort(([, a], [, b]) => b.localeCompare(a));
    for (const [filePath] of opened) {
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
   * Let the user pick an env vault in the native dialog. It offers the
   * configured extensions first, and "All files": the native filter can
   * refuse a name it should take (New-48), and the content check below is
   * what decides anyway.
   * @returns {Promise<{success: boolean, id?: string, canceled?: boolean,
   *   code?: string, error?: string}>}
   */
  async openFromDialog(win) {
    const picked = await this.#dialog.showOpenDialog(win, {
      title: 'Open Environment Vault',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'Environment vault', extensions: await this.#extensions() },
        { name: 'All files', extensions: ['*'] },
      ],
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
    await this.#noteOpened(filePath);
    return { success: true, id: this.#idFor(filePath) };
  }

  async #noteOpened(filePath, now = new Date()) {
    // App-folder vaults are always listed; nothing to remember.
    if (path.dirname(filePath) === this.#envsDir) return;
    await this.#loadRecents();
    this.#opened.set(filePath, now.toISOString());
    if (!this.#recents || !(await this.#remember())) return;
    try {
      await this.#recents.add(filePath, now);
    } catch (error) {
      // The vault is open either way; only the next run won't list it.
      console.error('Could not remember the env vault:', error.message);
    }
  }

  /**
   * Take an opened or remembered vault off the list, now and in later runs.
   * The file is untouched; app-folder vaults are always listed.
   * @returns {Promise<{success: boolean, code?: string, error?: string}>}
   */
  async forget(id) {
    const filePath = this.resolve(id);
    if (!filePath || !this.#opened.has(filePath)) {
      return {
        success: false,
        code: 'INVALID',
        error: 'Only opened vaults can be removed from the list',
      };
    }
    this.#opened.delete(filePath);
    await this.#recents?.remove(filePath);
    return { success: true };
  }

  /**
   * Stop remembering across runs (the D5 setting turned off): the kept list
   * is deleted. Vaults opened this run stay listed until the app quits.
   */
  async clearRecents() {
    await this.#recents?.clear();
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
