/**
 * MountRegistry — tracks the files the agent has materialized for live mounts so
 * they can be wiped as a set on lock / unmount (SPEC §13.5, G26).
 *
 * Bookkeeping over the mount lifecycle: it holds absolute paths, each with its
 * `rebuild` closure and (when a `watch` function is injected) the live file-watch
 * that re-materializes the mount if a build deletes it. It wipes via an injected
 * `secureDelete` and watches via an injected `watch`, so it is unit-testable
 * without touching disk. It never renders or resolves anything itself.
 *
 * The watch is always stopped *before* a secure delete, so an intentional
 * unmount / lock-wipe is never re-created by its own watcher.
 */
export class MountRegistry {
  constructor({ secureDelete, watch = null }) {
    if (typeof secureDelete !== 'function') {
      throw new TypeError(
        'MountRegistry requires a secureDelete(path) function'
      );
    }
    this._secureDelete = secureDelete;
    // Optional (absPath, rebuild) => stop() — arms a file-watch per mount.
    this._watch = typeof watch === 'function' ? watch : null;
    /** absPath -> { rebuild, stop } */
    this._entries = new Map();
  }

  /** Record a materialized artifact and how to rebuild it; arm its watch. */
  add(absPath, rebuild = () => {}) {
    const prior = this._entries.get(absPath);
    if (prior && prior.stop) prior.stop();
    const stop = this._watch ? this._watch(absPath, rebuild) : null;
    this._entries.set(absPath, { rebuild, stop });
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

  /** The rebuild closure for a path (used by the watch), or undefined. */
  rebuildFor(absPath) {
    const entry = this._entries.get(absPath);
    return entry ? entry.rebuild : undefined;
  }

  /** Securely wipe and forget a single mount (stopping its watch first). */
  remove(absPath) {
    const entry = this._entries.get(absPath);
    if (!entry) return;
    if (entry.stop) entry.stop();
    this._secureDelete(absPath);
    this._entries.delete(absPath);
  }

  /** Securely wipe and forget every mount (the lock / shutdown path). */
  wipeAll() {
    for (const [absPath, entry] of this._entries) {
      if (entry.stop) entry.stop();
      this._secureDelete(absPath);
    }
    this._entries.clear();
  }
}
