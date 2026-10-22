// @vitest-environment node
// App-wide settings (GUI-ENV-BREAKDOWN New-2) and the env vault recents they
// govern (Task 14), on a real filesystem.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  AppSettingsStore,
  APP_SETTINGS_DEFAULTS,
} from '../../../electron/services/AppSettingsStore.js';
import {
  EnvVaultRecents,
  MAX_RECENTS,
} from '../../../electron/services/EnvVaultRecents.js';
import {
  createAppSettingsHandlers,
  applyAppSettings,
} from '../../../electron/services/AppSettingsIpc.js';
import { claimSingleInstance } from '../../../electron/utils/singleInstance.js';
import { readJsonFile } from '../../../electron/utils/privateJsonFile.js';

let dir;
let file;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-settings-'));
  file = path.join(dir, 'data', 'app-settings.json');
});
afterEach(() => fs.remove(dir));

const mode = async (f) => (await fs.stat(f)).mode & 0o777;

describe('AppSettingsStore', () => {
  it('uses the defaults when there is no file, and writes nothing', async () => {
    const store = new AppSettingsStore({ file });
    expect(await store.get()).toEqual({
      idleMinutes: 5,
      rememberRecents: true,
    });
    expect(store.warning).toBe('');
    expect(await fs.pathExists(file)).toBe(false);
  });

  it('saves a change, 0600, and a new instance reads it back', async () => {
    const store = new AppSettingsStore({ file });
    expect(await store.update({ idleMinutes: 15 })).toEqual({
      success: true,
      settings: { idleMinutes: 15, rememberRecents: true },
    });
    if (process.platform !== 'win32') expect(await mode(file)).toBe(0o600);
    expect(await new AppSettingsStore({ file }).get()).toEqual({
      idleMinutes: 15,
      rememberRecents: true,
    });
  });

  it.each([
    ['damaged JSON', 'not json'],
    ['another format', JSON.stringify({ format: 2, settings: {} })],
    ['no settings', JSON.stringify({ format: 1 })],
  ])('falls back to the defaults on %s and says so', async (_, content) => {
    await fs.outputFile(file, content);
    const store = new AppSettingsStore({ file });
    expect(await store.get()).toEqual({ ...APP_SETTINGS_DEFAULTS });
    expect(store.warning).toMatch(/couldn't be read; using the default/);
    // Saving replaces the damaged file and clears the warning.
    expect((await store.update({ rememberRecents: false })).success).toBe(true);
    expect(store.warning).toBe('');
    expect((await readJsonFile(file)).data.settings.rememberRecents).toBe(
      false
    );
  });

  it('keeps the valid values of a partly bad file', async () => {
    await fs.outputJson(file, {
      format: 1,
      settings: { idleMinutes: 'ten', rememberRecents: false, extra: 1 },
    });
    expect(await new AppSettingsStore({ file }).get()).toEqual({
      idleMinutes: 5,
      rememberRecents: false,
    });
  });

  it.each([
    [{ idleMinutes: 0 }, /1 to 240/],
    [{ idleMinutes: 241 }, /1 to 240/],
    [{ idleMinutes: 2.5 }, /whole number/],
    [{ rememberRecents: 'yes' }, /on or off/],
    [{ theme: 'dark' }, /Unknown setting: theme/],
    [null, /Nothing to change/],
  ])('refuses %j and writes nothing', async (patch, message) => {
    const store = new AppSettingsStore({ file });
    const result = await store.update(/** @type {any} */ (patch));
    expect(result).toMatchObject({ success: false, code: 'INVALID' });
    expect(result.error).toMatch(message);
    expect(await fs.pathExists(file)).toBe(false);
  });

  it('keeps every change when updates overlap', async () => {
    const store = new AppSettingsStore({ file });
    await Promise.all([
      store.update({ idleMinutes: 30 }),
      store.update({ rememberRecents: false }),
    ]);
    expect(await new AppSettingsStore({ file }).get()).toEqual({
      idleMinutes: 30,
      rememberRecents: false,
    });
  });

  it('keeps the old value when the file cannot be written', async () => {
    // A directory where the file should be: the rename over it fails.
    await fs.mkdirp(file);
    await fs.outputFile(path.join(file, 'x'), '');
    const store = new AppSettingsStore({ file });
    const result = await store.update({ idleMinutes: 10 });
    expect(result).toMatchObject({ success: false, code: 'ERROR' });
    expect(result.error).toMatch(/^Couldn't save the settings/);
    expect((await store.get()).idleMinutes).toBe(5);
  });
});

describe('EnvVaultRecents', () => {
  let recentsFile;
  beforeEach(() => {
    recentsFile = path.join(dir, 'data', 'gui-env-recents.json');
  });
  const at = (s) => new Date(`2026-10-22T10:00:${s}Z`);

  it('keeps paths newest first, once each, 0600', async () => {
    const recents = new EnvVaultRecents({ file: recentsFile });
    expect(await recents.list()).toEqual([]);
    await recents.add('/p/a/.env.vault', at('01'));
    await recents.add('/p/b/.env.vault', at('02'));
    await recents.add('/p/a/.env.vault', at('03'));
    expect(await new EnvVaultRecents({ file: recentsFile }).list()).toEqual([
      { path: '/p/a/.env.vault', lastOpened: at('03').toISOString() },
      { path: '/p/b/.env.vault', lastOpened: at('02').toISOString() },
    ]);
    if (process.platform !== 'win32') {
      expect(await mode(recentsFile)).toBe(0o600);
    }
    // Paths only: nothing else is stored.
    expect(Object.keys((await fs.readJson(recentsFile))[0])).toEqual([
      'path',
      'lastOpened',
    ]);
  });

  it(`keeps the newest ${MAX_RECENTS}`, async () => {
    const recents = new EnvVaultRecents({ file: recentsFile });
    for (let i = 0; i < MAX_RECENTS + 5; i++) {
      await recents.add(`/p/${i}/.env.vault`, new Date(1e12 + i * 1000));
    }
    const list = await recents.list();
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0].path).toBe(`/p/${MAX_RECENTS + 4}/.env.vault`);
  });

  it('removes one, and clears all by deleting the file', async () => {
    const recents = new EnvVaultRecents({ file: recentsFile });
    await recents.add('/p/a/.env.vault');
    await recents.add('/p/b/.env.vault');
    await recents.remove('/p/a/.env.vault');
    await recents.remove('/p/zzz/.env.vault'); // not there: no error
    expect((await recents.list()).map((e) => e.path)).toEqual([
      '/p/b/.env.vault',
    ]);
    await recents.clear();
    expect(await recents.list()).toEqual([]);
    expect(await fs.pathExists(recentsFile)).toBe(false);
  });

  it('drops entries it cannot trust, and survives a damaged file', async () => {
    await fs.outputJson(recentsFile, [
      { path: '/ok/.env.vault', lastOpened: 'x' },
      { path: 'relative/.env.vault', lastOpened: 'x' },
      { path: '/ok/.env.vault', lastOpened: 'y' },
      { path: 42, lastOpened: 'x' },
      { path: '/no-date/.env.vault' },
      null,
    ]);
    expect(await new EnvVaultRecents({ file: recentsFile }).list()).toEqual([
      { path: '/ok/.env.vault', lastOpened: 'x' },
    ]);
    await fs.outputFile(recentsFile, '{');
    expect(await new EnvVaultRecents({ file: recentsFile }).list()).toEqual([]);
  });
});

