import { CryptographyService } from './CryptographyService.js';

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
 */
export class VaultSession {
  #vaultName = null;
  #password = null;
  // Derived keys for the session password, by `<salt hex>:<iterations>`.
  // PBKDF2 at the current work factor costs ~250 ms and blocks the main
  // process, so loads and saves within a session reuse the key.
  #keys = new Map();

  open(vaultName, password) {
    if (!vaultName || typeof password !== 'string') {
      throw new Error('A vault name and password are required to unlock');
    }
    this.#dropKeys();
    this.#vaultName = vaultName;
    this.#password = password;
  }

  close() {
    this.#dropKeys();
    this.#vaultName = null;
    this.#password = null;
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
