// @vitest-environment node
// Main-process side of the env vault GUI (GUI-ENV-BREAKDOWN Tasks 14, 15, 17
// and New-4, MVP scope): the registry, the session and the IPC handlers, on
// a real filesystem with the real service. Only dialogs and timers are fakes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../../electron/models/EnvironmentVault.js';
import { EnvironmentResolver } from '../../../electron/services/EnvironmentResolver.js';
import { EnvVaultRegistry } from '../../../electron/services/EnvVaultRegistry.js';
import {
  EnvVaultSession,
  ENV_VAULT_IDLE_MS,
  MAX_VIEWS_PER_VAULT,
} from '../../../electron/services/EnvVaultSession.js';
import { createEnvVaultHandlers } from '../../../electron/services/EnvVaultIpc.js';
import { readFeatures } from '../../../electron/utils/features.js';
import { EnvVaultKeychain } from '../../../electron/services/EnvVaultKeychain.js';
import { EnvVaultRecents } from '../../../electron/services/EnvVaultRecents.js';
import { fakeSafeStorage } from '../../helpers/fakeSafeStorage.js';
import {
  ClipboardService,
  CLIPBOARD_CLEAR_MS,
} from '../../../electron/services/ClipboardService.js';

const PW = 'Env-Pass-7&x';
const SECRET = 'sk-very-secret';

let dir;
let envsDir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-envgui-'));
  envsDir = path.join(dir, 'envs');
});
afterEach(() => fs.remove(dir));

/** base (public LOG_LEVEL) ← prod (secret API_KEY, public HOST). */
async function seed(filePath = path.join(envsDir, 'app.env.vault')) {
  const vault = new EnvironmentVault();
  vault.addEnvironment('base');
  vault.addVersion(
    'base',
    { LOG_LEVEL: 'debug', SHARED: 'from-base' },
    { nonSensitive: ['LOG_LEVEL'] }
  );
  vault.addEnvironment('prod');
  vault.addVersion(
    'prod',
    { API_KEY: SECRET, HOST: 'prod.example', SHARED: 'own' },
    { nonSensitive: ['HOST'], required: ['API_KEY'] }
  );
  vault.setExtends('prod', 'base');
  const created = await EnvironmentVaultService.createVault(
    filePath,
    PW,
    vault.toJSON()
  );
  expect(created.success).toBe(true);
  return filePath;
}

describe('readFeatures (New-4)', () => {
  it.each([
    [{}, false],
    [{ NODE_ENV: 'production' }, false],
    [{ SECURE_VAULT_ENV_UI: 'true' }, false],
    [{ SECURE_VAULT_ENV_UI: '1' }, true],
    [{ NODE_ENV: 'production', SECURE_VAULT_ENV_UI: '1' }, true],
    [{ ELECTRON_IS_DEV: '1' }, true],
    [{ NODE_ENV: 'development' }, true],
    [{ ELECTRON_IS_DEV: '1', SECURE_VAULT_ENV_UI: '0' }, false],
  ])('%j → envVaults %s', (env, on) => {
    expect(readFeatures(env)).toEqual({ envVaults: on });
  });
});

describe('EnvVaultRegistry', () => {
  const pick = (...filePaths) => ({
    showOpenDialog: vi.fn(async () => ({
      canceled: filePaths.length === 0,
      filePaths,
    })),
  });

  it('lists app-folder vaults with random ids that resolve to their path', async () => {
    const filePath = await seed();
    await fs.writeFile(path.join(envsDir, 'notes.txt'), 'x');
    const registry = new EnvVaultRegistry({ envsDir });
    const [entry, ...rest] = await registry.list();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      label: 'app',
      location: filePath,
      source: 'appdata',
      exists: true,
    });
    expect(entry.id).toMatch(/^[0-9a-f]{32}$/);
    expect(registry.resolve(entry.id)).toBe(filePath);
    // Stable within the run.
    expect((await registry.list())[0].id).toBe(entry.id);
  });

  it('lists nothing when the app folder does not exist', async () => {
    expect(await new EnvVaultRegistry({ envsDir }).list()).toEqual([]);
  });

  it('resolves unknown, forged and non-string ids to null', async () => {
    await seed();
    const registry = new EnvVaultRegistry({ envsDir });
    await registry.list();
    expect(registry.resolve('0'.repeat(32))).toBeNull();
    expect(registry.resolve(path.join(envsDir, 'app.env.vault'))).toBeNull();
    expect(registry.resolve(undefined)).toBeNull();
    expect(registry.resolve({ id: 1 })).toBeNull();
  });

  it('opens an env vault picked in the dialog and lists it for the run', async () => {
    const project = path.join(dir, 'project', '.env.vault');
    await seed(project);
    const dialog = pick(project);
    const registry = new EnvVaultRegistry({ envsDir, dialog });
    const opened = await registry.openFromDialog('win');
    expect(opened.success).toBe(true);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      'win',
      expect.any(Object)
    );
    expect(registry.resolve(opened.id)).toBe(project);
    const listed = await registry.list();
    expect(listed).toEqual([
      expect.objectContaining({
        id: opened.id,
        label: 'project/.env.vault',
        source: 'opened',
        exists: true,
      }),
    ]);
    await fs.remove(project);
    expect((await registry.list())[0].exists).toBe(false);
  });

  it('offers the configured extensions, then All files (New-48)', async () => {
    const project = path.join(dir, 'project', 'secrets.env');
    await seed(project); // an env vault under any name opens: content decides
    const dialog = pick(project);
    const registry = new EnvVaultRegistry({
      envsDir,
      dialog,
      extensions: async () => ['vault', 'envvault'],
    });
    expect((await registry.openFromDialog(null)).success).toBe(true);
    const [, options] = /** @type {any[]} */ (
      dialog.showOpenDialog.mock.calls[0]
    );
    expect(options.filters).toEqual([
      { name: 'Environment vault', extensions: ['vault', 'envvault'] },
      { name: 'All files', extensions: ['*'] },
    ]);
  });

  it('does not list an opened app-folder vault twice', async () => {
    const filePath = await seed();
    const registry = new EnvVaultRegistry({ envsDir, dialog: pick(filePath) });
    await registry.openFromDialog(null);
    expect(await registry.list()).toHaveLength(1);
  });

  it('refuses a picked file that is not an env vault, and mints no id', async () => {
    const other = path.join(dir, 'other.vault');
    await fs.writeJSON(other, { type: 'password-vault' });
    const registry = new EnvVaultRegistry({ envsDir, dialog: pick(other) });
    expect(await registry.openFromDialog(null)).toMatchObject({
      success: false,
      code: 'INVALID',
    });
    await fs.writeFile(other, 'not json');
    expect((await registry.openFromDialog(null)).code).toBe('INVALID');
    expect(await registry.list()).toEqual([]);
  });

  it('reports a canceled dialog', async () => {
    const registry = new EnvVaultRegistry({ envsDir, dialog: pick() });
    expect(await registry.openFromDialog(null)).toEqual({
      success: false,
      canceled: true,
    });
  });

  // New-22: a folder opens the vault the CLI would use there.
  describe('open a folder', () => {
    const pickFolder = (folder) => ({
      showOpenDialog: vi.fn(async () =>
        folder
          ? { canceled: false, filePaths: [folder] }
          : { canceled: true, filePaths: [] }
      ),
    });
    const openFolder = (folder) =>
      new EnvVaultRegistry({ envsDir, dialog: pickFolder(folder) });

    it("prefers the project's .env.vault over an app-folder vault of the same name", async () => {
      const project = path.join(dir, 'Superxpense');
      await seed(path.join(project, '.env.vault'));
      await seed(path.join(envsDir, 'superxpense.env.vault'));
      const registry = openFolder(project);
      const opened = await registry.openFolderFromDialog('win');
      expect(opened.success).toBe(true);
      expect(registry.resolve(opened.id)).toBe(
        path.join(project, '.env.vault')
      );
      expect(await registry.list()).toContainEqual(
        expect.objectContaining({
          id: opened.id,
          label: 'Superxpense/.env.vault',
          source: 'opened',
        })
      );
    });

    it('walks up to the git root, like the CLI', async () => {
      const repo = path.join(dir, 'repo');
      await fs.mkdirp(path.join(repo, '.git'));
      await seed(path.join(repo, '.env.vault'));
      const deep = path.join(repo, 'services', 'api');
      await fs.mkdirp(deep);
      const registry = openFolder(deep);
      const opened = await registry.openFolderFromDialog(null);
      expect(registry.resolve(opened.id)).toBe(path.join(repo, '.env.vault'));
    });

    it('finds config/.env.vault, then the app-folder vault named after the folder', async () => {
      const withConfig = path.join(dir, 'web');
      await seed(path.join(withConfig, 'config', '.env.vault'));
      let registry = openFolder(withConfig);
      let opened = await registry.openFolderFromDialog(null);
      expect(registry.resolve(opened.id)).toBe(
        path.join(withConfig, 'config', '.env.vault')
      );

      const bare = path.join(dir, 'Billing App');
      await fs.mkdirp(bare);
      await seed(path.join(envsDir, 'billing_app.env.vault'));
      registry = openFolder(bare);
      opened = await registry.openFolderFromDialog(null);
      expect(registry.resolve(opened.id)).toBe(
        path.join(envsDir, 'billing_app.env.vault')
      );
    });

    it('says where it looked when the folder has no vault', async () => {
      const repo = path.join(dir, 'empty-repo');
      await fs.mkdirp(path.join(repo, '.git'));
      const sub = path.join(repo, 'pkg');
      await fs.mkdirp(sub);
      const registry = openFolder(sub);
      const result = await registry.openFolderFromDialog(null);
      expect(result).toEqual({
        success: false,
        code: 'NOT_FOUND',
        error:
          `No environment vault found for ${sub}. Looked for .env.vault in ` +
          `it and its parents up to ${repo}, config/.env.vault, and ` +
          'pkg.env.vault in the app folder.',
      });
      expect(await registry.list()).toEqual([]);

      const alone = path.join(dir, 'alone');
      await fs.mkdirp(alone);
      expect(
        (await openFolder(alone).openFolderFromDialog(null)).error
      ).toContain(`for ${alone}. Looked for .env.vault in it, config`);
    });

    it('refuses a .env.vault that is not an env vault', async () => {
      const project = path.join(dir, 'odd');
      await fs.outputFile(path.join(project, '.env.vault'), 'API_KEY=plain');
      const registry = openFolder(project);
      expect((await registry.openFolderFromDialog(null)).code).toBe('INVALID');
      expect(await registry.list()).toEqual([]);
    });

    it('reports a canceled dialog', async () => {
      expect(await openFolder(null).openFolderFromDialog(null)).toEqual({
        success: false,
        canceled: true,
      });
    });
  });

  // Task 14: opened vaults are remembered across runs, unless turned off.
  describe('recents', () => {
    let recentsFile;
    let remember;
    beforeEach(() => {
      recentsFile = path.join(dir, 'gui-env-recents.json');
      remember = true;
    });
    /** A registry as a new app run would make it, picking `picked`. */
    const run = (...picked) =>
      new EnvVaultRegistry({
        envsDir,
        dialog: pick(...picked),
        recents: new EnvVaultRecents({ file: recentsFile }),
        remember: async () => remember,
      });

    it('lists a vault opened in an earlier run, under a new id', async () => {
      const project = await seed(path.join(dir, 'proj', '.env.vault'));
      const first = run(project);
      const opened = await first.openFromDialog(null);

      const later = run();
      const [entry] = await later.list();
      expect(entry).toMatchObject({
        label: 'proj/.env.vault',
        location: project,
        source: 'opened',
        exists: true,
      });
      expect(entry.id).not.toBe(opened.id);
      expect(later.resolve(entry.id)).toBe(project);
    });

    it('lists the most recently opened first', async () => {
      const a = await seed(path.join(dir, 'a', '.env.vault'));
      const b = await seed(path.join(dir, 'b', '.env.vault'));
      const registry = run(a);
      await registry.openFromDialog(null);
      await new Promise((r) => setTimeout(r, 5));
      const other = run(b);
      await other.openFromDialog(null);
      expect((await run().list()).map((e) => e.location)).toEqual([b, a]);
    });

    it('shows a remembered vault whose file is gone as missing', async () => {
      const project = await seed(path.join(dir, 'gone', '.env.vault'));
      await run(project).openFromDialog(null);
      await fs.remove(project);
      expect((await run().list())[0]).toMatchObject({
        location: project,
        exists: false,
      });
    });

    it('removes a vault from the list, now and in later runs', async () => {
      const project = await seed(path.join(dir, 'p', '.env.vault'));
      const registry = run(project);
      const { id } = await registry.openFromDialog(null);
      expect(await registry.forget(id)).toEqual({ success: true });
      expect(await registry.list()).toEqual([]);
      expect(await run().list()).toEqual([]);
      expect(await fs.pathExists(project)).toBe(true); // the file stays
    });

    it('removes only opened vaults', async () => {
      await seed();
      const registry = run();
      const [appFolder] = await registry.list();
      for (const id of [appFolder.id, 'nope']) {
        expect(await registry.forget(id)).toMatchObject({
          success: false,
          code: 'INVALID',
        });
      }
      expect(await registry.list()).toHaveLength(1);
    });

    it('does not remember an app-folder vault opened from the dialog', async () => {
      const filePath = await seed();
      await run(filePath).openFromDialog(null);
      expect(await fs.pathExists(recentsFile)).toBe(false);
    });

    it('with remembering off, writes nothing and lists no earlier vaults', async () => {
      const earlier = await seed(path.join(dir, 'e', '.env.vault'));
      await run(earlier).openFromDialog(null);
      const before = await fs.readFile(recentsFile, 'utf8');

      remember = false;
      const now = await seed(path.join(dir, 'n', '.env.vault'));
      const registry = run(now);
      await registry.openFromDialog(null);
      // This run's vault is listed for the run; the earlier one isn't.
      expect((await registry.list()).map((e) => e.location)).toEqual([now]);
      expect(await fs.readFile(recentsFile, 'utf8')).toBe(before);
    });

    it('clears the kept list, keeping what this run opened', async () => {
      const project = await seed(path.join(dir, 'c', '.env.vault'));
      const registry = run(project);
      await registry.openFromDialog(null);
      await registry.clearRecents();
      expect(await fs.pathExists(recentsFile)).toBe(false);
      expect(await registry.list()).toHaveLength(1);
      expect(await run().list()).toEqual([]);
    });

    it('still opens a vault when the list cannot be read or saved', async () => {
      const project = await seed(path.join(dir, 'x', '.env.vault'));
      const broken = {
        list: vi.fn(async () => {
          throw new Error('disk on fire');
        }),
        add: vi.fn(async () => {
          throw new Error('disk on fire');
        }),
      };
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const registry = new EnvVaultRegistry({
        envsDir,
        dialog: pick(project),
        recents: /** @type {any} */ (broken),
      });
      expect((await registry.openFromDialog(null)).success).toBe(true);
      expect(await registry.list()).toHaveLength(1);
      expect(errors).toHaveBeenCalled();
    });
  });

  it('reserves a new app-folder path only for a valid, unused name', async () => {
    await seed();
    const registry = new EnvVaultRegistry({ envsDir });
    const made = await registry.createInAppData('fresh');
    expect(made.path).toBe(path.join(envsDir, 'fresh.env.vault'));
    expect(registry.resolve(made.id)).toBe(made.path);
    for (const bad of ['../evil', 'a/b', '', 'x'.repeat(65), 42]) {
      expect((await registry.createInAppData(bad)).code).toBe('INVALID');
    }
    expect(await registry.createInAppData('app')).toMatchObject({
      success: false,
      error: 'A vault named "app" already exists',
    });
  });
});

