import fs from 'fs-extra';

// What Windows reports while another process (an antivirus scanner, a file
// watcher hashing the file, a reader) briefly has the target open.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Replace `to` with `from` in one step (`fs.rename`), retried on Windows
 * when the target is momentarily held open. Elsewhere those codes mean a
 * real permission problem, so they fail at once, as does any other error.
 *
 * Not fs-extra's `move(…, { overwrite: true })`: it deletes the target
 * before renaming, so for a moment the file doesn't exist. A concurrent
 * reader then gets "not found", and a crash in that gap leaves no file.
 * `rename` replaces an existing file atomically on POSIX, and on Windows
 * (Node uses MoveFileEx with MOVEFILE_REPLACE_EXISTING). Both paths must be
 * on the same volume: callers write the temp file next to the target.
 *
 * @param {string} from
 * @param {string} to
 * @param {Object} [options] Injectable for tests.
 * @param {string} [options.platform]
 * @param {(from: string, to: string) => Promise<unknown>} [options.move]
 * @param {(ms: number) => Promise<unknown>} [options.sleep]
 * @param {number} [options.tries]
 * @param {number} [options.delayMs]
 */
export async function moveWithRetry(
  from,
  to,
  {
    platform = process.platform,
    move = (a, b) => fs.rename(a, b),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    tries = 3,
    delayMs = 50,
  } = {}
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await move(from, to);
    } catch (error) {
      const retry =
        platform === 'win32' && TRANSIENT.has(error.code) && attempt < tries;
      if (!retry) throw error;
      await sleep(delayMs);
    }
  }
}
