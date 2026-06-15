import crypto from 'crypto';
import os from 'os';
import path from 'path';
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
 * Best-effort secure deletion: overwrite the file with 3 passes (0xFF, 0x00,
 * random) before unlinking, per SPEC §12.3.
 */
export function secureDelete(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const { size } = fs.statSync(filePath);
    if (size > 0) {
      const buf = Buffer.alloc(size);
      buf.fill(0xff);
      fs.writeFileSync(filePath, buf);
      buf.fill(0x00);
      fs.writeFileSync(filePath, buf);
      fs.writeFileSync(filePath, crypto.randomBytes(size));
    }
    fs.unlinkSync(filePath);
  } catch {
    // Cleanup is best-effort; never throw from teardown.
  }
}

/**
 * Scan for orphaned temp directories left by a prior crash and remove them.
 * Looks for `vault-env-*` directories under the OS temp dir.
 */
export function cleanupOrphanTempDirs() {
  try {
    const tmpDir = os.tmpdir();
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('vault-env-')) {
        const dirPath = path.join(tmpDir, entry.name);
        try {
          const files = fs.readdirSync(dirPath);
          for (const f of files) {
            secureDelete(path.join(dirPath, f));
          }
          fs.rmdirSync(dirPath);
        } catch {
          // Best-effort.
        }
      }
    }
  } catch {
    // Best-effort.
  }
}