describe('EnvVaultSession', () => {
  /** Fake timers we can fire by hand. */
  const timers = () => {
    const pending = new Set();
    return {
      pending,
      setTimer: (fn, ms) => {
        const timer = { fn, ms };
        pending.add(timer);
        return timer;
      },
      clearTimer: (timer) => pending.delete(timer),
      fire: () => [...pending].forEach((t) => (pending.delete(t), t.fn())),
    };
  };

  it('unlocks with the right password only', async () => {
    const filePath = await seed();
    const session = new EnvVaultSession();
    expect((await session.unlock('a', filePath, 'wrong-pass')).code).toBe(
      'AUTH'
    );
    expect(session.isUnlocked('a')).toBe(false);
    expect((await session.unlock('a', filePath, '')).code).toBe('INVALID');
    const ok = await session.unlock('a', filePath, PW);
    expect(ok).toEqual({ success: true, revision: expect.any(String) });
    expect(session.isUnlocked('a')).toBe(true);
  });

  it('refuses ops on a locked vault without calling them', async () => {
    const session = new EnvVaultSession();
    const op = vi.fn();
    expect(await session.run('nope', op)).toMatchObject({ code: 'LOCKED' });
    expect(op).not.toHaveBeenCalled();
  });

  it('locks after the idle time; touch restarts the timer', async () => {
    const filePath = await seed();
    const t = timers();
    const onLocked = vi.fn();
    const session = new EnvVaultSession({ ...t, onLocked });
    await session.unlock('a', filePath, PW);
    expect([...t.pending][0].ms).toBe(ENV_VAULT_IDLE_MS);
    session.touch('a');
    expect(t.pending.size).toBe(1); // the old timer was cleared
    t.fire();
    expect(session.isUnlocked('a')).toBe(false);
    expect(onLocked).toHaveBeenCalledWith('a', {
      reason: 'idle',
      minutes: ENV_VAULT_IDLE_MS / 60000,
    });
    session.touch('a'); // no-op once locked
    expect(t.pending.size).toBe(0);
  });

  it('takes a new idle time from Settings, restarting open timers', async () => {
    const filePath = await seed();
    const t = timers();
    const session = new EnvVaultSession({ ...t });
    await session.unlock('a', filePath, PW);
    session.setIdleMs(30 * 60 * 1000);
    expect([...t.pending].map((x) => x.ms)).toEqual([30 * 60 * 1000]);
    for (const bad of [0, -1, 1.5, 'x']) session.setIdleMs(bad);
    session.touch('a');
    expect([...t.pending].map((x) => x.ms)).toEqual([30 * 60 * 1000]);
    await session.unlock('b', filePath, PW); // later unlocks use it too
    expect([...t.pending].map((x) => x.ms)).toEqual([
      30 * 60 * 1000,
      30 * 60 * 1000,
    ]);
  });

  it('zeroes the key and drops the vault’s views on lock', async () => {
    const filePath = await seed();
    const session = new EnvVaultSession();
    await session.unlock('a', filePath, PW);
    let key = Buffer.alloc(0);
    await session.run('a', async (p, auth) => {
      key = auth.keyMaterial.key;
      return { success: true };
    });
    const viewId = session.openView('a', 'prod', 'rev');
    session.lockAll();
    expect(key).toHaveLength(32);
    expect(key.every((b) => b === 0)).toBe(true);
    expect(session.getView('a', viewId)).toBeNull();
  });

  it('keeps the key a write returns: a legacy vault edited twice needs no re-prompt', async () => {
    const filePath = await seed();
    const session = new EnvVaultSession();
    await session.unlock('a', filePath, PW);
    // Simulate a re-salt: the op returns a different key.
    const newKey = { key: Buffer.alloc(32, 7), header: { salt: 'x' } };
    let first = Buffer.alloc(0);
    await session.run('a', async (p, auth) => {
      first = auth.keyMaterial.key;
      return { success: true, keyMaterial: newKey };
    });
    expect(first).toHaveLength(32);
    expect(first.every((b) => b === 0)).toBe(true); // old key wiped
    await session.run('a', async (p, auth) => {
      expect(auth.keyMaterial).toBe(newKey);
      expect(auth.password).toBe(PW);
      return { success: true };
    });
  });

  it('says why it locked: by hand, or every vault at once (New-47)', async () => {
    const filePath = await seed();
    const onLocked = vi.fn();
    const session = new EnvVaultSession({ onLocked });
    await session.unlock('a', filePath, PW);
    session.lock('a');
    expect(onLocked).toHaveBeenLastCalledWith('a', { reason: 'user' });
    await session.unlock('a', filePath, PW);
    await session.unlock('b', filePath, PW);
    session.lockAll('sleep');
    expect(onLocked).toHaveBeenCalledWith('a', { reason: 'sleep' });
    expect(onLocked).toHaveBeenCalledWith('b', { reason: 'sleep' });
  });

  it('locks when the stored password stops working (AUTH → LOCKED)', async () => {
    const filePath = await seed();
    const onLocked = vi.fn();
    const session = new EnvVaultSession({ onLocked });
    await session.unlock('a', filePath, PW);
    const result = await session.run('a', async () => ({
      success: false,
      code: 'AUTH',
    }));
    expect(result).toMatchObject({
      code: 'LOCKED',
      reason: 'password-changed',
    });
    expect(session.isUnlocked('a')).toBe(false);
    expect(onLocked).toHaveBeenCalledWith('a', { reason: 'password-changed' });
  });

  it('opens a vault the CLI re-keyed, using the stored password', async () => {
    const filePath = await seed();
    const session = new EnvVaultSession();
    await session.unlock('a', filePath, PW);
    // Another tool re-keys the file with the same password.
    await EnvironmentVaultService.transact(filePath, PW, () => {}, {
      rekeyWith: PW,
    });
    const read = await session.run('a', (p, auth) =>
      EnvironmentVaultService.read(p, auth)
    );
    expect(read.success).toBe(true);
  });

  it('scopes views to their vault and keeps concurrent views of one env', () => {
    const session = new EnvVaultSession();
    const v1 = session.openView('a', 'prod', 'r1');
    expect(session.getView('b', v1)).toBeNull();
    // A later view of the same env must not invalidate an earlier one: the
    // calls can finish in either order (the "Unknown view" bug).
    const v2 = session.openView('a', 'prod', 'r2');
    expect(session.getView('a', v1)).toMatchObject({ revision: 'r1' });
    expect(session.getView('a', v2)).toMatchObject({ env: 'prod' });
    session.closeView('b', v2); // another vault's id can't close it
    expect(session.getView('a', v2)).not.toBeNull();
    session.closeView('a', v2);
    expect(session.getView('a', v2)).toBeNull();
  });
});

