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
 * password stays in main-process heap memory until the GC reuses it. Wiping it
 * for real needs native, off-heap storage (see AGENT-DESIGN.md §8).
 */
export class VaultSession {
  #vaultName = null;
  #password = null;

  open(vaultName, password) {
    if (!vaultName || typeof password !== 'string') {
      throw new Error('A vault name and password are required to unlock');
    }
    this.#vaultName = vaultName;
    this.#password = password;
  }

  close() {
    this.#vaultName = null;
    this.#password = null;
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
