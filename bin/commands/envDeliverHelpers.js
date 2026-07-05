import path from 'path';
import fs from 'fs-extra';

import { toDotenv } from '../../src/utils/dotenv.js';
import { renderTemplate } from '../../src/utils/templating.js';

/**
 * Delivery helpers shared by `vault env file` (single-var blob) and
 * `vault env apply` (manifest fan-out). These are the "materialize a secret to a
 * real file on disk" primitives — distinct from `run --export`, whose temp file
 * is wiped on child exit. Delivered files persist for the build tool to consume;
 * cleanup is the caller's concern (`vault env clean` / manual).
 */

/** Default mode for a delivered secret file: owner read/write only. */
export const DEFAULT_FILE_MODE = 0o600;

/**
 * Parse an octal file-mode string ("0600", "600", "0o600") into a number.
 * A number is passed through. Throws on anything that is not 3–4 octal digits.
 */
export function parseFileMode(input) {
  if (input == null) return DEFAULT_FILE_MODE;
  if (typeof input === 'number') return input;
  const s = String(input).trim().replace(/^0o/i, '');
  if (!/^[0-7]{3,4}$/.test(s)) {
    throw new Error(`Invalid file mode "${input}" (expected octal, e.g. 0600)`);
  }
  return parseInt(s, 8);
}

/**
 * Decode a resolved value per a `decode` directive. Returns a Buffer for decoded
 * (binary-capable) content, or the raw string when no decode is requested.
 * `base64` is the only codec today; extend here (never at the call site).
 */
export function decodeValue(value, decode) {
  const str = value == null ? '' : String(value);
  if (!decode) return str;
  if (decode === 'base64') return Buffer.from(str, 'base64');
  throw new Error(`Unknown decode "${decode}" (supported: base64)`);
}

/** Codecs a stored value may be encoded with on the way in (`set --encode`). */
export const ENCODERS = ['base64'];

/**
 * Encode raw bytes (or a string) into a storable string value — the inverse of
 * decodeValue, used by `set --in --encode` to ingest a file as a vault var.
 * Vault values are strings, so this always returns a string: the base64 text
 * for binary blobs, or the UTF-8 text when no encoding is requested.
 */
export function encodeValue(input, encode) {
  const buf = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input == null ? '' : String(input), 'utf-8');
  if (!encode) return buf.toString('utf-8');
  if (encode === 'base64') return buf.toString('base64');
  throw new Error(
    `Unknown encode "${encode}" (supported: ${ENCODERS.join(', ')})`
  );
}

/**
 * Write delivered content to `outPath`, creating the parent directory if needed.
 * The file mode is enforced with an explicit chmod so it is deterministic even
 * when overwriting a pre-existing file (whose mode `writeFile` would keep) and
 * regardless of umask. Parent-directory permissions are intentionally left
 * alone — artifacts land in real project dirs (e.g. `ios/`), not a private temp
 * dir (that 0700 story belongs to v2 mount).
 *
 * @param {string} outPath
 * @param {string|Buffer} content
 * @param {{ mode?: number }} [opts]
 * @returns {Promise<string>} the written path.
 */
export async function writeArtifact(
  outPath,
  content,
  { mode = DEFAULT_FILE_MODE } = {}
) {
  await fs.ensureDir(path.dirname(path.resolve(outPath)));
  await fs.writeFile(outPath, content, { mode });
  await fs.chmod(outPath, mode);
  return outPath;
}

// ---------------------------------------------------------------------------
// Delivery manifest (.vaultrc "deliver") — SPEC §8.5 / MOBILE-INTEGRATION-GAPS §4.F
// ---------------------------------------------------------------------------

/** Output formats vault serializes natively (it owns dotenv; json is trivial). */
export const DELIVER_FORMATS = ['dotenv', 'json'];
/** Codecs a `from` (blob) entry may decode with. */
export const DECODERS = ['base64'];

const KIND_FIELDS = ['format', 'from', 'template'];

/**
 * Validate and normalize a single `deliver[]` entry. Exactly one of `format`,
 * `from`, or `template` selects the kind:
 *
 * - `format` (+ optional `keys` subset) — serialize resolved vars natively.
 * - `from` (+ optional `decode`) — a single var's value as a blob.
 * - `template` (+ optional `out`) — render a `.vtpl`; `out` defaults to the
 *   template path minus its `.vtpl` suffix.
 *
 * Returns a normalized entry `{ kind, path, mode, ... }` where `path` is the
 * declared (still-relative) output path. Throws with a `deliver[i]:` prefix on
 * any structural problem so the manifest fails loudly, never silently.
 */