describe('EnvVaultSession view cap', () => {
  it('keeps at most MAX_VIEWS_PER_VAULT views per vault, dropping the oldest', () => {
    const session = new EnvVaultSession();
    const other = session.openView('b', 'prod', 'r');
    const ids = Array.from({ length: MAX_VIEWS_PER_VAULT + 2 }, (_, i) =>
      session.openView('a', 'prod', `r${i}`)
    );
    expect(session.getView('a', ids[0])).toBeNull();
    expect(session.getView('a', ids[1])).toBeNull();
    expect(session.getView('a', ids[2])).not.toBeNull();
    expect(session.getView('a', ids.at(-1))).not.toBeNull();
    expect(session.getView('b', other)).not.toBeNull(); // per vault
  });
});

/** A clipboard like Electron's, plus a clock we fire by hand. */
function fakeClipboard() {
  let text = '';
  const timers = [];
  return {
    clipboard: {
      writeText: (t) => {
        text = t;
      },
      readText: () => text,
    },
    timers,
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => timers.splice(timers.indexOf(timer), 1),
    fire: () => timers.splice(0).forEach((t) => t.fn()),
  };
}

describe('ClipboardService', () => {
  it('clears a copied secret after 30 s', () => {
    const fake = fakeClipboard();
    const service = new ClipboardService(fake);
    expect(service.copy('s3cret')).toEqual({ clearsInMs: CLIPBOARD_CLEAR_MS });
    expect(fake.clipboard.readText()).toBe('s3cret');
    expect(fake.timers[0].ms).toBe(30000);
    fake.fire();
    expect(fake.clipboard.readText()).toBe('');
  });

  it('leaves what the user copied afterwards', () => {
    const fake = fakeClipboard();
    new ClipboardService(fake).copy('s3cret');
    fake.clipboard.writeText('something else');
    fake.fire();
    expect(fake.clipboard.readText()).toBe('something else');
  });

  it('does not clear non-sensitive text, and a new copy replaces the timer', () => {
    const fake = fakeClipboard();
    const service = new ClipboardService(fake);
    expect(service.copy('KEY', { sensitive: false })).toEqual({
      clearsInMs: null,
    });
    expect(fake.timers).toHaveLength(0);
    service.copy('a');
    service.copy('b');
    expect(fake.timers).toHaveLength(1);
  });
});

