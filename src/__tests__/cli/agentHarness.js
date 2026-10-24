// Shared setup for the agent integration tests, split across several files so
// vitest runs them in parallel (each test spawns a real daemon and several CLI
// processes). `workDir`, `agentDir` and `vaultPath` are live bindings.
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { seedVault, removeSeed } from '../helpers/seedVault.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
export const NODE = process.execPath;
// The agent refuses to run on Windows (New-57).
export const ON_WINDOWS = process.platform === 'win32';
export const PASSWORD = 'TestVault123!@#';

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(pred, { timeout = 4000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await delay(interval);
  }
  return false;
}

export let workDir;
export let agentDir;
export let vaultPath;
let seedPath;

export function cli(args, { withPassword = false } = {}) {
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

/** Register the per-file and per-test hooks; call once at the top of a file. */
export function registerAgentHooks() {
  beforeAll(() => {
    seedPath = seedVault(PASSWORD, [
      ['init', '-v', '{vault}'],
      [
        'set',
        'API_URL',
        'https://api.example.com',
        '-e',
        'dev',
        '-v',
        '{vault}',
      ],
    ]);
  });
  afterAll(() => removeSeed(seedPath));

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-agent-cli-'));
    agentDir = path.join(workDir, 'runtime');
    vaultPath = path.join(workDir, 'test.env.vault');
    fs.mkdirSync(path.join(workDir, '.git')); // stop .vaultrc walk-up here
    fs.copyFileSync(seedPath, vaultPath);
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
}
