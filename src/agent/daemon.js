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
}) {
  await fs.ensureDir(path.dirname(socketPath));
  await fs.chmod(path.dirname(socketPath), 0o700);
  // Clear a stale socket from a prior crash so bind() succeeds.
  await fs.remove(socketPath);

  const dispatch = async (req) => {
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
    conn.on('data', async (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let res;
        try {
          res = await dispatch(JSON.parse(line));
        } catch (err) {
          res = { ok: false, error: `bad request: ${err.message}` };
        }
        conn.write(`${JSON.stringify(res)}\n`);
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