describe('claimSingleInstance (Task 11)', () => {
  const fakeApp = (gotLock) => {
    const handlers = {};
    return {
      requestSingleInstanceLock: vi.fn(() => gotLock),
      quit: vi.fn(),
      on: vi.fn((event, fn) => {
        handlers[event] = fn;
      }),
      handlers,
    };
  };

  it('runs the first instance and shows its window on a second launch', () => {
    const app = fakeApp(true);
    const showWindow = vi.fn();
    expect(claimSingleInstance(app, showWindow)).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    app.handlers['second-instance']();
    expect(showWindow).toHaveBeenCalledOnce();
  });

  it('quits a second instance', () => {
    const app = fakeApp(false);
    expect(claimSingleInstance(app, vi.fn())).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.on).not.toHaveBeenCalled();
  });
});

describe('app settings IPC (Task 23)', () => {
  const targets = () => ({
    vaultSession: { setIdleMs: vi.fn() },
    envSession: { setIdleMs: vi.fn() },
    registry: { clearRecents: vi.fn(async () => {}) },
  });

  it('reads the settings and the warning', async () => {
    await fs.outputFile(file, 'damaged');
    const h = createAppSettingsHandlers({
      settings: new AppSettingsStore({ file }),
      apply: vi.fn(),
    });
    expect(await h['app-settings:get']()).toEqual({
      success: true,
      settings: { idleMinutes: 5, rememberRecents: true },
      warning: expect.stringMatching(/couldn't be read/),
    });
  });

  it('saves, then applies with the settings before and after', async () => {
    const apply = vi.fn();
    const h = createAppSettingsHandlers({
      settings: new AppSettingsStore({ file }),
      apply,
    });
    const result = await h['app-settings:update']({}, { idleMinutes: 10 });
    expect(result.success).toBe(true);
    expect(apply).toHaveBeenCalledWith(
      { idleMinutes: 10, rememberRecents: true },
      { idleMinutes: 5, rememberRecents: true }
    );
  });

  it('applies nothing when the change is refused', async () => {
    const apply = vi.fn();
    const h = createAppSettingsHandlers({
      settings: new AppSettingsStore({ file }),
      apply,
    });
    expect(
      (await h['app-settings:update']({}, { idleMinutes: 0 })).success
    ).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('sets the idle time of every vault in milliseconds', async () => {
    const t = targets();
    await applyAppSettings(t, { idleMinutes: 15, rememberRecents: true });
    expect(t.vaultSession.setIdleMs).toHaveBeenCalledWith(15 * 60 * 1000);
    expect(t.envSession.setIdleMs).toHaveBeenCalledWith(15 * 60 * 1000);
    expect(t.registry.clearRecents).not.toHaveBeenCalled();
  });

  it('clears the kept vault list only when remembering is turned off', async () => {
    const on = { idleMinutes: 5, rememberRecents: true };
    const off = { idleMinutes: 5, rememberRecents: false };
    for (const [next, previous, clears] of [
      [off, on, true],
      [off, off, false],
      [on, off, false],
      [off, undefined, false], // at startup: nothing to turn off
    ]) {
      const t = targets();
      await applyAppSettings(
        t,
        /** @type {any} */ (next),
        /** @type {any} */ (previous)
      );
      expect(t.registry.clearRecents).toHaveBeenCalledTimes(clears ? 1 : 0);
    }
  });
});
