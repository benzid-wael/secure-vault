import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

export const DEFAULT_ALLOWLIST_FILE = '.vault-allowlist';

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
 * Read variable names from an allowlist file (one per line, # comments).
 * Returns an empty array if filePath is falsy or the file doesn't exist and
 * mustExist is false. Throws if mustExist is true and the file is unreadable.
 */
export function readAllowlistFile(filePath, { mustExist = false } = {}) {
  if (!filePath) return [];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (!mustExist && err.code === 'ENOENT') return [];
    throw new Error(`Cannot read allowlist file "${filePath}": ${err.message}`);
  }
  return content
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

export const VAULTRC_FILENAME = '.vaultrc';

// Flags on `vault env run` that consume the next argument as their value.
const RUN_FLAGS_WITH_VALUE = new Set([
  '-n',
  '--name',
  '-v',
  '--vault',
  '--password',
  '--password-file',
  '--inject',
  '--out-file',
  '--allowlist',
  '--allowlist-file',
]);

/**
 * Inject VAULT_ENV into argv before the `--` separator when `vault env run`
 * is invoked without an explicit envName positional argument. This lets
 * Commander see the env name as a proper positional rather than consuming
 * the first command argument after `--` as the env name.
 *
 * Does nothing when VAULT_ENV is not set, when `env run` is not in argv,
 * when there is no `--` separator, or when an envName is already present.
 */
export function injectVaultEnvArg(argv, vaultEnv = process.env.VAULT_ENV) {
  if (!vaultEnv) return argv;

  // Locate 'env run' in the argument list.
  let runPos = -1;
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === 'env' && argv[i + 1] === 'run') {
      runPos = i + 1;
      break;
    }
  }
  if (runPos === -1) return argv;

  // Find the `--` separator after `run`.
  const ddPos = argv.indexOf('--', runPos + 1);
  if (ddPos === -1) return argv;

  // Walk the slice between `run` and `--`, skipping known option/value pairs.
  // If any non-option, non-value arg is found, the user already supplied envName.
  let i = runPos + 1;
  while (i < ddPos) {
    const arg = argv[i];
    if (RUN_FLAGS_WITH_VALUE.has(arg)) {
      i += 2; // skip flag + its value
    } else if (arg.startsWith('-')) {
      i += 1; // boolean flag
    } else {
      return argv; // positional envName already present
    }
  }

  // No envName found before `--`: inject VAULT_ENV there.
  const result = [...argv];
  result.splice(ddPos, 0, vaultEnv);
  return result;
}

// Keys in .vaultrc and the Commander option name they map to.
const VAULTRC_KEYS = ['inject', 'env', 'name', 'vault', 'allowlistFile'];

/**
 * Walk from startDir upward looking for a .vaultrc file, stopping at a git
 * root (presence of .git) or the filesystem root. Returns the parsed config
 * object, or {} if no file is found. Throws on JSON parse errors.
 */
export function loadProjectConfig(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, VAULTRC_FILENAME);
    if (fs.existsSync(candidate)) {
      let raw;
      try {
        raw = fs.readFileSync(candidate, 'utf-8');
      } catch (err) {
        throw new Error(`Cannot read ${candidate}: ${err.message}`);
      }
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Error(`Invalid JSON in ${candidate}: ${err.message}`);
      }
    }
    // Stop at a git root or the filesystem root.
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

/**
 * Apply .vaultrc defaults to a Commander options object.
 * Precedence: CLI flag ('cli') > .vaultrc ('config') > env var ('env') > default.
 * Only overwrites options whose source is 'default' or 'env'.
 */
export function applyProjectConfig(cmd, config) {
  for (const key of VAULTRC_KEYS) {
    if (config[key] !== undefined) {
      const src = cmd.getOptionValueSource(key);
      if (src === 'default' || src === 'env') {
        cmd.setOptionValueWithSource(key, config[key], 'config');
      }
    }
  }
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
