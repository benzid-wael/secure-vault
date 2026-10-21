import crypto from 'crypto';
import fsSync from 'fs';
import fsDefault from 'fs/promises';
import os from 'os';

const BACKOFF_MS = [50, 100, 200, 400];
// Two readings of the boot time on the same machine differ by clock noise
// only; another machine's boot time is, in practice, never this close.
const SAME_BOOT_TOLERANCE_MS = 60 * 1000;

/** True unless `pid` names no process (EPERM: it exists, owned by another user). */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

/** This machine's boot time, in ms since the epoch. */
export function machineBootTime() {
  return Date.now() - os.uptime() * 1000;
}

/**
 * The pid namespace this process lives in (`pid:[4026531836]`), on Linux;
 * undefined elsewhere or when /proc is unreadable. A container shares the
 * host's kernel, so it reports the host's boot time, but its pids mean
 * something else: a pid is only worth probing from the same namespace.
 */
export function currentPidNamespace({
  platform = process.platform,
  readlink = fsSync.readlinkSync,
} = {}) {
  if (platform !== 'linux') return undefined;
  try {
    return readlink('/proc/self/ns/pid');
  } catch {
    return undefined;
  }
}

/**
 * An exclusive, cross-process lock on one vault file: `<vault>.lock`
 * (GUI-ENV-RFC §6.5). Every writer of the vault takes it for the length of a
 * single read-modify-write, so two writers can never interleave.
 *
 * Staleness: a lock left by a process on this machine (same boot time and,
 * on Linux, same pid namespace) is stale only once that pid is dead. A live holder is never taken over, however
 * long it runs (a change-password re-keying many snapshots). A lock from
 * another machine (a synced folder) can't be probed, so it's stale once its
 * mtime, which the holder's heartbeat keeps touching, is older than `staleMs`.
 *
 * Usage: `const r = await lock.acquire(); if (!r.success) …; try { … }
 * finally { await lock.release(); }`
 */
export class VaultLock {
  #path;
  #fs;
  #now;
  #sleep;
  #isAlive;
  #bootTime;
  #pidNamespace;
  #pid;
  #host;
  #tool;
  #timeoutMs;
  #staleMs;
  #heartbeatMs;
  #nonce = null;
  #heartbeat = null;
  #lost = false;

  constructor(
    vaultPath,
    {
      tool = 'cli',
      timeoutMs = 3000,
      staleMs = 30000,
      heartbeatMs = 5000,
      now = Date.now,
      sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isAlive = isProcessAlive,
      bootTime = machineBootTime,
      pidNamespace = currentPidNamespace,
      pid = process.pid,
      host = os.hostname(),
      fs = fsDefault,
    } = {}
  ) {
    this.#path = `${vaultPath}.lock`;
    this.#fs = fs;
    this.#now = now;
    this.#sleep = sleep;
    this.#isAlive = isAlive;
    this.#bootTime = bootTime;
    this.#pidNamespace = pidNamespace;
    this.#pid = pid;
    this.#host = host;
    this.#tool = tool;
    this.#timeoutMs = timeoutMs;
    this.#staleMs = staleMs;
    this.#heartbeatMs = heartbeatMs;
  }

  get path() {
    return this.#path;
  }

  /** True once the heartbeat found the lock gone (taken over or deleted). */
  get lost() {
    return this.#lost;
  }

  /**
   * @typedef {Object} LockResult
   * @property {boolean} success
   * @property {'BUSY'|'ERROR'} [code] - set when `success` is false
   * @property {string} [error]
   * @property {Object} [holder] - the current lock's contents, on `BUSY`
   */

  /** @returns {Promise<LockResult>} */
  async acquire() {
    if (this.#nonce) {
      return { success: false, code: 'ERROR', error: 'Lock already held' };
    }
    try {
      return await this.#acquireLoop();
    } catch (error) {
      return { success: false, code: 'ERROR', error: error.message };
    }
  }

