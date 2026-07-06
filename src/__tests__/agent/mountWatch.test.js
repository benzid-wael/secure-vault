// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { watchMount } from '../../agent/mountWatch.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, { timeout = 3000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await pred()) return true;
    } catch {
      /* file momentarily absent mid-rebuild — keep polling */
    }
    await delay(interval);
  }
  return false;
}

let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-mountwatch-'));
});

afterEach(async () => {
  await fs.remove(dir);
});

describe('watchMount', () => {
  it('re-materializes a mount deleted out from under a build', async () => {
    const p = path.join(dir, 'mounted.txt');
    await fs.writeFile(p, 'v1');
    let builds = 0;
    const stop = watchMount(p, async () => {
      builds += 1;
      await fs.writeFile(p, 'rebuilt');
    });

    await fs.remove(p);
    const restored = await waitFor(
      async () =>
        (await fs.pathExists(p)) &&
        (await fs.readFile(p, 'utf-8')) === 'rebuilt'
    );
    stop();

    expect(restored).toBe(true);
    expect(builds).toBeGreaterThanOrEqual(1);
  });

  it('re-arms after a rebuild — a second deletion is also restored', async () => {
    const p = path.join(dir, 'again.txt');
    await fs.writeFile(p, 'v1');
    let builds = 0;
    const stop = watchMount(p, async () => {
      builds += 1;
      await fs.writeFile(p, `build-${builds}`);
    });

    await fs.remove(p);
    await waitFor(async () => (await fs.readFile(p, 'utf-8')) === 'build-1');
    await fs.remove(p);
    const second = await waitFor(
      async () => (await fs.readFile(p, 'utf-8')) === 'build-2'
    );
    stop();

    expect(second).toBe(true);
  });

  it('stop() ends the watch — no rebuild after stop', async () => {
    const p = path.join(dir, 'stopped.txt');
    await fs.writeFile(p, 'v1');
    let builds = 0;
    const stop = watchMount(p, async () => {
      builds += 1;
      await fs.writeFile(p, 'x');
    });

    stop();
    await fs.remove(p);
    await delay(250);

    expect(builds).toBe(0);
    expect(await fs.pathExists(p)).toBe(false);
  });

  it('does not rebuild on a mere content change (only on disappearance)', async () => {
    const p = path.join(dir, 'edited.txt');
    await fs.writeFile(p, 'v1');
    let builds = 0;
    const stop = watchMount(p, async () => {
      builds += 1;
    });

    await fs.writeFile(p, 'edited-in-place');
    await delay(250);
    stop();

    expect(builds).toBe(0);
  });
});
