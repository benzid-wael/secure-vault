/**
 * Shared dotenv serialization used by both the CLI runner (`vault env run
 * --export`) and `vault env export`. The escaping here is the matched pair of
 * the reader in EnvironmentVault.parseEnvFile — values written by toDotenv()
 * round-trip back through `vault env import` unchanged.
 */

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

/**
 * Serialize a key/value map to dotenv format (values quoted/escaped as
 * needed). With `comments`, a key's comment is written as `#` lines above it;
 * `parseDotenv` reads them back.
 *
 * @param {Record<string, any>} vars
 * @param {{comments?: Record<string, string>}} [options]
 */
export function toDotenv(vars, { comments = {} } = {}) {
  return (
    Object.entries(vars)
      .map(([key, value]) => {
        const line = `${key}=${quoteDotenvValue(value)}`;
        const note = comments[key];
        if (!note) return line;
        const lines = note.split('\n').map((l) => (l ? `# ${l}` : '#'));
        return [...lines, line].join('\n');
      })
      .join('\n') + '\n'
  );
}

/** A key that survives export and re-import (EnvironmentVault's rule). */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT = /^\s*(?:export\s+)?([^\s=#]+)\s*=\s?(.*)$/;
const DOUBLE_QUOTE_ESCAPES = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
};

/** The text after a closing quote may only be blank or an inline comment. */
function trailingComment(rest) {
  const trimmed = rest.trim();
  if (trimmed === '') return { ok: true, comment: '' };
  if (trimmed.startsWith('#')) {
    return { ok: true, comment: trimmed.replace(/^#\s?/, '').trim() };
  }
  return { ok: false };
}

/**
 * Find the closing `quote` in `text` from `start`, honouring `\"` escapes in
 * double quotes. Returns its index, or -1.
 */
function closingQuote(text, start, quote) {
  for (let i = start; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/**
 * Parse a .env file the way dotenv tools read it:
 * - `KEY=value`, `export KEY=value`, spaces around `=`; CRLF line endings.
 * - Unquoted values are trimmed and end at ` #` (an inline comment).
 * - `"double"` values decode `\n \r \t \" \\` and may span lines;
 *   `'single'` and `` `backtick` `` values are literal and may span lines.
 * - The last of a repeated key wins.
 * - `#` lines directly above a key (no blank line between), and an inline
 *   comment, become that key's comment.
 *
 * Nothing is dropped silently: each skipped line gives a warning with its
 * line number. Warnings never include a value.
 *
 * @param {string} content
 * @returns {{vars: Record<string, string>, comments: Record<string, string>,
 *   warnings: Array<{line: number, message: string}>}}
 */
export function parseDotenv(content) {
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n');
  /** @type {Record<string, string>} */
  const vars = {};
  /** @type {Record<string, string>} */
  const comments = {};
  /** @type {Record<string, number>} */
  const seenOn = {};
  const warnings = [];
  let pending = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      pending = [];
      continue;
    }
    if (trimmed.startsWith('#')) {
      pending.push(trimmed.replace(/^#\s?/, ''));
      continue;
    }
    const above = pending;
    pending = [];

    const match = line.match(ASSIGNMENT);
    if (!match) {
      warnings.push({ line: lineNo, message: 'Not KEY=value; skipped' });
      continue;
    }
    const key = match[1];
    let raw = match[2];
    if (!KEY_PATTERN.test(key)) {
      warnings.push({
        line: lineNo,
        message: `'${key.slice(0, 40)}' isn't a valid name (letters, digits, _; not starting with a digit); skipped`,
      });
      continue;
    }

    let value;
    let inline = '';
    const quote = raw.trimStart()[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      raw = raw.trimStart();
      // A quoted value may continue on the following lines.
      let text = raw;
      let end = closingQuote(text, 1, quote);
      let last = i;
      while (end === -1 && last + 1 < lines.length) {
        last++;
        text += '\n' + lines[last];
        end = closingQuote(text, 1, quote);
      }
      const tail = end === -1 ? null : trailingComment(text.slice(end + 1));
      if (end === -1 || !tail.ok) {
        warnings.push({
          line: lineNo,
          message:
            end === -1
              ? `${key}: the quote is never closed; skipped`
              : `${key}: text after the closing quote; skipped`,
        });
        continue;
      }
      i = last;
      inline = tail.comment;
      const body = text.slice(1, end);
      value =
        quote === '"'
          ? body.replace(/\\(.)/g, (m, c) => DOUBLE_QUOTE_ESCAPES[c] ?? m)
          : body;
    } else {
      const hash = raw.search(/(^|\s)#/);
      if (hash !== -1) {
        inline = raw.slice(hash).trim().replace(/^#\s?/, '').trim();
        raw = raw.slice(0, hash);
      }
      value = raw.trim();
    }

    if (key in seenOn) {
      warnings.push({
        line: lineNo,
        message: `${key} is also on line ${seenOn[key]}; this later one wins`,
      });
    }
    seenOn[key] = lineNo;
    vars[key] = value;
    const note = [...above, inline].filter(Boolean).join('\n').trim();
    if (note) comments[key] = note;
    else delete comments[key];
  }

  return { vars, comments, warnings };
}

/**
 * The changeset that turns `before` into `after`, both .env text (bulk edit,
 * GUI-ENV-BREAKDOWN Task 21). Only keys whose value or comment changed get a
 * `set`; keys gone from `after` get an `rm`; untouched keys get nothing, so a
 * save never rewrites what the user didn't change.
 *
 * @param {string} before
 * @param {string} after
 * @returns {{ops: Array<{op: string, key: string, value?: string,
 *   comment?: string}>, warnings: Array<{line: number, message: string}>}}
 */
export function dotenvChanges(before, after) {
  const was = parseDotenv(before);
  const now = parseDotenv(after);
  const ops = [];
  for (const [key, value] of Object.entries(now.vars)) {
    const comment = now.comments[key] ?? '';
    const valueChanged = !(key in was.vars) || was.vars[key] !== value;
    const commentChanged = (was.comments[key] ?? '') !== comment;
    if (!valueChanged && !commentChanged) continue;
    ops.push({
      op: 'set',
      key,
      value,
      ...(commentChanged && { comment }),
    });
  }
  for (const key of Object.keys(was.vars)) {
    if (!(key in now.vars)) ops.push({ op: 'rm', key });
  }
  return { ops, warnings: now.warnings };
}
