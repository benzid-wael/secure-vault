import fs from 'fs';
import path from 'path';
import { EnvironmentVaultService } from './EnvironmentVaultService.js';

/** Wait this long after the last file event before reading the file. */
export const WATCH_DEBOUNCE_MS = 250;

/**
 * Tells the page when an unlocked env vault changes on disk for a reason
 * other than the app's own writes: the CLI, a sync tool, an editor
 * (GUI-ENV-BREAKDOWN Task 16).
 *
 * It watches the vault's directory, not the file: writes are atomic renames,
 * and a watch on the file would follow the replaced inode and go quiet (the
 * lesson from `src/agent/mountWatch.js`). Events are debounced, then the file
 * is hashed: a change is reported only when its revision differs from the
 * last one the app read or wrote (`note`), so the app's own commits are
 * ignored. A `null` filename (some platforms) may be ours, so it is checked
 * the same way. A vault is watched only while it is unlocked.
 */
export class EnvVaultWatcher {
  #watch;
  #readFile;
  #onChange;
  #debounceMs;
  #setTimer;
  #clearTimer;
  /** @type {Map<string, {path: string, revision: string|null,
   *   watcher: any, timer: any}>} */
  #watched = new Map();

  /**
   * @param {Object} options
   * @param {(id: string, change: {missing: boolean}) => void} options.onChange
   * @param {typeof fs.watch} [options.watch]
   * @param {(p: string) => Promise<Buffer>} [options.readFile]
   * @param {number} [options.debounceMs]
   * @param {(fn: () => void, ms: number) => any} [options.setTimer]
   * @param {(timer: any) => void} [options.clearTimer]
   */
  constructor({
    onChange,
    watch = fs.watch,
    readFile = (p) => fs.promises.readFile(p),
    debounceMs = WATCH_DEBOUNCE_MS,
    setTimer = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    },
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    this.#onChange = onChange;
    this.#watch = watch;
    this.#readFile = readFile;
    this.#debounceMs = debounceMs;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  /**
   * Start watching `vaultPath` for `id`, knowing it at `revision`.
   * A second start for the same id restarts the watch.
   */
  start(id, vaultPath, revision = null) {
    this.stop(id);
    const entry = { path: vaultPath, revision, watcher: null, timer: null };
    const name = path.basename(vaultPath);
    try {
      entry.watcher = this.#watch(
        path.dirname(vaultPath),
        { persistent: false },
        (event, filename) => {
          // Temp files and snapshots next to the vault share its prefix.
          if (filename != null && String(filename) !== name) return;
          this.#schedule(id, entry);
        }
      );
      entry.watcher.on?.('error', () => {});
    } catch {
      // No watch (directory gone, platform limit): the page still finds out
      // on its next read, as STALE.
    }
    this.#watched.set(id, entry);
  }

  /** The app read or wrote `revision` itself: don't report it. */
  note(id, revision) {
    const entry = this.#watched.get(id);
    if (entry && revision) entry.revision = revision;
  }

  stop(id) {
    const entry = this.#watched.get(id);
    if (!entry) return;
    if (entry.timer) this.#clearTimer(entry.timer);
    try {
      entry.watcher?.close();
    } catch {
      /* already closed */
    }
    this.#watched.delete(id);
  }

  stopAll() {
    for (const id of [...this.#watched.keys()]) this.stop(id);
  }

  #schedule(id, entry) {
    if (entry.timer) this.#clearTimer(entry.timer);
    entry.timer = this.#setTimer(() => {
      entry.timer = null;
      this.#check(id, entry);
    }, this.#debounceMs);
  }

  async #check(id, entry) {
    let revision = null;
    try {
      revision = EnvironmentVaultService.revisionOf(
        await this.#readFile(entry.path)
      );
    } catch {
      // Gone (deleted, or mid-move): report it once.
    }
    if (this.#watched.get(id) !== entry) return; // stopped meanwhile
    if (revision === entry.revision) return;
    entry.revision = revision;
    this.#onChange(id, { missing: revision === null });
  }
}
