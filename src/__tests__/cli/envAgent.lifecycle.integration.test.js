// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  cli,
  registerAgentHooks,
  vaultPath,
  ON_WINDOWS,
} from './agentHarness.js';

registerAgentHooks();

describe.skipIf(ON_WINDOWS)(
  'vault env agent — lifecycle (integration, spawns a real daemon)',
  () => {
    it('start → status → unlock → status → lock → stop', () => {
      const start = cli(['agent', 'start', '-v', vaultPath]);
      expect(start.status).toBe(0);
      expect(start.stdout).toMatch(/agent started/);

      let status = cli(['agent', 'status']);
      expect(status.stdout).toMatch(/agent: locked/);

      const badUnlock = cli([
        'agent',
        'unlock',
        '--password',
        'wrong-password',
      ]);
      expect(badUnlock.status).not.toBe(0);

      const unlock = cli(['agent', 'unlock'], { withPassword: true });
      expect(unlock.status).toBe(0);
      expect(unlock.stdout).toMatch(/agent unlocked/);

      status = cli(['agent', 'status']);
      expect(status.stdout).toMatch(/agent: unlocked/);

      const lock = cli(['agent', 'lock']);
      expect(lock.stdout).toMatch(/agent locked/);

      status = cli(['agent', 'status']);
      expect(status.stdout).toMatch(/agent: locked/);

      const stop = cli(['agent', 'stop']);
      expect(stop.stdout).toMatch(/agent stopped/);

      status = cli(['agent', 'status']);
      expect(status.stdout).toMatch(/not running/);
    });

    it('reports "not running" for status/lock before start', () => {
      expect(cli(['agent', 'status']).stdout).toMatch(/not running/);
      expect(cli(['agent', 'lock']).stdout).toMatch(/not running/);
    });

    it('unlock before start fails with guidance', () => {
      const r = cli(['agent', 'unlock'], { withPassword: true });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/agent is not running/);
    });

    it('start is idempotent', () => {
      expect(cli(['agent', 'start', '-v', vaultPath]).status).toBe(0);
      const second = cli(['agent', 'start', '-v', vaultPath]);
      expect(second.status).toBe(0);
      expect(second.stdout).toMatch(/already running/);
    });
  }
);

describe.runIf(ON_WINDOWS)('vault env agent on Windows (New-57)', () => {
  it('refuses with a pointer to `vault env run`', () => {
    const r = cli(['agent', 'start', '-v', vaultPath]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/isn't available on Windows yet/);
    expect(r.stderr).toMatch(/vault env run/);
  });
});
