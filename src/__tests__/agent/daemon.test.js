// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

import {
  startDaemonServer,
  sendRequest,
  isDaemonRunning,
} from '../../agent/daemon.js';
import { SessionManager } from '../../agent/sessionManager.js';

const CFG = { idleTimeoutMs: 1000, maxLifetimeMs: 100000 };
const ENVS = { dev: { API_URL: 'https://dev', TOKEN: 't' } };

let now;
let dir;
let socketPath;
let daemon;
let wipes;

// unlockVault stand-in: password "good" yields a resolver; anything else throws.
const unlockVault = (password) => {
  if (password !== 'good') throw new Error('Invalid password');
  return (name) => {
    if (!ENVS[name]) throw new Error(`Environment '${name}' not found`);
    return ENVS[name];
  };
};

beforeEach(async () => {
  now = 1_000_000;
  wipes = 0;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-daemon-'));
  socketPath = path.join(dir, 'agent.sock');
  const session = new SessionManager({
    config: CFG,
    clock: () => now,
    onWipeMounts: () => {
      wipes += 1;
    },
  });
  daemon = await startDaemonServer({
    session,
    socketPath,
    unlockVault,
    tickIntervalMs: 1_000_000, // don't auto-tick; drive via requests
  });
});

afterEach(async () => {
  await daemon.close().catch(() => {});
  await fs.remove(dir);
});

describe('daemon over a real unix socket', () => {
  it('reports running and creates a 0600 socket', async () => {
    expect(await isDaemonRunning(socketPath)).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect((await fs.stat(socketPath)).mode & 0o777).toBe(0o600);
  });

  it('unlock → get-env → lock round-trips', async () => {
    const bad = await sendRequest(socketPath, {
      verb: 'unlock',
      password: 'nope',
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Invalid password/);

    const ok = await sendRequest(socketPath, {
      verb: 'unlock',
      password: 'good',
    });
    expect(ok.ok).toBe(true);

    const env = await sendRequest(socketPath, { verb: 'get-env', env: 'dev' });
    expect(env.data).toEqual(ENVS.dev);

    const locked = await sendRequest(socketPath, { verb: 'lock' });
    expect(locked.ok).toBe(true);
    expect(wipes).toBe(1);

    const after = await sendRequest(socketPath, {
      verb: 'get-env',
      env: 'dev',
    });
    expect(after).toEqual({ ok: false, error: 'locked' });
  });

  it('status returns metadata only', async () => {
    await sendRequest(socketPath, { verb: 'unlock', password: 'good' });
    const res = await sendRequest(socketPath, { verb: 'status' });
    expect(res.data).toMatchObject({ status: 'unlocked', unlocked: true });
    expect(JSON.stringify(res.data)).not.toMatch(/API_URL|https:\/\/dev/);
  });

  it('rejects enumeration verbs over the wire', async () => {
    await sendRequest(socketPath, { verb: 'unlock', password: 'good' });
    const res = await sendRequest(socketPath, { verb: 'list-envs' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Unsupported verb/);
  });

  it('serves a key subset', async () => {
    await sendRequest(socketPath, { verb: 'unlock', password: 'good' });
    const res = await sendRequest(socketPath, {
      verb: 'get-env',
      env: 'dev',
      keys: ['API_URL'],
    });
    expect(res.data).toEqual({ API_URL: 'https://dev' });
  });

  it('shutdown closes the server and removes the socket', async () => {
    const res = await sendRequest(socketPath, { verb: 'shutdown' });
    expect(res.ok).toBe(true);
    // give the deferred close a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(await fs.pathExists(socketPath)).toBe(false);
    expect(await isDaemonRunning(socketPath)).toBe(false);
  });

  it('sendRequest reports a clear error when no daemon is listening', async () => {
    await expect(
      sendRequest(path.join(dir, 'nonexistent.sock'), { verb: 'status' })
    ).rejects.toThrow(/not running/);
  });
});
