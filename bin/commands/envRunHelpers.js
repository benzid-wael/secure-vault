import crypto from 'crypto';
import fs from 'fs-extra';

// System variables passed through in `clean` mode so the spawned command can
// still find its interpreter, home dir, etc. without inheriting the full env.
export const CLEAN_ALLOWLIST = ['PATH', 'HOME', 'SHELL', 'USER', 'TMPDIR'];

export const INJECT_MODES = ['clean', 'merge', 'file'];

/**
 * Build the environment object for the spawned child process.
 *
 * - clean  (default): only the vault vars + an allowlist of system vars
 * - merge:            vault vars layered on top of the inherited environment
 * - file:             no vault vars injected (they go to a temp file instead);
 *                     the child inherits the parent environment
 */
export function buildChildEnv({
  mode = 'clean',
  vars = {},
  parentEnv = process.env,
  allowlist = [],
}) {
  if (mode === 'merge') {
    return { ...parentEnv, ...vars };
  }
  if (mode === 'file') {
    return { ...parentEnv };
  }

  // clean
  const allowed = new Set([...CLEAN_ALLOWLIST, ...allowlist]);
  const base = {};
  for (const key of allowed) {
    if (parentEnv[key] !== undefined) base[key] = parentEnv[key];
  }
  return { ...base, ...vars };
}

/** Serialize a key/value map to dotenv format. */
export function toDotenv(vars) {
  return (
    Object.entries(vars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n'
  );
}

/** Parse a comma-separated allowlist string into a clean array. */
export function parseAllowlist(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Best-effort secure deletion: overwrite the file's bytes with random data
 * before unlinking so the plaintext secrets don't linger on disk.
 */
export function secureDelete(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const { size } = fs.statSync(filePath);
    if (size > 0) {
      fs.writeFileSync(filePath, crypto.randomBytes(size));
    }
    fs.unlinkSync(filePath);
  } catch {
    // Cleanup is best-effort; never throw from teardown.
  }
}
