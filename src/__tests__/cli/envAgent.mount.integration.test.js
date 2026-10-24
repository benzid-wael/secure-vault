// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  cli,
  registerAgentHooks,
  workDir,
  vaultPath,
  waitFor,
  ON_WINDOWS,
} from './agentHarness.js';

registerAgentHooks();

describe.skipIf(ON_WINDOWS)(
  'vault env agent — mount (integration, spawns a real daemon)',
  () => {
    it('mount materializes manifest files; lock wipes them', () => {
      cli(['agent', 'start', '-v', vaultPath]);
      cli(['agent', 'unlock'], { withPassword: true });

      const mount = cli(['agent', 'mount', '--force']);
      expect(mount.status).toBe(0);
      expect(mount.stdout).toMatch(/mounted .env.mounted/);
      expect(mount.stdout).toMatch(/highest-risk/); // the opt-in warning

      expect(fs.readFileSync(path.join(workDir, '.env.mounted'), 'utf-8')).toBe(
        'API_URL=https://api.example.com\n'
      );
      expect(fs.readFileSync(path.join(workDir, 'app.xcconfig'), 'utf-8')).toBe(
        'API_URL = https://api.example.com\n'
      );

      expect(cli(['agent', 'mounts']).stdout).toMatch(/app.xcconfig/);

      // Hard lock wipes the mounts.
      cli(['agent', 'lock']);
      expect(fs.existsSync(path.join(workDir, '.env.mounted'))).toBe(false);
      expect(fs.existsSync(path.join(workDir, 'app.xcconfig'))).toBe(false);
      // template source survives
      expect(fs.existsSync(path.join(workDir, 'app.xcconfig.vtpl'))).toBe(true);
    });

    it('mount without --force is refused (opt-in gate, G26)', () => {
      cli(['agent', 'start', '-v', vaultPath]);
      cli(['agent', 'unlock'], { withPassword: true });

      const r = cli(['agent', 'mount']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/--force/);
      // nothing was materialized
      expect(fs.existsSync(path.join(workDir, '.env.mounted'))).toBe(false);
    });

    it('mount is refused before unlock (I2)', () => {
      cli(['agent', 'start', '-v', vaultPath]);
      const r = cli(['agent', 'mount', '--force']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/locked/);
    });

    it('re-materializes a mounted file deleted out from under a build', async () => {
      cli(['agent', 'start', '-v', vaultPath]);
      cli(['agent', 'unlock'], { withPassword: true });
      cli(['agent', 'mount', '--force']);

      const mounted = path.join(workDir, '.env.mounted');
      expect(fs.existsSync(mounted)).toBe(true);

      fs.rmSync(mounted); // a build step clobbers the mount
      const restored = await waitFor(() => fs.existsSync(mounted));
      expect(restored).toBe(true);
      expect(fs.readFileSync(mounted, 'utf-8')).toBe(
        'API_URL=https://api.example.com\n'
      );
    });
  }
);
