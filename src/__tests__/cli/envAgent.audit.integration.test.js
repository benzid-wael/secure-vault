// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  cli,
  registerAgentHooks,
  agentDir,
  vaultPath,
  NODE,
  ON_WINDOWS,
} from './agentHarness.js';

registerAgentHooks();

describe.skipIf(ON_WINDOWS)(
  'vault env agent — audit (integration, spawns a real daemon)',
  () => {
    it('audit log records unlock + env access and verifies (G27)', () => {
      cli(['agent', 'start', '-v', vaultPath]);
      cli(['agent', 'unlock'], { withPassword: true });
      cli(['agent', 'exec', 'dev', '--', NODE, '-e', '1']);

      const out = cli(['agent', 'audit']).stdout;
      expect(out).toMatch(/unlock/);
      expect(out).toMatch(/get-env/);
      expect(out).toMatch(/via exec/);

      const verify = cli(['agent', 'audit', '--verify']);
      expect(verify.status).toBe(0);
      expect(verify.stdout).toMatch(/audit log OK/);
    });

    it('audit --verify detects a tampered entry', () => {
      cli(['agent', 'start', '-v', vaultPath]);
      cli(['agent', 'unlock'], { withPassword: true });

      const auditPath = path.join(agentDir, 'audit.log');
      const lines = fs
        .readFileSync(auditPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim());
      const first = JSON.parse(lines[0]);
      first.event.result = 'HACKED'; // rewrite history in place
      lines[0] = JSON.stringify(first);
      fs.writeFileSync(auditPath, `${lines.join('\n')}\n`);

      const verify = cli(['agent', 'audit', '--verify']);
      expect(verify.status).not.toBe(0);
      expect(verify.stderr).toMatch(/TAMPERED/);
    });

    it('audit records a rejected unlock', () => {
      cli(['agent', 'start', '-v', vaultPath]);
      cli(['agent', 'unlock', '--password', 'wrong-password']);

      const out = cli(['agent', 'audit']).stdout;
      expect(out).toMatch(/unlock.*\(refused\)/);
    });
  }
);
