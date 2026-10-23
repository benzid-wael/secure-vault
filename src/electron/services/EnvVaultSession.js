import crypto from 'crypto';
import { EnvironmentVaultService } from './EnvironmentVaultService.js';

/** Idle time before an unlocked env vault locks itself (RFC §12 D1). */
export const ENV_VAULT_IDLE_MS = 5 * 60 * 1000;

/** Open views per vault; past this the oldest is dropped. */
export const MAX_VIEWS_PER_VAULT = 32;

const locked = () => ({
  success: false,
  code: 'LOCKED',
  error: 'Vault is locked',
});

/**
 * @typedef {Object} EnvView
 * @property {string} id       The vault's id.
 * @property {string} env
 * @property {string} revision The file revision the renderer was shown.
 * @property {Record<string, string>} [stamps] A hash per own key at that
 *   revision (EnvVaultIpc `stampsOf`), for merging later commits.
 * @property {Record<string, string>} [rows] A hash per row shown, inherited
 *   ones included (EnvVaultIpc `rowStampsOf`), for reveal and copy.
 */

/**
 * Unlocked env vaults, held in the main process and keyed by registry id
 * (GUI-ENV-RFC §6.6). Several can be open at once; each locks after
 * `idleMs` without a user-initiated call (`touch`).
 *
 * Every read or write goes through `run`, which hands the op both the cached
 * key and the password: the service then opens a vault the CLI re-keyed with
 * the password, so `REKEYED` never reaches the renderer, and the key the op
 * returns is kept (the H3 trap: a legacy vault is re-salted on its first
 * write). Only `AUTH` (the password changed elsewhere) locks the vault.
 *
 * Limit, as in VaultSession: the password is a JS string and can't be wiped;
 * cached key Buffers are zeroed on lock.
 */
export class EnvVaultSession {
  #service;
  #idleMs;
  #onLocked;
  #setTimer;
  #clearTimer;
  /** @type {Map<string, {path: string, password: string,
   *   keyMaterial: {key: Buffer, header: Object}|null, timer: any}>} */
  #vaults = new Map();
  /** @type {Map<string, EnvView>} */
  #views = new Map();

  /**
   * @param {Object} [options]
   * @param {typeof EnvironmentVaultService} [options.service]
   * @param {number} [options.idleMs]
   * @param {(id: string) => void} [options.onLocked] After any lock.
   * @param {(fn: () => void, ms: number) => any} [options.setTimer]
   * @param {(timer: any) => void} [options.clearTimer]
   */
  constructor({
    service = EnvironmentVaultService,
    idleMs = ENV_VAULT_IDLE_MS,
    onLocked = () => {},
    setTimer = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    },
    clearTimer = (timer) => clearTimeout(timer),
  } = {}) {
    this.#service = service;
    this.#idleMs = idleMs;
    this.#onLocked = onLocked;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  /** Check the password by reading the vault; keep the key on success. */
  async unlock(id, vaultPath, password) {
    if (typeof password !== 'string' || password === '') {
      return { success: false, code: 'INVALID', error: 'Enter the password' };
    }
    const result = await this.#service.read(vaultPath, password);
    if (!result.success) return result;
    this.lock(id, { silent: true }); // a re-unlock starts clean
    this.#vaults.set(id, {
      path: vaultPath,
      password,
      keyMaterial: result.keyMaterial,
      timer: null,
    });
    this.touch(id);
    return { success: true, revision: result.revision };
  }

  /**
   * The vault's password was changed through the app (Task 28): keep the
   * new one, and drop the cached key so the next op derives it afresh.
   */
  setPassword(id, password) {
    const entry = this.#vaults.get(id);
    if (!entry) return;
    entry.keyMaterial?.key?.fill(0);
    entry.keyMaterial = null;
    entry.password = password;
  }

  /** The path of an unlocked vault, for ops that need it, or null. */
  pathOf(id) {
    return this.#vaults.get(id)?.path ?? null;
  }

  isUnlocked(id) {
    return this.#vaults.has(id);
  }

  /**
   * Run `op(vaultPath, auth)` (a service `read` or `transact` call) on the
   * unlocked vault, keep the key it returns, and map `AUTH` to a lock.
   *
   * @param {string} id
   * @param {(vaultPath: string, auth: {password: string,
   *   keyMaterial: any}) => Promise<any>} op
   * @returns {Promise<any>} What `op` returned, or a `LOCKED` failure.
   */
  async run(id, op) {
    const entry = this.#vaults.get(id);
    if (!entry) return locked();
    const result = await op(entry.path, {
      password: entry.password,
      keyMaterial: entry.keyMaterial,
    });
    if (result.success && result.keyMaterial) {
      this.#commit(id, entry, result.keyMaterial);
    } else if (!result.success && result.code === 'AUTH') {
      // The stored password no longer opens the file: changed elsewhere.
      this.lock(id);
      return {
        success: false,
        code: 'LOCKED',
        error: 'The vault password was changed elsewhere; unlock it again',
      };
    }
    return result;
  }

  #commit(id, entry, keyMaterial) {
    if (this.#vaults.get(id) !== entry) return; // locked while the op ran
    const old = entry.keyMaterial;
    if (old && old.key !== keyMaterial.key) old.key.fill(0);
    entry.keyMaterial = keyMaterial;
  }

  /**
   * A new idle timeout (Settings, Task 23). Every unlocked vault's timer
   * restarts with it, counted from now.
   */
  setIdleMs(ms) {
    if (!Number.isInteger(ms) || ms <= 0) return;
    this.#idleMs = ms;
    for (const id of this.#vaults.keys()) this.touch(id);
  }

  /** Reset the idle timer. Only user-initiated calls may do this. */
  touch(id) {
    const entry = this.#vaults.get(id);
    if (!entry) return;
    if (entry.timer) this.#clearTimer(entry.timer);
    entry.timer = this.#setTimer(() => this.lock(id), this.#idleMs);
  }

  /** Zero the key, drop the password and every view of `id`. */
  lock(id, { silent = false } = {}) {
    const entry = this.#vaults.get(id);
    if (!entry) return;
    if (entry.timer) this.#clearTimer(entry.timer);
    entry.keyMaterial?.key?.fill(0);
    entry.keyMaterial = null;
    entry.password = null;
    this.#vaults.delete(id);
    for (const [viewId, view] of this.#views) {
      if (view.id === id) this.#views.delete(viewId);
    }
    if (!silent) this.#onLocked(id);
  }

  lockAll() {
    for (const id of [...this.#vaults.keys()]) this.lock(id);
  }

  /**
   * A new view of `env`. Other views of the same env stay valid: two
   * `env:view` calls can be in flight at once (React StrictMode mounts twice
   * in dev) and finish in either order, so dropping the older one could drop
   * the one the page shows. The page closes views it no longer uses; a cap
   * bounds what a page forgets to close.
   */
  openView(id, env, revision) {
    const own = [...this.#views].filter(([, view]) => view.id === id);
    const excess = Math.max(0, own.length - MAX_VIEWS_PER_VAULT + 1);
    for (const [viewId] of own.slice(0, excess)) {
      this.#views.delete(viewId); // oldest first: a Map keeps insertion order
    }
    const viewId = crypto.randomBytes(16).toString('hex');
    this.#views.set(viewId, { id, env, revision });
    return viewId;
  }

  /** The view, only if it belongs to `id`; a view id alone grants nothing. */
  getView(id, viewId) {
    const view = this.#views.get(viewId);
    return view && view.id === id ? view : null;
  }

  closeView(id, viewId) {
    if (this.getView(id, viewId)) this.#views.delete(viewId);
  }
}
