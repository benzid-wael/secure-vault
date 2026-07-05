import {
  DEFAULT_LOCK_CONFIG,
  initialState,
  unlock as lockUnlock,
  evaluate,
  hardLock,
  canServeNewRequest,
  mountsRetained,
} from './lockState.js';

/**
 * SessionManager — the agent's security core (SPEC §13.5, AGENT-DESIGN.md §3–4).
 *
 * It holds the unlocked session (an injected `resolveEnv` closure that stands in
 * for key custody) and the lock state machine, and it is the ONLY place the
 * request-scoped protocol (G23) is enforced. Transport (Unix socket, launchd) is
 * a thin shell around this object, so all the security-relevant behavior is
 * unit-testable with an injected clock and no sockets.
 *
 * Invariants enforced here:
 *  - G23: the only data verbs are `status` (metadata only) and `get-env` (one
 *    named env, optional key subset). There is no `list-envs` / `dump-all`, and
 *    unknown verbs are rejected.
 *  - I2 (containment): `get-env` is refused unless fully unlocked.
 *  - G28: `get-env` never resets the idle timer — reads cannot keep a session
 *    alive. Only `unlock` (a user-authenticated action) does.
 */
export class SessionManager {
  constructor({
    config = DEFAULT_LOCK_CONFIG,
    clock = () => Date.now(),
    onWipeMounts = () => {},
  } = {}) {
    this._config = config;
    this._clock = clock;
    this._onWipeMounts = onWipeMounts;
    this._lock = initialState();
    // Key custody: an env-name -> resolved-vars closure, set on unlock and
    // dropped on any lock. In 7a the caller decrypts the vault and passes this
    // in; 7b swaps it for HW-backed decrypt-on-demand.
    this._resolveEnv = null;
  }

  _applyEffects(effects) {
    if (effects.wipeMounts) {
      try {
        this._onWipeMounts();
      } catch {
        // Wiping is best-effort; never throw out of a lock transition.
      }
    }
    if (effects.dropKey) this._resolveEnv = null;
  }

  /**
   * Acquire the session. `resolveEnv(name)` returns that env's resolved vars (or
   * throws if the env is unknown). This is the user-authenticated action that
   * (re)starts the idle and lifetime clocks.
   */
  unlock(resolveEnv, now = this._clock()) {
    if (typeof resolveEnv !== 'function') {
      throw new TypeError('unlock requires a resolveEnv(name) function');
    }
    const { state } = lockUnlock(this._lock, now);
    this._lock = state;
    this._resolveEnv = resolveEnv;
    return { ok: true };
  }

  /** Explicit hard lock (also used for sleep / screen-lock): wipe + drop key. */
  lock() {
    const { state, effects } = hardLock(this._lock);
    this._lock = state;
    this._applyEffects(effects);
    return { ok: true };
  }

  /** Advance the lock clock and apply any resulting soft/hard-lock effects. */
  tick(now = this._clock()) {
    const { state, effects } = evaluate(this._lock, now, this._config);
    this._lock = state;
    this._applyEffects(effects);
    return effects;
  }

  /** Metadata only — never values or env names (G23). */
  status(now = this._clock()) {
    return {
      status: this._lock.status,
      unlocked: canServeNewRequest(this._lock),
      mountsLive: mountsRetained(this._lock),
      uptimeMs:
        this._lock.sessionStart == null
          ? 0
          : Math.max(0, now - this._lock.sessionStart),
    };
  }

  /**
   * Dispatch a client request. Advances the lock clock first, so a request that
   * arrives after the idle timeout is correctly refused. Returns a plain
   * `{ ok, data | error }` result (never throws).
   */
  handle(req, now = this._clock()) {
    this.tick(now);
    const verb = req && req.verb;
    switch (verb) {
      case 'status':
        return { ok: true, data: this.status(now) };
      case 'get-env':
        return this._getEnv(req);
      default:
        // No enumeration, no dump-all, no unknown verbs — ever (G23).
        return { ok: false, error: `Unsupported verb "${verb}"` };
    }
  }

  _getEnv(req) {
    if (!canServeNewRequest(this._lock)) {
      return { ok: false, error: 'locked' };
    }
    if (!req.env || typeof req.env !== 'string') {
      return { ok: false, error: 'get-env requires an "env" name' };
    }

    let vars;
    try {
      vars = this._resolveEnv(req.env);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    // Deliberately NOT recording activity: a build reading its env must not keep
    // the session alive (G28).
    if (Array.isArray(req.keys)) {
      const scoped = {};
      for (const k of req.keys) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) scoped[k] = vars[k];
      }
      return { ok: true, data: scoped };
    }
    return { ok: true, data: vars };
  }
}
