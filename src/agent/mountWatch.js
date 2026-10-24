import fs from 'fs';

/**
 * watchMount — re-materialize a live mount that is deleted out from under a build
 * (SPEC §13.5, G18/G26; the file-watch half of Task 8).
 *
 * A build step (Pods install, `expo prebuild`, a clean task) can delete a
 * generated file mid-session. Since the mount is meant to stay live, we watch the
 * materialized path and, when it disappears, call `rebuild()` to write it again.
 *
 * `fs.watch` on a single file follows the *inode*, so once the file is replaced
 * the old watcher is dead — we therefore re-arm after every rebuild. The watcher
 * acts only on *disappearance* (`!existsSync`), so `rebuild()` writing the file
 * back never re-triggers itself. `rebuild()` pulls vars through the session, so a
 * locked session refuses it (I2); we swallow that and re-arm.
 *
 * Returns a `stop()` that ends the watch. The registry calls it *before* securely
 * deleting a mount, so an intentional unmount / lock-wipe is never re-created.
 */
export function watchMount(absPath, rebuild) {
  let stopped = false;
  let watcher = null;

  const restore = () => {
    // File vanished — drop the dead watcher, rebuild, re-arm on the new inode.
    if (watcher) watcher.close();
    watcher = null;
    Promise.resolve()
      .then(rebuild)
      .then(
        () => arm({ rebuilt: true }),
        () => arm() // locked session / transient error — just re-arm
      );
  };

  const arm = ({ rebuilt = false } = {}) => {
    if (stopped) return;
    try {
      watcher = fs.watch(absPath, { persistent: false }, () => {
        if (stopped || fs.existsSync(absPath)) return;
        restore();
      });
      watcher.on('error', () => {});
    } catch {
      /* path not present yet; a later rebuild + arm() will pick it up */
    }
    // Deleted again between rebuild() and here: the watch above threw or
    // follows a dead inode, so nothing would fire. Restore again, after a
    // pause so a rebuild that never writes the file can't spin.
    if (rebuilt && !fs.existsSync(absPath)) {
      setTimeout(() => {
        if (!stopped && !fs.existsSync(absPath)) restore();
      }, 100).unref();
    }
  };

  arm();

  return () => {
    stopped = true;
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
      watcher = null;
    }
  };
}
