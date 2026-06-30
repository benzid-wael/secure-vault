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
 * Population is a single axis with two modes; writing a `.env` file to disk is
 * an orthogonal concern handled by the caller (see `--export`), not a mode here.
 *
 * - clean (default): only the vault vars + an allowlist of system vars
 * - merge:           vault vars layered on top of the inherited environment
 *
 * Vault vars are ALWAYS injected. Any unrecognized mode (e.g. the legacy
 * `file`, kept working as a deprecated alias at the run layer) falls back to
 * clean — it never silently passes the full parent env through unfiltered.
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

  // clean (also the safe fallback for any non-merge mode)
  const allowed = new Set([...CLEAN_ALLOWLIST, ...allowlist]);
  const base = {};
  for (const key of allowed) {
    if (parentEnv[key] !== undefined) base[key] = parentEnv[key];
  }
  return { ...base, ...vars };
}

/**
 * Quote/escape a single dotenv value so it survives the line-based parser
 * (EnvironmentVault.parseEnvFile) unchanged. A value is double-quoted with
 * \\, \", \n, \r escaped when it would otherwise be corrupted unquoted —
 * i.e. it contains a newline or quote char, a `#`, or has leading/trailing
 * whitespace (which the parser would trim away). Plain values are emitted raw.
 */
export function quoteDotenvValue(value) {
  const str = value == null ? '' : String(value);
  const needsQuoting =
    str !== '' &&
    (str !== str.trim() || /[\n\r"']/.test(str) || str.includes('#'));
  if (!needsQuoting) return str;
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

/** Serialize a key/value map to dotenv format (values quoted/escaped as needed). */
export function toDotenv(vars) {
  return (
    Object.entries(vars)
      .map(([key, value]) => `${key}=${quoteDotenvValue(value)}`)
      .join('\n') + '\n'
  );
}

/**
 * Parse repeatable `--set KEY=VALUE` pairs into an object. The value may itself
 * contain `=` (only the first `=` is the separator). Throws on a pair with no
 * `=` or an empty key. Later pairs override earlier ones for the same key.
 */
export function parseSetPairs(pairs = []) {
  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      throw new Error(`Invalid --set "${pair}" (expected KEY=VALUE)`);
    }
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
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

// The command to run, captured from the tokens after the first `--` of a
// `vault env run` invocation. Set by extractRunCommand(), read by the run
// action via getRunCommand(). Module-level because the CLI is single-shot.
let runCommand = null;

/** The command captured from after `--`, or null if there was no `--`. */
export function getRunCommand() {
  return runCommand;
}

/**
 * Treat the first `--` after `vault env run` as a hard wall: everything to its
 * right is the command to execute and is removed from argv before Commander
 * parses, so a command token can never be mis-consumed as the `[envName]`
 * positional. The env name is then resolved solely from a positional *before*
 * `--` (or the VAULT_ENV fallback in the run action) — never from the command.
 *
 * Returns argv unchanged (and leaves the captured command null) when this is
 * not an `env run` invocation or there is no `--` separator. The `--` case
 * stashes the trailing tokens for getRunCommand(); any further `--` in the
 * command is preserved so nested `vault env run … -- …` composes correctly.
 */
export function extractRunCommand(argv) {
  runCommand = null;

  // Locate the `env run` subcommand (options for `run` always follow `run`).
  let runPos = -1;
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === 'env' && argv[i + 1] === 'run') {
      runPos = i + 1;
      break;
    }
  }
  if (runPos === -1) return argv;

  const ddPos = argv.indexOf('--', runPos + 1);
  if (ddPos === -1) return argv;

  runCommand = argv.slice(ddPos + 1);
  return argv.slice(0, ddPos);
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
