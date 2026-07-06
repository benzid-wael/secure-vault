// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { createMountService } from '../../agent/mountService.js';
import { MountRegistry } from '../../agent/mountRegistry.js';
import {
  findProjectConfig,
  secureDelete,
} from '../../../bin/commands/envRunHelpers.js';
import {
  normalizeManifest,
  renderDeliverEntry,
  writeArtifact,
} from '../../../bin/commands/envDeliverHelpers.js';

const OPS = {
  findProjectConfig,
  normalizeManifest,
  renderDeliverEntry,
  writeArtifact,
  readFile: (p) => fs.readFileSync(p, 'utf-8'),
};

const VARS = {
  API_URL: 'https://dev',
  GOOGLE: Buffer.from('blob').toString('base64'),
};

// Controllable fake session honoring the get-env contract.
function fakeSession({ unlocked = true } = {}) {
  return {
    handle(req) {
      if (req.verb !== 'get-env')
        return { ok: false, error: 'unexpected verb' };
      if (!unlocked) return { ok: false, error: 'locked' };
      return { ok: true, data: VARS };
    },
  };
}

let dir;
let registry;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-mountsvc-'));
  await fs.ensureDir(path.join(dir, '.git')); // stop .vaultrc walk-up here
  await fs.writeFile(
    path.join(dir, 'app.xcconfig.vtpl'),
    'API_URL = {{API_URL}}\n'
  );
  await fs.writeJson(path.join(dir, '.vaultrc'), {
    env: 'dev',
    deliver: [
      { path: '.env', format: 'dotenv', keys: ['API_URL'] },
      { path: 'g.bin', from: 'GOOGLE', decode: 'base64' },
      { template: 'app.xcconfig.vtpl' },
    ],
  });
  registry = new MountRegistry({ secureDelete });
});

afterEach(async () => {
  await fs.remove(dir);
});

describe('createMountService.mount', () => {
  it('materializes every manifest artifact and tracks them', async () => {
    const svc = createMountService({
      session: fakeSession(),
      registry,
      cwd: dir,
      ops: OPS,
    });
    const res = await svc.mount({ env: 'dev' });
    expect(res.ok).toBe(true);
    expect(res.data.mounted).toEqual(['.env', 'g.bin', 'app.xcconfig']);

    expect(await fs.readFile(path.join(dir, '.env'), 'utf-8')).toBe(
      'API_URL=https://dev\n'
    );
    expect(await fs.readFile(path.join(dir, 'g.bin'), 'utf-8')).toBe('blob');
    expect(await fs.readFile(path.join(dir, 'app.xcconfig'), 'utf-8')).toBe(
      'API_URL = https://dev\n'
    );
    expect(registry.size).toBe(3);
  });

  it('refuses to mount when the session is locked (I2)', async () => {
    const svc = createMountService({
      session: fakeSession({ unlocked: false }),
      registry,
      cwd: dir,
      ops: OPS,
    });
    const res = await svc.mount({ env: 'dev' });
    expect(res).toEqual({ ok: false, error: 'locked' });
    expect(registry.size).toBe(0);
    expect(await fs.pathExists(path.join(dir, '.env'))).toBe(false);
  });

  it('requires an env name', async () => {
    const svc = createMountService({
      session: fakeSession(),
      registry,
      cwd: dir,
      ops: OPS,
    });
    expect((await svc.mount({})).ok).toBe(false);
  });

  it('errors when there is no delivery manifest', async () => {
    await fs.writeJson(path.join(dir, '.vaultrc'), { env: 'dev' });
    const svc = createMountService({
      session: fakeSession(),
      registry,
      cwd: dir,
      ops: OPS,
    });
    const res = await svc.mount({ env: 'dev' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no delivery manifest/);
  });

  it('wipeAll (lock path) removes the materialized files', async () => {
    const svc = createMountService({
      session: fakeSession(),
      registry,
      cwd: dir,
      ops: OPS,
    });
    await svc.mount({ env: 'dev' });
    registry.wipeAll();
    expect(registry.size).toBe(0);
    expect(await fs.pathExists(path.join(dir, '.env'))).toBe(false);
    expect(await fs.pathExists(path.join(dir, 'g.bin'))).toBe(false);
    // the template SOURCE is not a mount and must survive
    expect(await fs.pathExists(path.join(dir, 'app.xcconfig.vtpl'))).toBe(true);
  });

  it('list and unmount reflect the registry', async () => {
    const svc = createMountService({
      session: fakeSession(),
      registry,
      cwd: dir,
      ops: OPS,
    });
    await svc.mount({ env: 'dev' });
    expect(svc.list().data.mounts).toHaveLength(3);
    const res = svc.unmount({});
    expect(res.data.mounts).toHaveLength(0);
  });
});
