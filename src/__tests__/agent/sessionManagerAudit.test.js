// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { SessionManager } from '../../agent/sessionManager.js';

function fakeAudit() {
  const records = [];
  return { records, record: (e) => records.push(e) };
}

const resolver = () => ({ API_URL: 'https://dev' });

describe('SessionManager audit hooks (G27)', () => {
  it('records a successful unlock', () => {
    const audit = fakeAudit();
    const s = new SessionManager({ audit, clock: () => 0 });
    s.unlock(resolver);
    expect(audit.records).toContainEqual({ type: 'unlock', result: 'ok' });
  });

  it('records a rejected unlock via noteFailedUnlock', () => {
    const audit = fakeAudit();
    const s = new SessionManager({ audit, clock: () => 0 });
    s.noteFailedUnlock();
    expect(audit.records).toContainEqual({ type: 'unlock', result: 'refused' });
  });

  it('records a served get-env with its source, never the values', () => {
    const audit = fakeAudit();
    const s = new SessionManager({ audit, clock: () => 0 });
    s.unlock(resolver);
    const res = s.handle({ verb: 'get-env', env: 'dev', source: 'exec' });
    expect(res.ok).toBe(true);
    expect(audit.records).toContainEqual({
      type: 'get-env',
      env: 'dev',
      result: 'ok',
      source: 'exec',
    });
    // the recorded event carries no secret values
    const getEnvEvents = audit.records.filter((e) => e.type === 'get-env');
    for (const e of getEnvEvents) {
      expect(JSON.stringify(e)).not.toContain('https://dev');
    }
  });

  it('records a refused get-env while locked', () => {
    const audit = fakeAudit();
    const s = new SessionManager({ audit, clock: () => 0 });
    const res = s.handle({ verb: 'get-env', env: 'dev' });
    expect(res.ok).toBe(false);
    expect(audit.records).toContainEqual({
      type: 'get-env',
      env: 'dev',
      result: 'refused',
      source: null,
    });
  });

  it('records an explicit lock', () => {
    const audit = fakeAudit();
    const s = new SessionManager({ audit, clock: () => 0 });
    s.unlock(resolver);
    s.lock();
    expect(audit.records).toContainEqual({ type: 'lock', result: 'ok' });
  });

  it('records a soft auto-lock when the idle timeout elapses', () => {
    const audit = fakeAudit();
    const s = new SessionManager({
      audit,
      config: { idleTimeoutMs: 100, maxLifetimeMs: 10000 },
    });
    s.unlock(resolver, 0);
    s.tick(200); // past idle → soft lock (drop key, keep mounts)
    expect(audit.records).toContainEqual({ type: 'auto-lock', tier: 'soft' });
  });

  it('records a hard auto-lock at max session lifetime', () => {
    const audit = fakeAudit();
    const s = new SessionManager({
      audit,
      config: { idleTimeoutMs: 10000, maxLifetimeMs: 100 },
    });
    s.unlock(resolver, 0);
    s.tick(200); // past lifetime → hard lock (wipe mounts)
    expect(audit.records).toContainEqual({ type: 'auto-lock', tier: 'hard' });
  });

  it('never throws out of a session op if the audit sink throws', () => {
    const s = new SessionManager({
      audit: {
        record: () => {
          throw new Error('disk full');
        },
      },
      clock: () => 0,
    });
    expect(() => s.unlock(resolver)).not.toThrow();
    expect(() => s.handle({ verb: 'get-env', env: 'dev' })).not.toThrow();
    expect(() => s.lock()).not.toThrow();
  });
});
