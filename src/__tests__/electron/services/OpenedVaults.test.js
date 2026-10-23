// @vitest-environment node
// Password vaults opened from other folders (GUI-ENV-BREAKDOWN New-53).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { OpenedVaults } from '../../../electron/services/OpenedVaults.js';

let dir;
let file;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-opened-'));
  file = path.join(dir, 'data', 'gui-opened-vaults.json');
});
afterEach(() => fs.remove(dir));

const at = (...parts) => path.join(dir, ...parts);

describe('OpenedVaults', () => {
  it('names a file after itself and keeps the list across runs, 0600', async () => {
    const opened = new OpenedVaults({ file });
    expect(await opened.add(at('team', 'team.vault'))).toBe('team');
    expect(opened.pathOf('team')).toBe(at('team', 'team.vault'));
    expect(opened.nameOf(at('team', 'team.vault'))).toBe('team');

    const later = new OpenedVaults({ file });
    expect(later.list()).toEqual([
      { name: 'team', path: at('team', 'team.vault') },
    ]);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps one name per file', async () => {
    const opened = new OpenedVaults({ file });
    await opened.add(at('a', 'team.vault'));
    expect(await opened.add(at('a', '..', 'a', 'team.vault'))).toBe('team');
    expect(opened.names()).toEqual(['team']);
  });

  it('avoids names in use, in the app folder or the list', async () => {
    const opened = new OpenedVaults({ file });
    expect(await opened.add(at('a', 'team.vault'), ['team'])).toBe('team (2)');
    expect(await opened.add(at('b', 'team.vault'), ['team'])).toBe('team (3)');
  });

  it.each([
    ['notes.json', 'notes.json'],
    ['a:b|c?.vault', 'a-b-c-'],
    ['.vault', 'vault'],
    [`${'x'.repeat(60)}.vault`, 'x'.repeat(50)],
  ])('makes a valid name of %s', async (base, name) => {
    const opened = new OpenedVaults({ file });
    expect(await opened.add(at(base))).toBe(name);
  });

  it('shortens a long name to fit its number', async () => {
    const opened = new OpenedVaults({ file });
    const long = 'y'.repeat(60);
    await opened.add(at('a', `${long}.vault`));
    const second = await opened.add(at('b', `${long}.vault`));
    expect(second).toBe(`${'y'.repeat(46)} (2)`);
    expect(second.length).toBeLessThanOrEqual(50);
  });

  it('removes an entry, the file untouched', async () => {
    const opened = new OpenedVaults({ file });
    await fs.outputFile(at('a', 'team.vault'), '{}');
    await opened.add(at('a', 'team.vault'));
    expect(await opened.remove('team')).toBe(true);
    expect(await opened.remove('team')).toBe(false);
    expect(opened.pathOf('team')).toBeNull();
    expect(new OpenedVaults({ file }).list()).toEqual([]);
    expect(fs.existsSync(at('a', 'team.vault'))).toBe(true);
  });

  it('drops entries it cannot trust from a damaged file', async () => {
    await fs.outputJson(file, [
      { name: 'ok', path: at('ok.vault') },
      { name: 'ok', path: at('dup-name.vault') },
      { name: 'other', path: at('ok.vault') },
      { name: 'rel', path: 'relative.vault' },
      { name: 'bad/name', path: at('bad.vault') },
      { name: '', path: at('empty.vault') },
      { name: 'x'.repeat(51), path: at('long.vault') },
      { path: at('no-name.vault') },
      null,
    ]);
    expect(new OpenedVaults({ file }).list()).toEqual([
      { name: 'ok', path: at('ok.vault') },
    ]);
  });

  it('starts empty from a missing or unreadable file', async () => {
    expect(new OpenedVaults({ file }).list()).toEqual([]);
    await fs.outputFile(file, 'not json');
    expect(new OpenedVaults({ file }).list()).toEqual([]);
    await fs.outputJson(file, { not: 'a list' });
    expect(new OpenedVaults({ file }).list()).toEqual([]);
  });
});
