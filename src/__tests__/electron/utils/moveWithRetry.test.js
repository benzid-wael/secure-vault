// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import { moveWithRetry } from '../../../electron/utils/moveWithRetry.js';

const failWith = (code) => Object.assign(new Error(code), { code });

/** A move that fails with the given codes, in order, then succeeds. */
function flakyMove(...codes) {
  const queue = [...codes];
  return vi.fn(async () => {
    if (queue.length) throw failWith(queue.shift());
    return 'moved';
  });
}

describe('moveWithRetry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('moves once when nothing is in the way', async () => {
    const move = flakyMove();
    const sleep = vi.fn();

    await moveWithRetry('a', 'b', { platform: 'win32', move, sleep });

    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith('a', 'b');
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    'on Windows, retries %s and succeeds',
    async (code) => {
      const move = flakyMove(code, code);
      const sleep = vi.fn();

      await expect(
        moveWithRetry('a', 'b', { platform: 'win32', move, sleep })
      ).resolves.toBe('moved');

      expect(move).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls).toEqual([[50], [50]]);
    }
  );

  it('on Windows, gives up after three tries with the last error', async () => {
    const move = flakyMove('EPERM', 'EPERM', 'EBUSY', 'EPERM');
    const sleep = vi.fn();

    await expect(
      moveWithRetry('a', 'b', { platform: 'win32', move, sleep })
    ).rejects.toMatchObject({ code: 'EBUSY' });

    expect(move).toHaveBeenCalledTimes(3);
  });

  it('does not retry an error that is not transient', async () => {
    const move = flakyMove('ENOENT');

    await expect(
      moveWithRetry('a', 'b', { platform: 'win32', move, sleep: vi.fn() })
    ).rejects.toMatchObject({ code: 'ENOENT' });

    expect(move).toHaveBeenCalledTimes(1);
  });

  it.each(['darwin', 'linux'])(
    'does not retry on %s, where EPERM is a real permission error',
    async (platform) => {
      const move = flakyMove('EPERM');

      await expect(
        moveWithRetry('a', 'b', { platform, move, sleep: vi.fn() })
      ).rejects.toMatchObject({ code: 'EPERM' });

      expect(move).toHaveBeenCalledTimes(1);
    }
  );

  it('by default, moves a real file over an existing one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-move-'));
    try {
      fs.writeFileSync(path.join(dir, 'new'), 'new');
      fs.writeFileSync(path.join(dir, 'target'), 'old');

      await moveWithRetry(path.join(dir, 'new'), path.join(dir, 'target'));

      expect(fs.readFileSync(path.join(dir, 'target'), 'utf8')).toBe('new');
      expect(fs.existsSync(path.join(dir, 'new'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('moveWithRetry on a real directory', () => {
  it('replaces the target without it ever disappearing', async () => {
    const fsx = (await import('fs-extra')).default;
    const os = await import('os');
    const path = await import('path');
    const dir = await fsx.mkdtemp(path.join(os.tmpdir(), 'sv-move-'));
    const target = path.join(dir, 'vault');
    await fsx.writeFile(target, 'v0');
    let missing = 0;
    let stop = false;
    const watcher = (async () => {
      while (!stop) {
        if (!(await fsx.pathExists(target))) missing++;
        await new Promise((r) => setImmediate(r));
      }
    })();
    for (let i = 1; i <= 200; i++) {
      await fsx.writeFile(`${target}.tmp`, `v${i}`);
      await moveWithRetry(`${target}.tmp`, target);
    }
    stop = true;
    await watcher;
    expect(missing).toBe(0);
    expect(await fsx.readFile(target, 'utf8')).toBe('v200');
    expect(await fsx.pathExists(`${target}.tmp`)).toBe(false);
    await fsx.remove(dir);
  });
});

// New-13: on a real Windows runner, not simulated. Another process holds the
// target open without FILE_SHARE_DELETE (as a scanner can), so a rename over
// it fails until that process lets go.
describe.runIf(process.platform === 'win32')('moveWithRetry on Windows', () => {
  /** Hold `file` open for `ms` in another process; resolves once it's held. */
  function holdOpen(file, ms) {
    const script =
      `$f = [System.IO.File]::Open('${file}', 'Open', 'Read', 'Read'); ` +
      `Write-Output held; Start-Sleep -Milliseconds ${ms}; $f.Close()`;
    const child = spawn('powershell', ['-NoProfile', '-Command', script]);
    const held = new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => String(d).includes('held') && resolve());
      child.on('exit', (code) => reject(new Error(`holder exited ${code}`)));
    });
    const exited = new Promise((resolve) => child.on('exit', resolve));
    return { held, exited };
  }

  it('fails at once while the target is held, without retries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-move-win-'));
    const target = path.join(dir, 'vault');
    fs.writeFileSync(target, 'old');
    fs.writeFileSync(`${target}.tmp`, 'new');
    const holder = holdOpen(target, 1500);
    await holder.held;
    await expect(
      moveWithRetry(`${target}.tmp`, target, { tries: 1 })
    ).rejects.toMatchObject({
      code: expect.stringMatching(/EPERM|EBUSY|EACCES/),
    });
    await holder.exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);

  it('replaces the target once the holder lets go', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-move-win-'));
    const target = path.join(dir, 'vault');
    fs.writeFileSync(target, 'old');
    fs.writeFileSync(`${target}.tmp`, 'new');
    const holder = holdOpen(target, 300);
    await holder.held;
    await moveWithRetry(`${target}.tmp`, target, { tries: 40, delayMs: 50 });
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    await holder.exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);
});
