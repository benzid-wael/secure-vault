import fs from 'fs';
import chalk from 'chalk';
import password from '@inquirer/password';

/**
 * Master-password resolution for the `vault env` CLI.
 *
 * These helpers were extracted from `bin/commands/env.js` so they can be unit
 * tested without importing the CLI entry tree (see SPEC.md §16.7). The command
 * layer re-exports them for backwards compatibility.
 *
 * File and stdin reads use Node's built-in `fs` directly (not `fs-extra`) so
 * tests can spy on `fs.readFileSync` against the same module production uses
 * (see SPEC.md §16.8).
 */

/**
 * Strip exactly one trailing newline sequence (`\n` or `\r\n`) from a string.
 * Other whitespace — including interior and leading/trailing spaces — is
 * preserved, since a password may legitimately contain spaces.
 */
export function stripTrailingNewline(value) {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}

/**
 * Read a password from a file, stripping a single trailing newline.
 * Throws if the file cannot be read so the caller can surface the error.
 */
export function readPasswordFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return stripTrailingNewline(content);
}

/** Read a password from stdin (fd 0), stripping a single trailing newline. */
export function readPasswordStdin() {
  const content = fs.readFileSync(0, 'utf8');
  return stripTrailingNewline(content);
}

/**
 * True when the password came from an explicit non-interactive source
 * (flag, file, stdin) or the environment variable — i.e. no prompt was shown.
 */
export function hasNonInteractivePassword(options) {
  return !!(
    options.password ||
    options.passwordFile ||
    options.passwordStdin ||
    process.env.VAULT_ENV_PASSWORD
  );
}

/**
 * Resolve the master password from the available sources, in precedence order:
 *   1. --password <password>
 *   2. --password-file <path>
 *   3. --password-stdin
 *   4. VAULT_ENV_PASSWORD env var
 *   5. interactive prompt
 *
 * Only one of the explicit sources (flag/file/stdin) may be provided; supplying
 * more than one is a usage error.
 */
export async function resolvePassword(options, promptMessage) {
  const explicit = [
    options.password != null,
    !!options.passwordFile,
    !!options.passwordStdin,
  ].filter(Boolean).length;

  if (explicit > 1) {
    console.error(
      chalk.red(
        'Error: choose only one of --password, --password-file, --password-stdin'
      )
    );
    process.exit(1);
  }

  if (options.password != null) return options.password;

  if (options.passwordFile) {
    try {
      return readPasswordFile(options.passwordFile);
    } catch (err) {
      console.error(
        chalk.red(
          `Error: cannot read password file "${options.passwordFile}": ${err.message}`
        )
      );
      process.exit(1);
    }
  }

  if (options.passwordStdin) {
    try {
      return readPasswordStdin();
    } catch (err) {
      console.error(
        chalk.red(`Error: cannot read password from stdin: ${err.message}`)
      );
      process.exit(1);
    }
  }

  if (process.env.VAULT_ENV_PASSWORD) return process.env.VAULT_ENV_PASSWORD;

  return password({ message: promptMessage, mask: true });
}
