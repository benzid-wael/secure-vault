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
import { EnvVaultRegistry } from '../../../electron/services/EnvVaultRegistry.js';
import {
  EnvVaultSession,
  ENV_VAULT_IDLE_MS,
  MAX_VIEWS_PER_VAULT,
} from '../../../electron/services/EnvVaultSession.js';
import { createEnvVaultHandlers } from '../../../electron/services/EnvVaultIpc.js';
import { readFeatures } from '../../../electron/utils/features.js';
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
    expect(onLocked).toHaveBeenCalledWith('a');
    session.touch('a'); // no-op once locked
    expect(t.pending.size).toBe(0);
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

  it('locks when the stored password stops working (AUTH → LOCKED)', async () => {
    const filePath = await seed();
    const onLocked = vi.fn();
    const session = new EnvVaultSession({ onLocked });
    await session.unlock('a', filePath, PW);
    const result = await session.run('a', async () => ({
      success: false,
      code: 'AUTH',
    }));
    expect(result.code).toBe('LOCKED');
    expect(session.isUnlocked('a')).toBe(false);
    expect(onLocked).toHaveBeenCalledWith('a');
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
      { key: 'API_KEY', sensitive: true, required: true, inheritedFrom: null },
      {
        key: 'HOST',
        value: 'prod.example',
        sensitive: false,
        required: false,
        inheritedFrom: null,
      },
      {
        key: 'LOG_LEVEL',
        value: 'debug',
        sensitive: false,
        required: false,
        inheritedFrom: 'base',
      },
      // The child's own value wins over the parent's.
      { key: 'SHARED', sensitive: true, required: false, inheritedFrom: null },
    ]);
    expect((await h['env:view'](ev, id, 'nope')).code).toBe('NOT_FOUND');
  });

  it('reveals one value, and only at the revision on screen', async () => {
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
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    expect((await h['env:reveal'](ev, id, view.viewId, 'API_KEY')).code).toBe(
      'STALE'
    );
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

    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'CLI', 'c');
    const stale = await h['env:commit'](ev, id, set('v3'));
    expect(stale.code).toBe('STALE');
    let read = await EnvironmentVaultService.read(filePath, PW);
    expect(read.vault.getActiveVersion('prod').vars).toMatchObject({
      API_KEY: 'v2',
      CLI: 'c',
    });

    // Refresh moves the base; then the same edit goes through.
    const refreshed = await h['env:refresh'](ev, id, view.viewId);
    expect(refreshed.viewId).toBe(view.viewId);
    expect((await h['env:commit'](ev, id, set('v3'))).success).toBe(true);
    read = await EnvironmentVaultService.read(filePath, PW);
    expect(read.vault.getActiveVersion('prod').vars).toMatchObject({
      API_KEY: 'v3',
      CLI: 'c',
    });
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

  it('refresh does not reset the idle timer; user calls do', async () => {
    await unlock();
    const touch = vi.spyOn(session, 'touch');
    const view = await h['env:view'](ev, id, 'prod');
    expect(touch).toHaveBeenCalledTimes(1);
    await h['env:refresh'](ev, id, view.viewId);
    expect(touch).toHaveBeenCalledTimes(1);
    expect((await h['env:refresh'](ev, id, 'bogus')).code).toBe('INVALID');
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
    expect(
      (await h['env-vaults:create'](ev, { mode: 'dialog' }, PW)).code
    ).toBe('INVALID');
    expect(
      (await h['env-vaults:create'](ev, { mode: 'appdata', name: 'w' }, 'weak'))
        .code
    ).toBe('INVALID');
    expect(await fs.pathExists(path.join(envsDir, 'w.env.vault'))).toBe(false);
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
    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    expect((await h['env:copy'](ev, id, view.viewId, 'API_KEY')).code).toBe(
      'STALE'
    );
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

    await EnvironmentVaultService.setEnv(filePath, PW, 'prod', 'X', '1');
    expect((await transfer({ keys: ['HOST'], target: 'base' })).code).toBe(
      'STALE'
    );
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
