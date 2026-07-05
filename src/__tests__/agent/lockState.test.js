// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  LOCK_STATUS,
  DEFAULT_LOCK_CONFIG,
  initialState,
  unlock,
  recordActivity,
  evaluate,
  hardLock,
  canServeNewRequest,
  mountsRetained,
} from '../../agent/lockState.js';

const CFG = { idleTimeoutMs: 1000, maxLifetimeMs: 10000 };
const T0 = 1_000_000; // arbitrary epoch base (clock is injected)

describe('initial + unlock', () => {
  it('starts locked, serving nothing, no mounts', () => {
    const s = initialState();
    expect(s.status).toBe(LOCK_STATUS.LOCKED);
    expect(canServeNewRequest(s)).toBe(false);
    expect(mountsRetained(s)).toBe(false);
  });

  it('unlock holds the key and starts both clocks', () => {
    const { state, effects } = unlock(initialState(), T0);
    expect(state.status).toBe(LOCK_STATUS.UNLOCKED);
    expect(state.sessionStart).toBe(T0);
    expect(state.lastActivity).toBe(T0);
    expect(effects).toEqual({ dropKey: false, wipeMounts: false });
    expect(canServeNewRequest(state)).toBe(true);
    expect(mountsRetained(state)).toBe(true);
  });
});

describe('soft lock (idle timeout)', () => {
  it('drops the key but KEEPS mounts, and refuses new requests', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state, effects } = evaluate(u, T0 + 1000, CFG);
    expect(state.status).toBe(LOCK_STATUS.SOFT_LOCKED);
    expect(effects).toEqual({ dropKey: true, wipeMounts: false });
    expect(canServeNewRequest(state)).toBe(false); // I2: no new envs
    expect(mountsRetained(state)).toBe(true); // I1: file already on disk
  });

  it('does not fire before the idle timeout elapses', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state, effects } = evaluate(u, T0 + 999, CFG);
    expect(state.status).toBe(LOCK_STATUS.UNLOCKED);
    expect(effects.dropKey).toBe(false);
  });

  it('is idempotent — ticking again while soft-locked emits no new effects', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state: soft } = evaluate(u, T0 + 1000, CFG);
    const { state, effects } = evaluate(soft, T0 + 2000, CFG);
    expect(state.status).toBe(LOCK_STATUS.SOFT_LOCKED);
    expect(effects).toEqual({ dropKey: false, wipeMounts: false });
  });
});

describe('idle timer resets only on user-authenticated activity (G28)', () => {
  it('recordActivity postpones the soft lock', () => {
    const { state: u } = unlock(initialState(), T0);
    const active = recordActivity(u, T0 + 900); // authenticated action at 900
    // 1000ms after unlock, but only 100ms after activity → still unlocked
    const { state } = evaluate(active, T0 + 1000, CFG);
    expect(state.status).toBe(LOCK_STATUS.UNLOCKED);
  });

  it('recordActivity is a no-op once soft-locked (must re-unlock)', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state: soft } = evaluate(u, T0 + 1000, CFG);
    const after = recordActivity(soft, T0 + 1100);
    expect(after).toBe(soft); // unchanged
    expect(after.status).toBe(LOCK_STATUS.SOFT_LOCKED);
  });
});

describe('hard cap (max session lifetime)', () => {
  it('wipes mounts when the cap is hit while unlocked', () => {
    const { state: u } = unlock(initialState(), T0);
    const active = recordActivity(u, T0 + 9999); // stay active so idle never fires
    const { state, effects } = evaluate(active, T0 + 10000, CFG);
    expect(state.status).toBe(LOCK_STATUS.LOCKED);
    expect(effects).toEqual({ dropKey: true, wipeMounts: true });
  });

  it('wipes mounts when the cap is hit while soft-locked', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state: soft } = evaluate(u, T0 + 1000, CFG); // soft-locked, mounts live
    const { state, effects } = evaluate(soft, T0 + 10000, CFG);
    expect(state.status).toBe(LOCK_STATUS.LOCKED);
    expect(effects.wipeMounts).toBe(true);
    expect(mountsRetained(state)).toBe(false);
  });
});

describe('hard lock (sleep / screen-lock / explicit)', () => {
  it('wipes mounts when locking from unlocked', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state, effects } = hardLock(u);
    expect(state.status).toBe(LOCK_STATUS.LOCKED);
    expect(effects).toEqual({ dropKey: true, wipeMounts: true });
  });

  it('wipes mounts when locking from soft-locked', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state: soft } = evaluate(u, T0 + 1000, CFG);
    const { effects } = hardLock(soft);
    expect(effects.wipeMounts).toBe(true);
  });

  it('is a harmless no-op when already locked', () => {
    const { effects } = hardLock(initialState());
    expect(effects).toEqual({ dropKey: false, wipeMounts: false });
  });
});

describe('config edges', () => {
  it('evaluate on a locked state never emits effects', () => {
    const { effects } = evaluate(initialState(), T0 + 999999, CFG);
    expect(effects).toEqual({ dropKey: false, wipeMounts: false });
  });

  it('null idleTimeout disables the soft lock', () => {
    const { state: u } = unlock(initialState(), T0);
    const { state } = evaluate(u, T0 + 100000, {
      idleTimeoutMs: null,
      maxLifetimeMs: 1_000_000,
    });
    expect(state.status).toBe(LOCK_STATUS.UNLOCKED);
  });

  it('null maxLifetime disables the hard cap', () => {
    const { state: u } = unlock(initialState(), T0);
    const active = recordActivity(u, T0 + 999_999);
    const { state } = evaluate(active, T0 + 1_000_000, {
      idleTimeoutMs: 1000,
      maxLifetimeMs: null,
    });
    // idle still applies (last activity was 1ms ago → unlocked)
    expect(state.status).toBe(LOCK_STATUS.UNLOCKED);
  });

  it('exposes sane defaults', () => {
    expect(DEFAULT_LOCK_CONFIG.idleTimeoutMs).toBe(30 * 60 * 1000);
    expect(DEFAULT_LOCK_CONFIG.maxLifetimeMs).toBe(8 * 60 * 60 * 1000);
  });
});
