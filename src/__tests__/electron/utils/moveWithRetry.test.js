// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

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
