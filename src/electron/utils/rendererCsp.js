import { createHash } from 'node:crypto';

// The renderer's Content-Security-Policy (GUI-ENV-RFC §6.10), injected by
// the build. Dev gets the same policy with the dev server's own inline
// scripts allowed by hash (`devRendererCsp`, New-18). emotion/MUI need
// inline styles.
// `frame-ancestors` is left out: browsers ignore it in a <meta> policy.
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** The dev server's origin; HMR talks to it over a websocket. */
export const DEV_PORT = 3000;

/**
 * The dev renderer's policy (GUI-ENV-BREAKDOWN New-18): production's, except
 * that the inline scripts the dev server itself puts in `html` (the React
 * Refresh preamble) are allowed by hash, and HMR may connect back to Vite.
 * Any other inline script, e.g. one added to index.html by mistake, is
 * blocked in dev as it would be in the build.
 *
 * @param {string} html The dev index.html, after every other transform.
 * @param {number} [port]
 * @param {string} [source] The index.html on disk: its own inline scripts
 *   aren't the dev server's, so they get no hash.
 */
export function devRendererCsp(html, port = DEV_PORT, source = '') {
  const inline = (text) =>
    [...text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(([, body]) => body)
      .filter((body) => body.trim() !== '');
  const own = new Set(inline(source));
  const hashes = inline(html)
    .filter((body) => !own.has(body))
    .map(
      (body) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`
    );
  return RENDERER_CSP.replace(
    "script-src 'self'",
    ["script-src 'self'", ...hashes].join(' ')
  ).replace(
    "connect-src 'self'",
    `connect-src 'self' ws://localhost:${port} http://localhost:${port}`
  );
}
