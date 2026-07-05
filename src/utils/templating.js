/**
 * File templating (`.vtpl`) — SPEC §8.5.
 *
 * A `.vtpl` file is a plain-text template in ANY format (xcconfig, plist,
 * gradle.properties, xml, JSON…). Vault renders it by substituting `{{KEY}}`
 * placeholders with resolved env values, producing the target file. Vault never
 * parses or understands the target format — it only substitutes — so a single
 * engine covers every current and future text format.
 *
 * This is deliberately distinct from the value-level references
 * (`{{env:name/KEY}}`, resolved inside stored values by EnvironmentResolver):
 * those recurse; `.vtpl` substitution is SINGLE-PASS so one secret can never
 * inject a `{{OTHER_KEY}}` reference to exfiltrate another (SPEC §8.5).
 */

/**
 * Placeholder grammar: `{{ KEY }}` or `{{ KEY | filter }}`.
 *
 * KEY is an env-var identifier (`[A-Za-z_][A-Za-z0-9_]*`). Tokens that do not
 * match this exact shape — e.g. the target format's own `{{env:self/X}}`-style
 * text or a stray `{{` — are left verbatim rather than treated as placeholders,
 * so the engine never corrupts the surrounding format.
 */
const PLACEHOLDER =
  /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|\s*([a-z0-9]+)\s*)?\}\}/g;

/**
 * Per-format escaping filters. Each transforms a raw value so it can be embedded
 * safely in a target format; none add wrapping quotes — the template author
 * supplies those (e.g. `"key": "{{SECRET | json}}"`). Filters are the ONLY place
 * any format knowledge lives, and they are opt-in.
 */
export const FILTERS = {
  // Escape for embedding inside a JSON string literal (no surrounding quotes).
  json: (str) => {
    const quoted = JSON.stringify(str);
    return quoted.slice(1, -1);
  },
  // Escape XML/HTML metacharacters (& first, so already-escaped output is safe).
  xml: (str) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;'),
  // Base64-encode the UTF-8 bytes of the value.
  base64: (str) => Buffer.from(str, 'utf-8').toString('base64'),
};

/**
 * Render a `.vtpl` template string against a resolved `{KEY: VALUE}` map.
 *
 * @param {string} template - the raw template text.
 * @param {Record<string, unknown>} vars - resolved environment variables.
 * @param {object} [options]
 * @param {Record<string, (s: string) => string>} [options.filters] - filter
 *   registry override (defaults to FILTERS).
 * @returns {string} the rendered output.
 * @throws if a placeholder references a key absent from `vars`, or names a
 *   filter that does not exist. Errors are hard by design — a missing secret
 *   must never render as an empty string.
 */
export function renderTemplate(template, vars = {}, options = {}) {
  if (typeof template !== 'string') {
    throw new TypeError('renderTemplate: template must be a string');
  }
  const filters = options.filters || FILTERS;

  // String.replace scans the ORIGINAL template only; substituted values are
  // never re-scanned, which is what makes substitution single-pass.
  return template.replace(PLACEHOLDER, (_match, key, filterName) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw new Error(`Template references undefined variable "${key}"`);
    }
    const raw = vars[key];
    let value = raw == null ? '' : String(raw);

    if (filterName) {
      const filter = filters[filterName];
      if (typeof filter !== 'function') {
        throw new Error(
          `Unknown template filter "${filterName}" for variable "${key}" ` +
            `(available: ${Object.keys(filters).join(', ')})`
        );
      }
      value = filter(value);
    }
    return value;
  });
}

/**
 * Report every distinct placeholder key referenced by a template (deduped, in
 * first-seen order). Useful for `doctor`/manifest validation to check a template
 * against an environment without rendering it.
 *
 * @param {string} template
 * @returns {string[]}
 */
export function templateKeys(template) {
  if (typeof template !== 'string') {
    throw new TypeError('templateKeys: template must be a string');
  }
  const keys = [];
  const seen = new Set();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}
