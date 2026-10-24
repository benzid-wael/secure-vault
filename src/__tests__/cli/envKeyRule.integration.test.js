// @vitest-environment node
// `env set` refuses a key a .env file can't hold; `env rm` still removes
// one an older version stored (GUI-ENV-BREAKDOWN Task 9).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { EnvironmentVaultService } from '../../electron/services/EnvironmentVaultService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
const PASSWORD = 'TestVault123!@#';

let workDir;
let vaultPath;

/** @param {string[]} args */
const cli = (args) =>
  spawnSync(process.execPath, [CLI, 'env', ...args, '-v', vaultPath], {
    encoding: 'utf8',
    cwd: workDir,
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, NO_COLOR: '1' },
  });

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-key-rule-'));
  vaultPath = path.join(workDir, 'test.env.vault');
  expect(cli(['init']).status).toBe(0);
  expect(cli(['set', 'A', '1', '-e', 'dev']).status).toBe(0);
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('env set and key names', () => {
  it.each(['my-key', 'a.b', '1ST'])(
    'refuses %s with exit 1 and changes nothing',
    (key) => {
      const before = fs.readFileSync(vaultPath);
      const r = cli(['set', key, 'x', '-e', 'dev']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        `Invalid key '${key}': use letters, digits and _, not starting with a digit`
      );
      expect(fs.readFileSync(vaultPath)).toEqual(before);
    }
  );

  it('refuses before asking for a value', () => {
    const r = cli(['set', 'my-key', '-e', 'dev']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Invalid key 'my-key'");
    expect(r.stderr).not.toContain('No value provided');
  });

  it('still removes such a key from an older vault', async () => {
    const written = await EnvironmentVaultService.transact(
      vaultPath,
      PASSWORD,
      (vault) => vault.addVersion('dev', { A: '1', 'my-key': 'x' })
    );
    expect(written.success).toBe(true);

    expect(cli(['rm', 'my-key', '-e', 'dev']).status).toBe(0);
    const read = await EnvironmentVaultService.read(vaultPath, PASSWORD);
    expect(read.vault.getActiveVersion('dev').vars).toEqual({ A: '1' });
  });
});
