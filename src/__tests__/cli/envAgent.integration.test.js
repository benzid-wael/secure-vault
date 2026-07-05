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

let workDir;
let agentDir;
let vaultPath;

function cli(args, { withPassword = false } = {}) {
  const env = { ...process.env, VAULT_AGENT_DIR: agentDir };
  if (withPassword) env.VAULT_ENV_PASSWORD = PASSWORD;
  else delete env.VAULT_ENV_PASSWORD;
  return spawnSync(NODE, [CLI, 'env', ...args], { encoding: 'utf8', env });
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-agent-cli-'));
  agentDir = path.join(workDir, 'runtime');
  vaultPath = path.join(workDir, 'test.env.vault');
  cli(['init', '-v', vaultPath], { withPassword: true });
  cli(
    ['set', 'API_URL', 'https://api.example.com', '-e', 'dev', '-v', vaultPath],
    {
      withPassword: true,
    }
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
});