export function normalizeDeliverEntry(entry, index = 0) {
  const where = `deliver[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${where}: entry must be an object`);
  }

  const kinds = KIND_FIELDS.filter((k) => entry[k] !== undefined);
  if (kinds.length !== 1) {
    throw new Error(
      `${where}: exactly one of "format", "from", "template" is required ` +
        `(got ${kinds.length ? kinds.join(', ') : 'none'})`
    );
  }
  const kind = kinds[0];
  const mode =
    entry.mode !== undefined ? parseFileMode(entry.mode) : DEFAULT_FILE_MODE;

  if (kind === 'template') {
    if (typeof entry.template !== 'string' || !entry.template) {
      throw new Error(`${where}: "template" must be a non-empty path`);
    }
    let outPath = entry.out;
    if (!outPath) {
      if (entry.template.endsWith('.vtpl')) {
        outPath = entry.template.slice(0, -'.vtpl'.length);
      } else {
        throw new Error(
          `${where}: template "${entry.template}" has no .vtpl suffix to strip; ` +
            `specify an explicit "out"`
        );
      }
    }
    return { kind, template: entry.template, path: outPath, mode };
  }

  if (typeof entry.path !== 'string' || !entry.path) {
    throw new Error(`${where}: "path" is required`);
  }

  if (kind === 'format') {
    if (!DELIVER_FORMATS.includes(entry.format)) {
      throw new Error(
        `${where}: unknown format "${entry.format}" ` +
          `(supported: ${DELIVER_FORMATS.join(', ')})`
      );
    }
    if (
      entry.keys !== undefined &&
      (!Array.isArray(entry.keys) ||
        entry.keys.some((k) => typeof k !== 'string'))
    ) {
      throw new Error(`${where}: "keys" must be an array of strings`);
    }
    return {
      kind,
      path: entry.path,
      format: entry.format,
      keys: entry.keys || null,
      mode,
    };
  }

  // from (blob)
  if (typeof entry.from !== 'string' || !entry.from) {
    throw new Error(`${where}: "from" must be a variable name`);
  }
  if (entry.decode !== undefined && !DECODERS.includes(entry.decode)) {
    throw new Error(
      `${where}: unknown decode "${entry.decode}" ` +
        `(supported: ${DECODERS.join(', ')})`
    );
  }
  return {
    kind,
    path: entry.path,
    from: entry.from,
    decode: entry.decode || null,
    mode,
  };
}

/**
 * Validate a whole `.vaultrc` config's delivery manifest. Returns
 * `{ env, entries }` — `env` is the manifest's default environment (may be
 * undefined), `entries` are normalized. An absent `deliver` yields an empty
 * list; a non-array `deliver` throws.
 */
export function normalizeManifest(config = {}) {
  const deliver = config.deliver;
  if (deliver === undefined) return { env: config.env, entries: [] };
  if (!Array.isArray(deliver)) {
    throw new Error('.vaultrc "deliver" must be an array');
  }
  return {
    env: config.env,
    entries: deliver.map((e, i) => normalizeDeliverEntry(e, i)),
  };
}

function pickKeys(vars, keys) {
  const out = {};
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(vars, k)) {
      throw new Error(`deliver: key "${k}" not found in environment`);
    }
    out[k] = vars[k];
  }
  return out;
}

/**
 * Produce the content for one normalized entry given the resolved `vars` map.
 * `readTemplate(path)` is injected (returns the template text) so this stays a
 * pure transform and is unit-testable without disk I/O. Returns a string, or a
 * Buffer for base64-decoded blobs.
 */
export function renderDeliverEntry(entry, vars, readTemplate) {
  if (entry.kind === 'from') {
    if (!Object.prototype.hasOwnProperty.call(vars, entry.from)) {
      throw new Error(
        `deliver: variable "${entry.from}" not found in environment`
      );
    }
    return decodeValue(vars[entry.from], entry.decode);
  }
  if (entry.kind === 'format') {
    const subset = entry.keys ? pickKeys(vars, entry.keys) : vars;
    if (entry.format === 'json') return `${JSON.stringify(subset, null, 2)}\n`;
    return toDotenv(subset);
  }
  // template
  return renderTemplate(readTemplate(entry.template), vars);
}
