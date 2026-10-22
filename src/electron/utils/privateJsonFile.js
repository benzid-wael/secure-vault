import fs from 'fs-extra';
import path from 'path';

import { moveWithRetry } from './moveWithRetry.js';

/**
 * Write `data` as JSON to `file`, readable by this user only (`0600`), in one
 * step: a temp file next to it, then a rename over it, so a reader or a
 * crash never sees half a file. Callers serialize their own writes.
 *
 * @param {string} file
 * @param {unknown} data
 */
export async function writePrivateJson(file, data) {
  await fs.ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await moveWithRetry(tmp, file);
}

/**
 * Read JSON from `file`: `{ data }`, `{ missing: true }` when there is no
 * file, or `{ damaged: true }` when it can't be read or parsed.
 *
 * @param {string} file
 * @returns {Promise<{data?: any, missing?: boolean, damaged?: boolean}>}
 */
export async function readJsonFile(file) {
  try {
    return { data: await fs.readJson(file) };
  } catch (error) {
    return error.code === 'ENOENT' ? { missing: true } : { damaged: true };
  }
}
