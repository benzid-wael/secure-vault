import crypto from 'crypto';

/**
 * AuditLog — append-only, hash-chained audit trail for the agent (SPEC §13.5,
 * gap G27). Every security-relevant session event (unlock, env access, lock) is
 * recorded so theft is neither silent nor untraceable.
 *
 * Tamper-evidence is a hash chain: each entry hashes its own body plus the
 * previous entry's hash, so editing or deleting any earlier entry breaks every
 * hash after it — a same-UID process cannot silently rewrite history in place
 * (the §7-Task-9 validation), even though it can append or truncate (detectable
 * as a chain/seq break by `verifyAuditLog`).
 *
 * The `sink(line)` and `clock()` are injected so this is unit-testable without a
 * filesystem, and it NEVER records secret values — only metadata (event type,
 * env name, result). Client PID/binary attribution and biometric approval need
 * peer-cred / Secure Enclave (native, deferred to the rest of 7b / Task 12).
 */
const GENESIS = '0'.repeat(64);

function hashBody(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export class AuditLog {
  constructor({ sink, clock = () => Date.now(), prevHash = GENESIS, seq = 0 }) {
    if (typeof sink !== 'function') {
      throw new TypeError('AuditLog requires a sink(line) function');
    }
    this._sink = sink;
    this._clock = clock;
    this._prevHash = prevHash;
    this._seq = seq;
  }

  /** Append one event. `event` must be flat, JSON-safe metadata (no values). */
  record(event = {}) {
    const body = {
      seq: this._seq,
      ts: this._clock(),
      prevHash: this._prevHash,
      event,
    };
    const hash = hashBody(body);
    this._sink(`${JSON.stringify({ ...body, hash })}\n`);
    this._prevHash = hash;
    this._seq += 1;
    return { ...body, hash };
  }

  /** Hash of the last entry (chain head) — used to resume across restarts. */
  get head() {
    return this._prevHash;
  }

  /** Number of entries this instance has appended (its next seq). */
  get size() {
    return this._seq;
  }
}

/**
 * Verify a full log (array of JSON lines). Returns `{ ok: true, entries, head }`
 * for an intact chain, or `{ ok: false, brokenAt, reason }` at the first entry
 * whose seq, prevHash link, or content hash doesn't line up.
 */
export function verifyAuditLog(lines) {
  let prevHash = GENESIS;
  let seq = 0;
  const entries = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      return { ok: false, brokenAt: seq, reason: 'unparseable' };
    }
    const body = {
      seq: entry.seq,
      ts: entry.ts,
      prevHash: entry.prevHash,
      event: entry.event,
    };
    if (entry.seq !== seq) return { ok: false, brokenAt: seq, reason: 'seq' };
    if (entry.prevHash !== prevHash) {
      return { ok: false, brokenAt: seq, reason: 'chain' };
    }
    if (entry.hash !== hashBody(body)) {
      return { ok: false, brokenAt: seq, reason: 'hash' };
    }
    prevHash = entry.hash;
    seq += 1;
    entries.push(entry);
  }
  return { ok: true, entries, head: prevHash };
}

/**
 * Resume a chain from an existing log's lines: returns `{ prevHash, seq }` to
 * feed a new AuditLog so a daemon restart continues the same chain. Falls back
 * to a fresh chain if the log is empty or its tail is unreadable.
 */
export function resumeAuditChain(lines) {
  const clean = lines.filter((l) => l.trim());
  if (clean.length === 0) return { prevHash: GENESIS, seq: 0 };
  try {
    const last = JSON.parse(clean[clean.length - 1]);
    if (typeof last.hash === 'string' && Number.isInteger(last.seq)) {
      return { prevHash: last.hash, seq: last.seq + 1 };
    }
  } catch {
    /* fall through to a fresh chain */
  }
  return { prevHash: GENESIS, seq: 0 };
}
