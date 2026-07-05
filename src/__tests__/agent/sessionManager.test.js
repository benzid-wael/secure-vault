// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

import { SessionManager } from '../../agent/sessionManager.js';
import { LOCK_STATUS } from '../../agent/lockState.js';

const CFG = { idleTimeoutMs: 1000, maxLifetimeMs: 10000 };
const T0 = 1_000_000;

const ENVS = {
  dev: { API_URL: 'https://dev', TOKEN: 'devtok' },
  prod: { API_URL: 'https://prod', TOKEN: 'prodtok' },
};
const resolveEnv = (name) => {
  if (!ENVS[name]) throw new Error(`Environment '${name}' not found`);
  return ENVS[name];
};

let now;
let wipes;
let sm;

beforeEach(() => {
  now = T0;
  wipes = 0;
  sm = new SessionManager({
    config: CFG,
    clock: () => now,
    onWipeMounts: () => {
      wipes += 1;
    },
  });
});

describe('request-scoped protocol (G23)', () => {
  beforeEach(() => sm.unlock(resolveEnv, now));

  it('serves a single named env', () => {
    const r = sm.handle({ verb: 'get-env', env: 'dev' }, now);
    expect(r).toEqual({ ok: true, data: ENVS.dev });
  });

  it('serves only the requested key subset', () => {
    const r = sm.handle(
      { verb: 'get-env', env: 'dev', keys: ['API_URL'] },
      now
    );
    expect(r.data).toEqual({ API_URL: 'https://dev' });
  });

  it('rejects an enumeration / dump-all / unknown verb', () => {
    for (const verb of ['list-envs', 'dump-all', 'get-all', 'wat']) {
      const r = sm.handle({ verb }, now);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Unsupported verb/);
    }
  });

  it('requires an env name for get-env', () => {
    const r = sm.handle({ verb: 'get-env' }, now);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/requires an "env"/);
  });

  it('surfaces the resolver error for an unknown env (no enumeration leak)', () => {
    const r = sm.handle({ verb: 'get-env', env: 'nope' }, now);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });
});

describe('status is metadata only (G23)', () => {
  it('never returns values or env names', () => {
    sm.unlock(resolveEnv, now);
    const r = sm.handle({ verb: 'status' }, now);
    expect(r.data).toEqual({
      status: LOCK_STATUS.UNLOCKED,
      unlocked: true,
      mountsLive: true,
      uptimeMs: 0,
    });
    const blob = JSON.stringify(r.data);
    expect(blob).not.toMatch(/devtok|https:\/\/dev|API_URL|dev|prod/);
  });
});

describe('lock gating (I2)', () => {
  it('refuses get-env before unlock', () => {
    const r = sm.handle({ verb: 'get-env', env: 'dev' }, now);
    expect(r).toEqual({ ok: false, error: 'locked' });
  });

  it('soft lock (idle) refuses new requests but does NOT wipe mounts', () => {
    sm.unlock(resolveEnv, now);
    now = T0 + 1000; // idle timeout reached
    const r = sm.handle({ verb: 'get-env', env: 'dev' }, now);
    expect(r).toEqual({ ok: false, error: 'locked' });
    expect(sm.status(now).status).toBe(LOCK_STATUS.SOFT_LOCKED);
    expect(sm.status(now).mountsLive).toBe(true);
    expect(wipes).toBe(0); // I1: mounts kept
  });

  it('explicit lock wipes mounts and drops the key', () => {
    sm.unlock(resolveEnv, now);
    sm.lock();
    expect(wipes).toBe(1);
    expect(sm.handle({ verb: 'get-env', env: 'dev' }, now).error).toBe(
      'locked'
    );
  });

  it('max lifetime hard-locks and wipes', () => {
    sm.unlock(resolveEnv, now);
    now = T0 + 10000;
    sm.tick(now);
    expect(wipes).toBe(1);
    expect(sm.status(now).status).toBe(LOCK_STATUS.LOCKED);
  });
});

describe('reads do not keep a session alive (G28)', () => {
  it('idle fires at unlock+timeout regardless of get-env traffic', () => {
    sm.unlock(resolveEnv, now);
    // hammer get-env right up to the timeout — these must NOT postpone the lock
    for (let t = 100; t < 1000; t += 100) {
      now = T0 + t;
      expect(sm.handle({ verb: 'get-env', env: 'dev' }, now).ok).toBe(true);
    }
    now = T0 + 1000;
    const r = sm.handle({ verb: 'get-env', env: 'dev' }, now);
    expect(r.error).toBe('locked'); // idle fired despite all the reads
  });

  it('re-unlock restarts the session and serves again', () => {
    sm.unlock(resolveEnv, now);
    now = T0 + 1000;
    expect(sm.handle({ verb: 'get-env', env: 'dev' }, now).ok).toBe(false);
    sm.unlock(resolveEnv, now); // user re-authenticates
    expect(sm.handle({ verb: 'get-env', env: 'dev' }, now).ok).toBe(true);
  });
});

describe('unlock guard', () => {
  it('throws without a resolver function', () => {
    expect(() => sm.unlock(null, now)).toThrow(/resolveEnv/);
  });
});
