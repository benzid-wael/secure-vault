import path from 'path';

import { getAppDataPath } from '../utils/appPaths.js';
import { readJsonFile, writePrivateJson } from '../utils/privateJsonFile.js';

const FORMAT = 1;

/**
 * @typedef {Object} AppSettings
 * @property {number} idleMinutes
 * @property {boolean} rememberRecents
 * @property {string[]} envVaultExtensions
 */

/**
 * What a fresh install uses (GUI-ENV-RFC §12 D1, D5).
 * @type {Readonly<AppSettings>}
 */
export const APP_SETTINGS_DEFAULTS = Object.freeze({
  /** Lock an unlocked vault after this many minutes without user activity. */
  idleMinutes: 5,
  /** Remember env vaults opened from a file or folder across restarts. */
  rememberRecents: true,
  /** File extensions the Open… dialog offers first for env vaults. */
  envVaultExtensions: ['vault'],
});

const EXTENSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;

const VALID = {
  idleMinutes: (v) => Number.isInteger(v) && v >= 1 && v <= 240,
  rememberRecents: (v) => typeof v === 'boolean',
  envVaultExtensions: (v) =>
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= 10 &&
    new Set(v).size === v.length &&
    v.every((ext) => typeof ext === 'string' && EXTENSION.test(ext)),
};

const INVALID_MESSAGE = {
  idleMinutes: 'The idle timeout must be a whole number of minutes, 1 to 240',
  rememberRecents: 'Remembering vaults is either on or off',
  envVaultExtensions:
    'List 1 to 10 file extensions, each up to 16 letters, digits, "-" or "_" (like vault), without repeats',
};

/**
 * App-wide settings that aren't secret (GUI-ENV-BREAKDOWN New-2): readable
 * while every vault is locked, unlike `VaultSettingsService`, which is per
 * password vault and encrypted. Plain JSON in the app data folder, `0600`,
 * written atomically and only by main.
 */
export class AppSettingsStore {
  #file;
  #settings = null;
  #warning = '';
  #loading = null;
  #writing = Promise.resolve();

  /** @param {{file?: string}} [options] */
  constructor({
    file = path.join(getAppDataPath(), 'app-settings.json'),
  } = {}) {
    this.#file = file;
  }

  /** Why the settings on disk weren't used, or '' when they were. */
  get warning() {
    return this.#warning;
  }

  /** @returns {Promise<AppSettings>} */
  async get() {
    this.#loading ??= this.#read();
    await this.#loading;
    return {
      ...this.#settings,
      envVaultExtensions: [...this.#settings.envVaultExtensions],
    };
  }

  async #read() {
    const { data, damaged } = await readJsonFile(this.#file);
    const stored = data?.format === FORMAT ? data.settings : null;
    if (damaged || (data !== undefined && !stored)) {
      this.#warning =
        "The settings file couldn't be read; using the default settings.";
    }
    // Each setting falls back on its own, so one bad value keeps the rest.
    this.#settings = {
      ...APP_SETTINGS_DEFAULTS,
      envVaultExtensions: [...APP_SETTINGS_DEFAULTS.envVaultExtensions],
    };
    for (const [key, valid] of Object.entries(VALID)) {
      if (stored && valid(stored[key])) this.#settings[key] = stored[key];
    }
  }

  /**
   * Change some settings. Unknown keys and invalid values are refused as a
   * whole; nothing is written then.
   *
   * @param {Partial<AppSettings>} patch
   * @returns {Promise<{success: boolean, settings?: Object, code?: string,
   *   error?: string}>}
   */
  async update(patch) {
    if (!patch || typeof patch !== 'object') {
      return { success: false, code: 'INVALID', error: 'Nothing to change' };
    }
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in VALID)) {
        return {
          success: false,
          code: 'INVALID',
          error: `Unknown setting: ${key}`,
        };
      }
      if (!VALID[key](value)) {
        return { success: false, code: 'INVALID', error: INVALID_MESSAGE[key] };
      }
    }
    await this.get();
    // Merge into what's current now, not a copy taken before the await:
    // an overlapping update may have changed it meanwhile.
    const before = this.#settings;
    const settings = { ...before, ...patch };
    this.#settings = settings;
    const data = { format: FORMAT, settings };
    const next = this.#writing.then(() => writePrivateJson(this.#file, data));
    this.#writing = next.catch(() => {});
    try {
      await next;
    } catch (error) {
      // Not saved: don't act on it either. (A later update may already
      // have replaced it; then that one stands.)
      if (this.#settings === settings) this.#settings = before;
      return {
        success: false,
        code: 'ERROR',
        error: `Couldn't save the settings: ${error.message}`,
      };
    }
    this.#warning = '';
    return {
      success: true,
      settings: {
        ...settings,
        envVaultExtensions: [...settings.envVaultExtensions],
      },
    };
  }
}
