import { CryptographyService } from './CryptographyService.js';

/** Idle time before the unlocked vault locks itself (GUI-ENV-RFC §12 D1). */
export const VAULT_IDLE_MS = 5 * 60 * 1000;

/**
 * The unlocked-vault session, held in the main process.
 *
 * The renderer never keeps the master password: it hands it over once to
 * unlock (or create / recover) a vault, and every later IPC call names only
 * the vault. A compromised renderer (XSS, DevTools, a hostile extension) can
 * therefore drive the open vault while it is unlocked, but cannot read the
 * password itself.
 *
 * Limit: JS strings are immutable and cannot be zeroed, so after `close()` the
 * password stays in main-process heap memory until the GC reuses it (cached
 * key Buffers are zeroed on close; copies handed out are not). Wiping it
 * for real needs native, off-heap storage (see AGENT-DESIGN.md §8).
 *
 * It locks itself after `idleMs` without user activity (Task 13). Only
 * `touch` counts as activity: main calls it for input in the window, never
 * for calls the page makes on its own.
 */
export class VaultSession {
  #vaultName = null;
  #password = null;
  #idleMs;
  #onIdle;
  #setTimer;
  #clearTimer;
  #timer = null;
  // Derived keys for the session password, by `<salt hex>:<iterations>`.
  // PBKDF2 at the current work factor costs ~250 ms and blocks the main
  // process, so loads and saves within a session reuse the key.
  #keys = new Map();

  /**
   * @param {Object} [options]
   * @param {number} [options.idleMs]
   * @param {(vaultName: string, idleMs: number) => void} [options.onIdle]
   *   After an idle lock.
   * @param {(fn: () => void, ms: number) => any} [options.setTimer]
   * @param {(timer: any) => void} [options.clearTimer]
   */
  constructor({
    idleMs = VAULT_IDLE_MS,
    onIdle = () => {},
    setTimer = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    },
    clearTimer = (timer) => clearTimeout(timer),
  } = {}) {
    this.#idleMs = idleMs;
    this.#onIdle = onIdle;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  open(vaultName, password) {
    if (!vaultName || typeof password !== 'string') {
      throw new Error('A vault name and password are required to unlock');
    }
    this.#dropKeys();
    this.#vaultName = vaultName;
    this.#password = password;
    this.touch();
  }

  close() {
    this.#stopTimer();
    this.#dropKeys();
    this.#vaultName = null;
    this.#password = null;
  }

  /** User activity: the idle time counts again from now. */
  touch() {
    if (this.#password === null) return;
    this.#stopTimer();
    this.#timer = this.#setTimer(() => {
      const vaultName = this.#vaultName;
      this.close();
      this.#onIdle(vaultName, this.#idleMs);
    }, this.#idleMs);
  }

  /** A new idle timeout (Settings): an unlocked vault's timer restarts. */
  setIdleMs(ms) {
    if (!Number.isInteger(ms) || ms <= 0) return;
    this.#idleMs = ms;
    this.touch();
  }

  #stopTimer() {
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#timer = null;
  }

  #dropKeys() {
    for (const key of this.#keys.values()) key.fill(0);
    this.#keys.clear();
  }

  /**
   * `CryptographyService.deriveKey`, memoized for the session password only:
   * any other password (a re-typed current password that doesn't match, an
   * import password) is derived fresh and never cached.
   */
  deriveKey(password, salt, iterations) {
    if (this.#password === null || password !== this.#password) {
      return CryptographyService.deriveKey(password, salt, iterations);
    }
    const id = `${Buffer.from(salt).toString('hex')}:${iterations}`;
    let key = this.#keys.get(id);
    if (!key) {
      key = CryptographyService.deriveKey(password, salt, iterations);
      this.#keys.set(id, key);
    }
    // A copy, so a caller can't zero or alter the cached key.
    return Buffer.from(key);
  }

  get vaultName() {
    return this.#vaultName;
  }

  isUnlocked(vaultName) {
    return this.#password !== null && this.#vaultName === vaultName;
  }

  /** The password for `vaultName`, or null when that vault is not unlocked. */
  passwordFor(vaultName) {
    return this.isUnlocked(vaultName) ? this.#password : null;
  }

  /**
   * Run `fn(password)` against the unlocked vault, or return the standard
   * locked result without calling it.
   */
  async withPassword(vaultName, fn) {
    const password = this.passwordFor(vaultName);
    if (password === null) {
      return { success: false, error: 'Vault is locked', locked: true };
    }
    return fn(password);
  }
}