describe('env vault IPC handlers (contract)', () => {
  let filePath;
  let registry;
  let session;
  let h;
  let id;
  let clip;
  let dialog;
  const ev = {};

  beforeEach(async () => {
    filePath = await seed();
    registry = new EnvVaultRegistry({ envsDir });
    session = new EnvVaultSession();
    clip = fakeClipboard();
    dialog = {
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: path.join(dir, 'out', 'prod.env'),
      })),
    };
    await fs.ensureDir(path.join(dir, 'out'));
    h = createEnvVaultHandlers({
      registry,
      session,
      dialog,
      clipboard: new ClipboardService(clip),
      getWindow: () => 'main-window',
    });
    id = (await h['env-vaults:list']()).vaults[0].id;
  });
  afterEach(() => session.lockAll());

  const unlock = () => h['env-vault:unlock'](ev, id, PW);

  it('refuses a forged or unknown id on every id channel', async () => {
    await unlock();
    for (const channel of [
      'env-vault:unlock',
      'env-vault:lock',
      'env:list',
      'env:view',
      'env:refresh',
      'env:reveal',
      'env:view-close',
      'env:commit',
      'env:create',
      'env:copy',
      'env:transfer',
      'env:export',
    ]) {
      expect(await h[channel](ev, filePath, 'prod')).toMatchObject({
        success: false,
        code: 'INVALID',
      });
    }
  });

  it('lists vaults with their unlocked state', async () => {
    expect((await h['env-vaults:list']()).vaults[0].unlocked).toBe(false);
    await unlock();
    expect((await h['env-vaults:list']()).vaults[0].unlocked).toBe(true);
  });

  it('refuses reads while locked', async () => {
    expect((await h['env:list'](ev, id)).code).toBe('LOCKED');
    expect((await h['env:view'](ev, id, 'prod')).code).toBe('LOCKED');
  });

  it('lists envs with their counts', async () => {
    await unlock();
    const result = await h['env:list'](ev, id);
    expect(result.envs).toEqual([
      expect.objectContaining({ name: 'base', varCount: 2, versionCount: 1 }),
      expect.objectContaining({
        name: 'prod',
        extends: 'base',
        varCount: 3,
        activeVersion: 1,
      }),
    ]);
  });

  it('views an env with no sensitive value, inherited keys marked', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(view)).not.toContain('from-base');
    expect(view.vars).toEqual([
      {
        key: 'API_KEY',
        sensitive: true,
        required: true,
        comment: '',
        inheritedFrom: null,
      },
      {
        key: 'HOST',
        value: 'prod.example',
        sensitive: false,
        required: false,
        comment: '',
        inheritedFrom: null,
      },
      {
        key: 'LOG_LEVEL',
        value: 'debug',
        sensitive: false,
        required: false,
        comment: '',
        inheritedFrom: 'base',
      },
      // The child's own value wins over the parent's.
      {
        key: 'SHARED',
        sensitive: true,
        required: false,
        comment: '',
        inheritedFrom: null,
      },
    ]);
    expect((await h['env:view'](ev, id, 'nope')).code).toBe('NOT_FOUND');
  });

  it('reveals one value, unless that key changed since it was shown', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    expect(await h['env:reveal'](ev, id, view.viewId, 'API_KEY')).toEqual({
      success: true,
      value: SECRET,
    });
    expect((await h['env:reveal'](ev, id, view.viewId, 'NOPE')).code).toBe(
      'NOT_FOUND'
    );
    expect((await h['env:reveal'](ev, id, 'bogus', 'API_KEY')).code).toBe(
      'INVALID'
    );
    // New-31: another key changing doesn't block it; this one does.
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    expect((await h['env:reveal'](ev, id, view.viewId, 'API_KEY')).value).toBe(
      SECRET
    );
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'API_KEY', 'k2');
    expect(await h['env:reveal'](ev, id, view.viewId, 'API_KEY')).toMatchObject(
      { success: false, code: 'STALE', changed: ['API_KEY'] }
    );
    expect(
      JSON.stringify(await h['env:reveal'](ev, id, view.viewId, 'API_KEY'))
    ).not.toContain('k2');
  });

  it('commits against the view’s base and refuses a stale one', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    const set = (value) => ({
      viewId: view.viewId,
      ops: [{ op: 'set', key: 'API_KEY', value, sensitive: true }],
    });
    const first = await h['env:commit'](ev, id, set('v1'));
    expect(first).toMatchObject({ success: true, rebased: false });
    // The view follows its own write, so a second edit isn't stale.
    expect((await h['env:commit'](ev, id, set('v2'))).success).toBe(true);

    // Another key changed elsewhere: the edit merges in (Task 10).
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'CLI', 'c');
    const merged = await h['env:commit'](ev, id, set('v3'));
    expect(merged).toMatchObject({ success: true, rebased: true });
    let read = await EnvironmentVaultService.read(filePath, PW);
    expect(read.vault.getActiveVersion('prod').vars).toMatchObject({
      API_KEY: 'v3',
      CLI: 'c',
    });

    // The same key changed elsewhere: a conflict, nothing written.
    await EnvironmentVaultService.setEnv(
      filePath,
      PW,
      'prod',
      'API_KEY',
      'cli'
    );
    const before = await fs.readFile(filePath);
    const conflict = await h['env:commit'](ev, id, set('v4'));
    expect(conflict).toMatchObject({
      success: false,
      code: 'CONFLICT',
      conflicts: [{ key: 'API_KEY', kind: 'changed' }],
    });
    expect(conflict.error).toBe('Changed elsewhere meanwhile: API_KEY');
    expect((await fs.readFile(filePath)).equals(before)).toBe(true);

    // force keeps the user's version.
    const forced = await h['env:commit'](ev, id, { ...set('v4'), force: true });
    expect(forced.success).toBe(true);
    read = await EnvironmentVaultService.read(filePath, PW);
    expect(read.vault.getActiveVersion('prod').vars.API_KEY).toBe('v4');
  });

  it('names each kind of conflict, and a deleted env', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'NEW', 'cli');
    await EnvironmentVaultService.removeKey(filePath, PW, 'prod', 'HOST');
    const result = await h['env:commit'](ev, id, {
      viewId: view.viewId,
      ops: [
        { op: 'set', key: 'NEW', value: 'mine' },
        { op: 'set', key: 'HOST', value: 'mine' },
        { op: 'set', key: 'SHARED', value: 'untouched elsewhere' },
      ],
    });
    expect(result.conflicts).toEqual([
      { key: 'NEW', kind: 'added' },
      { key: 'HOST', kind: 'removed' },
    ]);

    await EnvironmentVaultService.deleteEnv(filePath, PW, 'prod');
    const gone = await h['env:commit'](ev, id, {
      viewId: view.viewId,
      ops: [{ op: 'set', key: 'SHARED', value: 'x' }],
    });
    expect(gone).toMatchObject({
      code: 'CONFLICT',
      conflicts: [{ key: null, kind: 'env-gone' }],
      error: 'prod was deleted elsewhere',
    });
  });

  it('gives the own variables as .env text for bulk edit', async () => {
    await unlock();
    await EnvironmentVaultService.setEnv(
      filePath,
      PW,
      'prod',
      'HOST',
      'prod.example',
      {
        comment: 'Public host',
      }
    );
    const view = await h['env:view'](ev, id, 'prod');
    const result = await h['env:edit-text'](ev, id, view.viewId);
    expect(result.text).toBe(
      `API_KEY=${SECRET}\n# Public host\nHOST=prod.example\nSHARED=own\n`
    );
    expect((await h['env:edit-text'](ev, id, 'nope')).code).toBe('INVALID');
  });

  it('reports a bad changeset without writing', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    const before = await fs.readFile(filePath);
    const bad = await h['env:commit'](ev, id, {
      viewId: view.viewId,
      ops: [{ op: 'rm', key: 'NOPE' }],
    });
    expect(bad).toMatchObject({ success: false, code: 'ERROR' });
    expect((await h['env:commit'](ev, id, { viewId: 'x', ops: [] })).code).toBe(
      'INVALID'
    );
    expect((await fs.readFile(filePath)).equals(before)).toBe(true);
  });

  it('only input on the screen resets the idle timer; calls never do', async () => {
    await unlock();
    const touch = vi.spyOn(session, 'touch');
    const view = await h['env:view'](ev, id, 'prod');
    await h['env:list'](ev, id); // what the page runs on a CLI change
    await h['env:refresh'](ev, id, view.viewId);
    await h['env:reveal'](ev, id, view.viewId, 'API_KEY');
    expect(touch).not.toHaveBeenCalled();
    expect((await h['env:refresh'](ev, id, 'bogus')).code).toBe('INVALID');

    expect(await h['env-vaults:activity'](ev, id)).toEqual({ success: true });
    expect(touch).toHaveBeenCalledExactlyOnceWith(id);
    // An unknown id: nothing to keep open, nothing to report.
    expect((await h['env-vaults:activity'](ev, 'nope')).success).toBe(true);
  });

  it('closes views and locks', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    expect(await h['env:view-close'](ev, id, view.viewId)).toEqual({
      success: true,
    });
    expect((await h['env:refresh'](ev, id, view.viewId)).code).toBe('INVALID');
    expect(await h['env-vault:lock'](ev, id)).toEqual({ success: true });
    expect((await h['env:list'](ev, id)).code).toBe('LOCKED');
  });

  it('creates an env, checking the name and the revision', async () => {
    await unlock();
    const { revision } = await h['env:list'](ev, id);
    expect((await h['env:create'](ev, id, '../x', revision)).code).toBe(
      'INVALID'
    );
    const made = await h['env:create'](ev, id, 'staging', revision);
    expect(made.success).toBe(true);
    expect((await h['env:create'](ev, id, 'qa', revision)).code).toBe('STALE');
    expect((await h['env:create'](ev, id, 'staging')).code).toBe('ERROR');
    const names = (await h['env:list'](ev, id)).envs.map((e) => e.name);
    expect(names).toEqual(['base', 'prod', 'staging']);
  });

  it('creates a vault in the app folder and leaves it unlocked', async () => {
    const made = await h['env-vaults:create'](
      ev,
      { mode: 'appdata', name: 'fresh' },
      PW
    );
    expect(made.success).toBe(true);
    expect(session.isUnlocked(made.id)).toBe(true);
    expect(registry.resolve(made.id)).toBe(
      path.join(envsDir, 'fresh.env.vault')
    );
    expect((await h['env-vaults:create'](ev, { mode: 'cloud' }, PW)).code).toBe(
      'INVALID'
    );
    expect(
      (await h['env-vaults:create'](ev, { mode: 'appdata', name: 'w' }, 'weak'))
        .code
    ).toBe('INVALID');
    expect(await fs.pathExists(path.join(envsDir, 'w.env.vault'))).toBe(false);
  });

  describe('create where the user picks (Task 14)', () => {
    let saveTo;
    let dialog;
    let handlers;
    let reg;
    beforeEach(() => {
      saveTo = path.join(dir, 'Superxpense', '.env.vault');
      dialog = {
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(async () =>
          saveTo ? { canceled: false, filePath: saveTo } : { canceled: true }
        ),
      };
      reg = new EnvVaultRegistry({ envsDir, dialog });
      handlers = createEnvVaultHandlers({
        registry: reg,
        session,
        getWindow: () => 'main-window',
      });
    });
    const create = (password = PW) =>
      handlers['env-vaults:create'](ev, { mode: 'dialog' }, password);

    it('creates it there, unlocked, and lists it as opened', async () => {
      const made = await create();
      expect(made.success).toBe(true);
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        'main-window',
        expect.objectContaining({ defaultPath: '.env.vault' })
      );
      expect(reg.resolve(made.id)).toBe(saveTo);
      expect(session.isUnlocked(made.id)).toBe(true);
      expect((await fs.readJSON(saveTo)).type).toBe('environment-vault');
      expect(await reg.list()).toContainEqual(
        expect.objectContaining({
          id: made.id,
          label: 'Superxpense/.env.vault',
          source: 'opened',
        })
      );
    });

    it('never replaces an existing file', async () => {
      await fs.outputFile(saveTo, 'keep me');
      const result = await create();
      expect(result).toMatchObject({ success: false, code: 'INVALID' });
      expect(result.error).toContain('already exists. Open it with Open…');
      expect(await fs.readFile(saveTo, 'utf8')).toBe('keep me');
    });

    it('checks the password before asking where', async () => {
      expect((await create('weak')).code).toBe('INVALID');
      expect((await create(/** @type {any} */ (null))).error).toBe(
        'Enter a password'
      );
      expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    });

    it('reports a canceled dialog and writes nothing', async () => {
      saveTo = null;
      expect(await create()).toEqual({ success: false, canceled: true });
    });
  });

  it('opens through the registry dialog with the window as parent', async () => {
    const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true })) };
    const withDialog = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir, dialog }),
      session,
      getWindow: () => 'main-window',
    });
    expect(await withDialog['env-vaults:open']()).toMatchObject({
      canceled: true,
    });
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      'main-window',
      expect.anything()
    );
  });

  it('removes an opened vault from the list, but not while it is unlocked', async () => {
    const project = await seed(path.join(dir, 'proj', '.env.vault'));
    const reg = new EnvVaultRegistry({
      envsDir,
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [project] }),
      },
    });
    const handlers = createEnvVaultHandlers({
      registry: reg,
      session,
      getWindow: () => null,
    });
    const opened = await handlers['env-vaults:open']();
    await handlers['env-vault:unlock'](ev, opened.id, PW);
    expect(await handlers['env-vaults:forget'](ev, opened.id)).toMatchObject({
      success: false,
      code: 'INVALID',
      error: 'Lock the vault before removing it from the list',
    });
    await handlers['env-vault:lock'](ev, opened.id);
    expect(await handlers['env-vaults:forget'](ev, opened.id)).toEqual({
      success: true,
    });
    const listed = (await handlers['env-vaults:list']()).vaults;
    expect(listed.map((v) => v.location)).not.toContain(project);
  });

  it('opens a folder through the registry with the window as parent', async () => {
    const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true })) };
    const withDialog = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir, dialog }),
      session,
      getWindow: () => 'main-window',
    });
    expect(await withDialog['env-vaults:open-folder']()).toMatchObject({
      canceled: true,
    });
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      'main-window',
      expect.objectContaining({ properties: ['openDirectory'] })
    );
  });

  const activeVars = async (env) =>
    (await EnvironmentVaultService.read(filePath, PW)).vault.getActiveVersion(
      env
    )?.vars ?? {};

  it('copies a value, a KEY=value pair or a key name without returning it', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    const copied = await h['env:copy'](ev, id, view.viewId, 'API_KEY');
    expect(copied).toEqual({ success: true, clearsInMs: 30000 });
    expect(JSON.stringify(copied)).not.toContain(SECRET);
    expect(clip.clipboard.readText()).toBe(SECRET);

    await h['env:copy'](ev, id, view.viewId, 'API_KEY', 'pair');
    expect(clip.clipboard.readText()).toBe(`API_KEY=${SECRET}`);

    // A key name or a public value isn't a secret: no clearing.
    expect(await h['env:copy'](ev, id, view.viewId, 'API_KEY', 'key')).toEqual({
      success: true,
      clearsInMs: null,
    });
    expect(clip.clipboard.readText()).toBe('API_KEY');
    expect(
      (await h['env:copy'](ev, id, view.viewId, 'LOG_LEVEL')).clearsInMs
    ).toBeNull();
    expect(clip.clipboard.readText()).toBe('debug'); // inherited value

    expect(
      (await h['env:copy'](ev, id, view.viewId, 'API_KEY', 'html')).code
    ).toBe('INVALID');
    expect((await h['env:copy'](ev, id, view.viewId, 'NOPE')).code).toBe(
      'NOT_FOUND'
    );
    expect((await h['env:copy'](ev, id, 'bogus', 'API_KEY')).code).toBe(
      'INVALID'
    );
    // New-31: per key, inherited ones included.
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    expect((await h['env:copy'](ev, id, view.viewId, 'API_KEY')).success).toBe(
      true
    );
    await EnvironmentVaultService.setEnv(
      filePath,
      PW,
      'base',
      'LOG_LEVEL',
      'warn',
      { isPublic: true }
    );
    expect((await h['env:copy'](ev, id, view.viewId, 'LOG_LEVEL')).code).toBe(
      'STALE'
    );
    expect(clip.clipboard.readText()).toBe(SECRET);
  });

  it('copies keys to another env, keeping their sensitivity', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    const result = await h['env:transfer'](ev, id, {
      viewId: view.viewId,
      keys: ['API_KEY', 'HOST', 'LOG_LEVEL'],
      target: 'base',
    });
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(result.error).toBe('base already has LOG_LEVEL');

    const ok = await h['env:transfer'](ev, id, {
      viewId: view.viewId,
      keys: ['API_KEY', 'HOST'],
      target: 'base',
    });
    expect(ok.success).toBe(true);
    const read = await EnvironmentVaultService.read(filePath, PW);
    const base = read.vault.getActiveVersion('base');
    expect(base.vars).toMatchObject({ API_KEY: SECRET, HOST: 'prod.example' });
    expect(base.nonSensitive.sort()).toEqual(['HOST', 'LOG_LEVEL']);
    expect((await activeVars('prod')).API_KEY).toBe(SECRET); // copy keeps it
    // The view followed its own write.
    expect((await h['env:reveal'](ev, id, view.viewId, 'HOST')).success).toBe(
      true
    );
  });

  it('moves keys, overwriting only when asked', async () => {
    await unlock();
    await EnvironmentVaultService.setEnv(filePath, PW, 'base', 'HOST', 'old');
    const view = await h['env:view'](ev, id, 'prod');
    const move = (overwrite) =>
      h['env:transfer'](ev, id, {
        viewId: view.viewId,
        keys: ['HOST', 'API_KEY'],
        target: 'base',
        mode: 'move',
        overwrite,
      });
    expect((await move(false)).code).toBe('CONFLICT');
    expect((await activeVars('base')).HOST).toBe('old');
    expect((await move(true)).success).toBe(true);
    expect(await activeVars('base')).toMatchObject({
      HOST: 'prod.example',
      API_KEY: SECRET,
    });
    expect(Object.keys(await activeVars('prod'))).toEqual(['SHARED']);
  });

  it('refuses a bad transfer without writing', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    const before = await fs.readFile(filePath);
    const transfer = (request) =>
      h['env:transfer'](ev, id, { viewId: view.viewId, ...request });
    expect(
      (await transfer({ keys: ['LOG_LEVEL'], target: 'base', mode: 'move' }))
        .error
    ).toBe("'LOG_LEVEL' is inherited from base; copy it instead");
    expect((await transfer({ keys: ['NOPE'], target: 'base' })).error).toBe(
      "Key 'NOPE' not found"
    );
    expect((await transfer({ keys: ['HOST'], target: 'qa' })).error).toBe(
      "Environment 'qa' not found"
    );
    expect((await transfer({ keys: ['HOST'], target: 'prod' })).code).toBe(
      'INVALID'
    );
    expect((await transfer({ keys: [], target: 'base' })).code).toBe('INVALID');
    expect(
      (await transfer({ keys: ['HOST'], target: 'base', mode: 'swap' })).code
    ).toBe('INVALID');
    expect(
      (await h['env:transfer'](ev, id, { viewId: 'x', keys: ['HOST'] })).code
    ).toBe('INVALID');
    expect((await fs.readFile(filePath)).equals(before)).toBe(true);

    // New-31: a change to a key it moves blocks it, with the key named.
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'HOST', 'h9');
    const stale = await transfer({ keys: ['HOST'], target: 'base' });
    expect(stale).toMatchObject({ code: 'STALE', changed: ['HOST'] });
    expect(stale.error).toBe('Changed elsewhere meanwhile: HOST');
  });

  it('transfers over a change to other keys made elsewhere (New-31)', async () => {
    await unlock();
    const view = await h['env:view'](ev, id, 'prod');
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    const moved = await h['env:transfer'](ev, id, {
      viewId: view.viewId,
      keys: ['HOST'],
      target: 'base',
      mode: 'move',
    });
    expect(moved.success).toBe(true);
    const vault = (await EnvironmentVaultService.read(filePath, PW)).vault;
    expect(vault.getActiveVersion('prod').vars).not.toHaveProperty('HOST');
    expect(vault.getActiveVersion('prod').vars.X).toBe('1'); // kept
    expect(vault.getActiveVersion('base').vars).toHaveProperty('HOST');
  });

  it('exports an env, resolved, to the file picked in the dialog, mode 0600', async () => {
    await unlock();
    const out = path.join(dir, 'out', 'prod.env');
    const result = await h['env:export'](ev, id, 'prod');
    expect(result).toEqual({ success: true, path: out });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      'main-window',
      expect.objectContaining({ defaultPath: 'prod.env' })
    );
    const content = await fs.readFile(out, 'utf8');
    expect(content).toContain(`API_KEY=${SECRET}`);
    expect(content).toContain('LOG_LEVEL=debug'); // inherited
    expect(content).toContain('SHARED=own'); // child wins
    if (process.platform !== 'win32') {
      expect((await fs.stat(out)).mode & 0o777).toBe(0o600);
      // An existing file is narrowed to 0600 too.
      await fs.chmod(out, 0o644);
      await h['env:export'](ev, id, 'prod');
      expect((await fs.stat(out)).mode & 0o777).toBe(0o600);
    }
  });

  it('exports as JSON, as `vault env export -f json` prints it (New-35)', async () => {
    await unlock();
    dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(dir, 'out', 'prod.json'),
    });
    const result = await h['env:export'](ev, id, 'prod', 'json');
    expect(result).toEqual({
      success: true,
      path: path.join(dir, 'out', 'prod.json'),
    });
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(
      'main-window',
      expect.objectContaining({
        title: 'Export prod as JSON',
        defaultPath: 'prod.json',
      })
    );
    const cli = await EnvironmentVaultService.exportEnv(
      filePath,
      PW,
      'prod',
      'json'
    );
    const content = await fs.readFile(
      path.join(dir, 'out', 'prod.json'),
      'utf8'
    );
    expect(content).toBe(`${JSON.stringify(cli.data, null, 2)}\n`);
    expect(JSON.parse(content)).toMatchObject({
      API_KEY: SECRET,
      LOG_LEVEL: 'debug',
    });
    if (process.platform !== 'win32') {
      expect(
        (await fs.stat(path.join(dir, 'out', 'prod.json'))).mode & 0o777
      ).toBe(0o600);
    }
    expect((await h['env:export'](ev, id, 'prod', 'yaml')).code).toBe(
      'INVALID'
    );
  });

  it('reports a canceled export, a missing env, and a locked vault', async () => {
    expect((await h['env:export'](ev, id, 'prod')).code).toBe('LOCKED');
    await unlock();
    expect((await h['env:export'](ev, id, 'nope')).code).toBe('NOT_FOUND');
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await h['env:export'](ev, id, 'prod')).toEqual({
      success: false,
      canceled: true,
    });
    dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(dir, 'no', 'such', 'dir', 'x.env'),
    });
    expect((await h['env:export'](ev, id, 'prod')).code).toBe('ERROR');
  });

  it('locks the vault when its password was changed elsewhere', async () => {
    await unlock();
    await EnvironmentVaultService.changePassword(filePath, PW, 'Other-Pass-9!');
    expect((await h['env:list'](ev, id)).code).toBe('LOCKED');
    expect(session.isUnlocked(id)).toBe(false);
  });
});

