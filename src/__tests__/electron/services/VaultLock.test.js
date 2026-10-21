// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  VaultLock,
  currentPidNamespace,
  isProcessAlive,
  machineBootTime,
} from '../../../electron/services/VaultLock.js';

const BOOT = Date.parse('2026-10-20T08:00:00.000Z');
const OTHER_BOOT = Date.parse('2026-10-01T09:30:00.000Z');
const DEAD_PID = 999;
const PIDNS = 'pid:[4026531836]';
const CONTAINER_PIDNS = 'pid:[4026532461]';

describe('VaultLock', () => {
  let dir;
  let vaultPath;
  let lockPath;
  let t;
  let sleeps;
  let alive;

  // A lock with an injected clock (sleeping advances it), pid probe and boot.
  const makeLock = (overrides = {}) =>
    new VaultLock(vaultPath, {
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      isAlive: (pid) => alive.has(pid),
      bootTime: () => BOOT,
      // Pinned, so "same machine" means the same thing on macOS and Linux CI.
      pidNamespace: () => PIDNS,
      pid: 100,
      host: 'this-host',
      ...overrides,
    });

  // A lock file left by someone else, with a chosen mtime.
  const writeHolder = (content, mtimeMs = t) => {
    fs.writeFileSync(
      lockPath,
      typeof content === 'string' ? content : JSON.stringify(content)
    );
    fs.utimesSync(lockPath, new Date(mtimeMs), new Date(mtimeMs));
  };
  const holder = (fields) => ({
    v: 1,
    pid: 200,
    host: 'this-host',
    tool: 'cli',
    nonce: 'theirs',
    boot: new Date(BOOT).toISOString(),
    pidns: PIDNS,
    acquiredAt: new Date(t).toISOString(),
    ...fields,
  });
  const readLock = () => JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const leftovers = () =>
    fs.readdirSync(dir).filter((name) => name.includes('.stale.'));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-lock-'));
    vaultPath = path.join(dir, '.env.vault');
    lockPath = `${vaultPath}.lock`;
    t = Date.parse('2026-10-21T17:00:00.000Z');
    sleeps = [];
    alive = new Set([100, 200, 300]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('acquire and release', () => {
    it('creates <vault>.lock describing the holder, and release removes it', async () => {
      const lock = makeLock({ tool: 'gui' });

      expect(await lock.acquire()).toEqual({ success: true });

      expect(lock.path).toBe(lockPath);
      const info = readLock();
      expect(info).toMatchObject({
        v: 1,
        pid: 100,
        host: 'this-host',
        tool: 'gui',
        boot: new Date(BOOT).toISOString(),
        pidns: PIDNS,
        acquiredAt: new Date(t).toISOString(),
      });
      expect(info.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(fs.statSync(lockPath).mtimeMs).toBe(t);
      if (process.platform !== 'win32') {
        expect(fs.statSync(lockPath).mode & 0o777).toBe(0o600);
      }

      await lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('refuses to acquire twice on the same instance', async () => {
      const lock = makeLock();
      await lock.acquire();

      const again = await lock.acquire();

      expect(again).toMatchObject({ success: false, code: 'ERROR' });
      await lock.release();
    });

    it('release leaves a lock that is no longer ours', async () => {
      const lock = makeLock();
      await lock.acquire();
      writeHolder(holder({ nonce: 'someone-else' }));

      await lock.release();

      expect(readLock().nonce).toBe('someone-else');
    });

    it('release is safe without a lock and when called twice', async () => {
      const lock = makeLock();
      await lock.release();

      await lock.acquire();
      await lock.release();
      await lock.release();

      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('reports ERROR when the vault directory does not exist', async () => {
      vaultPath = path.join(dir, 'missing', '.env.vault');

      const result = await makeLock().acquire();

      expect(result).toMatchObject({ success: false, code: 'ERROR' });
    });

    it('removes a half-written lock instead of leaving it to block others', async () => {
      const failingFs = {
        ...fsp,
        open: async (file, flags, mode) => {
          const handle = await fsp.open(file, flags, mode);
          handle.writeFile = async () => {
            throw Object.assign(new Error('no space left'), {
              code: 'ENOSPC',
            });
          };
          return handle;
        },
      };

      const result = await makeLock({ fs: failingFs }).acquire();

      expect(result).toMatchObject({
        success: false,
        code: 'ERROR',
        error: 'no space left',
      });
      expect(fs.existsSync(lockPath)).toBe(false);
    });
  });

  describe('a held lock', () => {
    it('waits with backoff, then reports BUSY naming the holder', async () => {
      writeHolder(holder({ tool: 'cli', pid: 200 }));

      const result = await makeLock({ timeoutMs: 3000 }).acquire();

      expect(result).toMatchObject({
        success: false,
        code: 'BUSY',
        holder: { pid: 200, tool: 'cli' },
      });
      expect(result.error).toContain('held by cli pid 200');
      expect(result.error).toContain(lockPath);
      expect(sleeps.slice(0, 5)).toEqual([50, 100, 200, 400, 400]);
      expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3000);
    });

    it('acquires once the holder releases while we wait', async () => {
      writeHolder(holder());
      const lock = makeLock({
        sleep: async (ms) => {
          t += ms;
          fs.rmSync(lockPath, { force: true }); // the holder finishes
        },
      });

      expect(await lock.acquire()).toEqual({ success: true });
      await lock.release();
    });

    it('never takes over a live holder on this machine, however old (H1)', async () => {
      writeHolder(holder({ pid: 200 }), t - 10 * 60 * 1000);

      const result = await makeLock({ timeoutMs: 0 }).acquire();

      expect(result.code).toBe('BUSY');
      expect(readLock().nonce).toBe('theirs');
    });
  });

  describe('stale locks', () => {
    it('takes over a lock whose holder on this machine is dead', async () => {
      writeHolder(holder({ pid: DEAD_PID }));
      const lock = makeLock({ timeoutMs: 0 });

      expect(await lock.acquire()).toEqual({ success: true });

      expect(readLock().pid).toBe(100);
      expect(leftovers()).toEqual([]);
      await lock.release();
    });

    it('recognizes this machine by boot time even if the hostname changed', async () => {
      writeHolder(holder({ pid: DEAD_PID, host: 'old-name.local' }));

      expect(await makeLock({ timeoutMs: 0 }).acquire()).toEqual({
        success: true,
      });
    });

    it('waits on a fresh lock from another machine, even with a "dead" pid', async () => {
      writeHolder(
        holder({ pid: DEAD_PID, boot: new Date(OTHER_BOOT).toISOString() }),
        t - 1000
      );

      const result = await makeLock({ timeoutMs: 0 }).acquire();

      expect(result.code).toBe('BUSY');
    });

    it('takes over a lock from another machine once its mtime is stale', async () => {
      writeHolder(
        holder({ pid: 200, boot: new Date(OTHER_BOOT).toISOString() }),
        t - 31000
      );

      expect(await makeLock({ timeoutMs: 0 }).acquire()).toEqual({
        success: true,
      });
    });

    it('waits on a fresh lock from a container on this kernel, even with a "dead" pid', async () => {
      // Same boot time (shared kernel), but its pid 42 means nothing here.
      writeHolder(holder({ pid: DEAD_PID, pidns: CONTAINER_PIDNS }), t - 1000);

      const result = await makeLock({ timeoutMs: 0 }).acquire();

      expect(result.code).toBe('BUSY');
      expect(readLock().pidns).toBe(CONTAINER_PIDNS);
    });

    it('takes over a container lock once its mtime is stale', async () => {
      writeHolder(holder({ pid: 200, pidns: CONTAINER_PIDNS }), t - 31000);

      expect(await makeLock({ timeoutMs: 0 }).acquire()).toEqual({
        success: true,
      });
    });

    it('does not trust a pid probe when only one side knows its namespace', async () => {
      writeHolder(holder({ pid: DEAD_PID, pidns: undefined }), t - 1000);

      const result = await makeLock({ timeoutMs: 0 }).acquire();

      expect(result.code).toBe('BUSY');
    });

    it('writes no pidns field where there is no namespace (macOS, Windows)', async () => {
      const lock = makeLock({ pidNamespace: () => undefined });
      await lock.acquire();

      expect('pidns' in readLock()).toBe(false);
      await lock.release();
    });

    it('judges an unreadable lock by its mtime alone', async () => {
      writeHolder('{"v":1,"pi', t - 1000);
      const fresh = await makeLock({ timeoutMs: 0 }).acquire();
      expect(fresh.code).toBe('BUSY');
      expect(fresh.error).toContain('held by an unknown process');

      writeHolder('', t - 31000);
      expect(await makeLock({ timeoutMs: 0 }).acquire()).toEqual({
        success: true,
      });
    });

    it('puts back a live lock that another taker created meanwhile', async () => {
      writeHolder(holder({ pid: DEAD_PID, nonce: 'stale-one' }));
      let raced = false;
      const racingFs = {
        ...fsp,
        rename: async (from, to) => {
          if (!raced && from === lockPath) {
            raced = true;
            // Another taker replaced the stale lock just before our rename.
            writeHolder(holder({ pid: 300, nonce: 'fresh-one' }));
          }
          return fsp.rename(from, to);
        },
      };

      const result = await makeLock({ timeoutMs: 0, fs: racingFs }).acquire();

      expect(result.code).toBe('BUSY');
      expect(readLock()).toMatchObject({ pid: 300, nonce: 'fresh-one' });
      expect(leftovers()).toEqual([]);
    });

    it('lets exactly one of two concurrent takers win', async () => {
      writeHolder(holder({ pid: DEAD_PID }));
      const a = makeLock({ timeoutMs: 0, pid: 100 });
      const b = makeLock({ timeoutMs: 0, pid: 200 });

      const results = await Promise.all([a.acquire(), b.acquire()]);

      const winners = results.filter((r) => r.success);
      expect(winners).toHaveLength(1);
      const winnerPid = results[0].success ? 100 : 200;
      expect(readLock().pid).toBe(winnerPid);
      expect(leftovers()).toEqual([]);
    });
  });

  describe('heartbeat', () => {
    it('refresh touches the mtime so another machine sees the lock alive', async () => {
      const lock = makeLock();
      await lock.acquire();
      t += 20000;

      await lock.refresh();

      expect(fs.statSync(lockPath).mtimeMs).toBe(t);
      await lock.release();
    });

    it('refreshes on an interval while held, and stops on release', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const lock = makeLock({ heartbeatMs: 5000 });
      const refresh = vi.spyOn(lock, 'refresh').mockResolvedValue();
      await lock.acquire();

      vi.advanceTimersByTime(15000);
      expect(refresh).toHaveBeenCalledTimes(3);

      await lock.release();
      vi.advanceTimersByTime(15000);
      expect(refresh).toHaveBeenCalledTimes(3);
    });

    it('marks the lock lost, without recreating it, once it is gone', async () => {
      const lock = makeLock();
      await lock.acquire();
      fs.rmSync(lockPath);

      await lock.refresh();

      expect(lock.lost).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
      await lock.release();
    });

    it('refresh does nothing when no lock is held', async () => {
      const lock = makeLock();
      await lock.refresh();
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(lock.lost).toBe(false);
    });
  });
});

describe('VaultLock across processes', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-lock-procs-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serializes read-modify-write between real processes', async () => {
    const PROCS = 4;
    const ROUNDS = 25;
    const counter = path.join(dir, 'counter');
    fs.writeFileSync(counter, '0');
    // Each child increments the counter ROUNDS times under the lock, yielding
    // between its read and its write so an unlocked run would lose updates.
    const child = path.join(dir, 'child.mjs');
    const lockModule = new URL(
      '../../../electron/services/VaultLock.js',
      import.meta.url
    ).href;
    fs.writeFileSync(
      child,
      `import fs from 'fs/promises';
import { VaultLock } from ${JSON.stringify(lockModule)};
const [vault, counter, rounds] = process.argv.slice(2);
for (let i = 0; i < Number(rounds); i++) {
  const lock = new VaultLock(vault, { timeoutMs: 20000 });
  const r = await lock.acquire();
  if (!r.success) { console.error(r.error); process.exit(2); }
  try {
    const n = Number(await fs.readFile(counter, 'utf8'));
    await new Promise((res) => setTimeout(res, 1));
    await fs.writeFile(counter, String(n + 1));
  } finally {
    await lock.release();
  }
}
`
    );

    const { spawn } = await import('child_process');
    const codes = await Promise.all(
      Array.from(
        { length: PROCS },
        () =>
          new Promise((resolve) => {
            const p = spawn(
              process.execPath,
              [child, path.join(dir, '.env.vault'), counter, String(ROUNDS)],
              { stdio: ['ignore', 'ignore', 'inherit'] }
            );
            p.on('exit', resolve);
          })
      )
    );

    expect(codes).toEqual(Array(PROCS).fill(0));
    expect(Number(fs.readFileSync(counter, 'utf8'))).toBe(PROCS * ROUNDS);
    expect(fs.existsSync(path.join(dir, '.env.vault.lock'))).toBe(false);
  }, 60000);
});

describe('isProcessAlive', () => {
  afterEach(() => vi.restoreAllMocks());

  const killThrowing = (code) =>
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error(code), { code });
    });

  it('is true for this process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('is false when the pid does not exist (ESRCH)', () => {
    killThrowing('ESRCH');
    expect(isProcessAlive(12345)).toBe(false);
  });

  it("is true when the pid exists but isn't ours to signal (EPERM)", () => {
    killThrowing('EPERM');
    expect(isProcessAlive(1)).toBe(true);
  });
});

