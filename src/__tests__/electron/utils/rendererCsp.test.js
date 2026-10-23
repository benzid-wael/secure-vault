// @vitest-environment node
// The renderer's Content-Security-Policy in dev (GUI-ENV-BREAKDOWN New-18).
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

import {
  RENDERER_CSP,
  devRendererCsp,
} from '../../../electron/utils/rendererCsp.js';

const hash = (body) =>
  `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
const PREAMBLE =
  'import { injectIntoGlobalHook } from "/@react-refresh";\ninjectIntoGlobalHook(window);';

describe('devRendererCsp', () => {
  it("is production's policy plus the dev server's own inline script and HMR", () => {
    const html =
      `<head><script type="module">${PREAMBLE}</script>` +
      '<script type="module" src="/@vite/client"></script></head>';
    expect(devRendererCsp(html, 3000)).toBe(
      RENDERER_CSP.replace(
        "script-src 'self'",
        `script-src 'self' ${hash(PREAMBLE)}`
      ).replace(
        "connect-src 'self'",
        "connect-src 'self' ws://localhost:3000 http://localhost:3000"
      )
    );
  });

  it("gives index.html's own inline scripts no hash: they fail in dev as in the build", () => {
    const stray = 'window.stray = 1;';
    const source = `<head></head><body><script>${stray}</script></body>`;
    const html = `<head><script type="module">${PREAMBLE}</script></head><body><script>${stray}</script></body>`;
    const csp = devRendererCsp(html, 3000, source);
    expect(csp).toContain(hash(PREAMBLE));
    expect(csp).not.toContain(hash(stray));
  });

  it('allows no inline script when there is none, and follows the port', () => {
    const csp = devRendererCsp('<head></head>', 3999);
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain('ws://localhost:3999');
    expect(csp).not.toContain('sha256-');
  });
});
