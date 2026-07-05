// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  PRESETS,
  getPreset,
  ensureGitignore,
  scaffoldPreset,
} from '../../../bin/commands/envScaffold.js';

describe('getPreset', () => {
  it('returns the react-native preset', () => {
    expect(getPreset('react-native')).toBe(PRESETS['react-native']);
  });

  it('throws listing available presets for an unknown name', () => {
    expect(() => getPreset('flutter')).toThrow(
      /Unknown preset "flutter" \(available: react-native\)/
    );
  });
});

describe('react-native preset shape', () => {
  const preset = getPreset('react-native');

  it('ships a strict-JSON .vaultrc (no comments — .vaultrc uses JSON.parse)', () => {
    const rc = preset.files.find((f) => f.path === '.vaultrc');
    expect(rc).toBeTruthy();
    expect(() => JSON.parse(rc.content)).not.toThrow();
    const parsed = JSON.parse(rc.content);
    expect(parsed.deliver).toHaveLength(4);
  });

  it('ships a committed .vtpl template, not a rendered output', () => {
    const tpl = preset.files.find((f) => f.path.endsWith('.vtpl'));
    expect(tpl.content).toMatch(/\{\{API_URL\}\}/);
  });

  it('gitignores the delivered artifacts but not the .vtpl or .env.vault', () => {
    expect(preset.gitignore).toContain('.env');
    expect(preset.gitignore).toContain('ios/GoogleService-Info.plist');
    expect(preset.gitignore).not.toContain('.env.vault');
    expect(preset.gitignore.some((l) => l.endsWith('.vtpl'))).toBe(false);
  });
});

describe('ensureGitignore', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-gi-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('creates .gitignore and adds the lines', async () => {
    const added = await ensureGitignore(dir, ['.env', 'secret']);
    expect(added).toEqual(['.env', 'secret']);
    const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('.env');
    expect(content).toContain('secret');
  });

  it('is idempotent — a second run adds nothing', async () => {
    await ensureGitignore(dir, ['.env', 'secret']);
    const added = await ensureGitignore(dir, ['.env', 'secret']);
    expect(added).toEqual([]);
  });

  it('appends only the missing lines and preserves existing content', async () => {
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n.env\n');
    const added = await ensureGitignore(dir, ['.env', 'ios/Secrets.xcconfig']);
    expect(added).toEqual(['ios/Secrets.xcconfig']);
    const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules');
    // .env kept its single occurrence
    expect(content.match(/^\.env$/gm)).toHaveLength(1);
  });
});

describe('scaffoldPreset', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-scaffold-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('writes every file (creating nested dirs) and reconciles .gitignore', async () => {
    const report = await scaffoldPreset(getPreset('react-native'), {
      cwd: dir,
    });
    expect(report.written).toContain('.vaultrc');
    expect(report.written).toContain('ios/Config/Secrets.xcconfig.vtpl');
    expect(
      await fs.pathExists(path.join(dir, 'ios/Config/Secrets.xcconfig.vtpl'))
    ).toBe(true);
    expect(report.gitignoreAdded.length).toBeGreaterThan(0);
  });

  it('never clobbers an existing file — it reports it as skipped', async () => {
    await fs.writeFile(path.join(dir, '.vaultrc'), '{"custom":true}');
    const report = await scaffoldPreset(getPreset('react-native'), {
      cwd: dir,
    });
    expect(report.skipped).toContain('.vaultrc');
    expect(await fs.readFile(path.join(dir, '.vaultrc'), 'utf-8')).toBe(
      '{"custom":true}'
    );
  });
});