describe('currentPidNamespace', () => {
  it('reads /proc/self/ns/pid on Linux', () => {
    const readlink = vi.fn().mockReturnValue('pid:[4026531836]');

    expect(currentPidNamespace({ platform: 'linux', readlink })).toBe(
      'pid:[4026531836]'
    );
    expect(readlink).toHaveBeenCalledWith('/proc/self/ns/pid');
  });

  it('is undefined on Linux when /proc is unreadable', () => {
    const readlink = () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    };

    expect(currentPidNamespace({ platform: 'linux', readlink })).toBe(
      undefined
    );
  });

  it('is undefined off Linux, without touching /proc', () => {
    const readlink = vi.fn();

    expect(currentPidNamespace({ platform: 'darwin', readlink })).toBe(
      undefined
    );
    expect(readlink).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === 'linux')(
    'returns a real namespace id on this Linux machine',
    () => {
      expect(currentPidNamespace()).toMatch(/^pid:\[\d+\]$/);
    }
  );
});

describe('machineBootTime', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is now minus the uptime', () => {
    vi.spyOn(os, 'uptime').mockReturnValue(3600);
    vi.spyOn(Date, 'now').mockReturnValue(10_000_000);

    expect(machineBootTime()).toBe(10_000_000 - 3_600_000);
  });
});
