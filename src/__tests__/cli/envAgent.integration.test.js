// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
const NODE = process.execPath;
const PASSWORD = 'TestVault123!@#';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, { timeout = 4000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await delay(interval);
  }
  return false;
}

let workDir;
let agentDir;
let vaultPath;

function cli(args, { withPassword = false } = {}) {
  const env = { ...process.env, VAULT_AGENT_DIR: agentDir };
  if (withPassword) env.VAULT_ENV_PASSWORD = PASSWORD;
  else delete env.VAULT_ENV_PASSWORD;
  // Run in workDir so the spawned daemon inherits it as cwd and finds .vaultrc.
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    env,
    cwd: workDir,
  });
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-agent-cli-'));
  agentDir = path.join(workDir, 'runtime');
  vaultPath = path.join(workDir, 'test.env.vault');
  fs.mkdirSync(path.join(workDir, '.git')); // stop .vaultrc walk-up here
  cli(['init', '-v', vaultPath], { withPassword: true });
  cli(
    ['set', 'API_URL', 'https://api.example.com', '-e', 'dev', '-v', vaultPath],
    {
      withPassword: true,
    }
  );
  fs.writeFileSync(
    path.join(workDir, 'app.xcconfig.vtpl'),
    'API_URL = {{API_URL}}\n'
  );
  fs.writeFileSync(
    path.join(workDir, '.vaultrc'),
    JSON.stringify({
      env: 'dev',
      vault: vaultPath,
      deliver: [
        { path: '.env.mounted', format: 'dotenv', keys: ['API_URL'] },
        { template: 'app.xcconfig.vtpl' },
      ],
    })
  );
});

afterEach(() => {
  cli(['agent', 'stop']); // best-effort shutdown of any spawned daemon
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('vault env agent (integration, spawns a real daemon)', () => {
  it('start → status → unlock → status → lock → stop', () => {
    const start = cli(['agent', 'start', '-v', vaultPath]);
    expect(start.status).toBe(0);
    expect(start.stdout).toMatch(/agent started/);

    let status = cli(['agent', 'status']);
    expect(status.stdout).toMatch(/agent: locked/);

    const badUnlock = cli(['agent', 'unlock', '--password', 'wrong-password']);
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

  it('mount materializes manifest files; lock wipes them', () => {
    cli(['agent', 'start', '-v', vaultPath]);
    cli(['agent', 'unlock'], { withPassword: true });

    const mount = cli(['agent', 'mount', '--force']);
    expect(mount.status).toBe(0);
    expect(mount.stdout).toMatch(/mounted .env.mounted/);
    expect(mount.stdout).toMatch(/highest-risk/); // the opt-in warning

    expect(fs.readFileSync(path.join(workDir, '.env.mounted'), 'utf-8')).toBe(
      'API_URL=https://api.example.com\n'
    );
    expect(fs.readFileSync(path.join(workDir, 'app.xcconfig'), 'utf-8')).toBe(
      'API_URL = https://api.example.com\n'
    );

    expect(cli(['agent', 'mounts']).stdout).toMatch(/app.xcconfig/);

    // Hard lock wipes the mounts.
    cli(['agent', 'lock']);
    expect(fs.existsSync(path.join(workDir, '.env.mounted'))).toBe(false);
    expect(fs.existsSync(path.join(workDir, 'app.xcconfig'))).toBe(false);
    // template source survives
    expect(fs.existsSync(path.join(workDir, 'app.xcconfig.vtpl'))).toBe(true);
  });

  it('mount without --force is refused (opt-in gate, G26)', () => {
    cli(['agent', 'start', '-v', vaultPath]);
    cli(['agent', 'unlock'], { withPassword: true });

    const r = cli(['agent', 'mount']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--force/);
    // nothing was materialized
    expect(fs.existsSync(path.join(workDir, '.env.mounted'))).toBe(false);
  });

  it('mount is refused before unlock (I2)', () => {
    cli(['agent', 'start', '-v', vaultPath]);
    const r = cli(['agent', 'mount', '--force']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/locked/);
  });

  it('re-materializes a mounted file deleted out from under a build', async () => {
    cli(['agent', 'start', '-v', vaultPath]);
    cli(['agent', 'unlock'], { withPassword: true });
    cli(['agent', 'mount', '--force']);

    const mounted = path.join(workDir, '.env.mounted');
    expect(fs.existsSync(mounted)).toBe(true);

    fs.rmSync(mounted); // a build step clobbers the mount
    const restored = await waitFor(() => fs.existsSync(mounted));
    expect(restored).toBe(true);
    expect(fs.readFileSync(mounted, 'utf-8')).toBe(
      'API_URL=https://api.example.com\n'
    );
  });
});