describe('env vault IPC: key comments', () => {
  const ev = {};
  let h;
  let id;
  let session;
  let filePath;

  beforeEach(async () => {
    filePath = await seed();
    session = new EnvVaultSession();
    h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
    });
    id = (await h['env-vaults:list']()).vaults[0].id;
    await h['env-vault:unlock'](ev, id, PW);
  });
  afterEach(() => session.lockAll());

  const rows = async (env) => (await h['env:view'](ev, id, env)).vars;

  it('shows comments, unmasked, and edits them through env:commit', async () => {
    const view = await h['env:view'](ev, id, 'prod');
    expect(view.vars.every((r) => r.comment === '')).toBe(true);
    const result = await h['env:commit'](ev, id, {
      viewId: view.viewId,
      ops: [
        {
          op: 'set',
          key: 'API_KEY',
          value: SECRET,
          comment: 'Rotate after offboarding',
        },
      ],
    });
    expect(result.success).toBe(true);
    const apiKey = (await rows('prod')).find((r) => r.key === 'API_KEY');
    expect(apiKey).toMatchObject({ comment: 'Rotate after offboarding' });
    expect(apiKey).not.toHaveProperty('value');
  });

  it('carries a comment when a key is copied to another env', async () => {
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'HOST', 'h', {
      isPublic: true,
      comment: 'Behind the VPN',
    });
    const view = await h['env:view'](ev, id, 'prod');
    const result = await h['env:transfer'](ev, id, {
      viewId: view.viewId,
      keys: ['HOST'],
      target: 'base',
    });
    expect(result.success).toBe(true);
    expect((await rows('base')).find((r) => r.key === 'HOST').comment).toBe(
      'Behind the VPN'
    );
  });
});

