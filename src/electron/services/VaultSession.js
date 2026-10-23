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
 * A vault with a key file (format 2, New-54) is held as its data key
 * instead, `{dek}`: a Buffer, zeroed on close. Callers get the credential
 * the vault was opened with, whichever it is.
 *
 * It locks itself after `idleMs` without user activity (Task 13). Only
 * `touch` counts as activity: main calls it for input in the window, never
 * for calls the page makes on its own.
 */
export class VaultSession {
  #vaultName = null;
  /** @type {string | {dek: Buffer} | null} The password, or the data key. */
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

  /**
   * @param {string} vaultName
   * @param {string | {dek: Buffer}} credential The master password, or a
   *   format-2 vault's data key (copied: the session owns and zeroes it).
   */
  open(vaultName, credential) {
    const dek =
      typeof credential === 'object' &&
      credential !== null &&
      Buffer.isBuffer(credential.dek)
        ? credential.dek
        : null;
    if (!vaultName || (typeof credential !== 'string' && !dek)) {
      throw new Error('A vault name and password are required to unlock');
    }
    this.#forget();
    this.#vaultName = vaultName;
    this.#password = dek ? { dek: Buffer.from(dek) } : credential;
    this.touch();
  }

  close() {
    this.#stopTimer();
    this.#forget();
    this.#vaultName = null;
  }

  #forget() {
    this.#dropKeys();
    const held = this.#password;
    if (held !== null && typeof held !== 'string') held.dek.fill(0);
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
    if (typeof this.#password !== 'string' || password !== this.#password) {
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

  /**
   * The credential `vaultName` was opened with (password or `{dek}`), or
   * null when that vault is not unlocked.
   */
  passwordFor(vaultName) {
    return this.isUnlocked(vaultName) ? this.#password : null;
  }

  /**
   * Run `fn(credential)` against the unlocked vault (the password, or
   * `{dek}` for format 2), or return the standard locked result without
   * calling it.
   *
   * A data key is handed over as a copy, zeroed once `fn` settles: a lock
   * while `fn` is still running zeroes the session's key, never the one
   * `fn` is encrypting with (it would write the vault under a zero key).
   */
  async withPassword(vaultName, fn) {
    const credential = this.passwordFor(vaultName);
    if (credential === null) {
      return { success: false, error: 'Vault is locked', locked: true };
    }
    if (typeof credential === 'string') return fn(credential);
    const dek = Buffer.from(credential.dek);
    try {
      return await fn({ dek });
    } finally {
      dek.fill(0);
    }
  }
}
