// @vitest-environment node
// The write operations, on a real filesystem: since Task 6 every one of them
// runs through transact() (lock, read, write), which a mocked fs-extra can't
// exercise. Read-only operations keep their tests in
// EnvironmentVaultService.test.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
import { VaultLock } from '../../../electron/services/VaultLock.js';
import { EnvironmentVault } from '../../../electron/models/EnvironmentVault.js';

const PW = 'TestVault123!@#';
const NEW_PW = 'NewStrongPass123!@#';
const ENV = 'staging';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../../..');

describe('EnvironmentVaultService write operations', () => {
  let dir;
  let vaultPath;

  /** Create the vault holding `vault` (empty by default). */
  const seed = async (vault = new EnvironmentVault()) => {
    const created = await EnvironmentVaultService.createVault(
      vaultPath,
      PW,
      vault.toJSON()
    );
    expect(created.success).toBe(true);
  };
  const populated = (env, vars, opts) => {
    const vault = new EnvironmentVault();
    vault.addEnvironment(env);
    vault.addVersion(env, vars, opts);
    return vault;
  };
  const reload = async (password = PW) => {
    const loaded = await EnvironmentVaultService.loadVault(vaultPath, password);
    expect(loaded.success).toBe(true);
    return loaded.data;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ops-'));
    vaultPath = path.join(dir, 'test.env.vault');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('every write returns the new revision and leaves no lock behind', async () => {
    await seed();

    const result = await EnvironmentVaultService.setEnv(
      vaultPath,
      PW,
      ENV,
      'A',
      '1'
    );

    expect(result).toEqual({
      success: true,
      revision: EnvironmentVaultService.revisionOf(fs.readFileSync(vaultPath)),
    });
    expect(fs.existsSync(`${vaultPath}.lock`)).toBe(false);
  });

  it('reports BUSY while another writer holds the lock', async () => {
    await seed();
    const other = new VaultLock(vaultPath);
    await other.acquire();
    try {
      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        () => {},
        { lockTimeoutMs: 0 }
      );
      expect(result.code).toBe('BUSY');
    } finally {
      await other.release();
    }
  });

  describe('setEnv', () => {
    it('keeps a key public until isPublic is false (New-27)', async () => {
      await seed();
      const set = (value, opts) =>
        EnvironmentVaultService.setEnv(vaultPath, PW, ENV, 'URL', value, opts);
      const isPublic = async () =>
        (await reload()).getActiveVersion(ENV).nonSensitive.includes('URL');
      await set('a');
      expect(await isPublic()).toBe(false); // new keys are secret
      await set('b', { isPublic: true });
      await set('c');
      expect(await isPublic()).toBe(true);
      await set('d', { isPublic: false });
      expect(await isPublic()).toBe(false);
    });

    it('exports comments only when asked; import reports skipped lines', async () => {
      await seed(populated(ENV, { A: '1' }, { comments: { A: 'first key' } }));
      const plain = await EnvironmentVaultService.exportEnv(vaultPath, PW, ENV);
      expect(plain.data).toBe('A=1\n');
      const noted = await EnvironmentVaultService.exportEnv(
        vaultPath,
        PW,
        ENV,
        'dotenv',
        { comments: true }
      );
      expect(noted.data).toBe('# first key\nA=1\n');

      const file = path.join(dir, 'in.env');
      fs.writeFileSync(file, '# from file\nB=2\nbroken line\n');
      const imported = await EnvironmentVaultService.importEnvFile(
        vaultPath,
        PW,
        ENV,
        file,
        { comments: true }
      );
      expect(imported.success).toBe(true);
      expect(imported.warnings).toEqual([
        { line: 3, message: 'Not KEY=value; skipped' },
      ]);
      expect((await reload()).getActiveVersion(ENV).comments).toEqual({
        B: 'from file',
      });
    });

    it('sets, keeps and clears a comment; show reports it; rm drops it', async () => {
      await seed(populated(ENV, { EXISTING: 'val' }));
      await EnvironmentVaultService.setEnv(vaultPath, PW, ENV, 'K', 'v', {
        comment: 'Owned by the payments team',
      });
      await EnvironmentVaultService.setEnv(vaultPath, PW, ENV, 'K', 'v2');
      const shown = /** @type {any} */ (
        await EnvironmentVaultService.showEnv(vaultPath, PW, ENV)
      );
      expect(shown.data.keys).toContainEqual(
        expect.objectContaining({
          key: 'K',
          comment: 'Owned by the payments team',
        })
      );
      expect(
        shown.data.keys.find((k) => k.key === 'EXISTING')
      ).not.toHaveProperty('comment');

      await EnvironmentVaultService.copyEnv(vaultPath, PW, ENV, 'copy');
      expect((await reload()).getActiveVersion('copy').comments).toEqual({
        K: 'Owned by the payments team',
      });

      await EnvironmentVaultService.setEnv(vaultPath, PW, ENV, 'K', 'v3', {
        comment: '',
      });
      expect((await reload()).getActiveVersion(ENV)).not.toHaveProperty(
        'comments'
      );
      await EnvironmentVaultService.setEnv(vaultPath, PW, ENV, 'K', 'v4', {
        comment: 'back',
      });
      await EnvironmentVaultService.removeKey(vaultPath, PW, ENV, 'K');
      expect((await reload()).getActiveVersion(ENV)).not.toHaveProperty(
        'comments'
      );
    });

    it('sets a variable, keeping the existing ones', async () => {
      await seed(populated(ENV, { EXISTING: 'val' }));

      const result = await EnvironmentVaultService.setEnv(
        vaultPath,
        PW,
        ENV,
        'DB_HOST',
        'localhost'
      );

      expect(result.success).toBe(true);
      expect((await reload()).getActiveVersion(ENV).vars).toEqual({
        EXISTING: 'val',
        DB_HOST: 'localhost',
      });
    });

    it('creates the environment on first use', async () => {
      await seed();

      await EnvironmentVaultService.setEnv(vaultPath, PW, 'dev', 'K', 'v');

      expect((await reload()).getActiveVersion('dev').vars).toEqual({
        K: 'v',
      });
    });

    it('marks a variable public', async () => {
      await seed(populated(ENV, { EXISTING: 'val' }));

      await EnvironmentVaultService.setEnv(vaultPath, PW, ENV, 'PORT', '3000', {
        isPublic: true,
      });

      expect((await reload()).getActiveVersion(ENV).nonSensitive).toContain(
        'PORT'
      );
    });

    it('marks a variable required, and keeps it required on a later update', async () => {
      await seed();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        PW,
        'dev',
        'API_URL',
        'https://x',
        { isRequired: true }
      );
      await EnvironmentVaultService.setEnv(
        vaultPath,
        PW,
        'dev',
        'API_URL',
        'https://y'
      );

      const version = (await reload()).getActiveVersion('dev');
      expect(version.required).toContain('API_URL');
      expect(version.vars.API_URL).toBe('https://y');
    });

    it('refuses a reserved environment name ("self") and writes nothing', async () => {
      await seed();
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.setEnv(
        vaultPath,
        PW,
        'self',
        'KEY',
        'val'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/reserved/i);
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
    });

    it('fails on a missing vault', async () => {
      const result = await EnvironmentVaultService.setEnv(
        path.join(dir, 'nonexistent.env.vault'),
        PW,
        ENV,
        'KEY',
        'val'
      );

      expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
      expect(result.error).toContain('not found');
    });

    it('fails with the wrong password', async () => {
      await seed();

      const result = await EnvironmentVaultService.setEnv(
        vaultPath,
        'WrongPass123!@#',
        ENV,
        'KEY',
        'val'
      );

      expect(result).toMatchObject({ success: false, code: 'AUTH' });
      expect(result.error).toContain('wrong password');
    });
  });

  describe('removeKey', () => {
    it('removes a key as a new version', async () => {
      await seed(populated(ENV, { KEEP: 'a', REMOVE: 'b' }));

      const result = await EnvironmentVaultService.removeKey(
        vaultPath,
        PW,
        ENV,
        'REMOVE'
      );

      expect(result.success).toBe(true);
      const vault = await reload();
      expect(vault.getActiveVersion(ENV).vars).toEqual({ KEEP: 'a' });
      expect(vault.getHistory(ENV)).toHaveLength(2);
    });

    it('fails on a missing key, writing nothing', async () => {
      await seed(populated(ENV, { KEEP: 'a' }));
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.removeKey(
        vaultPath,
        PW,
        ENV,
        'GHOST'
      );

      expect(result).toMatchObject({
        success: false,
        error: `Key 'GHOST' not found in environment '${ENV}'`,
      });
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
    });

    it('fails on an environment without versions', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment(ENV);
      await seed(vault);

      const result = await EnvironmentVaultService.removeKey(
        vaultPath,
        PW,
        ENV,
        'K'
      );

      expect(result.error).toBe(`Environment '${ENV}' has no versions`);
    });
  });

  describe('deleteEnv', () => {
    it('deletes an environment and keeps a pre-delete snapshot', async () => {
      await seed(populated(ENV, { KEY: 'val' }));
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.deleteEnv(
        vaultPath,
        PW,
        ENV
      );

      expect(result.success).toBe(true);
      expect((await reload()).listEnvironmentNames()).toEqual([]);
      const snapshots = fs
        .readdirSync(dir)
        .filter((n) => n.startsWith('test.env.vault.deleted.'));
      expect(snapshots).toHaveLength(1);
      expect(fs.readFileSync(path.join(dir, snapshots[0])).equals(before)).toBe(
        true
      );
    });

    it('fails on a missing environment, writing nothing and no snapshot', async () => {
      await seed(populated(ENV, { KEY: 'val' }));
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.deleteEnv(
        vaultPath,
        PW,
        'ghost'
      );

      expect(result.success).toBe(false);
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
      expect(fs.readdirSync(dir).some((n) => n.includes('.deleted.'))).toBe(
        false
      );
    });
  });

  describe('renameEnv', () => {
    it('renames an environment', async () => {
      await seed(populated(ENV, { KEY: 'val' }));

      const result = await EnvironmentVaultService.renameEnv(
        vaultPath,
        PW,
        ENV,
        'prod'
      );

      expect(result.success).toBe(true);
      expect((await reload()).listEnvironmentNames()).toEqual(['prod']);
    });
  });

  describe('copyEnv', () => {
    it('copies an environment, leaving the source intact', async () => {
      await seed(populated(ENV, { KEY: 'val', HOST: 'h' }));

      const result = await EnvironmentVaultService.copyEnv(
        vaultPath,
        PW,
        ENV,
        'prod'
      );

      expect(result.success).toBe(true);
      const vault = await reload();
      expect(vault.listEnvironmentNames().sort()).toEqual(['prod', ENV].sort());
      expect(vault.getActiveVersion('prod').vars).toEqual({
        KEY: 'val',
        HOST: 'h',
      });
      expect(vault.getActiveVersion(ENV).vars).toEqual({
        KEY: 'val',
        HOST: 'h',
      });
    });

    it('fails when the destination already exists', async () => {
      const vault = populated(ENV, { KEY: 'val' });
      vault.addEnvironment('prod');
      vault.addVersion('prod', { OTHER: 'x' });
      await seed(vault);

      const result = await EnvironmentVaultService.copyEnv(
        vaultPath,
        PW,
        ENV,
        'prod'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/i);
    });

    it('fails when the source does not exist', async () => {
      await seed(populated(ENV, { KEY: 'val' }));

      const result = await EnvironmentVaultService.copyEnv(
        vaultPath,
        PW,
        'nope',
        'prod'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  describe('setExtends', () => {
    it('sets and persists the parent of an environment', async () => {
      const vault = populated('base', { PORT: '3000' });
      vault.addEnvironment('staging');
      vault.addVersion('staging', { API_URL: 'x' });
      await seed(vault);

      const result = await EnvironmentVaultService.setExtends(
        vaultPath,
        PW,
        'staging',
        'base'
      );

      expect(result.success).toBe(true);
      expect((await reload()).environments.staging.extends).toBe('base');
    });

    it('fails when the parent does not exist', async () => {
      await seed(populated('staging', { API_URL: 'x' }));

      const result = await EnvironmentVaultService.setExtends(
        vaultPath,
        PW,
        'staging',
        'ghost'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  describe('setEnvDescription', () => {
    it('sets a description', async () => {
      await seed(populated(ENV, { K: 'v' }));

      await EnvironmentVaultService.setEnvDescription(
        vaultPath,
        PW,
        ENV,
        'Staging stack'
      );

      expect((await reload()).environments[ENV].description).toBe(
        'Staging stack'
      );
    });

    it('fails on a missing environment', async () => {
      await seed();

      const result = await EnvironmentVaultService.setEnvDescription(
        vaultPath,
        PW,
        'ghost',
        'x'
      );

      expect(result.error).toBe("Environment 'ghost' not found");
    });
  });

  describe('importEnvFile', () => {
    it('imports a .env file into an environment', async () => {
      await seed(populated(ENV, { KEY: 'old' }));
      const envFile = path.join(dir, '.env');
      fs.writeFileSync(envFile, 'IMPORTED_KEY=imported_value');

      const result = await EnvironmentVaultService.importEnvFile(
        vaultPath,
        PW,
        ENV,
        envFile
      );

      expect(result.success).toBe(true);
      expect((await reload()).getActiveVersion(ENV).vars.IMPORTED_KEY).toBe(
        'imported_value'
      );
    });

    it('fails on a missing .env file without touching the vault', async () => {
      await seed();
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.importEnvFile(
        vaultPath,
        PW,
        ENV,
        path.join(dir, 'missing.env')
      );

      expect(result.success).toBe(false);
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
    });
  });

  describe('squashEnv', () => {
    it('squashes the history', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment(ENV);
      vault.addVersion(ENV, { KEEP: 'a' });
      vault.addVersion(ENV, { KEEP: 'a', ADD: 'b' });
      vault.addVersion(ENV, { KEEP: 'a', ADD: 'b', ADD2: 'c' });
      await seed(vault);

      const result = await EnvironmentVaultService.squashEnv(
        vaultPath,
        PW,
        ENV,
        1
      );

      expect(result.success).toBe(true);
      expect((await reload()).getHistory(ENV)).toHaveLength(1);
    });

    it('keeps a snapshot of the pre-squash vault (Task 7)', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment(ENV);
      vault.addVersion(ENV, { A: '1' });
      vault.addVersion(ENV, { A: '2' });
      await seed(vault);
      const before = fs.readFileSync(vaultPath);

      await EnvironmentVaultService.squashEnv(vaultPath, PW, ENV, 1);

      const snapshots = fs
        .readdirSync(dir)
        .filter((n) => n.startsWith('test.env.vault.squashed.'));
      expect(snapshots).toHaveLength(1);
      const snap = path.join(dir, snapshots[0]);
      expect(fs.readFileSync(snap).equals(before)).toBe(true);
      const opened = await EnvironmentVaultService.loadVault(snap, PW);
      expect(opened.data.getHistory(ENV)).toHaveLength(2);
    });

    it('takes no snapshot when the env is missing', async () => {
      await seed(populated(ENV, { A: '1' }));
      const result = await EnvironmentVaultService.squashEnv(
        vaultPath,
        PW,
        'ghost'
      );
      expect(result.success).toBe(false);
      expect(fs.readdirSync(dir).some((n) => n.includes('.squashed.'))).toBe(
        false
      );
    });

    it('a password change re-keys squashed and deleted snapshots alike', async () => {
      const vault = populated(ENV, { A: '1' });
      vault.addVersion(ENV, { A: '2' });
      vault.addEnvironment('other');
      await seed(vault);
      await EnvironmentVaultService.squashEnv(vaultPath, PW, ENV, 1);
      await EnvironmentVaultService.deleteEnv(vaultPath, PW, 'other');

      const changed = await EnvironmentVaultService.changePassword(
        vaultPath,
        PW,
        NEW_PW
      );
      expect(changed.success).toBe(true);
      const snaps = fs
        .readdirSync(dir)
        .filter((n) => /\.(squashed|deleted)\./.test(n));
      expect(snaps).toHaveLength(2);
      for (const name of snaps) {
        const snap = path.join(dir, name);
        expect(
          (await EnvironmentVaultService.loadVault(snap, PW)).success
        ).toBe(false);
        expect(
          (await EnvironmentVaultService.loadVault(snap, NEW_PW)).success
        ).toBe(true);
      }
    });
  });

  describe('rollbackEnv', () => {
    it('rolls back to a previous version', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment(ENV);
      vault.addVersion(ENV, { VERSION: '1' });
      vault.addVersion(ENV, { VERSION: '2' });
      await seed(vault);

      const result = await EnvironmentVaultService.rollbackEnv(
        vaultPath,
        PW,
        ENV,
        1
      );

      expect(result.success).toBe(true);
      expect((await reload()).getActiveVersion(ENV).vars).toEqual({
        VERSION: '1',
      });
    });
  });

  describe('changePassword', () => {
    it('re-keys the vault under the new password', async () => {
      await seed(populated(ENV, { KEY: 'val' }));

      const result = await EnvironmentVaultService.changePassword(
        vaultPath,
        PW,
        NEW_PW
      );

      expect(result).toMatchObject({
        success: true,
        rekeyedSnapshots: [],
        skippedSnapshots: [],
      });
      expect((await reload(NEW_PW)).getActiveVersion(ENV).vars).toEqual({
        KEY: 'val',
      });
      const old = await EnvironmentVaultService.loadVault(vaultPath, PW);
      expect(old.success).toBe(false);
    });

    it('re-keys deletion snapshots under the same lock', async () => {
      const vault = populated(ENV, { KEY: 'val' });
      vault.addEnvironment('gone');
      await seed(vault);
      await EnvironmentVaultService.deleteEnv(vaultPath, PW, 'gone');

      const result = await EnvironmentVaultService.changePassword(
        vaultPath,
        PW,
        NEW_PW
      );

      expect(result.rekeyedSnapshots).toHaveLength(1);
      const snapshot = path.join(dir, result.rekeyedSnapshots[0]);
      expect(
        (await EnvironmentVaultService.loadVault(snapshot, NEW_PW)).success
      ).toBe(true);
      expect(
        (await EnvironmentVaultService.loadVault(snapshot, PW)).success
      ).toBe(false);
      expect(fs.existsSync(`${vaultPath}.lock`)).toBe(false);
    });

    it('rejects a weak new password', async () => {
      await seed();

      const result = await EnvironmentVaultService.changePassword(
        vaultPath,
        PW,
        'weak'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 8 characters');
    });

    it('rejects the wrong current password, changing nothing', async () => {
      await seed(populated(ENV, { KEY: 'val' }));
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.changePassword(
        vaultPath,
        'WrongPass123!@#',
        NEW_PW
      );

      expect(result.success).toBe(false);
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
    });
  });
});

describe('Every env vault write goes through transact (Task 6)', () => {
  /** All .js/.mjs/.cjs files under `dir`, skipping tests and dependencies. */
  const sources = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return ['node_modules', '__tests__'].includes(entry.name)
          ? []
          : sources(full);
      }
      return /\.(c|m)?js$/.test(entry.name) ? [full] : [];
    });

  it('nothing outside the service calls EnvironmentVaultService.saveVault', () => {
    const offenders = ['bin', 'public', 'src']
      .flatMap((d) => sources(path.join(REPO, d)))
      .filter((file) =>
        /EnvironmentVaultService\.saveVault\s*\(/.test(
          fs.readFileSync(file, 'utf8')
        )
      )
      .map((file) => path.relative(REPO, file));

    expect(offenders).toEqual([]);
  });

  it('the service itself only calls saveVault from its own definition', () => {
    const service = fs.readFileSync(
      path.join(REPO, 'src/electron/services/EnvironmentVaultService.js'),
      'utf8'
    );

    expect(service.match(/\bthis\.saveVault\s*\(/g)).toBeNull();
  });
});

describe('No lost updates across processes (Task 6)', () => {
  let dir;
  let vaultPath;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ops-procs-'));
    vaultPath = path.join(dir, 'shared.env.vault');
    await EnvironmentVaultService.createVault(vaultPath, PW);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Run `node <args>` and resolve with its exit code and stderr. */
  const run = (args) =>
    new Promise((resolve) => {
      // process.env carries vitest's NODE_OPTIONS (the fast-KDF import), so
      // children derive keys at the test work factor too.
      const child = spawn(process.execPath, args, {
        env: { ...process.env, VAULT_ENV_PASSWORD: PW },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('exit', (code) => resolve({ code, stderr }));
    });

  it('two processes x 50 setEnv calls through the shared service keep all 100 keys', async () => {
    const PROCS = 2;
    const ROUNDS = 50;
    const child = path.join(dir, 'writer.mjs');
    const service = pathToFileURL(
      path.join(REPO, 'src/electron/services/EnvironmentVaultService.js')
    ).href;
    fs.writeFileSync(
      child,
      `import { EnvironmentVaultService } from ${JSON.stringify(service)};
const [vault, prefix, rounds, password] = process.argv.slice(2);
for (let i = 0; i < Number(rounds); i++) {
  const r = await EnvironmentVaultService.setEnv(vault, password, 'dev', prefix + i, String(i));
  if (!r.success) { console.error(r.error); process.exit(2); }
}
`
    );

    const results = await Promise.all(
      Array.from({ length: PROCS }, (_, p) =>
        run([child, vaultPath, `P${p}_`, String(ROUNDS), PW])
      )
    );

    expect(results.map((r) => r.stderr)).toEqual(Array(PROCS).fill(''));
    expect(results.map((r) => r.code)).toEqual(Array(PROCS).fill(0));
    const loaded = await EnvironmentVaultService.loadVault(vaultPath, PW);
    const vars = loaded.data.getActiveVersion('dev').vars;
    expect(Object.keys(vars)).toHaveLength(PROCS * ROUNDS);
    expect(loaded.data.getHistory('dev')).toHaveLength(PROCS * ROUNDS);
  }, 120000);

  it('concurrent `vault env set` CLI processes keep every key', async () => {
    const CLI = path.join(REPO, 'bin/cli.js');
    const keys = ['K1', 'K2', 'K3', 'K4'];

    const results = await Promise.all(
      keys.map((key) =>
        run([CLI, 'env', 'set', key, `v-${key}`, '-e', 'dev', '-v', vaultPath])
      )
    );

    expect(results.map((r) => r.code)).toEqual(keys.map(() => 0));
    const loaded = await EnvironmentVaultService.loadVault(vaultPath, PW);
    expect(
      Object.keys(loaded.data.getActiveVersion('dev').vars).sort()
    ).toEqual(keys);
  }, 120000);
});
