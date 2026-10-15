// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { cli, registerAgentHooks, vaultPath, NODE } from './agentHarness.js';

registerAgentHooks();

describe('vault env agent — exec (integration, spawns a real daemon)', () => {
  it('exec runs a command with the env injected by the agent (G24)', () => {
    cli(['agent', 'start', '-v', vaultPath]);
    cli(['agent', 'unlock'], { withPassword: true });

    const r = cli([
      'agent',
      'exec',
      'dev',
      '--',
      NODE,
      '-e',
      'process.stdout.write(process.env.API_URL || "MISSING")',
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('https://api.example.com');
  });

  it('exec relays the child exit code', () => {
    cli(['agent', 'start', '-v', vaultPath]);
    cli(['agent', 'unlock'], { withPassword: true });

    const r = cli([
      'agent',
      'exec',
      'dev',
      '--',
      NODE,
      '-e',
      'process.exit(3)',
    ]);
    expect(r.status).toBe(3);
  });

  it('exec is refused before unlock (I2)', () => {
    cli(['agent', 'start', '-v', vaultPath]);
    const r = cli(['agent', 'exec', 'dev', '--', NODE, '-e', '1']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/locked/);
  });

  it('exec clean mode does not leak an arbitrary parent var', () => {
    // Set SNEAKY *before* start so the daemon inherits it; clean mode (which the
    // daemon applies when spawning the child) must then strip it.
    const prev = process.env.SNEAKY;
    process.env.SNEAKY = 'leaked';
    try {
      cli(['agent', 'start', '-v', vaultPath]);
      cli(['agent', 'unlock'], { withPassword: true });

      const r = cli([
        'agent',
        'exec',
        'dev',
        '--',
        NODE,
        '-e',
        'process.stdout.write(process.env.SNEAKY || "clean")',
      ]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('clean');
    } finally {
      if (prev === undefined) delete process.env.SNEAKY;
      else process.env.SNEAKY = prev;
    }
  });
});