describe('env vault IPC: unlock message and export comments', () => {
  const ev = {};

  it('says which file a wrong password was for, typo first (New-23)', async () => {
    await seed();
    const session = new EnvVaultSession();
    const h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
    });
    const id = (await h['env-vaults:list']()).vaults[0].id;
    const result = await h['env-vault:unlock'](ev, id, 'not-the-password');
    expect(result).toMatchObject({ success: false, code: 'AUTH' });
    expect(result.error).toBe(
      "Wrong password for app.env.vault. If you're sure it's right, the file may be damaged."
    );
  });

  it('writes key comments into an exported .env', async () => {
    const filePath = await seed();
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'HOST', 'h', {
      comment: 'Behind the VPN',
    });
    const session = new EnvVaultSession();
    const out = path.join(dir, 'prod.env');
    const h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
      dialog: {
        showSaveDialog: async () => ({ canceled: false, filePath: out }),
      },
    });
    const id = (await h['env-vaults:list']()).vaults[0].id;
    await h['env-vault:unlock'](ev, id, PW);
    expect((await h['env:export'](ev, id, 'prod')).success).toBe(true);
    expect(await fs.readFile(out, 'utf8')).toContain(
      '# Behind the VPN\nHOST=h\n'
    );
    session.lockAll();
  });
});

describe('env vault IPC: env management, history, watcher (Tasks 16, 24, 25)', () => {
  const ev = {};
  let h;
  let id;
  let session;
  let filePath;
  let watcher;

  beforeEach(async () => {
    filePath = await seed();
    session = new EnvVaultSession();
    watcher = /** @type {any} */ ({
      start: vi.fn(),
      note: vi.fn(),
      stop: vi.fn(),
    });
    h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
      watcher,
    });
    id = (await h['env-vaults:list']()).vaults[0].id;
    await h['env-vault:unlock'](ev, id, PW);
  });
  afterEach(() => session.lockAll());

  const rev = async () => (await h['env:list'](ev, id)).revision;
  const manage = async (request) =>
    h['env:manage'](ev, id, { expectedRevision: await rev(), ...request });
  const loaded = async () =>
    (await EnvironmentVaultService.read(filePath, PW)).vault;

  it('starts the watcher on unlock and notes every revision the app sees', async () => {
    expect(watcher.start).toHaveBeenCalledWith(
      id,
      filePath,
      expect.stringMatching(/^sha256:/)
    );
    const r = await rev();
    expect(watcher.note).toHaveBeenCalledWith(id, r);
    const result = await manage({
      op: 'describe',
      env: 'prod',
      description: 'Live',
    });
    expect(watcher.note).toHaveBeenLastCalledWith(id, result.revision);
  });

  it('renames an env, and the envs extending it follow', async () => {
    const result = await manage({ op: 'rename', env: 'base', name: 'common' });
    expect(result.success).toBe(true);
    const vault = await loaded();
    expect(vault.listEnvironmentNames()).toEqual(['common', 'prod']);
    expect(vault.environments.prod.extends).toBe('common');
  });

  it('counts references to an env, names and counts only (New-30)', async () => {
    await EnvironmentVaultService.setEnv(
      filePath,
      PW,
      'prod',
      'DSN',
      '{{env:base/LOG_LEVEL}}-{{env:base/LOG_LEVEL}}'
    );
    expect(await h['env:references'](ev, id, 'base')).toEqual({
      success: true,
      references: [{ env: 'prod', count: 2 }],
    });
    expect(await h['env:references'](ev, id, 'prod')).toEqual({
      success: true,
      references: [],
    });
    expect((await h['env:references'](ev, id, 'ghost')).code).toBe('NOT_FOUND');
    expect((await h['env:references'](ev, id, 42)).code).toBe('INVALID');
    session.lock(id);
    expect((await h['env:references'](ev, id, 'base')).code).toBe('LOCKED');
  });

  it('renames with the references, in one write, when asked (New-30)', async () => {
    await EnvironmentVaultService.setEnv(
      filePath,
      PW,
      'prod',
      'DSN',
      'log={{env:base/LOG_LEVEL}}'
    );
    const before = (await loaded()).getHistory('prod').length;
    const result = await manage({
      op: 'rename',
      env: 'base',
      name: 'common',
      updateReferences: true,
    });
    expect(result).toMatchObject({
      success: true,
      updated: [{ env: 'prod', count: 1 }],
    });
    const vault = await loaded();
    expect(vault.getActiveVersion('prod').vars.DSN).toBe(
      'log={{env:common/LOG_LEVEL}}'
    );
    expect(vault.getHistory('prod')).toHaveLength(before + 1);
    expect(
      new EnvironmentResolver(vault).resolveEnvironment('prod').DSN
    ).toMatch(/^log=/);
  });

  it('leaves the references alone unless asked', async () => {
    await EnvironmentVaultService.setEnv(
      filePath,
      PW,
      'prod',
      'DSN',
      'log={{env:base/LOG_LEVEL}}'
    );
    let env = 'base';
    for (const [name, updateReferences] of /** @type {[string, any][]} */ ([
      ['c1', undefined],
      ['c2', false],
      ['c3', 'yes'], // only `true` counts
    ])) {
      const result = await manage({
        op: 'rename',
        env,
        name,
        updateReferences,
      });
      expect(result).toMatchObject({ success: true, updated: [] });
      env = name;
    }
    expect((await loaded()).getActiveVersion('prod').vars.DSN).toBe(
      'log={{env:base/LOG_LEVEL}}'
    );
  });

  it('duplicates an env with its flags, comments and parent', async () => {
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'HOST', 'h', {
      comment: 'note',
    });
    expect(
      (await manage({ op: 'duplicate', env: 'prod', name: 'prod-2' })).success
    ).toBe(true);
    const vault = await loaded();
    const copy = vault.getActiveVersion('prod-2');
    expect(copy.vars).toEqual(vault.getActiveVersion('prod').vars);
    expect(copy.nonSensitive).toEqual(['HOST']);
    expect(copy.comments).toEqual({ HOST: 'note' });
    expect(vault.environments['prod-2'].extends).toBe('base');
  });

  it('refuses to delete an env others extend; deletes it with a snapshot otherwise', async () => {
    const refused = await manage({ op: 'delete', env: 'base' });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain('prod extends base; change that first');
    expect((await manage({ op: 'delete', env: 'prod' })).success).toBe(true);
    expect((await loaded()).listEnvironmentNames()).toEqual(['base']);
    expect(
      (await fs.readdir(envsDir)).some((n) => n.includes('.deleted.'))
    ).toBe(true);
  });

  it('sets and clears a parent, refusing a loop', async () => {
    const loop = await manage({ op: 'extends', env: 'base', parent: 'prod' });
    expect(loop.success).toBe(false);
    expect(loop.error).toContain('prod already extends base');
    expect(
      (await manage({ op: 'extends', env: 'prod', parent: null })).success
    ).toBe(true);
    expect((await loaded()).environments.prod.extends).toBeNull();
  });

  it('validates input and refuses a stale list', async () => {
    expect((await manage({ op: 'explode', env: 'prod' })).code).toBe('INVALID');
    expect(
      (await manage({ op: 'rename', env: 'prod', name: 'bad name' })).code
    ).toBe('INVALID');
    expect(
      (
        await manage({
          op: 'describe',
          env: 'prod',
          description: 'x'.repeat(501),
        })
      ).code
    ).toBe('INVALID');
    expect((await manage({ op: 'describe', env: 42 })).code).toBe('INVALID');
    const old = await rev();
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    const stale = await h['env:manage'](ev, id, {
      op: 'describe',
      env: 'prod',
      description: 'late',
      expectedRevision: old,
    });
    expect(stale.code).toBe('STALE');
    expect(
      (await manage({ op: 'rename', env: 'ghost', name: 'g2' })).success
    ).toBe(false);
  });

  it('lists history without values, rolls back and squashes against the view', async () => {
    await EnvironmentVaultService.setEnv(
      filePath,
      PW,
      'prod',
      'API_KEY',
      'v2-secret'
    );
    const view = await h['env:view'](ev, id, 'prod');
    const history = await h['env:history'](ev, id, view.viewId);
    expect(history.versions.map((v) => v.n)).toEqual([2, 1]);
    expect(history.versions[0]).toMatchObject({
      isActive: true,
      keys: ['API_KEY', 'HOST', 'SHARED'],
    });
    expect(JSON.stringify(history)).not.toMatch(/secret/);

    const rolled = await h['env:rollback'](ev, id, view.viewId, 1);
    expect(rolled.success).toBe(true);
    expect((await loaded()).getActiveVersion('prod').vars.API_KEY).toBe(SECRET);

    const squashed = await h['env:squash'](ev, id, view.viewId, 1);
    expect(squashed.success).toBe(true);
    expect(squashed.snapshot).toMatch(/^app\.env\.vault\.squashed\./);
    expect((await loaded()).getHistory('prod')).toHaveLength(1);
  });

  it('refuses history ops on an unknown view, bad input or a stale view', async () => {
    const view = await h['env:view'](ev, id, 'prod');
    expect((await h['env:history'](ev, id, 'nope')).code).toBe('INVALID');
    expect((await h['env:rollback'](ev, id, 'nope', 1)).code).toBe('INVALID');
    expect((await h['env:squash'](ev, id, 'nope', 1)).code).toBe('INVALID');
    expect((await h['env:rollback'](ev, id, view.viewId, '1')).code).toBe(
      'INVALID'
    );
    expect((await h['env:squash'](ev, id, view.viewId, 0)).code).toBe(
      'INVALID'
    );
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    expect((await h['env:rollback'](ev, id, view.viewId, 1)).code).toBe(
      'STALE'
    );
    expect((await h['env:squash'](ev, id, view.viewId, 1)).code).toBe('STALE');
    expect(
      (await fs.readdir(envsDir)).some((n) => n.includes('.squashed.'))
    ).toBe(false);
  });
});

