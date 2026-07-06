/**
 * MountRegistry — tracks the files the agent has materialized for live mounts so
 * they can be wiped as a set on lock / unmount (SPEC §13.5, G26).
 *
 * Pure bookkeeping: it holds absolute paths and a per-path `rebuild` closure
 * (used by the daemon's file-watch to re-materialize a mount deleted out from
 * under a build), and wipes via an injected `secureDelete` so it is unit-testable
 * without touching disk. It never renders or resolves anything itself.
 */
export class MountRegistry {
  constructor({ secureDelete }) {
    if (typeof secureDelete !== 'function') {
      throw new TypeError(
        'MountRegistry requires a secureDelete(path) function'
      );
    }
    this._secureDelete = secureDelete;
    /** absPath -> rebuild() */
    this._entries = new Map();
  }

  /** Record a materialized artifact and how to rebuild it. */
  add(absPath, rebuild = () => {}) {
    this._entries.set(absPath, rebuild);
  }

  /** Absolute paths of every currently-tracked mount. */
  list() {
    return [...this._entries.keys()];
  }

  /** Number of live mounts. */
  get size() {
    return this._entries.size;
  }

  has(absPath) {
    return this._entries.has(absPath);
  }

  /** The rebuild closure for a path (used by file-watch), or undefined. */
  rebuildFor(absPath) {
    return this._entries.get(absPath);
  }

  /** Securely wipe and forget a single mount. */
  remove(absPath) {
    if (!this._entries.has(absPath)) return;
    this._secureDelete(absPath);
    this._entries.delete(absPath);
  }

  /** Securely wipe and forget every mount (the lock / shutdown path). */
  wipeAll() {
    for (const absPath of this._entries.keys()) {
      this._secureDelete(absPath);
    }
    this._entries.clear();
  }
}
