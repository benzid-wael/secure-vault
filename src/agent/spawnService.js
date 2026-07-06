import { STREAMING } from './daemon.js';

/**
 * Spawn service — spawn-based delivery (SPEC §13.5, gap G24 / §5.4 mode A).
 *
 * Instead of handing secrets back over the socket (where any same-UID process
 * that dials in could request them) or writing them to disk (a mount/export
 * file), the daemon SPAWNS the build itself as its own child and injects the
 * scoped env into that child. The secret therefore never crosses the socket and
 * never touches disk — it lives only in the child's memory for the run (§5.4
 * mode A: "None (memory only)" at-rest window, the safest delivery mode). The
 * child's stdout/stderr are relayed back to the CLI over the connection.
 *
 * Enforcement: vars are pulled through `session.handle('get-env')`, so a locked
 * session refuses the spawn (I2) and there is no enumeration (G23). `buildChildEnv`
 * and `spawnFn` are injected so this never imports from `bin/` and is unit-testable
 * without a real process.
 *
 * Residual (documented, deferred to 7b): the `exec` verb is still reachable over
 * the same-UID socket — peer-cred (also G24) is a native-addon follow-up — and an
 * env-injected secret is visible in the child's /proc/<pid>/environ (I1, the
 * mode-A residual in §5.2). This closes the delivery-mechanism half of G24, not
 * the socket-hardening half.
 */
export function createSpawnService({ session, spawnFn, buildChildEnv }) {
  function exec(req, ctx) {
    const argv = req && req.argv;
    if (!Array.isArray(argv) || argv.length === 0) {
      ctx.send({ ok: false, error: 'exec requires a non-empty "argv"' });
      return STREAMING;
    }

    // Pull the scoped env through the session — refused while locked (I2),
    // no enumeration (G23). Never sent back to the client; injected into the child.
    const got = session.handle({
      verb: 'get-env',
      env: req.env,
      keys: req.keys,
    });
    if (!got.ok) {
      ctx.send({ ok: false, error: got.error });
      return STREAMING;
    }

    const childEnv = buildChildEnv({
      mode: req.mode === 'merge' ? 'merge' : 'clean',
      vars: got.data,
      parentEnv: process.env,
    });

    let child;
    try {
      child = spawnFn(argv[0], argv.slice(1), {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      ctx.send({ ok: false, error: err.message });
      return STREAMING;
    }

    let settled = false;
    const finish = (msg) => {
      if (settled) return;
      settled = true;
      ctx.send(msg);
    };

    if (child.stdout) {
      child.stdout.on('data', (d) =>
        ctx.send({ stream: 'stdout', chunk: Buffer.from(d).toString('base64') })
      );
    }
    if (child.stderr) {
      child.stderr.on('data', (d) =>
        ctx.send({ stream: 'stderr', chunk: Buffer.from(d).toString('base64') })
      );
    }

    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.on('close', (code, signal) =>
      finish({ ok: true, data: { code, signal } })
    );

    // If the client (CLI) goes away — e.g. the user hits Ctrl-C — take the build
    // down with it; a spawned build must not outlive the request that asked for it.
    if (ctx.conn && typeof ctx.conn.on === 'function') {
      ctx.conn.on('close', () => {
        if (!settled) {
          try {
            child.kill('SIGTERM');
          } catch {
            /* already gone */
          }
        }
      });
    }

    return STREAMING;
  }

  return { exec };
}
