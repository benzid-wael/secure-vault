// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

import {
  VaultSession,
  VAULT_IDLE_MS,
} from '../../../electron/services/VaultSession.js';

describe('VaultSession', () => {
  it('starts locked', () => {
    const session = new VaultSession();
    expect(session.vaultName).toBeNull();
    expect(session.isUnlocked('main')).toBe(false);
    expect(session.passwordFor('main')).toBeNull();
  });

  it('serves the password only for the unlocked vault', () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    expect(session.isUnlocked('main')).toBe(true);
    expect(session.passwordFor('main')).toBe('pw');
    expect(session.isUnlocked('other')).toBe(false);
    expect(session.passwordFor('other')).toBeNull();
  });

  it('opening another vault replaces the session', () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    session.open('other', 'pw2');
    expect(session.passwordFor('main')).toBeNull();
    expect(session.passwordFor('other')).toBe('pw2');
  });

  it('close() locks it again', () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    session.close();
    expect(session.vaultName).toBeNull();
    expect(session.passwordFor('main')).toBeNull();
  });

  it('accepts an empty-string password but rejects a missing one', () => {
    const session = new VaultSession();
    expect(() => session.open('main', undefined)).toThrow();
    expect(() => session.open('', 'pw')).toThrow();
    session.open('main', '');
    expect(session.passwordFor('main')).toBe('');
  });

  it('withPassword runs fn with the password when unlocked', async () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    const fn = vi.fn().mockResolvedValue({ success: true });
    await expect(session.withPassword('main', fn)).resolves.toEqual({
      success: true,
    });
    expect(fn).toHaveBeenCalledWith('pw');
  });

  it('withPassword refuses without calling fn when locked or for another vault', async () => {
    const session = new VaultSession();
    const fn = vi.fn();
    await expect(session.withPassword('main', fn)).resolves.toMatchObject({
      success: false,
      locked: true,
    });
    session.open('other', 'pw');
    await expect(session.withPassword('main', fn)).resolves.toMatchObject({
      locked: true,
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('VaultSession idle lock (Task 13)', () => {
  // A fake clock: the pending timer and when it fires.
  const clock = () => {
    const c = {
      now: 0,
      timers: new Map(),
      next: 1,
      setTimer: (fn, ms) => {
        const id = c.next++;
        c.timers.set(id, { fn, at: c.now + ms });
        return id;
      },
      clearTimer: (id) => c.timers.delete(id),
      advance(ms) {
        c.now += ms;
        for (const [id, t] of [...c.timers]) {
          if (t.at <= c.now) {
            c.timers.delete(id);
            t.fn();
          }
        }
      },
    };
    return c;
  };
  const make = (c, idleMs = VAULT_IDLE_MS) => {
    const onIdle = vi.fn();
    const session = new VaultSession({
      idleMs,
      onIdle,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });
    return { session, onIdle };
  };

  it('locks after 5 minutes by default and says so once', () => {
    const c = clock();
    const { session, onIdle } = make(c);
    session.open('main', 'pw');
    c.advance(VAULT_IDLE_MS - 1);
    expect(session.isUnlocked('main')).toBe(true);
    c.advance(1);
    expect(session.isUnlocked('main')).toBe(false);
    expect(session.passwordFor('main')).toBeNull();
    expect(onIdle).toHaveBeenCalledExactlyOnceWith('main', VAULT_IDLE_MS);
    expect(c.timers.size).toBe(0);
  });

  it('activity restarts the idle time; calls on the vault do not', async () => {
    const c = clock();
    const { session, onIdle } = make(c, 1000);
    session.open('main', 'pw');
    c.advance(900);
    session.touch();
    c.advance(900);
    expect(session.isUnlocked('main')).toBe(true);
    // Calls the page makes (load, save) don't keep the vault open.
    await session.withPassword('main', async () => ({ success: true }));
    c.advance(100);
    expect(session.isUnlocked('main')).toBe(false);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('a lock, or activity while locked, leaves no timer', () => {
    const c = clock();
    const { session, onIdle } = make(c);
    session.touch();
    expect(c.timers.size).toBe(0);
    session.open('main', 'pw');
    session.close();
    expect(c.timers.size).toBe(0);
    c.advance(VAULT_IDLE_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('reopening, or opening another vault, starts one fresh timer', () => {
    const c = clock();
    const { session, onIdle } = make(c, 1000);
    session.open('main', 'pw');
    c.advance(600);
    session.open('other', 'pw2');
    expect(c.timers.size).toBe(1);
    c.advance(600);
    expect(session.isUnlocked('other')).toBe(true);
    c.advance(400);
    expect(onIdle).toHaveBeenCalledExactlyOnceWith('other', 1000);
  });

  it('a new idle time applies at once, counted from now', () => {
    const c = clock();
    const { session, onIdle } = make(c, 10000);
    session.open('main', 'pw');
    c.advance(5000);
    session.setIdleMs(2000);
    c.advance(1999);
    expect(session.isUnlocked('main')).toBe(true);
    c.advance(1);
    expect(onIdle).toHaveBeenCalledExactlyOnceWith('main', 2000);
  });

  it('ignores a bad idle time, and a new one while locked sets no timer', () => {
    const c = clock();
    const { session } = make(c, 1000);
    for (const bad of [0, -1, 1.5, NaN, undefined]) session.setIdleMs(bad);
    session.setIdleMs(3000);
    expect(c.timers.size).toBe(0);
    session.open('main', 'pw');
    c.advance(2999);
    expect(session.isUnlocked('main')).toBe(true);
    c.advance(1);
    expect(session.isUnlocked('main')).toBe(false);
  });

  it('uses real timers by default, unref’d so they never keep the app up', () => {
    vi.useFakeTimers();
    try {
      const session = new VaultSession({ idleMs: 50 });
      session.open('main', 'pw');
      vi.advanceTimersByTime(50);
      expect(session.isUnlocked('main')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
