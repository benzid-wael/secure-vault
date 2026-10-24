// @vitest-environment node
// New-40: packaged builds refuse Chromium's remote-debugging switches.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  DEBUG_SWITCHES,
  readAllowDebugPort,
  refusedDebugSwitch,
} from '../../../electron/utils/debugSwitches.js';

const launch = (switches, over = {}) => ({
  isPackaged: true,
  allowDebugPort: false,
  hasSwitch: (name) => switches.includes(name),
  ...over,
});

describe('refusedDebugSwitch', () => {
  it.each(DEBUG_SWITCHES)('refuses --%s in a packaged build', (name) => {
    expect(refusedDebugSwitch(launch([name]))).toBe(name);
  });

  it('lets a normal launch through', () => {
    expect(refusedDebugSwitch(launch(['enable-logging']))).toBeNull();
  });

  it('keeps the switch for dev runs and for the twin build', () => {
    const port = ['remote-debugging-port'];
    expect(refusedDebugSwitch(launch(port, { isPackaged: false }))).toBeNull();
    expect(
      refusedDebugSwitch(launch(port, { allowDebugPort: true }))
    ).toBeNull();
  });
});

describe('readAllowDebugPort', () => {
  let dir;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const withPkg = (pkg) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-debug-'));
    if (pkg !== undefined) {
      fs.writeFileSync(path.join(dir, 'package.json'), pkg);
    }
    return dir;
  };

  it('is on only when the packaged package.json says so', () => {
    expect(readAllowDebugPort(withPkg('{"allowDebugPort": true}'))).toBe(true);
  });
  it.each([
    ['set as a string by the build CLI', '{"allowDebugPort": "true"}', true],
    ['absent', '{"name": "app"}', false],
    ['anything else', '{"allowDebugPort": 1}', false],
    ['a broken file', '{', false],
    ['no file', undefined, false],
  ])('%s', (_, pkg, want) => {
    expect(readAllowDebugPort(withPkg(pkg))).toBe(want);
  });
});
