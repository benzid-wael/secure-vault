import path from 'path';
import fs from 'fs-extra';

import { normalizeManifest } from './envDeliverHelpers.js';
import { templateKeys } from '../../src/utils/templating.js';

/**
 * `vault env doctor` diagnostics for the delivery wiring.
 *
 * Checks are split so the common case needs no vault unlock:
 *  - `checkStructure` — manifest validity, template files present, .gitignore
 *    coverage. Pure over its inputs (fs access is injected) → unit-testable.
 *  - `checkResolution` — every variable the manifest references actually exists
 *    in the resolved environment. Requires the decrypted env, so the command
 *    only runs it when a password is available.
 *
 * A result is { level, title, detail?, fix? } where level is one of
 * 'ok' | 'info' | 'warn' | 'error'. Only 'error' makes `doctor` exit non-zero.
 */

/** True if any result is an error (drives the command's exit code). */
export function hasErrors(results) {
  return results.some((r) => r.level === 'error');
}

/**
 * Structural checks that need no vault access.
 *
 * @param {object} args
 * @param {object} args.config - parsed .vaultrc
 * @param {string} args.baseDir - directory .vaultrc lives in (path base)
 * @param {string} args.gitignore - contents of .gitignore ('' if none)
 * @param {(p: string) => boolean} [args.fileExists] - injectable for tests
 * @returns {{ results: object[], manifest: object|null }}
 */
export function checkStructure({
  config,
  baseDir,
  gitignore,
  fileExists = (p) => fs.existsSync(p),
}) {
  const results = [];

  let manifest;
  try {
    manifest = normalizeManifest(config);
  } catch (err) {
    results.push({
      level: 'error',
      title: 'Delivery manifest is invalid',
      detail: err.message,
      fix: 'Fix the "deliver" array in .vaultrc.',
    });
    return { results, manifest: null };
  }

  if (manifest.entries.length === 0) {
    results.push({
      level: 'info',
      title: 'No delivery manifest',
      detail: 'Nothing to check. Add a "deliver" array to .vaultrc.',
    });
    return { results, manifest };
  }

  results.push({
    level: 'ok',
    title: `Manifest valid (${manifest.entries.length} artifacts)`,
  });

  // Template sources must exist on disk.
  for (const entry of manifest.entries) {
    if (
      entry.kind === 'template' &&
      !fileExists(path.join(baseDir, entry.template))
    ) {
      results.push({
        level: 'error',
        title: `Template not found: ${entry.template}`,
        fix: `Create ${entry.template} or remove its manifest entry.`,
      });
    }
  }

  // Every delivered artifact should be git-ignored (literal-line match — a
  // decoded secret must never be committed).
  const ignored = new Set(
    gitignore
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );
  for (const entry of manifest.entries) {
    if (!ignored.has(entry.path)) {
      results.push({
        level: 'warn',
        title: `Delivered artifact not in .gitignore: ${entry.path}`,
        detail: 'A decoded secret could be committed.',
        fix: `Add "${entry.path}" to .gitignore.`,
      });
    }
  }

  return { results, manifest };
}

/**
 * Deep check: every variable the manifest references resolves in `vars`.
 * `readTemplate(path)` returns a template's text (missing templates are already
 * reported by checkStructure, so read failures are skipped here).
 */
export function checkResolution(manifest, vars, readTemplate) {
  const missing = new Set();
  const require_ = (key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) missing.add(key);
  };

  for (const entry of manifest.entries) {
    if (entry.kind === 'from') {
      require_(entry.from);
    } else if (entry.kind === 'format' && entry.keys) {
      entry.keys.forEach(require_);
    } else if (entry.kind === 'template') {
      let text;
      try {
        text = readTemplate(entry.template);
      } catch {
        continue;
      }
      templateKeys(text).forEach(require_);
    }
  }

  if (missing.size > 0) {
    return [
      {
        level: 'error',
        title: `Manifest references undefined variables: ${[...missing].join(', ')}`,
        fix: 'Set them with `vault env set` (or `set --in --encode base64` for files).',
      },
    ];
  }
  return [{ level: 'ok', title: 'All manifest variables resolve' }];
}

/**
 * The vault's write lock (Task 8), from `VaultLock#inspect`. Read-only:
 * it names the file and the remedy, the same ones the "Vault is busy"
 * error gives, and never deletes anything.
 */
export function checkLock({ state, path: lockPath, holder, asides }) {
  const who = holder
    ? `${holder.tool ?? 'a vault process'} pid ${holder.pid}` +
      (holder.host ? ` on ${holder.host}` : '') +
      (holder.acquiredAt ? ` since ${holder.acquiredAt}` : '')
    : 'an unknown process';
  const results = [];
  if (state === 'none') {
    results.push({ level: 'ok', title: 'No write lock on the vault' });
  } else if (state === 'held') {
    results.push({
      level: 'info',
      title: `Vault is being written: locked by ${who}`,
      detail: lockPath,
      fix: `Wait for it to finish. If no vault command is running, remove ${lockPath}.`,
    });
  } else {
    results.push({
      level: 'warn',
      title: `Stale write lock left by ${who}`,
      detail: `${lockPath}. Its holder is gone; the next write takes it over.`,
      fix: `Nothing to do, or remove ${lockPath} if no vault command is running.`,
    });
  }
  for (const aside of asides) {
    results.push({
      level: 'warn',
      title: 'Leftover lock file from an interrupted takeover',
      detail: aside,
      fix: `Remove ${aside}; no vault command reads it.`,
    });
  }
  return results;
}

/**
 * The vault's format against this build (New-29), from `checkVaultFormat`.
 * A format it can't read is an error; features it doesn't know are a
 * warning (reads work, writes are refused).
 *
 * @param {import('../../src/electron/utils/vaultFormat.js').FormatCheck} format
 * @param {Record<string, string>} known Feature descriptions this build has.
 */
export function checkFormat(format, known) {
  if (!format.readable) {
    return [
      {
        level: 'error',
        title: `Vault format ${format.version} is newer than this version reads`,
        detail: format.message,
      },
    ];
  }
  if (!format.writable) {
    return [
      {
        level: 'warn',
        title: `Vault uses features this version doesn't support: ${format.unknown.join(', ')}`,
        detail: format.message,
      },
    ];
  }
  const used = format.features.map((f) => known[f] ?? f);
  return [
    {
      level: 'ok',
      title:
        `Vault format ${format.version}` +
        (used.length ? ` (uses ${used.join(', ')})` : ''),
    },
  ];
}
