import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

/**
 * Agent daemon transport (AGENT-DESIGN.md §1, §3).
 *
 * A thin Unix-domain-socket shell around SessionManager: it frames requests
 * (newline-delimited JSON), delegates data verbs to `session.handle()`, and owns
 * the control verbs that need process/crypto authority (`unlock`, `lock`,
 * `shutdown`). All security-relevant policy lives in SessionManager, not here.
 *
 * Known limitation (documented, not faked): Node cannot read
 * SO_PEERCRED/LOCAL_PEERCRED without a native addon, so there is no peer-credential
 * check. The socket lives in a 0700 directory and the protocol is request-scoped;
 * per AGENT-DESIGN.md §3 peer-cred is a speed-bump, not a boundary, and is
 * deferred to a follow-up.
 */

/**
 * Sentinel an injected handler returns to signal "I have taken over this
 * connection and will write my own (possibly streaming) responses" — the
 * transport then skips its default one-shot response write. Used by the spawn
 * service to relay a child's stdout/stderr back over the socket.
 */
export const STREAMING = Symbol('vault-agent-streaming');

/**
 * Per-user runtime paths for the agent (socket + pidfile in a 0700 dir).
 * `VAULT_AGENT_DIR` overrides the location — useful for tests and for relocating
 * the runtime dir off a noexec/again tmpfs.
 */
export function agentPaths() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const dir =
    process.env.VAULT_AGENT_DIR || path.join(os.tmpdir(), `vault-agent-${uid}`);
  return {
    dir,
    socket: path.join(dir, 'agent.sock'),
    pid: path.join(dir, 'agent.pid'),
  };
}

/**
 * Start the daemon server. `unlockVault(password)` returns a `resolveEnv(name)`
 * closure (or throws on a bad password) — injected so the crypto is swappable
 * and tests need no real vault. Returns `{ socketPath, close() }`.
 */
export async function startDaemonServer({
  session,
  socketPath,
  unlockVault,
  tickIntervalMs = 5000,
  onShutdown = () => {},
  handlers = {},
}) {
  await fs.ensureDir(path.dirname(socketPath));
  await fs.chmod(path.dirname(socketPath), 0o700);
  // Clear a stale socket from a prior crash so bind() succeeds.
  await fs.remove(socketPath);

  const dispatch = async (req, ctx) => {
    // Injected control handlers (e.g. mount/mounts/unmount, exec) take precedence
    // over the built-in verbs; they capture the session + registry in their
    // closures. A streaming handler uses `ctx` to write its own responses and
    // returns STREAMING so the transport skips the default response write.
    if (req && handlers[req.verb]) {
      return handlers[req.verb](req, ctx);
    }
    switch (req && req.verb) {
      case 'unlock':
        try {
          const resolveEnv = await unlockVault(req.password);
          session.unlock(resolveEnv);
          return { ok: true, data: session.status() };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      case 'lock':
        session.lock();
        return { ok: true };
      case 'shutdown':
        setImmediate(() => close());
        return { ok: true };
      default:
        // status / get-env / unknown — all policed by SessionManager (G23).
        return session.handle(req);
    }
  };

  const server = net.createServer((conn) => {
    conn.setEncoding('utf8');
    let buf = '';
    const ctx = {
      conn,
      send: (obj) => conn.write(`${JSON.stringify(obj)}\n`),
    };
    conn.on('data', async (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let res;
        try {
          res = await dispatch(JSON.parse(line), ctx);
        } catch (err) {
          res = { ok: false, error: `bad request: ${err.message}` };
        }
        // A streaming handler owns its own writes; don't double-respond.
        if (res !== STREAMING) conn.write(`${JSON.stringify(res)}\n`);
      }
    });
    conn.on('error', () => {
      /* client hangups are not the daemon's problem */
    });
  });

  const ticker = setInterval(() => session.tick(), tickIntervalMs);
  if (typeof ticker.unref === 'function') ticker.unref();

  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(ticker);
    // Lock on shutdown so mounts are wiped and the key is dropped.
    try {
      session.lock();
    } catch {
      /* best-effort */
    }
    await new Promise((resolve) => server.close(resolve));
    await fs.remove(socketPath).catch(() => {});
    onShutdown();
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  await fs.chmod(socketPath, 0o600).catch(() => {});

  return { socketPath, close };
}

/**
 * Send one request to a running daemon and resolve its response. Rejects if the
 * socket is unreachable (daemon not running) or the timeout elapses.
 */
export function sendRequest(socketPath, req, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(socketPath);
    let buf = '';
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error('agent request timed out'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    conn.setEncoding('utf8');
    conn.on('connect', () => conn.write(`${JSON.stringify(req)}\n`));
    conn.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (err) {
          reject(new Error(`bad response: ${err.message}`));
        }
        conn.end();
      }
    });
    conn.on('error', (err) => {
      clearTimeout(timer);
      const code = err && 'code' in err ? err.code : undefined;
      reject(
        code === 'ENOENT' || code === 'ECONNREFUSED'
          ? new Error('agent is not running')
          : err
      );
    });
  });
}

/**
 * Open a streaming request: send one request, relay every intermediate
 * `{ stream, chunk }` event to `onEvent`, and resolve with the terminal
 * `{ ok, ... }` message. Used by `agent exec` to stream a child's output.
 *
 * When `signal` aborts (the CLI caught Ctrl-C), the connection is destroyed —
 * the daemon takes the child down on close — and the promise resolves with a
 * conventional 130 exit so the caller can propagate it.
 */
export function streamRequest(
  socketPath,
  req,
  { onEvent = () => {}, signal } = {}
) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(socketPath);
    let buf = '';
    let settled = false;
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      fn(val);
    };

    const onAbort = () => {
      try {
        conn.destroy();
      } catch {
        /* already gone */
      }
      settle(resolve, { ok: true, data: { code: 130, signal: 'SIGINT' } });
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    conn.setEncoding('utf8');
    conn.on('connect', () => conn.write(`${JSON.stringify(req)}\n`));
    conn.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg && msg.stream) {
          onEvent(msg);
          continue;
        }
        settle(resolve, msg);
        conn.end();
        return;
      }
    });
    conn.on('error', (err) => {
      const code = err && 'code' in err ? err.code : undefined;
      settle(
        reject,
        code === 'ENOENT' || code === 'ECONNREFUSED'
          ? new Error('agent is not running')
          : err
      );
    });
    conn.on('close', () =>
      settle(reject, new Error('agent closed the connection'))
    );
  });
}

/** True if a daemon is reachable at socketPath. */
export async function isDaemonRunning(socketPath) {
  try {
    const res = await sendRequest(
      socketPath,
      { verb: 'status' },
      { timeoutMs: 1500 }
    );
    return !!res;
  } catch {
    return false;
  }
}
