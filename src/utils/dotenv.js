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

/** Serialize a key/value map to dotenv format (values quoted/escaped as needed). */
export function toDotenv(vars) {
  return (
    Object.entries(vars)
      .map(([key, value]) => `${key}=${quoteDotenvValue(value)}`)
      .join('\n') + '\n'
  );
}
