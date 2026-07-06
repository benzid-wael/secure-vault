// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';

import { createSpawnService } from '../../agent/spawnService.js';
import { STREAMING } from '../../agent/daemon.js';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function fakeCtx() {
  const conn = new EventEmitter();
  const sent = [];
  return { conn, send: (obj) => sent.push(obj), sent };
}

// Pass vars straight through so the test can assert on the injected env.
const passthroughEnv = ({ vars }) => ({ ...vars });

const unlockedSession = (data = { API_URL: 'https://dev' }) => ({
  handle: vi.fn(() => ({ ok: true, data })),
});

describe('createSpawnService.exec', () => {
  it('refuses to spawn when the session is locked (I2)', () => {
    const spawnFn = vi.fn();
    const session = { handle: vi.fn(() => ({ ok: false, error: 'locked' })) };
    const svc = createSpawnService({
      session,
      spawnFn,
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();

    const ret = svc.exec({ env: 'dev', argv: ['node'] }, ctx);

    expect(ret).toBe(STREAMING);
    expect(ctx.sent).toEqual([{ ok: false, error: 'locked' }]);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('requires a non-empty argv', () => {
    const spawnFn = vi.fn();
    const svc = createSpawnService({
      session: unlockedSession(),
      spawnFn,
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();

    const ret = svc.exec({ env: 'dev', argv: [] }, ctx);

    expect(ret).toBe(STREAMING);
    expect(ctx.sent[0].ok).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('pulls the env through the session and injects it into the child', () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child);
    const session = unlockedSession({ API_URL: 'https://dev' });
    const svc = createSpawnService({
      session,
      spawnFn,
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();

    const ret = svc.exec({ env: 'dev', argv: ['node', '-v'] }, ctx);

    expect(ret).toBe(STREAMING);
    expect(session.handle).toHaveBeenCalledWith({
      verb: 'get-env',
      env: 'dev',
      keys: undefined,
      source: 'exec',
    });
    expect(spawnFn).toHaveBeenCalledWith(
      'node',
      ['-v'],
      expect.objectContaining({
        env: { API_URL: 'https://dev' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  });

  it('relays stdout/stderr as base64 and resolves with the exit code', () => {
    const child = fakeChild();
    const svc = createSpawnService({
      session: unlockedSession(),
      spawnFn: () => child,
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();
    svc.exec({ env: 'dev', argv: ['node'] }, ctx);

    child.stdout.emit('data', Buffer.from('out'));
    child.stderr.emit('data', Buffer.from('err'));
    child.emit('close', 0, null);

    expect(ctx.sent).toContainEqual({
      stream: 'stdout',
      chunk: Buffer.from('out').toString('base64'),
    });
    expect(ctx.sent).toContainEqual({
      stream: 'stderr',
      chunk: Buffer.from('err').toString('base64'),
    });
    expect(ctx.sent.at(-1)).toEqual({
      ok: true,
      data: { code: 0, signal: null },
    });
  });

  it('reports a spawn error (e.g. command not found)', () => {
    const child = fakeChild();
    const svc = createSpawnService({
      session: unlockedSession(),
      spawnFn: () => child,
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();
    svc.exec({ env: 'dev', argv: ['nope'] }, ctx);

    child.emit('error', new Error('spawn nope ENOENT'));

    expect(ctx.sent.at(-1)).toEqual({ ok: false, error: 'spawn nope ENOENT' });
  });

  it('reports a synchronous spawn throw', () => {
    const svc = createSpawnService({
      session: unlockedSession(),
      spawnFn: () => {
        throw new Error('boom');
      },
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();

    const ret = svc.exec({ env: 'dev', argv: ['x'] }, ctx);

    expect(ret).toBe(STREAMING);
    expect(ctx.sent.at(-1)).toEqual({ ok: false, error: 'boom' });
  });

  it('kills the child if the client disconnects before it exits', () => {
    const child = fakeChild();
    const svc = createSpawnService({
      session: unlockedSession(),
      spawnFn: () => child,
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();
    svc.exec({ env: 'dev', argv: ['node'] }, ctx);

    ctx.conn.emit('close');

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does not kill the child if it already exited', () => {
    const child = fakeChild();
    const svc = createSpawnService({
      session: unlockedSession(),
      spawnFn: () => child,
      buildChildEnv: passthroughEnv,
    });
    const ctx = fakeCtx();
    svc.exec({ env: 'dev', argv: ['node'] }, ctx);

    child.emit('close', 0, null);
    ctx.conn.emit('close');

    expect(child.kill).not.toHaveBeenCalled();
  });
});