describe('env vault IPC: compare, validate, import, template, password (Tasks 26–28)', () => {
  const ev = {};
  let h;
  let id;
  let session;
  let filePath;
  let picked;
  let saved;

  beforeEach(async () => {
    filePath = await seed();
    session = new EnvVaultSession();
    picked = null;
    saved = path.join(dir, 'out.env');
    h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
      dialog: {
        showOpenDialog: async () =>
          picked
            ? { canceled: false, filePaths: [picked] }
            : { canceled: true, filePaths: [] },
        showSaveDialog: async () => ({ canceled: false, filePath: saved }),
      },
    });
    id = (await h['env-vaults:list']()).vaults[0].id;
    await h['env-vault:unlock'](ev, id, PW);
  });
  afterEach(() => session.lockAll());

  const active = async (env) =>
    (await EnvironmentVaultService.read(filePath, PW)).vault.getActiveVersion(
      env
    );

  it('compares two envs, masked unless asked', async () => {
    const masked = await h['env:diff'](ev, id, 'base', 'prod');
    expect(masked).toMatchObject({
      success: true,
      added: ['API_KEY', 'HOST'],
      removed: [],
      changed: [{ key: 'SHARED' }],
      unchanged: 1,
    });
    expect(JSON.stringify(masked)).not.toContain('from-base');
    const shown = await h['env:diff'](ev, id, 'base', 'prod', { reveal: true });
    expect(shown.changed).toEqual([
      { key: 'SHARED', valueA: 'from-base', valueB: 'own' },
    ]);
    expect((await h['env:diff'](ev, id, 'base', 'ghost')).success).toBe(false);
  });

  it('validates an env', async () => {
    const ok = await h['env:validate'](ev, id, 'prod');
    expect(ok).toMatchObject({ success: true, errors: [], requiredCount: 1 });
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'API_KEY', '');
    const bad = await h['env:validate'](ev, id, 'prod');
    expect(bad.errors).toContain('Required key is empty: API_KEY');
    expect((await h['env:validate'](ev, id, 'ghost')).success).toBe(false);
  });

  it('previews an import by key name only, then merges the chosen keys', async () => {
    picked = path.join(dir, 'in.env');
    await fs.writeFile(
      picked,
      `# rotated\nAPI_KEY=new-secret\nHOST=prod.example\nADDED="multi\nline"\nbad line\n`
    );
    const view = await h['env:view'](ev, id, 'prod');
    const preview = await h['env:import-pick'](ev, id, view.viewId);
    expect(preview).toMatchObject({
      success: true,
      fileName: 'in.env',
      keys: [
        { key: 'ADDED', status: 'new', comment: '' },
        { key: 'API_KEY', status: 'changed', comment: 'rotated' },
        { key: 'HOST', status: 'same', comment: '' },
      ],
      absent: ['SHARED'],
      warnings: [{ line: 6, message: 'Not KEY=value; skipped' }],
    });
    expect(JSON.stringify(preview)).not.toMatch(/new-secret|multi/);

    const applied = await h['env:import-apply'](ev, id, preview.token, {
      keys: ['ADDED', 'API_KEY'],
      comments: true,
    });
    expect(applied).toMatchObject({ success: true, count: 2 });
    const now = await active('prod');
    expect(now.vars).toMatchObject({
      API_KEY: 'new-secret',
      ADDED: 'multi\nline',
      SHARED: 'own',
    });
    expect(now.comments).toEqual({ API_KEY: 'rotated' });
    expect(now.nonSensitive).toEqual(['HOST']); // flags kept
    // A token works once.
    expect((await h['env:import-apply'](ev, id, preview.token)).code).toBe(
      'INVALID'
    );
  });

  it('replace removes the own keys the file lacks', async () => {
    picked = path.join(dir, 'in.env');
    await fs.writeFile(picked, 'HOST=h2\n');
    const view = await h['env:view'](ev, id, 'prod');
    const preview = await h['env:import-pick'](ev, id, view.viewId);
    await h['env:import-apply'](ev, id, preview.token, { mode: 'replace' });
    expect((await active('prod')).vars).toEqual({ HOST: 'h2' });
  });

  it('import: canceled pick, cancel, a key changed meanwhile, bad mode', async () => {
    const view = await h['env:view'](ev, id, 'prod');
    expect(await h['env:import-pick'](ev, id, view.viewId)).toEqual({
      success: false,
      canceled: true,
    });
    picked = path.join(dir, 'in.env');
    await fs.writeFile(picked, 'HOST=h2\n');
    let preview = await h['env:import-pick'](ev, id, view.viewId);
    await h['env:import-cancel'](ev, id, preview.token);
    expect((await h['env:import-apply'](ev, id, preview.token)).code).toBe(
      'INVALID'
    );

    preview = await h['env:import-pick'](ev, id, view.viewId);
    expect(
      (await h['env:import-apply'](ev, id, preview.token, { mode: 'x' })).code
    ).toBe('INVALID');
    // New-31: a change elsewhere to a key it sets blocks it.
    preview = await h['env:import-pick'](ev, id, view.viewId);
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'HOST', 'h9');
    expect(await h['env:import-apply'](ev, id, preview.token)).toMatchObject({
      code: 'STALE',
      changed: ['HOST'],
    });
  });

  it('import: applies over unrelated changes; replace sees every own key (New-31)', async () => {
    const view = await h['env:view'](ev, id, 'prod');
    picked = path.join(dir, 'in.env');
    await fs.writeFile(picked, 'HOST=h2\n');

    let preview = await h['env:import-pick'](ev, id, view.viewId);
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    expect((await h['env:import-apply'](ev, id, preview.token)).success).toBe(
      true
    );
    let vars = (
      await EnvironmentVaultService.read(filePath, PW)
    ).vault.getActiveVersion('prod').vars;
    expect(vars).toMatchObject({ HOST: 'h2', X: '1' });

    // replace would remove Y, added after the preview: refused.
    preview = await h['env:import-pick'](ev, id, view.viewId);
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'Y', '2');
    expect(
      await h['env:import-apply'](ev, id, preview.token, { mode: 'replace' })
    ).toMatchObject({ code: 'STALE', changed: ['Y'] });
    vars = (
      await EnvironmentVaultService.read(filePath, PW)
    ).vault.getActiveVersion('prod').vars;
    expect(vars.Y).toBe('2');
  });

  it('saves a template with required keys marked, 0600', async () => {
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'HOST', 'h', {
      comment: 'Public host',
    });
    const result = await h['env:template'](ev, id, 'prod');
    expect(result).toEqual({ success: true, path: saved });
    expect(await fs.readFile(saved, 'utf8')).toBe(
      'API_KEY=<required>\n# Public host\nHOST=\nLOG_LEVEL=\nSHARED=\n'
    );
    if (process.platform !== 'win32') {
      expect((await fs.stat(saved)).mode & 0o777).toBe(0o600);
    }
    expect((await h['env:template'](ev, id, 'ghost')).code).toBe('NOT_FOUND');
  });

  it('changes the password and keeps the session working', async () => {
    const NEW = 'Brand-New-Pass-42!';
    expect(
      (await h['env-vault:change-password'](ev, id, 'wrong', NEW)).error
    ).toBe('The current password is wrong');
    expect((await h['env-vault:change-password'](ev, id, PW, PW)).code).toBe(
      'INVALID'
    );
    expect(
      (await h['env-vault:change-password'](ev, id, PW, 'short')).success
    ).toBe(false);
    const changed = await h['env-vault:change-password'](ev, id, PW, NEW);
    expect(changed).toMatchObject({ success: true, skippedSnapshots: [] });
    expect((await EnvironmentVaultService.read(filePath, PW)).success).toBe(
      false
    );
    expect((await EnvironmentVaultService.read(filePath, NEW)).success).toBe(
      true
    );
    // Still unlocked, reading and writing with the new password.
    const view = await h['env:view'](ev, id, 'prod');
    expect(view.success).toBe(true);
    const commit = await h['env:commit'](ev, id, {
      viewId: view.viewId,
      ops: [{ op: 'set', key: 'AFTER', value: '1' }],
    });
    expect(commit.success).toBe(true);
    session.lock(id);
    expect((await h['env-vault:change-password'](ev, id, NEW, PW)).code).toBe(
      'LOCKED'
    );
  });
});