  /** @returns {Promise<LockResult>} */
  async #acquireLoop() {
    const start = this.#now();
    for (let attempt = 0; ; attempt++) {
      const nonce = crypto.randomBytes(16).toString('hex');
      try {
        await this.#create(nonce);
        this.#nonce = nonce;
        this.#lost = false;
        this.#startHeartbeat();
        return { success: true };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }

      const holder = await this.#readHolder();
      if (holder === null) continue; // released between our create and read
      if (this.#isStale(holder) && (await this.#takeOver(holder))) continue;

      if (this.#now() - start >= this.#timeoutMs) {
        return {
          success: false,
          code: 'BUSY',
          error: this.#busyMessage(holder),
          holder: holder.info,
        };
      }
      await this.#sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }

  /** Remove the lock if it is still ours. Safe to call more than once. */
  async release() {
    this.#stopHeartbeat();
    const nonce = this.#nonce;
    this.#nonce = null;
    if (!nonce) return;
    const holder = await this.#readHolder();
    if (holder?.info?.nonce !== nonce) return; // not ours any more
    try {
      await this.#fs.unlink(this.#path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  /** Touch the lock's mtime, so a reader on another machine sees it alive. */
  async refresh() {
    if (!this.#nonce) return;
    const t = new Date(this.#now());
    try {
      // utimes, not a rewrite: it can't recreate a lock someone took over.
      await this.#fs.utimes(this.#path, t, t);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.#lost = true;
        this.#stopHeartbeat();
      }
    }
  }

  async #create(nonce) {
    const handle = await this.#fs.open(this.#path, 'wx', 0o600);
    try {
      const at = this.#now();
      await handle.writeFile(
        JSON.stringify({
          v: 1,
          pid: this.#pid,
          host: this.#host,
          tool: this.#tool,
          nonce,
          boot: new Date(this.#bootTime()).toISOString(),
          // Omitted (undefined) off Linux, so it compares equal there.
          pidns: this.#pidNamespace(),
          acquiredAt: new Date(at).toISOString(),
        })
      );
      // The heartbeat's clock, not the filesystem's, defines freshness.
      await handle.utimes(new Date(at), new Date(at));
    } catch (error) {
      // We created it, so it's ours to remove: a half-written lock would
      // otherwise block every writer until it looks stale.
      await handle.close().catch(() => {});
      await this.#fs.unlink(this.#path).catch(() => {});
      throw error;
    }
    await handle.close();
  }

  /** `{ info, mtimeMs }`, `info` null when unreadable; null when no lock. */
  async #readHolder() {
    try {
      const [content, stat] = await Promise.all([
        this.#fs.readFile(this.#path, 'utf8'),
        this.#fs.stat(this.#path),
      ]);
      let info = null;
      try {
        info = JSON.parse(content);
      } catch {
        // Being written right now, or garbage: judged by mtime alone.
      }
      return { info, mtimeMs: stat.mtimeMs };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  #isStale({ info, mtimeMs }) {
    // Same boot time alone isn't enough on Linux: a container shares the
    // kernel. Its pids are only meaningful in its own pid namespace.
    const sameMachine =
      info?.boot !== undefined &&
      Math.abs(Date.parse(info.boot) - this.#bootTime()) <=
        SAME_BOOT_TOLERANCE_MS &&
      info.pidns === this.#pidNamespace();
    if (sameMachine && Number.isInteger(info.pid)) {
      return !this.#isAlive(info.pid);
    }
    return this.#now() - mtimeMs > this.#staleMs;
  }

  /**
   * Move a stale lock aside so `wx` can succeed. Rename is atomic, but it
   * moves whatever is at the path *now*: another taker may already have
   * replaced the stale lock with a live one. So check what was moved, and
   * put a live lock back.
   */
  async #takeOver(judged) {
    const aside = `${this.#path}.stale.${crypto.randomBytes(8).toString('hex')}`;
    try {
      await this.#fs.rename(this.#path, aside);
    } catch (error) {
      if (error.code === 'ENOENT') return true; // someone else moved it
      throw error;
    }
    const moved = await this.#readAside(aside);
    if (judged.info !== null && moved?.nonce !== judged.info.nonce) {
      try {
        await this.#fs.link(aside, this.#path);
      } catch {
        // A third writer created a lock meanwhile; theirs stands.
      }
      await this.#fs.unlink(aside).catch(() => {});
      return false;
    }
    await this.#fs.unlink(aside).catch(() => {});
    return true;
  }

  async #readAside(aside) {
    try {
      return JSON.parse(await this.#fs.readFile(aside, 'utf8'));
    } catch {
      return null;
    }
  }

  #startHeartbeat() {
    this.#heartbeat = setInterval(() => {
      this.refresh();
    }, this.#heartbeatMs);
    // Never keep a CLI process alive just to touch a lock.
    this.#heartbeat.unref?.();
  }

  #stopHeartbeat() {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #busyMessage({ info }) {
    const who = info
      ? `held by ${info.tool ?? 'a vault process'} pid ${info.pid}` +
        (info.acquiredAt ? ` since ${info.acquiredAt}` : '')
      : 'held by an unknown process';
    return (
      `Vault is busy (${who}). Try again, or remove ${this.#path} ` +
      'if no vault command is running.'
    );
  }
}
