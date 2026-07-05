/**
 * Agent lock state machine — the G12 / Task 6 two-tier lock contract in code
 * (SPEC §13.5, docs/environments/AGENT-DESIGN.md §4).
 *
 * This is pure: it holds no key, no sockets, no timers — just status +
 * timestamps, and it reports the *effects* the daemon must apply on each
 * transition (drop the key, wipe mounts). Keeping it pure is deliberate: the
 * security-critical transitions are unit-tested with zero platform coupling.
 *
 * Time is passed in (`now`, epoch ms) rather than read from the clock, so the
 * machine is deterministic and testable.
 */

export const LOCK_STATUS = {
  /** No key in memory, no live mounts. Initial + hard-locked state. */
  LOCKED: 'locked',
  /** Key held; serving requests; mounts live. */
  UNLOCKED: 'unlocked',
  /** Idle-locked: key dropped, but mounts kept live (I1); new requests refused. */
  SOFT_LOCKED: 'soft-locked',
};

/** Defaults: 30-min idle timeout, 8-hour hard session cap (SPEC §13.5). */
export const DEFAULT_LOCK_CONFIG = {
  idleTimeoutMs: 30 * 60 * 1000,
  maxLifetimeMs: 8 * 60 * 60 * 1000,
};

const NO_EFFECTS = Object.freeze({ dropKey: false, wipeMounts: false });

function locked() {
  return { status: LOCK_STATUS.LOCKED, sessionStart: null, lastActivity: null };
}

/** Fresh, locked state. */
export function initialState() {
  return locked();
}

/** True while the agent may serve a NEW request (only when fully unlocked). */
export function canServeNewRequest(state) {
  return state.status === LOCK_STATUS.UNLOCKED;
}

/** True while mounted files remain on disk (unlocked or idle/soft-locked). */
export function mountsRetained(state) {
  return (
    state.status === LOCK_STATUS.UNLOCKED ||
    state.status === LOCK_STATUS.SOFT_LOCKED
  );
}

/** Acquire the key. Starts both the idle timer and the session-lifetime clock. */
export function unlock(_state, now) {
  return {
    state: {
      status: LOCK_STATUS.UNLOCKED,
      sessionStart: now,
      lastActivity: now,
    },
    effects: NO_EFFECTS,
  };
}

/**
 * Record a *user-authenticated* action (an unlock, a biometric approval) — the
 * ONLY thing that resets the idle timer. Raw IPC requests and mounted-file reads
 * deliberately do NOT call this, which is what closes the G28 synthetic-activity
 * attack. No-op unless currently unlocked.
 */
export function recordActivity(state, now) {
  if (state.status !== LOCK_STATUS.UNLOCKED) return state;
  return { ...state, lastActivity: now };
}

/**
 * Advance the clock. Emits effects only on the transition it performs this call
 * (so repeated ticks in the same state are idempotent — no duplicate wipes).
 *
 * - session age ≥ maxLifetime → hard lock (drop key + wipe mounts), from any
 *   live state;
 * - else idle ≥ idleTimeout while unlocked → soft lock (drop key, keep mounts).
 */
export function evaluate(state, now, config = DEFAULT_LOCK_CONFIG) {
  const { idleTimeoutMs, maxLifetimeMs } = {
    ...DEFAULT_LOCK_CONFIG,
    ...config,
  };

  if (state.status === LOCK_STATUS.LOCKED) {
    return { state, effects: NO_EFFECTS };
  }

  // Hard cap on total session (and mount) lifetime, regardless of activity.
  if (maxLifetimeMs != null && now - state.sessionStart >= maxLifetimeMs) {
    return { state: locked(), effects: { dropKey: true, wipeMounts: true } };
  }

  if (state.status === LOCK_STATUS.UNLOCKED) {
    if (idleTimeoutMs != null && now - state.lastActivity >= idleTimeoutMs) {
      // Soft lock: key gone, mounts stay (I1); new requests refused (I2).
      return {
        state: { ...state, status: LOCK_STATUS.SOFT_LOCKED },
        effects: { dropKey: true, wipeMounts: false },
      };
    }
  }

  // SOFT_LOCKED with lifetime remaining: hold (wait for max-lifetime or suspend).
  return { state, effects: NO_EFFECTS };
}

/**
 * Hard lock now — sleep, screen-lock, or an explicit `agent lock`. Always drops
 * the key and wipes mounts if any were live.
 */
export function hardLock(state) {
  const wipeMounts = mountsRetained(state);
  return {
    state: locked(),
    effects: { dropKey: wipeMounts, wipeMounts },
  };
}