describe('env vault IPC: pending imports end with the session', () => {
  it('drops a previewed import when the vault locks', async () => {
    await seed();
    const session = new EnvVaultSession();
    const file = path.join(dir, 'in.env');
    await fs.writeFile(file, 'HOST=h2\n');
    const h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [file] }),
      },
    });
    const ev = {};
    const id = (await h['env-vaults:list']()).vaults[0].id;
    await h['env-vault:unlock'](ev, id, PW);
    let view = await h['env:view'](ev, id, 'prod');
    const first = await h['env:import-pick'](ev, id, view.viewId);
    await h['env-vault:lock'](ev, id);
    await h['env-vault:unlock'](ev, id, PW);
    expect((await h['env:import-apply'](ev, id, first.token)).code).toBe(
      'INVALID'
    );

    view = await h['env:view'](ev, id, 'prod');
    const second = await h['env:import-pick'](ev, id, view.viewId);
    session.lock(id); // idle lock: main's own path, not the channel
    await h['env-vault:unlock'](ev, id, PW);
    expect((await h['env:import-apply'](ev, id, second.token)).code).toBe(
      'INVALID'
    );
    session.lockAll();
  });
});

describe('env vault IPC: password kept on this computer (New-24)', () => {
  const ev = {};
  let h;
  let id;
  let session;
  let filePath;
  let keychain;
  let present;
  let watcher;

  beforeEach(async () => {
    filePath = await seed();
    session = new EnvVaultSession();
    present = true;
    keychain = new EnvVaultKeychain({
      file: path.join(dir, 'kept', 'passwords.json'),
      safeStorage: fakeSafeStorage(),
      confirmPresence: async () => present,
    });
    watcher = /** @type {any} */ ({
      start: vi.fn(),
      note: vi.fn(),
      stop: vi.fn(),
    });
    h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
      keychain,
      watcher,
    });
    id = (await h['env-vaults:list']()).vaults[0].id;
  });
  afterEach(() => session.lockAll());

  const listed = async () => (await h['env-vaults:list']()).vaults[0];

  it('keeps the password only when asked, and unlocks with it', async () => {
    expect((await h['env-vaults:list']()).keychain).toBe(true);
    expect((await listed()).remembered).toBe(false);

    await h['env-vault:unlock'](ev, id, PW);
    expect((await listed()).remembered).toBe(false);
    session.lock(id);

    const unlocked = await h['env-vault:unlock'](ev, id, PW, {
      remember: true,
    });
    expect(unlocked).toMatchObject({ success: true, remembered: true });
    expect((await listed()).remembered).toBe(true);
    session.lock(id);

    const saved = await h['env-vault:unlock-saved'](ev, id);
    expect(saved.success).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(PW);
    expect(session.isUnlocked(id)).toBe(true);
    expect(watcher.start).toHaveBeenLastCalledWith(
      id,
      filePath,
      saved.revision
    );
  });

  it('does not keep a wrong password', async () => {
    const result = await h['env-vault:unlock'](ev, id, 'nope', {
      remember: true,
    });
    expect(result.error).toMatch(/^Wrong password for app\.env\.vault/);
    expect((await listed()).remembered).toBe(false);
  });

  it('forgets on an unticked box or on request', async () => {
    await h['env-vault:unlock'](ev, id, PW, { remember: true });
    session.lock(id);
    await h['env-vault:unlock'](ev, id, PW, { remember: false });
    expect((await listed()).remembered).toBe(false);

    await h['env-vault:unlock'](ev, id, PW, { remember: true });
    expect((await h['env-vault:forget-password'](ev, id)).success).toBe(true);
    expect((await listed()).remembered).toBe(false);
    session.lock(id);
    expect(await h['env-vault:unlock-saved'](ev, id)).toMatchObject({
      success: false,
      code: 'NONE',
      error: 'No saved password for app.env.vault. Type it instead.',
    });
  });

  it('does nothing when the presence check is declined', async () => {
    await h['env-vault:unlock'](ev, id, PW, { remember: true });
    session.lock(id);
    present = false;
    expect(await h['env-vault:unlock-saved'](ev, id)).toMatchObject({
      success: false,
      code: 'CANCELED',
    });
    expect(session.isUnlocked(id)).toBe(false);
    expect((await listed()).remembered).toBe(true);
  });

  it('forgets a kept password the CLI made stale', async () => {
    await h['env-vault:unlock'](ev, id, PW, { remember: true });
    session.lock(id);
    await EnvironmentVaultService.changePassword(filePath, PW, 'Other-Pass-9!');
    const result = await h['env-vault:unlock-saved'](ev, id);
    expect(result).toMatchObject({
      success: false,
      code: 'AUTH',
      remembered: false,
    });
    expect(result.error).toMatch(/no longer opens app\.env\.vault/);
    expect((await listed()).remembered).toBe(false);
  });

  it('follows a password change made in the app', async () => {
    const NEW = 'Brand-New-Pass-42!';
    await h['env-vault:unlock'](ev, id, PW, { remember: true });
    await h['env-vault:change-password'](ev, id, PW, NEW);
    session.lock(id);
    expect((await h['env-vault:unlock-saved'](ev, id)).success).toBe(true);
  });

  it('leaves no password kept after a password change without one', async () => {
    await h['env-vault:unlock'](ev, id, PW);
    await h['env-vault:change-password'](ev, id, PW, 'Brand-New-Pass-42!');
    expect((await listed()).remembered).toBe(false);
  });

  it('drops the password of a deleted vault at the next list (New-36)', async () => {
    await h['env-vault:unlock'](ev, id, PW, { remember: true });
    session.lock(id);
    expect((await h['env-vaults:list']()).savedPasswords).toBe(1);
    await fs.remove(filePath);
    const list = await h['env-vaults:list']();
    expect(list.savedPasswords).toBe(0);
    expect(await keychain.has(filePath)).toBe(false);
  });

  it('forgets every saved password on request (New-36)', async () => {
    await h['env-vault:unlock'](ev, id, PW, { remember: true });
    session.lock(id);
    expect(await h['env-vaults:forget-passwords']()).toEqual({
      success: true,
      count: 1,
    });
    expect((await h['env-vaults:list']()).savedPasswords).toBe(0);
    expect((await listed()).remembered).toBe(false);
  });

  it('forgets the password of a vault taken off the list (New-36)', async () => {
    const project = await seed(path.join(dir, 'proj', '.env.vault'));
    const handlers = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({
        envsDir,
        dialog: {
          showOpenDialog: async () => ({
            canceled: false,
            filePaths: [project],
          }),
        },
      }),
      session,
      keychain,
    });
    const opened = await handlers['env-vaults:open']();
    await handlers['env-vault:unlock'](ev, opened.id, PW, { remember: true });
    await handlers['env-vault:lock'](ev, opened.id);
    expect(await keychain.has(project)).toBe(true);
    expect((await handlers['env-vaults:forget'](ev, opened.id)).success).toBe(
      true
    );
    expect(await keychain.has(project)).toBe(false);
  });

  it('works without a keychain: nothing kept, nothing offered', async () => {
    const plain = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
    });
    const list = await plain['env-vaults:list']();
    expect(list.keychain).toBe(false);
    expect(list.savedPasswords).toBe(0);
    expect(await plain['env-vaults:forget-passwords']()).toEqual({
      success: true,
      count: 0,
    });
    expect(list.vaults[0].remembered).toBe(false);
    const plainId = list.vaults[0].id;
    expect(
      (await plain['env-vault:unlock'](ev, plainId, PW, { remember: true }))
        .remembered
    ).toBeUndefined();
    expect((await plain['env-vault:unlock-saved'](ev, plainId)).code).toBe(
      'INVALID'
    );
    expect(
      (await plain['env-vault:forget-password'](ev, plainId)).success
    ).toBe(true);
  });
});

describe('env vault IPC: a vault from a newer SecureVault (New-29)', () => {
  it('opens it read-only, says why, and refuses writes', async () => {
    const filePath = await seed();
    await fs.writeJSON(filePath, {
      ...(await fs.readJSON(filePath)),
      features: ['expiry'],
    });
    const session = new EnvVaultSession();
    const h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
    });
    const ev = {};
    const id = (await h['env-vaults:list']()).vaults[0].id;
    expect((await h['env-vault:unlock'](ev, id, PW)).success).toBe(true);

    const listed = await h['env:list'](ev, id);
    expect(listed).toMatchObject({ success: true, readOnly: true });
    expect(listed.formatMessage).toMatch(/\(expiry\)/);

    const view = await h['env:view'](ev, id, 'prod');
    const commit = await h['env:commit'](ev, id, {
      viewId: view.viewId,
      ops: [{ op: 'set', key: 'X', value: '1' }],
    });
    expect(commit).toMatchObject({ success: false, code: 'NEWER_FORMAT' });
    session.lockAll();
  });

  it('does not unlock a newer format version', async () => {
    const filePath = await seed();
    await fs.writeJSON(filePath, {
      ...(await fs.readJSON(filePath)),
      version: 2,
    });
    const session = new EnvVaultSession();
    const h = createEnvVaultHandlers({
      registry: new EnvVaultRegistry({ envsDir }),
      session,
    });
    const id = (await h['env-vaults:list']()).vaults[0].id;
    const result = await h['env-vault:unlock']({}, id, PW);
    expect(result).toMatchObject({ success: false, code: 'NEWER_FORMAT' });
    expect(result.error).toMatch(/uses vault format 2/);
    expect(session.isUnlocked(id)).toBe(false);
  });
});
