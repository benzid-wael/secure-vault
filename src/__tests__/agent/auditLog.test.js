// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  AuditLog,
  verifyAuditLog,
  resumeAuditChain,
} from '../../agent/auditLog.js';

function collector() {
  const lines = [];
  return { lines, sink: (l) => lines.push(l) };
}

describe('AuditLog', () => {
  it('requires a sink function', () => {
    expect(() => new AuditLog({})).toThrow(/sink/);
  });

  it('records chained entries with advancing seq and head', () => {
    const { lines, sink } = collector();
    let t = 1000;
    const log = new AuditLog({ sink, clock: () => t++ });
    log.record({ type: 'unlock', result: 'ok' });
    log.record({ type: 'get-env', env: 'dev', result: 'ok' });

    expect(log.size).toBe(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].seq).toBe(0);
    expect(parsed[1].seq).toBe(1);
    expect(parsed[1].prevHash).toBe(parsed[0].hash);
    expect(log.head).toBe(parsed[1].hash);
    // never records values — only the metadata it was given
    expect(parsed[1].event).toEqual({
      type: 'get-env',
      env: 'dev',
      result: 'ok',
    });
  });

  it('verifies an intact chain', () => {
    const { lines, sink } = collector();
    const log = new AuditLog({ sink, clock: () => 5 });
    log.record({ type: 'a' });
    log.record({ type: 'b' });

    const res = verifyAuditLog(lines);
    expect(res.ok).toBe(true);
    expect(res.entries).toHaveLength(2);
    expect(res.head).toBe(log.head);
  });

  it('detects a tampered event body (hash mismatch)', () => {
    const { lines, sink } = collector();
    const log = new AuditLog({ sink, clock: () => 5 });
    log.record({ type: 'get-env', env: 'dev', result: 'ok' });
    log.record({ type: 'get-env', env: 'dev', result: 'ok' });

    const e0 = JSON.parse(lines[0]);
    e0.event.env = 'prod'; // rewrite history in place, keep the old hash
    lines[0] = JSON.stringify(e0);

    const res = verifyAuditLog(lines);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(0);
    expect(res.reason).toBe('hash');
  });

  it('detects a spliced-out middle entry', () => {
    const { lines, sink } = collector();
    const log = new AuditLog({ sink, clock: () => 5 });
    log.record({ type: 'a' });
    log.record({ type: 'b' });
    log.record({ type: 'c' });

    lines.splice(1, 1); // delete seq 1

    const res = verifyAuditLog(lines);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(1);
  });

  it('flags an unparseable line', () => {
    const res = verifyAuditLog(['not json']);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unparseable');
  });

  it('resumeAuditChain continues an existing chain', () => {
    const { lines, sink } = collector();
    const log = new AuditLog({ sink, clock: () => 5 });
    log.record({ type: 'a' });
    log.record({ type: 'b' });

    const { prevHash, seq } = resumeAuditChain(lines);
    expect(seq).toBe(2);
    expect(prevHash).toBe(log.head);

    const resumed = new AuditLog({ sink, clock: () => 6, prevHash, seq });
    resumed.record({ type: 'c' });

    const res = verifyAuditLog(lines);
    expect(res.ok).toBe(true);
    expect(res.entries).toHaveLength(3);
  });

  it('resumeAuditChain returns a fresh chain for an empty log', () => {
    expect(resumeAuditChain([])).toEqual({ prevHash: '0'.repeat(64), seq: 0 });
  });
});
