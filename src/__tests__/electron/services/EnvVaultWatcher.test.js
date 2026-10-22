// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { EnvVaultWatcher } from '../../../electron/services/EnvVaultWatcher.js';
import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';

const rev = (text) => EnvironmentVaultService.revisionOf(Buffer.from(text));

/** A fake `fs.watch` that records listeners, and timers run by hand. */
function harness({ files = {} } = {}) {
  const watchers = [];
  const timers = [];
  const changes = [];
  const watcher = new EnvVaultWatcher({
    onChange: (id, change) => changes.push({ id, ...change }),
    watch: /** @type {any} */ (dir, options, listener) => {
      const w = {
        dir,
        listener,
        closed: false,
        close: () => (w.closed = true),
        on: () => {},
      };
      watchers.push(w);
      return w;
    },
    readFile: async (p) => {
      if (!(p in files))
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return Buffer.from(files[p]);
    },
    setTimer: (fn) => {
      timers.push(fn);
      return fn;
    },
    clearTimer: (fn) => {
      const i = timers.indexOf(fn);
      if (i !== -1) timers.splice(i, 1);
    },
  });
  const flush = async () => {
    while (timers.length) await timers.shift()();
  };
  return { watcher, watchers, changes, files, flush };
}

const VAULT = '/vaults/app.env.vault';

describe('EnvVaultWatcher (Task 16)', () => {
  it('watches the directory and reports a change made elsewhere, once', async () => {
    const h = harness({ files: { [VAULT]: 'v1' } });
    h.watcher.start('id1', VAULT, rev('v1'));
    expect(h.watchers[0].dir).toBe('/vaults');

    h.files[VAULT] = 'v2';
    h.watchers[0].listener('rename', 'app.env.vault');
    h.watchers[0].listener('change', 'app.env.vault'); // debounced together
    await h.flush();
    expect(h.changes).toEqual([{ id: 'id1', missing: false }]);

    h.watchers[0].listener('change', 'app.env.vault'); // same bytes again
    await h.flush();
    expect(h.changes).toHaveLength(1);
  });

  it("ignores the app's own writes", async () => {
    const h = harness({ files: { [VAULT]: 'v1' } });
    h.watcher.start('id1', VAULT, rev('v1'));
    h.files[VAULT] = 'ours';
    h.watcher.note('id1', rev('ours'));
    h.watchers[0].listener('rename', 'app.env.vault');
    await h.flush();
    expect(h.changes).toEqual([]);
  });

  it('checks a null filename, and skips other files in the directory', async () => {
    const h = harness({ files: { [VAULT]: 'v1' } });
    h.watcher.start('id1', VAULT, rev('v1'));
    h.files[VAULT] = 'v2';
    h.watchers[0].listener('rename', 'app.env.vault.tmp');
    h.watchers[0].listener('rename', 'other.env.vault');
    await h.flush();
    expect(h.changes).toEqual([]);
    h.watchers[0].listener('rename', null);
    await h.flush();
    expect(h.changes).toEqual([{ id: 'id1', missing: false }]);
  });

  it('reports a vault that disappeared', async () => {
    const h = harness({ files: {} });
    h.watcher.start('id1', VAULT, rev('v1'));
    h.watchers[0].listener('rename', 'app.env.vault');
    await h.flush();
    expect(h.changes).toEqual([{ id: 'id1', missing: true }]);
  });

  it('stops: closes the watch and drops a pending check', async () => {
    const h = harness({ files: { [VAULT]: 'v1' } });
    h.watcher.start('id1', VAULT, rev('v1'));
    h.files[VAULT] = 'v2';
    h.watchers[0].listener('rename', 'app.env.vault');
    h.watcher.stopAll();
    await h.flush();
    expect(h.watchers[0].closed).toBe(true);
    expect(h.changes).toEqual([]);
    h.watcher.note('id1', 'x'); // no-op once stopped
  });

  it('survives a watch that cannot start', () => {
    const watcher = new EnvVaultWatcher({
      onChange: () => {},
      watch: () => {
        throw new Error('ENOSPC');
      },
    });
    expect(() => watcher.start('id1', VAULT)).not.toThrow();
    watcher.stop('id1');
  });
});

describe('EnvVaultWatcher on a real directory', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-watch-'));
  });
  afterEach(() => fs.remove(dir));

  it('fires after an atomic rename over the vault', async () => {
    const file = path.join(dir, 'app.env.vault');
    await fs.writeFile(file, 'v1');
    const onChange = vi.fn();
    const watcher = new EnvVaultWatcher({ onChange, debounceMs: 20 });
    watcher.start('id1', file, rev('v1'));
    // macOS (FSEvents) can miss a change made the instant a watch starts.
    await new Promise((r) => setTimeout(r, 200));
    await fs.writeFile(`${file}.tmp`, 'v2');
    await fs.rename(`${file}.tmp`, file);
    await vi.waitFor(
      () => expect(onChange).toHaveBeenCalledWith('id1', { missing: false }),
      {
        timeout: 10000,
      }
    );
    watcher.stopAll();
  }, 15000);
});
